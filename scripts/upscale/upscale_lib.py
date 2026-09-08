"""
Shared library for the Real-ESRGAN upscale jobs (GitHub Actions).

Used by scripts/upscale/batch.py (daily / manual batch) and
scripts/upscale/single.py (one image). Keeps the heavy imports
(torch, cv2, realesrgan, cloudinary) LAZY so that argument and
config errors fail fast, before any multi-hundred-megabyte import.

Operational messages are in French on purpose — they are read by the
repo owner in the Actions logs. See docs/UPSCALE.md for the full guide.
"""

from __future__ import annotations

import math
import multiprocessing
import os
import sys
import tempfile
import threading
import time
from dataclasses import dataclass


# ── errors ───────────────────────────────────────────────────────────────────

class JobError(Exception):
    """Fatal, job-level error → the process exits 1 with a clear message."""


class ImageSkipped(Exception):
    """Expected, per-image stop (dead link, limit reached, image gone…).
    Not a failure: reported in the summary, run stays green."""


class LimitReached(ImageSkipped):
    """The image already holds the maximum number of upscales."""


def log(msg: str) -> None:
    with _STDOUT_LOCK:
        print(msg, flush=True)


def die(msg: str) -> "JobError":
    return JobError(msg)


# ── heartbeat (GitHub Actions expects regular log output) ─────────────────

HEARTBEAT_INTERVAL = float(os.environ.get("HEARTBEAT_SECONDS", "5") or 5)
_STDOUT_LOCK = threading.Lock()


class Heartbeat:
    """Timer imprimé toutes les `interval` secondes pendant une phase longue
    et silencieuse (téléchargement/chargement du modèle, upscale, upload).

    GitHub Actions n'interrompt pas un job silencieux, mais un run de 10+ min
    sans aucune sortie ressemble à un hang : ces lignes ⏱ hh:mm:ss prouvent
    que le processus vit et permettent de suivre l'avancement.

    Usage :
        with Heartbeat("upscale ×4 en cours"):
            …
    """

    def __init__(self, label: str, interval: float | None = None):
        self.label = label
        self.interval = interval if interval and interval > 0 else HEARTBEAT_INTERVAL
        self._started = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "Heartbeat":
        self._started = time.monotonic()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc) -> bool:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self.interval + 2)
        return False

    def _run(self) -> None:
        # Première ligne immédiate (00:00:00), puis une par intervalle —
        # la sortie du contexte stoppe le thread (Event.wait → True).
        while True:
            self._print_elapsed()
            if self._stop.wait(self.interval):
                return

    def _print_elapsed(self) -> None:
        elapsed = int(time.monotonic() - self._started)
        h, rem = divmod(elapsed, 3600)
        m, s = divmod(rem, 60)
        with _STDOUT_LOCK:
            print(f"⏱ {h:02d}:{m:02d}:{s:02d} · {self.label}", flush=True)


# ── configuration ────────────────────────────────────────────────────────────

# Real-ESRGAN model registry (official weights from xinntao/Real-ESRGAN).
MODEL_REGISTRY = {
    "RealESRGAN_x4plus": {
        "file": "RealESRGAN_x4plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        "arch": "rrdbnet_x4",
        "note": "généraliste photo, très bon pour la photo stock",
    },
    "RealESRGAN_x2plus": {
        "file": "RealESRGAN_x2plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
        "arch": "rrdbnet_x2",
        "note": "x2 natif — plus rapide, moins de zoom",
    },
    "realesr-general-x4v3": {
        "file": "realesr-general-x4v3.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
        "arch": "srvgg_compact",
        "note": "modèle compact, rapide, bon compromis qualité/vitesse",
    },
}

DEFAULT_MODEL = "RealESRGAN_x4plus"
DEFAULT_MAX_UPSCALES = 1   # mirrors the documented secret default
DEFAULT_SCALE = 4          # mirrors the documented secret default
DEFAULT_MAX_IMAGES = 5     # GitHub Actions free quota friendly

# ── sources ──────────────────────────────────────────────────────────────────
# 'images' → the sellable images (collection images_to_bay) — the historical
#             target of the batch workflow, UNCHANGED behavior.
# 'etsy'   → the images nested inside Etsy products (etsy_products.images[]) —
#             same claim/release/upscale protocol, dedicated nested routes
#             (the two collections were split apart, each keeps its own job).
SOURCES = ("images", "etsy")
SOURCE_IMAGES = "images"
SOURCE_ETSY = "etsy"

# Default Cloudinary folders — one per source keeps the media library tidy
# and matches the two businesses (stock marketplaces vs Etsy products).
DEFAULT_CLOUDINARY_FOLDERS = {
    SOURCE_IMAGES: "adobe-stock/upscales",
    SOURCE_ETSY: "etsy-products/upscales",
}


@dataclass
class Ref:
    """WHERE an image to upscale lives: a standalone sellable image
    (images_to_bay) or one image nested inside an Etsy product. Both flow
    through the same pipeline — only the API routes differ."""

    source: str = SOURCE_IMAGES
    image_id: str = ""
    product_id: str = ""   # etsy only

    @classmethod
    def from_doc(cls, doc: dict) -> "Ref":
        return cls(
            source=str(doc.get("source") or SOURCE_IMAGES),
            image_id=str(doc.get("_id") or ""),
            product_id=str(doc.get("product_id") or ""),
        )

    @property
    def label(self) -> str:
        return "image Etsy" if self.source == SOURCE_ETSY else "image"

# Parallel tile workers. "auto" = one worker per CPU core, capped at 4 —
# the public-repo GitHub runners are 4-vCPU/16GB, and each worker runs the
# model single-threaded so N workers use exactly N cores.
DEFAULT_TILE_WORKERS = "auto"
TILE_WORKERS_MAX = 16

