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
DEFAULT_CLOUDINARY_FOLDER = "adobe-stock/upscales"

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
    dry_run: bool = False
    run_id: str = ""
    output_format: str = DEFAULT_OUTPUT_FORMAT      # "jpg" (stock-ready) | "png" (lossless)
    jpeg_quality: int = DEFAULT_JPEG_QUALITY         # 80-100, stepped down if > max_upload_bytes
    max_upload_bytes: int = CLOUDINARY_FREE_MAX_BYTES - UPLOAD_SIZE_SAFETY


def _parse_int(value, name, minimum, maximum):
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        raise JobError(f"{name} doit être un entier — valeur reçue : {value!r}")
    if not (minimum <= n <= maximum):
        raise JobError(f"{name} doit être entre {minimum} et {maximum} — valeur reçue : {n}")
    return n


def build_config(args) -> JobConfig:
    """Resolve the job configuration from CLI args (priority) then env."""

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
        cloudinary_folder=getattr(args, "cloudinary_folder", None) or DEFAULT_CLOUDINARY_FOLDER,
        model_dir=getattr(args, "model_dir", None)
        or os.environ.get("UPSCALE_MODEL_DIR", os.path.expanduser("~/.cache/upscale-models")),
        dry_run=bool(getattr(args, "dry_run", False)),
        run_id=os.environ.get("GITHUB_RUN_ID", ""),
        output_format=output_format,
        jpeg_quality=jpeg_quality,
        max_upload_bytes=max_upload_bytes,
    )


# ── asset database API client ────────────────────────────────────────────────

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

    # ── endpoints ──

    def get_image(self, image_id: str):
        """Return the image document, or None when it does not exist."""
        resp = self._request("GET", f"/api/images/{image_id}")
        if resp.status_code == 404:
            return None
        return self._json(resp, f"GET /api/images/{image_id}")["data"]

    def list_eligible(self, max_upscales: int, limit: int):
        """Images whose upscale count is BELOW max_upscales, oldest first
        (the daily batch makes deterministic progress through the backlog)."""
        collected = []
        page = 1
        while len(collected) < limit:
            resp = self._request(
                "GET",
                "/api/images",
                params={
                    "upscales_lt": max_upscales,
                    "limit": 100,
                    "page": page,
                    "sort": "createdAt",
                    "order": "asc",
                },
            )
            body = self._json(resp, "GET /api/images (images éligibles)")
            data = body.get("data", [])
            collected.extend(data)
            pagination = body.get("pagination", {})
            if not data or page >= pagination.get("totalPages", 1):
                break
            page += 1
        return collected[:limit]

    def download_image(self, image_id: str, wake_retries: int = 2, wake_backoff: float = 20):
        """Fetch the ORIGINAL image bytes through the API download proxy.
        Returns (bytes, content_type). Raises ImageSkipped on dead links.

        A 502 often just means the ORIGIN service (the image host — typically
        another Render free-tier service) is waking up: we retry before
        declaring the link dead."""
        resp = self._request("GET", f"/api/images/{image_id}/download")
        attempt = 0
        while resp.status_code == 502 and attempt < wake_retries:
            attempt += 1
            log(
                f"· 502 de la source — le service d'origine se réveille peut-être "
                f"(Render) ; nouvel essai dans {int(wake_backoff)}s ({attempt}/{wake_retries})…"
            )
            time.sleep(wake_backoff)
            resp = self._request("GET", f"/api/images/{image_id}/download")
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
                f"Téléchargement de l'image {image_id} échoué (HTTP {resp.status_code}) — relancez le job."
            )
        content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return resp.content, content_type

    def add_upscale(self, image_id: str, payload: dict) -> dict:
        """POST /api/images/:id/upscales — register the upscaled variant.
        Returns the updated image document. Raises LimitReached on 409."""
        resp = self._request(
            "POST", f"/api/images/{image_id}/upscales", json=payload
        )
        if resp.status_code == 409:
            body = {}
            try:
                body = resp.json()
            except ValueError:
                pass
            raise LimitReached(
                f"limite atteinte côté API (409) — {body.get('error', {}).get('message', '')}"
            )
        return self._json(resp, f"POST /api/images/{image_id}/upscales")["data"]


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
    """Lazy Real-ESRGANer wrapper (CPU, tiled to bound memory)."""

    def __init__(self, model_name: str, model_dir: str):
        self.model_name = model_name
        self.model_path = ensure_model(model_name, model_dir)
        self._upsampler = None

    def _load(self):
        if self._upsampler is not None:
            return self._upsampler

        import torch  # lazy (heavy)
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from basicsr.archs.srvgg_arch import SRVGGNetCompact
        from realesrgan import RealESRGANer

        arch = MODEL_REGISTRY[self.model_name]["arch"]
        if arch == "rrdbnet_x4":
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
            netscale = 4
        elif arch == "rrdbnet_x2":
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2)
            netscale = 2
        else:  # srvgg_compact
            model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type="prelu")
            netscale = 4

        torch.set_num_threads(os.cpu_count() or 2)
        log(f"· chargement du modèle {self.model_name} (CPU, {os.cpu_count() or 2} threads)…")
        try:
            with Heartbeat(f"chargement du modèle {self.model_name}"):
                self._upsampler = RealESRGANer(
                    scale=netscale,
                    model_path=self.model_path,
                    model=model,
                    tile=512,          # bounded memory on 2-core / 7 GB runners
                    tile_pad=32,
                    pre_pad=0,
                    half=False,         # CPU → fp32
                )
        except Exception as e:
            raise JobError(
                f"Chargement du modèle Real-ESRGAN échoué — {e} "
                "(vérifiez requirements.txt et le patch basicsr dans le workflow)"
            )
        return self._upsampler

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

    Returns a result record {status: ok, …}. Raises ImageSkipped / JobError.
    """
    image_id = str(image_doc["_id"])
    title = image_doc.get("title", "(sans titre)")
    current = len(image_doc.get("upscales") or [])

    # The listing may be a few minutes old — re-check the fresh count.
    fresh = api.get_image(image_id)
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
        data, content_type = api.download_image(image_id)
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
    updated = api.add_upscale(image_id, {
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

    return {
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
