#!/usr/bin/env python3
"""
Erase the USB power cable from the transparent LED charger stand images, then re-crop.

The cable's loops are matted into a solid blob, so it can't be told apart from the
stand by shape. Instead, each image layout has traced removal areas: everything left
of the stand's left upright within the cable's height band (the coil, plug and its
floor shadow), plus the strip between the upright and the base, above the base's top
edge (where the cord passes behind). Nothing of the stand lies in those areas.

Layouts:
  color  - the 17 aligned remote frames in assets/img/stand-colors/ (501x720 before)
  photo  - the gallery cutouts stand-rgb.webp / stand-white.webp (~1290x1600 before)

The color frames are cropped to one shared box so remote crossfades stay aligned.

Run it once, on the original (uncropped) images: it crops after clearing, so the
coordinates no longer match its own output.

Usage:
  python3 scripts/remove-stand-cable.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
COLOR_FRAMES = sorted((ROOT / "assets/img/stand-colors").glob("stand-*.webp"))
PHOTOS = [ROOT / "assets/img/gallery/stand/stand-rgb.webp", ROOT / "assets/img/gallery/stand/stand-white.webp"]

# "left": (x_max, y_min, y_max), the band left of the left upright.
# "strip": a polygon between the upright's right edge and the base, whose lower side
# traces the base's curved top rim (in the images' original, uncropped coordinates).
LAYOUTS = {
    "color": {
        "left": (117, 440, 545),
        "strip": [(188, 466), (226, 466), (226, 498), (213, 501), (200, 509), (188, 516)],
    },
    "photo": {
        "left": (229, 850, 1035),
        "strip": [(370, 890), (462, 890), (462, 948), (440, 954), (420, 961), (400, 971), (380, 982), (370, 988)],
    },
}


def cable_mask(shape, layout):
    h, w = shape
    y, x = np.mgrid[0:h, 0:w]
    lx, ly0, ly1 = layout["left"]
    mask = (x <= lx) & (y >= ly0) & (y <= ly1)
    strip = Image.new("L", (w, h), 0)
    ImageDraw.Draw(strip).polygon(layout["strip"], fill=255)
    return mask | (np.asarray(strip) > 0)


def clear(path, layout):
    rgba = np.asarray(Image.open(path).convert("RGBA")).copy()
    mask = cable_mask(rgba.shape[:2], layout)
    removed = int((rgba[..., 3][mask] > 0).sum())
    rgba[..., 3][mask] = 0
    return rgba, removed


def bbox(alpha):
    ys, xs = np.nonzero(alpha > 8)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def save(rgba, box, path):
    x0, y0, x1, y1 = box
    Image.fromarray(rgba[y0:y1, x0:x1]).save(path, "WEBP", quality=92, method=6)
    return x1 - x0, y1 - y0


def main():
    # Color frames: clear each, then crop all to the union box so they stay aligned.
    cleared = {p: clear(p, LAYOUTS["color"]) for p in COLOR_FRAMES}
    boxes = [bbox(rgba[..., 3]) for rgba, _ in cleared.values()]
    union = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    for p, (rgba, removed) in cleared.items():
        size = save(rgba, union, p)
        print(f"{p.name}: removed {removed} px -> {size[0]}x{size[1]}")
    for p in PHOTOS:
        rgba, removed = clear(p, LAYOUTS["photo"])
        size = save(rgba, bbox(rgba[..., 3]), p)
        print(f"{p.name}: removed {removed} px -> {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