# ── output format policy ──────────────────────────────────────────────────
# Upscales are destined for Adobe Stock: photo submissions there are JPEG.
# A ×4 PNG (lossless) easily passes 10 Mo — Cloudinary's free-plan per-file
# cap — while the SAME dimensions in JPEG q95 weigh ~2-4 Mo. JPEG is therefore
# the DEFAULT; PNG stays available for explicit lossless needs (--output-format png).
DEFAULT_OUTPUT_FORMAT = "jpg"
DEFAULT_JPEG_QUALITY = 95
JPEG_QUALITY_FLOOR = 80
CLOUDINARY_FREE_MAX_BYTES = 10 * 1024 * 1024   # 10 Mo — free plan per-file limit
UPLOAD_SIZE_SAFETY = 512 * 1024                # stay safely under the account limit


@dataclass
class JobConfig:
    api_url: str
    api_key: str
    max_upscales: int
    scale: int
    model: str
    max_images: int
    cloudinary_cloud_name: str
    cloudinary_api_key: str
    cloudinary_api_secret: str
    cloudinary_folder: str
    model_dir: str
    source: str = SOURCE_IMAGES                        # 'images' | 'etsy'
    dry_run: bool = False
    run_id: str = ""
    output_format: str = DEFAULT_OUTPUT_FORMAT      # "jpg" (stock-ready) | "png" (lossless)
    jpeg_quality: int = DEFAULT_JPEG_QUALITY         # 80-100, stepped down if > max_upload_bytes
    max_upload_bytes: int = CLOUDINARY_FREE_MAX_BYTES - UPLOAD_SIZE_SAFETY
    tile_workers: int = 1                            # parallel tile inference processes
    stale_minutes: int = 30                          # claim older than this is reclaimable


def _parse_int(value, name, minimum, maximum):
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        raise JobError(f"{name} doit être un entier — valeur reçue : {value!r}")
    if not (minimum <= n <= maximum):
        raise JobError(f"{name} doit être entre {minimum} et {maximum} — valeur reçue : {n}")
    return n


def resolve_tile_workers(raw) -> int:
    """'auto' → min(4, cpu_count) ; explicit int → clamped 1..TILE_WORKERS_MAX."""
    value = str(raw or DEFAULT_TILE_WORKERS).strip().lower()
    if value in ("", "auto"):
        return max(1, min(4, os.cpu_count() or 1))
    return _parse_int(value, "tile_workers / UPSCALE_TILE_WORKERS", 1, TILE_WORKERS_MAX)


def build_config(args) -> JobConfig:
    """Resolve the job configuration from CLI args (priority) then env."""

    source = str(getattr(args, "source", None) or SOURCE_IMAGES).strip().lower()
    if source not in SOURCES:
        raise JobError(
            f"source inconnue : {source!r} — sources supportées : {', '.join(SOURCES)}"
        )

    missing = []

    api_url = (getattr(args, "api_url", None) or os.environ.get("ASSET_API_URL", "")).strip().rstrip("/")
    if not api_url:
        missing.append("ASSET_API_URL (URL de l'API Render, ex. https://adobe-stock-images-generator-api.onrender.com)")

    api_key = (getattr(args, "api_key", None) or os.environ.get("ASSET_API_KEY", "")).strip()
    if not api_key:
        missing.append("ASSET_API_KEY (clé de l'agent — le même secret que API_KEY sur Render)")

    if missing:
        raise JobError(
            "Configuration incomplète — il manque :\n  - " + "\n  - ".join(missing)
        )

    max_upscales = _parse_int(
        getattr(args, "max_upscales", None) or os.environ.get("MAX_NUMBER_OF_UPSCALES_PER_IMAGE") or DEFAULT_MAX_UPSCALES,
        "max_upscales / MAX_NUMBER_OF_UPSCALES_PER_IMAGE", 1, 10,
    )
    scale = _parse_int(
        getattr(args, "scale", None) or os.environ.get("DEFAULT_SCALE") or DEFAULT_SCALE,
        "scale / DEFAULT_SCALE", 2, 8,
    )

    model = (getattr(args, "model", None) or os.environ.get("UPSCALE_MODEL") or DEFAULT_MODEL).strip()
    if model not in MODEL_REGISTRY:
        raise JobError(
            f"Modèle inconnu : {model!r} — modèles supportés : {', '.join(MODEL_REGISTRY)}"
        )

    output_format = (
        getattr(args, "output_format", None) or os.environ.get("UPSCALE_OUTPUT_FORMAT") or DEFAULT_OUTPUT_FORMAT
    ).strip().lower()
    if output_format not in ("jpg", "png"):
        raise JobError(f"output_format doit valoir « jpg » ou « png » — valeur reçue : {output_format!r}")

    jpeg_quality = _parse_int(
        getattr(args, "jpeg_quality", None) or os.environ.get("UPSCALE_JPEG_QUALITY") or DEFAULT_JPEG_QUALITY,
        "jpeg_quality / UPSCALE_JPEG_QUALITY", JPEG_QUALITY_FLOOR, 100,
    )

    max_upload_raw = os.environ.get("CLOUDINARY_MAX_UPLOAD_BYTES", "").strip()
    max_upload_bytes = CLOUDINARY_FREE_MAX_BYTES - UPLOAD_SIZE_SAFETY
    if max_upload_raw:
        max_upload_bytes = _parse_int(
            max_upload_raw, "CLOUDINARY_MAX_UPLOAD_BYTES", 1_000_000, 200_000_000
        )

    cloud_name = os.environ.get("CLOUDINARY_CLOUD_NAME", "").strip()
    cloud_key = os.environ.get("CLOUDINARY_API_KEY", "").strip()
    cloud_secret = os.environ.get("CLOUDINARY_API_SECRET", "").strip()

    dry_run = bool(getattr(args, "dry_run", False))
    cloud_missing = [n for n, v in (
        ("CLOUDINARY_CLOUD_NAME", cloud_name),
        ("CLOUDINARY_API_KEY", cloud_key),
        ("CLOUDINARY_API_SECRET", cloud_secret),
    ) if not v]
    if cloud_missing and not dry_run:
        # dry-run lists eligibility without uploading — no credentials needed.
        raise JobError(
            "Configuration Cloudinary incomplète — il manque : " + ", ".join(cloud_missing)
        )

    tile_workers = resolve_tile_workers(
        getattr(args, "tile_workers", None) or os.environ.get("UPSCALE_TILE_WORKERS") or DEFAULT_TILE_WORKERS
    )
    stale_minutes = _parse_int(
        getattr(args, "stale_minutes", None) or os.environ.get("UPSCALE_CLAIM_STALE_MINUTES") or 30,
        "stale_minutes / UPSCALE_CLAIM_STALE_MINUTES", 1, 1440,
    )

    return JobConfig(
        api_url=api_url,
        api_key=api_key,
        max_upscales=max_upscales,
        scale=scale,
        model=model,
        max_images=getattr(args, "max_images", None) or DEFAULT_MAX_IMAGES,
        cloudinary_cloud_name=cloud_name,
        cloudinary_api_key=cloud_key,
        cloudinary_api_secret=cloud_secret,
        cloudinary_folder=getattr(args, "cloudinary_folder", None)
        or DEFAULT_CLOUDINARY_FOLDERS.get(source, DEFAULT_CLOUDINARY_FOLDERS[SOURCE_IMAGES]),
        model_dir=getattr(args, "model_dir", None)
        or os.environ.get("UPSCALE_MODEL_DIR", os.path.expanduser("~/.cache/upscale-models")),
        source=source,
        dry_run=bool(getattr(args, "dry_run", False)),
        run_id=os.environ.get("GITHUB_RUN_ID", ""),
        output_format=output_format,
        jpeg_quality=jpeg_quality,
        max_upload_bytes=max_upload_bytes,
        tile_workers=tile_workers,
        stale_minutes=stale_minutes,
    )


