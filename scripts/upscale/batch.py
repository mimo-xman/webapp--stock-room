#!/usr/bin/env python3
"""
Batch upscale — Real-ESRGAN via GitHub Actions, PARALLEL worker edition.

The workflow runs N copies of this script at the same time (matrix jobs).
Each copy loops:

    claim one eligible image (atomic POST — upscales count < max, active,
    not already claimed; images_to_bay via /api/images/claim, or the images
    nested in Etsy products via /api/etsy-products/claim with --source etsy)
        → upscale → upload Cloudinary → POST …/upscales
        → release 'ok'
    claim the next one… until the API answers "nothing to claim".

The claim is atomic (findOneAndUpdate), so N workers never process the same
image twice. Every attempt ALWAYS ends with a release:

    ok      → in_use cleared, error cleared
    stopped → in_use cleared (cancelled / limit raced / image vanished)
    error   → in_use cleared + image marked active:false + error_message
              recorded — visible in the webapp, which can re-activate it

A claim older than --stale-minutes (default 30) is considered dead (a worker
killed without cleanup) and is reclaimable — no image can stay locked forever.

Sources:
  --source images (default) — sellable images (images_to_bay). The historical
      behavior, unchanged: the daily upscale-batch workflow runs this.
  --source etsy             — the images nested inside Etsy products
      (etsy_products.images[]). Same protocol, dedicated routes: the daily
      upscale-etsy-batch workflow runs this (own schedule, own concurrency
      group, its own Cloudinary folder by default).

Exit codes:
  0 — done (or nothing eligible, or dry-run listing)
  1 — fatal configuration/API error, or at least one image hard-failed
      (GitHub will show the run as failed and notify you).

Run locally (see docs/UPSCALE.md):
  python3 scripts/upscale/batch.py --api-url http://localhost:3333 \
      --api-key <AGENT_KEY> --scale 4 --max-images 5 --dry-run
  python3 scripts/upscale/batch.py --source etsy --dry-run
"""

from __future__ import annotations

import argparse
import signal
import sys

from upscale_lib import (
    AssetApi,
    CloudinaryUploader,
    ImageSkipped,
    JobError,
    LimitReached,
    RealEsrganUpscaler,
    Ref,
    SOURCE_ETSY,
    build_config,
    handle_fatal,
    log,
    process_image,
    write_summary,
)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        prog="batch.py",
        description=(
            "Upscale eligible images in a claim loop (several copies of this "
            "script can run concurrently — each claims a different image)."
        ),
    )
    parser.add_argument("--api-url", default="", help="Asset API base URL (défaut : secret ASSET_API_URL)")
    parser.add_argument("--api-key", default="", help="Clé de l'agent (défaut : secret ASSET_API_KEY)")
    parser.add_argument(
        "--max-upscales",
        default="",
        dest="max_upscales",
        help="Nombre max d'upscales par image (défaut : secret MAX_NUMBER_OF_UPSCALES_PER_IMAGE, sinon 1)",
    )
    parser.add_argument(
        "--scale",
        default="",
        help="Facteur d'upscale 2-8 (défaut : secret DEFAULT_SCALE, sinon 4)",
    )
    parser.add_argument(
        "--model",
        default="",
        help="RealESRGAN_x4plus | RealESRGAN_x2plus | realesr-general-x4v3 (défaut : RealESRGAN_x4plus)",
    )
    parser.add_argument(
        "--max-images",
        type=int,
        default=None,
        help="Nombre max d'images traitées par CE worker (défaut : 5 ; total = max_images × nb workers)",
    )
    parser.add_argument(
        "--tile-workers",
        default="",
        dest="tile_workers",
        help="Processus parallèles pour les tuiles Real-ESRGAN (défaut : auto = min(4, cœurs CPU))",
    )
    parser.add_argument(
        "--stale-minutes",
        default="",
        dest="stale_minutes",
        help="Une réservation plus vieille que X minutes est considérée morte et reprisable (défaut : 30)",
    )
    parser.add_argument(
        "--max-no-progress",
        type=int,
        default=10,
        dest="max_no_progress",
        help=(
            "Arrêt de sécurité après N réclamations consécutives sans progression "
            "(claim ignoré pour quota atteint) — protege contre une boucle infinie "
            "claim/skip si la politique de l'API divergeait de celle du worker (défaut : 10)"
        ),
    )
    parser.add_argument("--cloudinary-folder", default="", help="Dossier Cloudinary (défaut : adobe-stock/upscales)")
    parser.add_argument("--model-dir", default="", help="Dossier de cache des modèles (défaut : ~/.cache/upscale-models)")
    parser.add_argument(
        "--output-format",
        default="",
        choices=["", "jpg", "png"],
        help="Format de sortie : jpg (défaut — prêt pour Adobe Stock, ~2-4 Mo) ou png (lossless, lourd)",
    )
    parser.add_argument("--jpeg-quality", default="", help="Qualité JPEG 80-100 (défaut : 95, réduite auto si > limite Cloudinary)")
    parser.add_argument(
        "--source",
        default="",
        choices=["", "images", "etsy"],
        help="Cible : images = images à vendre (images_to_bay, défaut) ; etsy = images imbriquées dans les produits Etsy",
    )
    parser.add_argument("--dry-run", action="store_true", help="Lister les images éligibles sans rien faire")
    return parser.parse_args(argv)


