#!/usr/bin/env python3
"""
Single-image upscale — Real-ESRGAN via GitHub Actions (manual workflow).

Takes an image id and processes exactly that image:
  1. the image must EXIST  → otherwise a clear message + exit 1;
  2. its upscale count must be BELOW max_upscales (secret default 1,
     overridable by input/CLI) → otherwise the job STOPS with a clear
     message and exit 0 (expected business rule, not an error);
  3. download → Real-ESRGAN → Cloudinary → POST /api/images/:id/upscales.

Exit codes:
  0 — image upscaled, OR clean stop (limit already reached)
  1 — image not found, or fatal error (config/API/upscale/upload)

Run locally (see docs/UPSCALE.md):
  python3 scripts/upscale/single.py --image-id 65f1a2b3c4d5e6f7a8b9c0d1 \
      --api-url http://localhost:3333 --api-key <AGENT_KEY> --scale 4
"""

from __future__ import annotations

import argparse
import sys

from upscale_lib import (
    AssetApi,
    CloudinaryUploader,
    ImageSkipped,
    JobError,
    LimitReached,
    RealEsrganUpscaler,
    build_config,
    handle_fatal,
    log,
    process_image,
    write_summary,
)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        prog="single.py",
        description="Upscale ONE image by id (Real-ESRGAN → Cloudinary → base).",
    )
    parser.add_argument(
        "--image-id",
        required=True,
        help="MongoDB _id de l'image (24 caractères hex, visible dans la webapp)",
    )
    parser.add_argument("--api-url", default="", help="Asset API base URL (défaut : secret ASSET_API_URL)")
    parser.add_argument("--api-key", default="", help="Clé de l'agent (défaut : secret ASSET_API_KEY)")
    parser.add_argument(
        "--max-upscales",
        default="",
        dest="max_upscales",
        help="Stop si l'image a déjà ce nombre d'upscales (défaut : secret MAX_NUMBER_OF_UPSCALES_PER_IMAGE, sinon 1)",
    )
    parser.add_argument("--scale", default="", help="Facteur d'upscale 2-8 (défaut : secret DEFAULT_SCALE, sinon 4)")
    parser.add_argument(
        "--model",
        default="",
        help="RealESRGAN_x4plus | RealESRGAN_x2plus | realesr-general-x4v3 (défaut : RealESRGAN_x4plus)",
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
    parser.add_argument("--dry-run", action="store_true", help="Vérifier l'image et la limite sans rien faire")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    image_id = args.image_id.strip()

    try:
        config = build_config(args)
    except JobError as e:
        return handle_fatal(e, "configuration du job")

    api = AssetApi(config.api_url, config.api_key)

    # ── step 0 : wake the API up if Render put it to sleep ──
    try:
        api.wait_until_ready()
    except JobError as e:
        return handle_fatal(e, "réveil de l'API")

    # ── step 1 : the image must exist ──
    try:
        image = api.get_image(image_id)
    except JobError as e:
        return handle_fatal(e, f"récupération de l'image {image_id}")

    if image is None:
        print(
            f"\n✖ IMAGE INTROUVABLE\n"
            f"  Aucune image avec l'identifiant « {image_id} » dans la base.\n"
            f"  → Vérifiez l'id dans la webapp (détail d'une image → champ « id »)\n"
            f"  → ou listez les images : GET {config.api_url}/api/images?limit=100\n",
            file=sys.stderr,
            flush=True,
        )
        return 1

    title = image.get("title", "(sans titre)")
    current = len(image.get("upscales") or [])
    log(f"Image : {title} [{image_id}] — {current} upscale(s) enregistré(s)")

    # ── step 2 : upscale count must be BELOW max ──
    if current >= config.max_upscales:
        message = (
            f"L'image « {title} » a déjà {current} upscale(s) — "
            f"le maximum autorisé est {config.max_upscales}. "
            "Le job s'arrête proprement. Pour la traiter quand même : "
            "supprimez un upscale existant dans la webapp, ou relancez le "
            "workflow avec un input « max upscales » plus élevé."
        )
        log(f"\n🛑 STOP — {message}")
        write_summary(
            "Upscale image unique — stop",
            message,
            [{
                "status": "stopped",
                "image_id": image_id,
                "title": title,
                "detail": f"{current}/{config.max_upscales} upscales déjà enregistrés",
            }],
        )
        return 0

    if config.dry_run:
        message = (
            f"[dry-run] L'image « {title} » est éligible : {current}/{config.max_upscales} "
            f"upscales, échelle ×{config.scale} prévue. Aucun traitement effectué."
        )
        log(message)
        write_summary("Upscale image unique — dry-run", message, [])
        return 0

    # ── step 3 : process (download → upscale → upload → register) ──
    try:
        upscaler = RealEsrganUpscaler(config.model, config.model_dir)
        upscaler._load()
        uploader = CloudinaryUploader(config)
        record = process_image(config, api, upscaler, uploader, image)
    except LimitReached as e:  # raced with another run / stale count
        message = f"Limite atteinte au moment d'enregistrer — {e}"
        log(f"\n🛑 STOP — {message}")
        write_summary(
            "Upscale image unique — stop",
            message,
            [{"status": "stopped", "image_id": image_id, "title": title, "detail": str(e)}],
        )
        return 0
    except ImageSkipped as e:
        print(f"\n✖ IMPOSSIBLE DE TRAITER L'IMAGE\n  {e}\n", file=sys.stderr, flush=True)
        write_summary(
            "Upscale image unique — ignorée",
            str(e),
            [{"status": "skipped", "image_id": image_id, "title": title, "detail": str(e)}],
        )
        return 1
    except JobError as e:
        return handle_fatal(e, f"traitement de l'image {image_id}")

    write_summary(
        "Upscale image unique",
        f"Échelle ×{config.scale} · modèle {config.model} · run {config.run_id or 'local'}.",
        [record],
    )
    log(f"\n✓ Image upscalée : {record['title']} → ×{record['scale']} {record['dimensions']}")
    log(f"  {record['url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