# ── asset database API client ────────────────────────────────────────────────

# ── etsy normalization helpers ───────────────────────────────────────────────

def _find_etsy_image(product: dict, image_id: str):
    """The image sub-document with this id, or None."""
    for im in product.get("images") or []:
        if str(im.get("_id")) == str(image_id):
            return im
    return None


def _normalize_etsy_image(product: dict, image: dict) -> dict:
    """Flatten an (etsy product, nested image) pair into the SAME shape as a
    standalone image doc — plus the routing keys `source` / `product_id` — so
    the whole pipeline (dry-run, process_image, ClaimGuard) is source-blind."""
    md = product.get("metadata") or {}
    product_title = md.get("title") or "(produit sans titre)"
    caption = (image.get("caption") or "").strip()
    index = None
    for i, im in enumerate(product.get("images") or []):
        if str(im.get("_id")) == str(image.get("_id")):
            index = i
            break
    label = caption or (f"image #{index + 1}" if index is not None else "image")
    doc = dict(image)
    doc["_id"] = str(image.get("_id"))
    doc["source"] = SOURCE_ETSY
    doc["product_id"] = str(product.get("_id"))
    doc["product_title"] = product_title
    doc["title"] = f"{product_title} — {label}"
    return doc


def _etsy_image_eligible(image: dict, max_upscales: int) -> bool:
    """Dry-run eligibility for a nested etsy image: upscales below max,
    active (absent field = active), not currently claimed."""
    upscales = len(image.get("upscales") or [])
    active = image.get("active") is not False
    not_in_use = image.get("in_use") is not True
    return upscales < max_upscales and active and not_in_use