class ClaimGuard:
    """Tracks the image currently claimed by THIS worker and guarantees a
    release on every exit path — normal, exception, or SIGINT/SIGTERM
    (GitHub "Cancel workflow"). A release failure is only warned about:
    the stale window (30 min) recovers the lock anyway."""

    def __init__(self, api: AssetApi, stale_minutes: int):
        self.api = api
        self.stale_minutes = stale_minutes
        self.ref: Ref | None = None
        self.title: str = ""
        # Cancellation → release as 'stopped' before dying.
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                signal.signal(sig, self._on_signal)
            except (ValueError, OSError):
                pass  # not the main thread / unsupported platform

    def _on_signal(self, signum, frame):
        self.release("stopped")
        log(f"🛑 signal {signum} — réservation libérée, arrêt du worker.")
        sys.exit(128 + signum)

    def hold(self, image_doc: dict) -> None:
        self.ref = Ref.from_doc(image_doc)
        self.title = image_doc.get("title", "")

    def release(self, status: str, error_message: str = "") -> None:
        if not self.ref:
            return
        ref, self.ref, self.title = self.ref, None, ""
        try:
            self.api.release(ref, status, error_message)
        except Exception as e:  # noqa: BLE001 — release must never crash the loop
            log(
                f"⚠ release {ref.image_id} ({status}) a échoué — {e}. La fenêtre "
                f"stale ({self.stale_minutes} min) libérera la réservation."
            )


