#!/usr/bin/env python3
"""Generate the Stock Room webapp icon set from the brand tokens.

Outputs (run from the repo root):
    web/src/app/apple-icon.png   180x180  (iOS / apple touch icon)
    web/src/app/favicon.ico      16+32+48 (legacy browser favicon)

Identity (same as src/app/icon.svg and the TopBar plate): paper background,
brand-orange plate rotated -4deg with a hard ink shadow, white SR monogram.

    python3 scripts/gen-app-icons.py
"""

from PIL import Image, ImageDraw, ImageFont

SIZE = 180
OUT_PNG = "web/src/app/apple-icon.png"
OUT_ICO = "web/src/app/favicon.ico"

BRAND = (232, 80, 10, 255)      # #e8500a
INK = (23, 24, 28, 255)         # #17181c
WHITE = (255, 255, 255, 255)
PAPER = (243, 242, 237, 255)    # #f3f2ed

BG_RADIUS = 40                  # rounded paper corners
PLATE = 96                      # brand plate size
PLATE_OFFSET = 7                # hard ink shadow offset (down-right)
ROT = -4                        # signature tilt (same as TopBar plate)

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


def build_icon(size: int) -> Image.Image:
    """Render the icon at `size` px (supersample at 180 then downscale)."""
    s = SIZE  # draw at 180 then resize
    scale_bg = max(2, round(BG_RADIUS * size / s)) if size < 64 else BG_RADIUS

    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # paper background, rounded corners
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=BG_RADIUS, fill=PAPER)

    # plate layer: ink shadow + brand plate, rotated, with the SR monogram
    font = load_font(50)
    bbox = draw.textbbox((0, 0), "SR", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    layer = Image.new("RGBA", (PLATE + 40, PLATE + 40), (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(layer)
    cx = (layer.width - PLATE) // 2
    cy = (layer.height - PLATE) // 2
    # hard ink shadow (offset), then the brand plate on top
    ldraw.rectangle([cx + PLATE_OFFSET, cy + PLATE_OFFSET,
                     cx + PLATE - 1 + PLATE_OFFSET, cy + PLATE - 1 + PLATE_OFFSET], fill=INK)
    ldraw.rectangle([cx, cy, cx + PLATE - 1, cy + PLATE - 1], fill=BRAND)
    # white SR monogram, centered on the plate
    ldraw.text((cx + (PLATE - tw) // 2 - bbox[0],
                cy + (PLATE - th) // 2 - bbox[1]), "SR", font=font, fill=WHITE)

    plate = layer.rotate(ROT, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(plate, ((s - plate.width) // 2, (s - plate.height) // 2))

    if size != s:
        img = img.resize((size, size), Image.LANCZOS)
        _ = scale_bg  # (radius already scaled by the resize)
    return img


def main() -> None:
    icon = build_icon(SIZE)
    icon.convert("RGB").save(OUT_PNG, "PNG")
    print(f"OK — {OUT_PNG} ({SIZE}x{SIZE})")

    ico_sizes = [(48, 48), (32, 32), (16, 16)]
    frames = [build_icon(d) for d, _ in ico_sizes]
    frames[0].save(OUT_ICO, format="ICO", sizes=ico_sizes, append_images=frames[1:])
    print(f"OK — {OUT_ICO} ({[d for d, _ in ico_sizes]})")


if __name__ == "__main__":
    main()