class AssetApi:
    """Thin HTTP client for the Stockroom API (X-API-Key, agent role)."""

    def __init__(self, base_url: str, api_key: str, timeout: int = 60):
        self.base = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _request(self, method: str, path: str, **kwargs):
        import requests  # lazy

        url = f"{self.base}{path}"
        headers = {"X-API-Key": self.api_key, **kwargs.pop("headers", {})}
        try:
            resp = requests.request(
                method, url, headers=headers, timeout=self.timeout, **kwargs
            )
        except requests.exceptions.ConnectionError:
            raise JobError(
                f"Impossible de joindre l'API à {url} — vérifiez le secret ASSET_API_URL "
                "et que le service Render est bien démarré (premier démarrage = ~30-60 s)."
            )
        except requests.exceptions.Timeout:
            raise JobError(f"L'API n'a pas répondu dans les {self.timeout}s — {url}")

        if resp.status_code == 401:
            raise JobError(
                "Authentification refusée (HTTP 401) — vérifiez le secret ASSET_API_KEY : "
                "il doit contenir la clé de l'AGENT (header X-API-Key), pas le mot de passe de la webapp."
            )
        if resp.status_code == 429:
            raise JobError(
                "Limite de débit atteinte (HTTP 429) — l'API limite à 300 requêtes/min. "
                "Relancez le job dans une minute."
            )
        return resp

    def _json(self, resp, action: str):
        try:
            body = resp.json()
        except ValueError:
            raise JobError(f"{action} : réponse non-JSON de l'API (HTTP {resp.status_code})")
        if not 200 <= resp.status_code < 300:
            err = body.get("error", {})
            raise JobError(
                f"{action} échoué (HTTP {resp.status_code}) — {err.get('code', '?')}: {err.get('message', body)}"
            )
        return body

    # ── warm-up (Render free tier spins services down) ──

    def wait_until_ready(self, total_timeout: float = 300, poll: float = 10, path: str = "/health"):
        """Réveille l'API si elle est en pause et attend qu'elle réponde.

        À appeler AVANT tout vrai travail : un service Render endormi met
        ~30-90 s à redémarrer, et les premières requêtes échouent sinon
        (connexion refusée, timeout, 502). Chaque tentative est logguée."""
        import requests  # lazy

        started = time.monotonic()
        attempt = 0
        log("· réveil de l'API (un service Render en pause redémarre en ~30-90 s)…")
        while True:
            attempt += 1
            detail = ""
            try:
                resp = requests.get(f"{self.base}{path}", timeout=self.timeout)
                if 200 <= resp.status_code < 300:
                    log(f"✓ API prête (tentative {attempt}, {time.monotonic() - started:.0f}s)")
                    return
                detail = f"HTTP {resp.status_code}"
            except requests.RequestException as e:
                detail = type(e).__name__
            elapsed = time.monotonic() - started
            if elapsed >= total_timeout:
                raise JobError(
                    f"L'API {self.base} ne répond pas après {attempt} tentative(s) "
                    f"({int(elapsed)}s) — le service est probablement arrêté. "
                    "Ouvrez cette URL dans un navigateur pour le redémarrer, puis relancez le workflow."
                )
            log(f"  tentative {attempt} : {detail} — nouvel essai dans {int(poll)}s…")
            time.sleep(poll)

    # ── endpoints (source-aware: standalone images or nested etsy images) ──

    def get_image(self, ref: Ref):
        """Return the image document (normalized for both sources), or None
        when it does not exist."""
        if ref.source == SOURCE_ETSY:
            resp = self._request("GET", f"/api/etsy-products/{ref.product_id}")
            if resp.status_code == 404:
                return None
            product = self._json(resp, f"GET /api/etsy-products/{ref.product_id}")["data"]
            image = _find_etsy_image(product, ref.image_id)
            if image is None:
                return None
            return _normalize_etsy_image(product, image)
        resp = self._request("GET", f"/api/images/{ref.image_id}")
        if resp.status_code == 404:
            return None
        return self._json(resp, f"GET /api/images/{ref.image_id}")["data"]

    def list_eligible(self, source: str, max_upscales: int, limit: int):
        """Images eligible for the DRY-RUN listing: upscale count BELOW
        max_upscales, active, not currently claimed (in_use), oldest first.
        The real processing uses claim() instead — atomic reservation."""
        if source == SOURCE_ETSY:
            return self._list_eligible_etsy(max_upscales, limit)
        collected = []
        page = 1
        while len(collected) < limit:
            resp = self._request(
                "GET",
                "/api/images",
                params={
                    "upscales_lt": max_upscales,
                    "active": "true",
                    "in_use": "false",
                    "limit": 100,
                    "page": page,
                    "sort": "createdAt",
                    "order": "asc",
                },
            )
            body = self._json(resp, "GET /api/images (images éligibles)")
            data = body.get("data", [])
            for d in data:
                d["source"] = SOURCE_IMAGES
            collected.extend(data)
            pagination = body.get("pagination", {})
            if not data or page >= pagination.get("totalPages", 1):
                break
            page += 1
        return collected[:limit]

    def _list_eligible_etsy(self, max_upscales: int, limit: int):
        """Etsy edition of the dry-run listing: walks the products (they are
        few), expands their images and keeps the eligible ones. Products are
        listed oldest-first so the order matches the claim policy."""
        collected = []
        page = 1
        while len(collected) < limit:
            resp = self._request(
                "GET",
                "/api/etsy-products",
                params={
                    "limit": 100,
                    "page": page,
                    "sort": "createdAt",
                    "order": "asc",
                },
            )
            body = self._json(resp, "GET /api/etsy-products (images éligibles)")
            data = body.get("data", [])
            for product in data:
                for image in product.get("images") or []:
                    if _etsy_image_eligible(image, max_upscales):
                        collected.append(_normalize_etsy_image(product, image))
            pagination = body.get("pagination", {})
            if not data or page >= pagination.get("totalPages", 1):
                break
            page += 1
        return collected[:limit]

    def download_image(self, ref: Ref, wake_retries: int = 2, wake_backoff: float = 20):
        """Fetch the ORIGINAL image bytes through the API download proxy.
        Returns (bytes, content_type). Raises ImageSkipped on dead links.

        A 502 often just means the ORIGIN service (the image host — typically
        another Render free-tier service) is waking up: we retry before
        declaring the link dead."""
        if ref.source == SOURCE_ETSY:
            path = f"/api/etsy-products/{ref.product_id}/images/{ref.image_id}/download"
        else:
            path = f"/api/images/{ref.image_id}/download"
        resp = self._request("GET", path)
        attempt = 0
        while resp.status_code == 502 and attempt < wake_retries:
            attempt += 1
            log(
                f"· 502 de la source — le service d'origine se réveille peut-être "
                f"(Render) ; nouvel essai dans {int(wake_backoff)}s ({attempt}/{wake_retries})…"
            )
            time.sleep(wake_backoff)
            resp = self._request("GET", path)
        if resp.status_code == 502:
            body = {}
            try:
                body = resp.json()
            except ValueError:
                pass
            raise ImageSkipped(
                f"lien source mort (502) — {body.get('error', {}).get('message', 'image introuvable à sa source')}. "
                "Les liens éphémères (fichiers du serveur de génération) expirent au redémarrage ; "
                "les liens Cloudinary restent valides."
            )
        if resp.status_code == 404:
            raise ImageSkipped("image absente de la base (404)")
        if not 200 <= resp.status_code < 300:
            raise JobError(
                f"Téléchargement de {ref.label} {ref.image_id} échoué (HTTP {resp.status_code}) — relancez le job."
            )
        content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return resp.content, content_type

    def add_upscale(self, ref: Ref, payload: dict) -> dict:
        """POST …/upscales — register the upscaled variant. Returns the updated
        image document. Raises LimitReached on 409."""
        if ref.source == SOURCE_ETSY:
            path = f"/api/etsy-products/{ref.product_id}/images/{ref.image_id}/upscales"
        else:
            path = f"/api/images/{ref.image_id}/upscales"
        resp = self._request("POST", path, json=payload)
        if resp.status_code == 409:
            body = {}
            try:
                body = resp.json()
            except ValueError:
                pass
            raise LimitReached(
                f"limite atteinte côté API (409) — {body.get('error', {}).get('message', '')}"
            )
        return self._json(resp, f"POST {path}")["data"]

    # ── parallel batch workers: claim / release ──

    def claim(self, source: str, max_upscales: int, stale_minutes: int = 30):
        """POST /api/<images|etsy-products>/claim — atomically reserve ONE
        eligible image (upscales < max_upscales, active, not already claimed —
        a claim older than stale_minutes is considered dead and reclaimable).

        Returns the claimed image document (normalized, source-aware), or
        None when nothing is claimable (the worker exits its loop). The
        reservation is written by the same findOneAndUpdate that selects the
        document: two concurrent workers can never reserve the same image."""
        if source == SOURCE_ETSY:
            resp = self._request(
                "POST",
                "/api/etsy-products/claim",
                json={"max_upscales": max_upscales, "stale_minutes": stale_minutes},
            )
            body = self._json(resp, "POST /api/etsy-products/claim")
            data = body.get("data")
            if not data:
                return None
            doc = _normalize_etsy_image(data.get("product") or {}, data.get("image") or {})
            if data.get("image_index") is not None:
                doc["image_index"] = data["image_index"]
            return doc
        resp = self._request(
            "POST",
            "/api/images/claim",
            json={"max_upscales": max_upscales, "stale_minutes": stale_minutes},
        )
        body = self._json(resp, "POST /api/images/claim")
        data = body.get("data")
        if not data:
            return None
        doc = dict(data)
        doc["_id"] = str(doc.get("_id"))
        doc["source"] = SOURCE_IMAGES
        return doc

    def release(self, ref: Ref, status: str, error_message: str = ""):
        """POST …/release — report the terminal state of a claim.

        status:
          'ok'      → success — in_use cleared, error_message cleared
          'stopped' → cancelled / limit raced — in_use cleared only
          'error'   → hard failure — in_use cleared, image set active:false
                      and error_message recorded (visible in the webapp)

        A 404 (the image was deleted meanwhile) is tolerated → returns None.
        Best-effort by design: if the call itself fails, the stale window
        (default 30 min) eventually frees the claim anyway."""
        if ref.source == SOURCE_ETSY:
            path = f"/api/etsy-products/{ref.product_id}/images/{ref.image_id}/release"
        else:
            path = f"/api/images/{ref.image_id}/release"
        payload = {"status": status}
        if error_message:
            payload["error_message"] = error_message
        resp = self._request("POST", path, json=payload)
        if resp.status_code == 404:
            log(f"· release {ref.image_id} : introuvable (404) — ignoré")
            return None
        return self._json(resp, f"POST {path}")["data"]