def main(argv=None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    try:
        config = build_config(args)
    except JobError as e:
        return handle_fatal(e, "configuration du job")

    api = AssetApi(config.api_url, config.api_key)

    # ── wake the API up first (Render free tier spins services down) ──
    try:
        api.wait_until_ready()
    except JobError as e:
        return handle_fatal(e, "réveil de l'API")

    # ── dry-run: list eligible images WITHOUT claiming anything ──
    if config.dry_run:
        try:
            images = api.list_eligible(config.source, config.max_upscales, config.max_images)
        except JobError as e:
            return handle_fatal(e, "récupération des images éligibles")
        source_label = "produits Etsy" if config.source == SOURCE_ETSY else "images à vendre"
        log(
            f"[dry-run] {len(images)} {source_label} éligible(s) "
            f"(active, non réservée, < {config.max_upscales} upscale(s)) :"
        )
        for i in images:
            log(f"  · {i.get('title')} [{i['_id']}] — {len(i.get('upscales') or [])}/{config.max_upscales} upscales")
        write_summary(
            f"Upscale batch — dry-run ({'Etsy' if config.source == SOURCE_ETSY else 'images'})",
            f"{len(images)} image(s) éligible(s) (aucun traitement effectué).",
            [
                {"status": "skipped", "image_id": str(i["_id"]), "title": i.get("title", ""),
                 "detail": f"éligible ({len(i.get('upscales') or [])}/{config.max_upscales} upscales) — dry-run"}
                for i in images
            ],
        )
        return 0

    log(
        f"Politique : source {config.source} · max {config.max_upscales} upscale(s)/image · "
        f"échelle ×{config.scale} · modèle {config.model} · {config.max_images} image(s) max "
        f"par worker · {config.tile_workers} worker(s) de tuiles"
    )

    # ── heavy setup: model + Cloudinary pool (before the first claim, so
    #    reservations stay short) ──
    try:
        upscaler = RealEsrganUpscaler(config.model, config.model_dir, tile_workers=config.tile_workers)
        upscaler._load()  # fail here, before touching any image
        uploader = CloudinaryUploader(config)
    except JobError as e:
        return handle_fatal(e, "initialisation Real-ESRGAN / Cloudinary")

    guard = ClaimGuard(api, config.stale_minutes)
    results = []
    processed = 0
    # Safety: a skipped-for-quota claim does NOT change the image state — if
    # the API kept returning ineligible images (policy drift, projection bug,
    # stale aggregation…), this loop would spin forever while the workflow
    # burns its whole 60-min timeout. Two guards break the loop:
    #   no_progress  — N consecutive claims skipped for quota in a row;
    #   repeat_claims — the SAME image claimed more than 3 times, ever.
    no_progress = 0
    claim_counts = {}  # image_id → nombre de réclamations par CE worker

    # ── claim loop: keep going until the API says "nothing to claim" ──
    while processed < config.max_images:
        try:
            image_doc = api.claim(config.source, config.max_upscales, config.stale_minutes)
        except JobError as e:
            return handle_fatal(e, "réservation d'image (claim)")

        if image_doc is None:
            if processed == 0 and not results:
                source_label = "aucune image Etsy" if config.source == SOURCE_ETSY else "aucune image"
                log(
                    f"✓ {source_label.title()} éligible — toutes ont atteint leur quota "
                    "d'upscales, sont en pause (active:false) ou sont réservées."
                )
            else:
                log("✓ Plus rien à réclamer — tous les autres workers ont le reste.")
            break

        image_id = str(image_doc["_id"])
        title = image_doc.get("title", "(sans titre)")
        guard.hold(image_doc)
        log(f"→ réclamée : {title} [{image_id}] ({len(image_doc.get('upscales') or [])}/{config.max_upscales})")

        claim_counts[image_id] = claim_counts.get(image_id, 0) + 1
        if claim_counts[image_id] > 3:
            guard.release("stopped")
            results.append({
                "status": "skipped",
                "image_id": image_id,
                "title": title,
                "detail": (
                    f"image réclamée {claim_counts[image_id]} fois par CE worker sans aboutir — "
                    "boucle suspectée côté API (politique d'éligibilité incohérente), arrêt de sécurité"
                ),
            })
            log(
                f"⚠ {title} [{image_id}] réclamée {claim_counts[image_id]} fois sans aboutir — "
                "boucle suspectée : arrêt du worker (les autres continuent)."
            )
            break

        try:
            record = process_image(config, api, upscaler, uploader, image_doc)
            results.append(record)
            processed += 1
            no_progress = 0
            guard.release("ok")
            log(f"✅ {record['title']} → ×{record['scale']} {record['dimensions']} ({record['url']})")
        except LimitReached as e:
            # Another worker registered an upscale between our claim and our
            # registration — the image is simply done. Not a failure.
            results.append({
                "status": "skipped",
                "image_id": image_id,
                "title": title,
                "detail": str(e),
            })
            guard.release("stopped")
            no_progress += 1
            log(f"⏭️  {title} — ignorée : {e}")
            if no_progress >= max(1, args.max_no_progress):
                log(
                    f"⚠ {no_progress} réclamations consécutives ignorées (quota déjà atteint) — "
                    "arrêt de sécurité du worker : l'API semble renvoyer des images non éligibles."
                )
                break
        except ImageSkipped as e:
            # Dead source link, empty file, image deleted meanwhile… these do
            # not heal by retrying: mark the image inactive with the reason,
            # so the owner sees it in the webapp and re-activates it if fixed.
            results.append({
                "status": "skipped",
                "image_id": image_id,
                "title": title,
                "detail": str(e),
            })
            guard.release("error", error_message=f"ignorée : {e}")
            log(f"⏭️  {title} — ignorée et mise en pause : {e}")
        except JobError as e:
            results.append({
                "status": "failed",
                "image_id": image_id,
                "title": title,
                "detail": str(e),
            })
            guard.release("error", error_message=str(e))
            log(f"❌ {title} — échec (image mise en pause) : {e}")
        except KeyboardInterrupt:
            guard.release("stopped")
            upscaler.close()
            raise

    guard.release("stopped")  # no-op when nothing is held
    upscaler.close()

    failed = sum(1 for r in results if r["status"] == "failed")
    ok = sum(1 for r in results if r["status"] == "ok")
    source_label = "Etsy product images" if config.source == SOURCE_ETSY else "sellable images"
    write_summary(
        f"Upscale batch — {source_label} (worker parallèle)",
        f"Source {config.source} · échelle ×{config.scale} · modèle {config.model} · "
        f"max {config.max_upscales} upscale(s)/image · "
        f"{config.tile_workers} worker(s) de tuiles.",
        results,
    )

    if failed:
        print(
            f"\n✖ {failed} image(s) en échec sur {len(results)} — elles sont "
            "passées en active:false avec leur error_message (visibles dans la "
            "webapp). Réactivez-les après correction, puis relancez le workflow.",
            file=sys.stderr,
            flush=True,
        )
        return 1
    log(f"\n✓ Terminé : {ok} image(s) upscalée(s), 0 échec.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
