#!/usr/bin/env python3
"""
Turn white-background product shots into transparent cutouts.

Only near-white pixels connected to the image border are removed, so white
details inside the product (logos, highlights, glitter) are kept. Edges get a
soft alpha ramp and a little de-fringing so the cutout sits cleanly on dark UI.

Usage:
  python3 scripts/remove-white-bg.py in.jpg [more.jpg ...] --out assets/img/gallery
  python3 scripts/remove-white-bg.py in.jpg --tolerance 28 --max 1600
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def cutout(im: Image.Image, tolerance: float, feather: float, hole_area: float, grow: float = 1.2) -> Image.Image:
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    # Distance from pure white (0 = white).
    dist = np.sqrt(((255.0 - rgb) ** 2).sum(axis=2))

    near_white = dist < tolerance
    labels, count = ndimage.label(near_white)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    border = border[border != 0]
    # Large enclosed white areas (e.g. the gap under a headband) are background too;
    # small ones are highlights on the product and stay.
    sizes = ndimage.sum(near_white, labels, index=np.arange(1, count + 1))
    holes = np.nonzero(sizes >= hole_area * near_white.size)[0] + 1
    seeds = np.isin(labels, np.union1d(border, holes))

    # Hysteresis: grow from those seeds into connected light-gray pixels (soft shadows, rims).
    weak_labels, _ = ndimage.label(dist < tolerance * grow)
    background = np.isin(weak_labels, np.unique(weak_labels[seeds & (weak_labels > 0)]))

    # Opening drops speckled pale texture (light fabric weave) that touches the background;
    # real backdrop is large and smooth so it survives.
    background = ndimage.binary_opening(background, structure=np.ones((3, 3)), iterations=4)
    bg_labels, _ = ndimage.label(background)
    keep = np.unique(np.concatenate([bg_labels[0], bg_labels[-1], bg_labels[:, 0], bg_labels[:, -1], bg_labels[seeds & ~np.isin(labels, border)]]))
    background = np.isin(bg_labels, keep[keep != 0])

    # Soft ramp: pixels just outside the background fade in over `feather` units of distance.
    dist_to_bg = ndimage.distance_transform_edt(~background)
    ramp = np.clip((dist - tolerance * 0.5) / max(feather, 1e-3), 0, 1)
    alpha = np.where(background, 0.0, np.where(dist_to_bg <= 2, np.maximum(ramp, 0.0), 1.0))
    alpha = ndimage.gaussian_filter(alpha, 0.6)
    alpha[background] = 0.0

    # De-fringe: un-mix white from semi-transparent edge pixels.
    a = np.clip(alpha, 1e-3, 1)[..., None]
    edge = (alpha > 0) & (alpha < 1)
    unmixed = np.clip((rgb - 255.0 * (1 - a)) / a, 0, 255)
    rgb = np.where(edge[..., None], unmixed, rgb)

    out = np.dstack([rgb, alpha * 255.0]).round().astype(np.uint8)
    img = Image.fromarray(out)
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("inputs", nargs="+", type=Path)
    p.add_argument("--out", type=Path, default=Path("assets/img/gallery"))
    p.add_argument("--tolerance", type=float, default=48, help="how close to white counts as background (0-441)")
    p.add_argument("--hole-area", type=float, default=0.012, help="enclosed white areas larger than this share of the image are removed")
    p.add_argument("--grow", type=float, default=1.2, help="also clear light-gray shadows touching the background, up to tolerance x this")
    p.add_argument("--feather", type=float, default=30, help="edge softness")
    p.add_argument("--max", type=int, default=1600, help="longest side of the output, in px")
    args = p.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    for src in args.inputs:
        img = cutout(Image.open(src), args.tolerance, args.feather, args.hole_area, args.grow)
        img.thumbnail((args.max, args.max), Image.LANCZOS)
        dest = args.out / (src.stem + ".webp")
        img.save(dest, "WEBP", quality=88, method=6)
        print(f"{src} -> {dest} {img.size}")


if __name__ == "__main__":
    main()