# ── Cloudinary upload (happens on the runner, NOT on the API) ────────────────

class CloudinaryUploader:
    def __init__(self, config: JobConfig):
        self.folder = config.cloudinary_folder
        # NB: cloudinary >= 1.41 no longer auto-imports its submodules from the
        # top-level package — `import cloudinary` alone leaves `cloudinary.uploader`
        # unbound and raises AttributeError. Import the submodule explicitly.
        import cloudinary  # lazy
        import cloudinary.uploader  # noqa: F401 — binds cloudinary.uploader

        cloudinary.config(
            cloud_name=config.cloudinary_cloud_name,
            api_key=config.cloudinary_api_key,
            api_secret=config.cloudinary_api_secret,
            secure=True,
        )
        self._uploader = cloudinary.uploader

    def upload(self, file_path: str, public_id: str) -> dict:
        """Upload a local file → {url, public_id, bytes, width, height}."""
        try:
            result = self._uploader.upload(
                file_path,
                resource_type="image",
                folder=self.folder,
                public_id=public_id,
                overwrite=True,          # idempotent rerun after a partial failure
                unique_filename=False,
            )
        except Exception as e:  # cloudinary raises various exception types
            raise JobError(f"Upload Cloudinary échoué — {e}")
        return {
            "url": result.get("secure_url") or result.get("url", ""),
            "public_id": result.get("public_id", ""),
            "bytes": result.get("bytes"),
            "width": result.get("width"),
            "height": result.get("height"),
        }


# ── Real-ESRGAN ──────────────────────────────────────────────────────────────

def _build_arch(model_name: str):
    """Build the (untrained) network for a registry model → (model, netscale)."""
    from basicsr.archs.rrdbnet_arch import RRDBNet
    from basicsr.archs.srvgg_arch import SRVGGNetCompact

    arch = MODEL_REGISTRY[model_name]["arch"]
    if arch == "rrdbnet_x4":
        return (
            RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4),
            4,
        )
    if arch == "rrdbnet_x2":
        return (
            RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2),
            2,
    )
    # srvgg_compact
    return (
        SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type="prelu"),
        4,
    )


def _load_torch_model(model_name: str, model_path: str):
    """Build + load the weights for a tile worker process.

    Same weight-loading logic as realesrgan 0.3.0's RealESRGANer.__init__
    (params_ema preferred over params, strict) — the parent process uses the
    library's own loader, workers use this one: both yield identical weights."""
    import torch

    model, _ = _build_arch(model_name)
    loadnet = torch.load(model_path, map_location=torch.device("cpu"))
    keyname = "params_ema" if "params_ema" in loadnet else "params"
    model.load_state_dict(loadnet[keyname], strict=True)
    model.eval()
    return model


# Worker-side state — populated once per pool process by _tile_worker_init.
_TILE_WORKER_STATE: dict = {}


def _tile_worker_init(model_name: str, model_path: str, threads: int):
    """Pool initializer: single-threaded torch + the model, loaded ONCE."""
    os.environ.setdefault("OMP_NUM_THREADS", str(threads))
    import torch

    torch.set_num_threads(threads)
    _TILE_WORKER_STATE["torch"] = torch
    _TILE_WORKER_STATE["model"] = _load_torch_model(model_name, model_path)


def _tile_worker_run(spec: dict):
    """Run the model on one (padded) input tile → (index, total, cropped tile).

    Exactly what the sequential tile_process does per tile: model() on the
    padded input, then crop the part that lands in the output image. The
    worker returns it as float32 numpy (pickled back to the parent)."""
    torch = _TILE_WORKER_STATE["torch"]
    model = _TILE_WORKER_STATE["model"]
    with torch.no_grad():
        output_tile = model(torch.from_numpy(spec["input_tile"]))
    out_np = output_tile.contiguous().numpy()
    sy, ey = spec["tile_crop_y"]
    sx, ex = spec["tile_crop_x"]
    return spec["index"], spec["total"], out_np[:, :, sy:ey, sx:ex]


