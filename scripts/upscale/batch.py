#!/usr/bin/env python3
"""
Batch upscale — Real-ESRGAN via GitHub Actions.

Processes every image whose upscale count is BELOW max_upscales_per_image
(repo secret MAX_NUMBER_OF_UPSCALES_PER_IMAGE, default 1 — overridable
by workflow input or CLI flag), oldest first, capped at --max-images.

Each successful image:
  download (API proxy) → Real-ESRGAN → upload to Cloudinary →
  POST /api/images/:id/upscales (registered on the image document).

Exit codes:
  0 — done (or nothing eligible, or dry-run listing)
  1 — fatal configuration/API error, or at least one image hard-failed
      (GitHub will show the run as failed and notify you).

Run locally (see docs/UPSCALE.md):
  python3 scripts/upscale/batch.py --api-url http://localhost:3333 \
      --api-key <AGENT_KEY> --scale 4 --max-images 5 --dry-run
"""

from __future__ import annotations

import argparse
import sys

from upscale_lib import (
    AssetApi,
    CloudinaryUploader,
    ImageSkipped,
    JobError,
    RealEsrganUpscaler,
    build_config,
    handle_fatal,
    log,
    process_image,
    write_summary,
)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        prog="batch.py",
        description="Upscale all eligible images (upscale count < max_upscales_per_image), oldest first.",
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
        help="Nombre max d'images traitées dans cette exécution (défaut : 5, quota Actions oblige)",
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
    parser.add_argument("--dry-run", action="store_true", help="Lister les images éligibles sans rien faire")
    return parser.parse_args(argv)


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

    # ── eligibility listing (fail fast, before any heavy import) ──
    try:
        images = api.list_eligible(config.max_upscales, config.max_images)
    except JobError as e:
        return handle_fatal(e, "récupération des images éligibles")

    log(
        f"Politique : max {config.max_upscales} upscale(s)/image · échelle ×{config.scale} · "
        f"modèle {config.model} · {config.max_images} image(s) max"
    )

    if not images:
        log(
            f"✓ Aucune image éligible — toutes les images ont déjà atteint "
            f"{config.max_upscales} upscale(s), ou la base est vide."
        )
        write_summary(
            "Upscale batch — rien à faire",
            f"Aucune image avec moins de {config.max_upscales} upscale(s).",
            [],
        )
        return 0

    if config.dry_run:
        results = [
            {"status": "skipped", "image_id": str(i["_id"]), "title": i.get("title", ""),
             "detail": f"éligible ({len(i.get('upscales') or [])}/{config.max_upscales} upscales) — dry-run"}
            for i in images
        ]
        log(f"[dry-run] {len(images)} image(s) éligible(s) :")
        for i in images:
            log(f"  · {i.get('title')} [{i['_id']}] — {len(i.get('upscales') or [])}/{config.max_upscales} upscales")
        write_summary(
            "Upscale batch — dry-run",
            f"{len(images)} image(s) éligible(s) (aucun traitement effectué).",
            results,
        )
        return 0

    # ── heavy setup: model + Cloudinary (after eligibility is confirmed) ──
    try:
        upscaler = RealEsrganUpscaler(config.model, config.model_dir)
        upscaler._load()  # fail here, before touching any image
        uploader = CloudinaryUploader(config)
    except JobError as e:
        return handle_fatal(e, "initialisation Real-ESRGAN / Cloudinary")

    # ── process each image; one failure never stops the run ──
    results = []
    for image_doc in images:
        try:
            record = process_image(config, api, upscaler, uploader, image_doc)
            results.append(record)
            log(f"✅ {record['title']} → ×{record['scale']} {record['dimensions']} ({record['url']})")
        except ImageSkipped as e:
            results.append({
                "status": "skipped",
                "image_id": str(image_doc["_id"]),
                "title": image_doc.get("title", ""),
                "detail": str(e),
            })
            log(f"⏭️  {image_doc.get('title')} — ignorée : {e}")
        except JobError as e:
            results.append({
                "status": "failed",
                "image_id": str(image_doc["_id"]),
                "title": image_doc.get("title", ""),
                "detail": str(e),
            })
            log(f"❌ {image_doc.get('title')} — échec : {e}")

    failed = sum(1 for r in results if r["status"] == "failed")
    ok = sum(1 for r in results if r["status"] == "ok")
    write_summary(
        "Upscale batch",
        f"Échelle ×{config.scale} · modèle {config.model} · max {config.max_upscales} upscale(s)/image.",
        results,
    )

    if failed:
        print(
            f"\n✖ {failed} image(s) en échec sur {len(results)} — relancez le workflow "
            "(les images déjà traitées sont ignorées automatiquement).",
            file=sys.stderr,
            flush=True,
        )
        return 1
    log(f"\n✓ Terminé : {ok} image(s) upscalée(s), 0 échec.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
