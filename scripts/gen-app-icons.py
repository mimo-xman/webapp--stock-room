#!/usr/bin/env python3
"""Generate web/src/app/apple-icon.png (180x180) for the Stock Room webapp.

Full-bleed brand-orange tile, white SR monogram rotated -4deg (same identity
as src/app/icon.svg). Run from the repo root:

    python3 scripts/gen-app-icons.py
"""

from PIL import Image, ImageDraw, ImageFont

SIZE = 180
OUT = "web/src/app/apple-icon.png"

BRAND = (232, 80, 10, 255)      # #e8500a
INK = (23, 24, 28, 255)         # #17181c
WHITE = (255, 255, 255, 255)
PAPER = (243, 242, 237, 255)    # #f3f2ed

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    raise SystemExit("fatal: no bold sans font found")


def main() -> None:
    img = Image.new("RGBA", (SIZE, SIZE), BRAND)
    draw = ImageDraw.Draw(img)

    # subtle ink shadow band at the bottom-right edge (the hard-shadow signature)
    band = 8
    draw.rectangle([SIZE - band, 0, SIZE, SIZE], fill=INK)
    draw.rectangle([0, SIZE - band, SIZE, SIZE], fill=INK)

    # SR monogram on its own layer, rotated like the TopBar plate
    font = load_font(92)
    text = "SR"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = 40
    layer = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(layer)
    ldraw.text((pad - bbox[0], pad - bbox[1]), text, font=font, fill=WHITE)

    mono = layer.rotate(4, resample=Image.BICUBIC, expand=True)

    x = (SIZE - mono.width) // 2
    y = (SIZE - mono.height) // 2
    img.alpha_composite(mono, (x, y))

    img.convert("RGB").save(OUT, "PNG")
    print(f"OK — {OUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