def _build_parallel_upsampler_class(RealESRGANer):
    """RealESRGANer subclass whose tile loop runs tiles in PARALLEL processes.

    WHY this is bit-identical to the stock sequential loop: the per-tile math
    below is a VERBATIM replica of realesrgan 0.3.0 RealESRGANer.tile_process
    (source: realesrgan/utils.py). In that loop each tile only
      1. reads a padded slice of the (already pre-padded) input,
      2. runs the model on it (pure function, fp32 CPU, eval mode, no_grad),
      3. writes the CROPPED tile into a DISJOINT region of self.output.
    There is no blending, no weight matrix and no cross-tile state — every
    output pixel comes from exactly ONE tile. Running the model() calls in
    worker processes and assigning the identical cropped tiles to the same
    disjoint output regions therefore reproduces the sequential result down
    to the last bit. Workers get the same weights (same file, strict load),
    the same fp32 inputs (float32 numpy round-trip is lossless) and 1 torch
    thread each, so N workers use exactly N CPU cores.
    """

    class ParallelRealESRGANer(RealESRGANer):
        def __init__(self, *args, tile_workers: int = 1, model_name: str = "", **kwargs):
            super().__init__(*args, **kwargs)
            self.tile_workers = max(1, tile_workers)
            # RealESRGANer does not keep model_path as an attribute — store it
            # ourselves so the pool initializer can reload the weights.
            self._model_path = args[1] if len(args) > 1 else kwargs.get("model_path", "")
            self._model_name = model_name
            self._pool = None

        # ── pool lifecycle ──

        def _ensure_pool(self):
            if self._pool is None:
                ctx = multiprocessing.get_context("spawn")
                log(
                    f"· démarrage du pool d'upscale : {self.tile_workers} worker(s), "
                    "1 thread chacun (modèle chargé une fois par worker)…"
                )
                with Heartbeat(f"pool de {self.tile_workers} workers"):
                    self._pool = ctx.Pool(
                        processes=self.tile_workers,
                        initializer=_tile_worker_init,
                        initargs=(self._model_name, self._model_path, 1),
                    )
            return self._pool

        def close_pool(self):
            pool, self._pool = self._pool, None
            if pool is not None:
                pool.terminate()

        # ── the parallel tile loop (verbatim slice math, see docstring) ──

        def tile_process(self):
            import torch

            batch, channel, height, width = self.img.shape
            output_height = height * self.scale
            output_width = width * self.scale
            output_shape = (batch, channel, output_height, output_width)

            # start with black image
            self.output = self.img.new_zeros(output_shape)
            tiles_x = math.ceil(width / self.tile_size)
            tiles_y = math.ceil(height / self.tile_size)

            # loop over all tiles — collect the exact slice specs
            specs = []
            for y in range(tiles_y):
                for x in range(tiles_x):
                    # extract tile from input image
                    ofs_x = x * self.tile_size
                    ofs_y = y * self.tile_size
                    # input tile area on total image
                    input_start_x = ofs_x
                    input_end_x = min(ofs_x + self.tile_size, width)
                    input_start_y = ofs_y
                    input_end_y = min(ofs_y + self.tile_size, height)

                    # input tile area on total image with padding
                    input_start_x_pad = max(input_start_x - self.tile_pad, 0)
                    input_end_x_pad = min(input_end_x + self.tile_pad, width)
                    input_start_y_pad = max(input_start_y - self.tile_pad, 0)
                    input_end_y_pad = min(input_end_y + self.tile_pad, height)

                    # input tile dimensions
                    input_tile_width = input_end_x - input_start_x
                    input_tile_height = input_end_y - input_start_y
                    tile_idx = y * tiles_x + x + 1
                    input_tile = self.img[
                        :, :, input_start_y_pad:input_end_y_pad, input_start_x_pad:input_end_x_pad
                    ]

                    # output tile area on total image
                    output_start_x = input_start_x * self.scale
                    output_end_x = input_end_x * self.scale
                    output_start_y = input_start_y * self.scale
                    output_end_y = input_end_y * self.scale

                    # output tile area without padding
                    output_start_x_tile = (input_start_x - input_start_x_pad) * self.scale
                    output_end_x_tile = output_start_x_tile + input_tile_width * self.scale
                    output_start_y_tile = (input_start_y - input_start_y_pad) * self.scale
                    output_end_y_tile = output_start_y_tile + input_tile_height * self.scale

                    specs.append({
                        "index": tile_idx,
                        "total": tiles_x * tiles_y,
                        # float32 copy (contiguous → numpy shares/copies losslessly)
                        "input_tile": input_tile.contiguous().numpy(),
                        "output_y": (output_start_y, output_end_y),
                        "output_x": (output_start_x, output_end_x),
                        "tile_crop_y": (output_start_y_tile, output_end_y_tile),
                        "tile_crop_x": (output_start_x_tile, output_end_x_tile),
                    })

            def assign(spec, tile_np):
                """Put one cropped tile into the output image (same slice math
                as the stock loop's final assignment)."""
                oy, oey = spec["output_y"]
                ox, oex = spec["output_x"]
                self.output[:, :, oy:oey, ox:oex] = torch.from_numpy(tile_np)

            if self.tile_workers > 1 and len(specs) > 1:
                pool = self._ensure_pool()
                log(f"· {len(specs)} tuile(s) → {self.tile_workers} worker(s)…")
                for index, total, tile_np in pool.imap_unordered(_tile_worker_run, specs):
                    assign(specs[index - 1], tile_np)
                    log(f"  Tile {index}/{total} ✓ (worker)")
            else:
                # Sequential path (workers=1, or a single-tile image) — the
                # stock loop, run in this process: identical by construction.
                for spec in specs:
                    with torch.no_grad():
                        output_tile = self.model(torch.from_numpy(spec["input_tile"]))
                    out_np = output_tile.contiguous().numpy()
                    assign(
                        spec,
                        out_np[:, :, spec["tile_crop_y"][0]:spec["tile_crop_y"][1],
                                spec["tile_crop_x"][0]:spec["tile_crop_x"][1]],
                    )
                    log(f"\tTile {spec['index']}/{spec['total']}")

    return ParallelRealESRGANer


def ensure_model(model_name: str, model_dir: str) -> str:
    """Make sure the model weights exist locally (download ~64 MB on first run)."""
    spec = MODEL_REGISTRY[model_name]
    os.makedirs(model_dir, exist_ok=True)
    path = os.path.join(model_dir, spec["file"])
    if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
        return path

    log(f"· téléchargement du modèle {model_name} ({spec['url']})…")
    import requests  # lazy

    tmp_path = path + ".part"
    try:
        with Heartbeat(f"téléchargement du modèle {model_name}"):
            with requests.get(spec["url"], stream=True, timeout=120) as r:
                r.raise_for_status()
                total = int(r.headers.get("Content-Length") or 0)
                done = 0
                with open(tmp_path, "wb") as fh:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        fh.write(chunk)
                        done += len(chunk)
                if total and done != total:
                    raise RuntimeError(f"téléchargement incomplet ({done}/{total} octets)")
        os.replace(tmp_path, path)
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise JobError(f"Téléchargement du modèle {model_name} échoué — {e}")
    return path


class RealEsrganUpscaler:
    """Lazy Real-ESRGANer wrapper (CPU, tiled to bound memory).

    tile_workers > 1 dispatches the per-tile model inference to a pool of
    worker processes — see _build_parallel_upsampler_class for the exactness
    argument (bit-identical to the sequential loop)."""

    def __init__(self, model_name: str, model_dir: str, tile_workers: int = 1):
        self.model_name = model_name
        self.model_path = ensure_model(model_name, model_dir)
        self.tile_workers = max(1, tile_workers)
        self._upsampler = None

    def _load(self):
        if self._upsampler is not None:
            return self._upsampler

        import torch  # lazy (heavy)
        from realesrgan import RealESRGANer

        model, netscale = _build_arch(self.model_name)

        # One single-threaded torch per worker when the pool is active (N
        # workers × 1 thread = exactly N cores); otherwise use every core.
        if self.tile_workers > 1:
            threads = max(1, (os.cpu_count() or 2) // self.tile_workers)
        else:
            threads = os.cpu_count() or 2
        torch.set_num_threads(threads)

        parallel_note = (
            f", {self.tile_workers} workers parallèles"
            if self.tile_workers > 1
            else ""
        )
        log(f"· chargement du modèle {self.model_name} (CPU, {threads} thread(s){parallel_note})…")
        try:
            with Heartbeat(f"chargement du modèle {self.model_name}"):
                upsampler_cls = _build_parallel_upsampler_class(RealESRGANer)
                self._upsampler = upsampler_cls(
                    scale=netscale,
                    model_path=self.model_path,
                    model=model,
                    tile=512,          # bounded memory on small runners
                    tile_pad=32,
                    pre_pad=0,
                    half=False,         # CPU → fp32
                    tile_workers=self.tile_workers,
                    model_name=self.model_name,
                )
        except Exception as e:
            raise JobError(
                f"Chargement du modèle Real-ESRGAN échoué — {e} "
                "(vérifiez requirements.txt et le patch basicsr dans le workflow)"
            )
        return self._upsampler

    def close(self) -> None:
        """Terminate the worker pool (if any) — safe to call repeatedly."""
        up = self._upsampler
        if up is not None and hasattr(up, "close_pool"):
            up.close_pool()

    def upscale(self, in_path: str, out_path: str, outscale: int, *,
                output_format: str = DEFAULT_OUTPUT_FORMAT,
                jpeg_quality: int = DEFAULT_JPEG_QUALITY,
                max_bytes: int | None = None):
        """Upscale one image file → JPEG (default, stock-ready) or PNG.

        Returns (width, height) of the output. When `max_bytes` is set and the
        JPEG still exceeds it, the quality is stepped down (e.g. 95 → 90 → 85 →
        80) — Cloudinary's free plan caps each file at 10 Mo, and Adobe Stock
        photo submissions are JPEG anyway. Dimensions NEVER change: only the
        compression is adjusted."""
        import cv2  # lazy

        image = cv2.imread(in_path, cv2.IMREAD_UNCHANGED)
        if image is None:
            raise JobError(f"lecture impossible de {in_path} (fichier corrompu ou format non supporté)")

        if image.ndim == 2:  # grayscale → 3 channels
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        elif image.ndim == 3 and image.shape[2] == 4:  # RGBA → drop alpha
            log("· image avec canal alpha — l'alpha est ignoré pour l'upscale")
            image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)

        upsampler = self._load()
        started = time.monotonic()
        try:
            with Heartbeat(f"upscale ×{outscale} en cours ({self.model_name})"):
                output, _ = upsampler.enhance(image, outscale=outscale)
        except Exception as e:
            raise JobError(f"Real-ESRGAN a échoué sur cette image — {e}")

        # Keep the file extension consistent with the encoded format.
        root, _ = os.path.splitext(out_path)
        out_path = root + (".jpg" if output_format == "jpg" else ".png")

        buf = encode_image(output, output_format, jpeg_quality)
        if output_format == "jpg" and max_bytes and buf.nbytes > max_bytes and jpeg_quality > JPEG_QUALITY_FLOOR:
            q = jpeg_quality
            while q > JPEG_QUALITY_FLOOR and buf.nbytes > max_bytes:
                q = max(JPEG_QUALITY_FLOOR, q - 5)
                log(
                    f"· JPEG {format_size(buf.nbytes)} > limite {format_size(max_bytes)} "
                    f"— ré-encodage en qualité {q}…"
                )
                buf = encode_image(output, output_format, q)
        if max_bytes and buf.nbytes > max_bytes:
            advice = (
                f"Même en JPEG qualité {JPEG_QUALITY_FLOOR} la sortie dépasse la limite "
                "d'upload Cloudinary — réduisez --scale, ou augmentez le secret "
                "CLOUDINARY_MAX_UPLOAD_BYTES si votre plan le permet."
                if output_format == "jpg" else
                "Le PNG (lossless) devient très lourd en ×4 : gardez le format JPEG "
                "(--output-format jpg, par défaut) — mêmes dimensions, ~2-4 Mo, et "
                "c'est le format standard des soumissions photo Adobe Stock."
            )
            raise JobError(
                f"la sortie pèse {format_size(buf.nbytes)} — la limite d'upload est "
                f"{format_size(max_bytes)}. {advice}"
            )
        with open(out_path, "wb") as fh:
            fh.write(buf.tobytes())

        h, w = output.shape[:2]
        log(
            f"· upscale ×{outscale} terminé en {time.monotonic() - started:.1f}s → "
            f"{w}×{h}px ({output_format}, {format_size(buf.nbytes)})"
        )
        return w, h


# Output format: JPEG by default (stock-ready, and small enough for Cloudinary's
# free 10 Mo per-file cap); PNG available for explicit lossless needs.
def encode_image(output, output_format: str, jpeg_quality: int):
    """Encode the upscaled ndarray → (jpg | png) buffer via OpenCV."""
    import cv2  # lazy

    ext = ".jpg" if output_format == "jpg" else ".png"
    params = [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)] if output_format == "jpg" else []
    ok, buf = cv2.imencode(ext, output, params)
    if not ok:
        raise JobError(f"encodage {output_format} impossible (image trop grande ?)")
    return buf


# ── per-image pipeline (shared by batch.py and single.py) ────────────────────

def process_image(config: JobConfig, api: AssetApi, upscaler: RealEsrganUpscaler,
                  uploader: CloudinaryUploader, image_doc: dict) -> dict:
    """Download → upscale → upload to Cloudinary → register in the API.

    Works identically for both sources — the image_doc carries the routing
    keys (`source`, `product_id`) and Ref.from_doc derives the API paths.
    Returns a result record {status: ok, …}. Raises ImageSkipped / JobError.
    """
    ref = Ref.from_doc(image_doc)
    image_id = str(image_doc["_id"])
    title = image_doc.get("title", "(sans titre)")
    current = len(image_doc.get("upscales") or [])

    # The listing may be a few minutes old — re-check the fresh count.
    fresh = api.get_image(ref)
    if fresh is None:
        raise ImageSkipped("image supprimée de la base entre-temps")
    current = len(fresh.get("upscales") or [])
    if current >= config.max_upscales:
        raise LimitReached(
            f"déjà {current} upscale(s) (max = {config.max_upscales}) — ignorée"
        )

    log(f"→ {title} [{image_id}] ({current}/{config.max_upscales} upscales)")

    # 1. download the original through the API proxy
    with Heartbeat(f"téléchargement de l'image source [{image_id}]"):
        data, content_type = api.download_image(ref)
    if len(data) < 1000:
        raise ImageSkipped(f"fichier source trop petit ou vide ({len(data)} octets)")

    # 2. upscale in a temp dir — output format follows the job policy
    #    (JPEG by default: stock-ready and under Cloudinary's 10 Mo cap).
    with tempfile.TemporaryDirectory(prefix="upscale-") as tmp:
        in_ext = ".jpg" if content_type in ("image/jpeg", "image/jpg") else ".png"
        in_path = os.path.join(tmp, "input" + in_ext)
        out_ext = ".jpg" if config.output_format == "jpg" else ".png"
        out_path = os.path.join(tmp, "output" + out_ext)
        with open(in_path, "wb") as fh:
            fh.write(data)

        width, height = upscaler.upscale(
            in_path, out_path, config.scale,
            output_format=config.output_format,
            jpeg_quality=config.jpeg_quality,
            max_bytes=config.max_upload_bytes,
        )
        size_bytes = os.path.getsize(out_path)

        # 3. upload to Cloudinary (folder + deterministic public_id)
        index = current + 1
        public_id = f"{image_id}_x{config.scale}_{index}"
        with Heartbeat(f"upload Cloudinary {public_id}"):
            uploaded = uploader.upload(out_path, public_id)

    # 4. register on the image document
    updated = api.add_upscale(ref, {
        "url": uploaded["url"],
        "public_id": uploaded["public_id"],
        "scale": config.scale,
        "model": config.model,
        "width": width,
        "height": height,
        "size_bytes": size_bytes,
        "source": "github-actions",
        "run_id": config.run_id,
        "max_upscales": config.max_upscales,
    })

    record = {
        "status": "ok",
        "image_id": image_id,
        "title": title,
        "scale": config.scale,
        "model": config.model,
        "dimensions": f"{width}×{height}",
        "size_bytes": size_bytes,
        "url": uploaded["url"],
        "upscales_count": len(updated.get("upscales") or []),
    }
    if ref.source == SOURCE_ETSY:
        record["product_id"] = ref.product_id
    return record


# ── job summary (GitHub step summary / stdout) ───────────────────────────────

def format_size(nbytes) -> str:
    if not isinstance(nbytes, (int, float)) or nbytes <= 0:
        return "—"
    units = ["o", "Ko", "Mo", "Go"]
    n = float(nbytes)
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024
        i += 1
    return f"{n:.1f} {units[i]}"


STATUS_LABELS = {
    "ok": "✅ upscalée",
    "skipped": "⏭️ ignorée",
    "failed": "❌ échec",
    "stopped": "🛑 stop (limite)",
}


def write_summary(title: str, intro: str, results: list) -> None:
    """Append a Markdown summary to $GITHUB_STEP_SUMMARY (or print it)."""
    ok_count = sum(1 for r in results if r["status"] == "ok")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    failed = sum(1 for r in results if r["status"] == "failed")

    lines = [f"## {title}", "", intro, ""]
    if not results:
        lines.append("_Aucune image à traiter._")
    else:
        lines += [
            "| Statut | Image | ×scale | Résultat |",
            "|---|---|---|---|",
        ]
        for r in results:
            label = STATUS_LABELS.get(r["status"], r["status"])
            title_cell = f"{r['title']} (`{r['image_id']}`)"
            scale_cell = f"×{r.get('scale', '—')}" if r.get("scale") else "—"
            if r["status"] == "ok":
                detail = f"[{r['dimensions']}, {format_size(r['size_bytes'])}]({r['url']})"
            else:
                detail = r.get("detail", "")
            lines.append(f"| {label} | {title_cell} | {scale_cell} | {detail} |")
        lines.append("")
        lines.append(
            f"**Total : {ok_count} upscalée(s), {skipped} ignorée(s), {failed} échec(s)**"
        )

    md = "\n".join(lines) + "\n"
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write(md)
    print(md, flush=True)


def handle_fatal(error: JobError, context: str) -> int:
    """Print a clear fatal error and return the exit code (always 1)."""
    print(f"\n✖ ERREUR FATALE — {context}\n{error}\n", file=sys.stderr, flush=True)
    return 1
