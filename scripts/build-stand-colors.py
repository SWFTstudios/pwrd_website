#!/usr/bin/env python3
"""
Build aligned transparent stand color frames for the interactive LED stand demo.

Uses one shared matte across all frames (dark shell + saturated lit arches),
drops the floor shadow, de-fringes white edges, and crops every frame to the
same bbox so crossfades stay locked.

After building, run scripts/remove-stand-cable.py to erase the USB cable and re-crop
(then update the 374/696 frame size in styles.css, main.js and the HTML if it changes).

Usage:
  python3 scripts/build-stand-colors.py /path/to/PWRD0001R_folder
  python3 scripts/build-stand-colors.py /path/to/folder --out assets/img/stand-colors
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

# Source stem -> output id. Order matches remote columns (R→Y, G→teal, B→pink) + W + off.
STAND_FRAMES = {
    "PWRD0001R_06": "red",
    "PWRD0001R_07": "orange-red",
    "PWRD0001R_08": "orange",
    "PWRD0001R_09": "amber",
    "PWRD0001R_10": "yellow",
    "PWRD0001R_11": "green",
    "PWRD0001R_12": "lime",
    "PWRD0001R_13": "mint",
    "PWRD0001R_14": "cyan",
    "PWRD0001R_15": "teal",
    "PWRD0001R_16": "blue",
    "PWRD0001R_17": "sky",
    "PWRD0001R_18": "violet",
    "PWRD0001R_19": "magenta",
    "PWRD0001R_20": "pink",
    "PWRD0001R_21": "white",
    "PWRD0001R_02": "off",
}

REMOTE_STEM = "PWRD0001R_05"
REMOTE_ROWS = 6
REMOTE_COLS = 4

# Colors used for the lit-arch union (skip white/off — they don't add saturation).
COLOR_FRAMES = [n for n in STAND_FRAMES.values() if n not in ("white", "off")]


def load_rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def saturation(rgb: np.ndarray) -> np.ndarray:
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    with np.errstate(invalid="ignore", divide="ignore"):
        sat = np.where(mx > 1, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    return np.nan_to_num(sat, nan=0.0)


def luminance(rgb: np.ndarray) -> np.ndarray:
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def build_shared_matte(rgbs: dict[str, np.ndarray]) -> np.ndarray:
    """
    Foreground = dark shell/base/cord OR saturated lit arch across colored frames.
    Floor shadow is light + unsaturated, so it drops out.
    """
    # Dark parts: black plastic. Threshold leaves room for soft highlights.
    dark = np.zeros(rgbs["off"].shape[:2], dtype=bool)
    for name, rgb in rgbs.items():
        dark |= luminance(rgb) < 150

    # Lit arch: any strongly saturated pixel in a colored frame.
    sat = np.zeros(rgbs["off"].shape[:2], dtype=bool)
    for name in COLOR_FRAMES:
        rgb = rgbs[name]
        s = saturation(rgb)
        # Also require not-near-white so studio reflections don't sneak in.
        dist_white = np.sqrt(((255.0 - rgb) ** 2).sum(axis=2))
        sat |= (s > 0.18) & (dist_white > 40) & (rgb.max(axis=2) > 60)

    fg = dark | sat

    # Drop tiny speckles, close small gaps in the shell, keep largest blob.
    fg = ndimage.binary_opening(fg, structure=np.ones((3, 3)), iterations=1)
    fg = ndimage.binary_closing(fg, structure=np.ones((5, 5)), iterations=2)

    labels, n = ndimage.label(fg)
    if n == 0:
        raise SystemExit("shared matte is empty — check luminance/saturation thresholds")
    sizes = ndimage.sum(fg, labels, index=np.arange(1, n + 1))
    best = int(np.argmax(sizes)) + 1
    fg = labels == best

    # Fill only small holes (specular highlights), not the U opening.
    filled = ndimage.binary_fill_holes(fg)
    hole = filled & ~fg
    h_labels, hn = ndimage.label(hole)
    if hn:
        h_sizes = ndimage.sum(hole, h_labels, index=np.arange(1, hn + 1))
        # Anything under ~0.4% of the image is a highlight hole; larger = the arch opening.
        max_hole = fg.size * 0.004
        keep_holes = np.nonzero(h_sizes < max_hole)[0] + 1
        fg = fg | np.isin(h_labels, keep_holes)

    # Trim any leftover floor-shadow sliver that touches the bottom edge.
    # The stand base is elevated; a thin band of light gray at the bottom is shadow.
    # Already excluded by luminance, but erode the bottom contact if present.
    return fg


def apply_matte(rgb: np.ndarray, matte: np.ndarray, feather: float = 2.5) -> Image.Image:
    """Wider soft edge + stronger white de-fringe so scaled-down frames stay clean."""
    # Light erode so the soft ramp starts inside the hard silhouette.
    core = ndimage.binary_erosion(matte, iterations=1)
    dist_in = ndimage.distance_transform_edt(core)
    alpha = np.clip(dist_in / max(feather, 1e-3), 0, 1)
    alpha = ndimage.gaussian_filter(alpha, 1.2)
    alpha[~matte] = 0.0

    a = np.clip(alpha, 1e-3, 1)[..., None]
    # Stronger unmix: pull studio white out of all semi-transparent rim pixels.
    unmixed = np.clip((rgb - 255.0 * (1 - a)) / a, 0, 255)
    edge = (alpha > 0) & (alpha < 0.98)
    out_rgb = np.where(edge[..., None], unmixed, rgb)
    # Second pass on the softest rim — kills leftover chalky fringes on dark UI.
    pale = edge & (luminance(out_rgb) > 210) & (saturation(out_rgb) < 0.12)
    out_rgb = np.where(pale[..., None], unmixed * 0.92, out_rgb)

    # Drop residual pale floor shadow under the base.
    lum = luminance(out_rgb)
    sat = saturation(out_rgb)
    h = alpha.shape[0]
    bottom = np.zeros_like(alpha, dtype=bool)
    bottom[int(h * 0.82) :, :] = True
    shadow = bottom & (alpha > 0.02) & (alpha < 0.9) & (lum > 140) & (sat < 0.12)
    alpha[shadow] = 0.0
    soft = (alpha > 0) & (alpha < 0.4) & (lum > 190) & (sat < 0.15)
    alpha[soft] *= 0.08

    out = np.dstack([out_rgb, alpha * 255.0]).round().astype(np.uint8)
    return Image.fromarray(out)


def matte_bbox(matte: np.ndarray, pad: int = 8) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(matte)
    if len(xs) == 0:
        raise SystemExit("empty matte bbox")
    h, w = matte.shape
    left = max(0, int(xs.min()) - pad)
    top = max(0, int(ys.min()) - pad)
    right = min(w, int(xs.max()) + 1 + pad)
    bottom = min(h, int(ys.max()) + 1 + pad)
    return left, top, right, bottom


def sample_glow(im: Image.Image) -> str:
    a = np.asarray(im.convert("RGBA"))
    h, _w = a.shape[:2]
    region = a[: int(h * 0.55)]
    rgb = region[..., :3].astype(np.float32)
    alpha = region[..., 3]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = saturation(rgb)
    mask = (alpha > 160) & (sat > 0.25) & (mx > 80)
    if not mask.any():
        opaque = alpha > 200
        if not opaque.any():
            return "#ffffff"
        c = rgb[opaque].mean(axis=0)
        return "#%02x%02x%02x" % tuple(int(round(x)) for x in c)
    thresh = np.percentile(sat[mask], 85)
    pick = mask & (sat >= thresh)
    c = np.clip(rgb[pick].mean(axis=0) * 1.15, 0, 255)
    return "#%02x%02x%02x" % tuple(int(round(x)) for x in c)


def sample_remote_colors(remote_path: Path) -> dict[str, str]:
    """Sample button colors from the front-on remote photo for the CSS remote."""
    rgb = load_rgb(remote_path)
    h, w = rgb.shape[:2]
    mx, my_top, my_bot = 0.12, 0.105, 0.12
    gx0, gy0 = mx * w, my_top * h
    gw, gh = w * (1 - 2 * mx), h * (1 - my_top - my_bot)
    cell_w, cell_h = gw / REMOTE_COLS, gh / REMOTE_ROWS

    grid = [
        [None, None, "off", "on"],
        ["red", "green", "blue", "white"],
        ["orange-red", "lime", "sky", None],
        ["orange", "mint", "violet", None],
        ["amber", "cyan", "magenta", None],
        ["yellow", "teal", "pink", None],
    ]
    out: dict[str, str] = {}
    for row in range(REMOTE_ROWS):
        for col in range(REMOTE_COLS):
            cell = grid[row][col]
            if not cell:
                continue
            cx = int(gx0 + (col + 0.5) * cell_w)
            cy = int(gy0 + (row + 0.5) * cell_h)
            r = 6
            patch = rgb[max(0, cy - r) : min(h, cy + r), max(0, cx - r) : min(w, cx + r)]
            c = patch.reshape(-1, 3).mean(axis=0)
            out[cell] = "#%02x%02x%02x" % tuple(int(round(v)) for v in c)
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("source", type=Path, help="folder containing PWRD0001R_*.jpg")
    p.add_argument("--out", type=Path, default=Path("assets/img/stand-colors"))
    p.add_argument("--max", type=int, default=1200, help="longest side of stand frames")
    args = p.parse_args()

    src_dir = args.source
    if not src_dir.is_dir():
        raise SystemExit(f"source folder not found: {src_dir}")
    args.out.mkdir(parents=True, exist_ok=True)

    rgbs: dict[str, np.ndarray] = {}
    for stem, name in STAND_FRAMES.items():
        path = src_dir / f"{stem}.jpg"
        if not path.exists():
            raise SystemExit(f"missing stand frame: {path}")
        rgbs[name] = load_rgb(path)
        print(f"loaded {stem} -> {name} {rgbs[name].shape[1]}x{rgbs[name].shape[0]}")

    # Shared matte at full source resolution, then soft edge + crop + downscale.
    matte = build_shared_matte(rgbs)
    bbox = matte_bbox(matte, pad=12)
    print(f"shared matte coverage: {matte.mean() * 100:.1f}%  bbox: {bbox}")

    # Drop the old remote cutout if present — CSS remote replaces it.
    old_remote = args.out / "stand-remote.webp"
    if old_remote.exists():
        old_remote.unlink()
        print(f"removed {old_remote}")

    glow_samples: dict[str, str] = {}
    out_size = None
    for name, rgb in rgbs.items():
        rgba = apply_matte(rgb, matte, feather=2.5)
        cropped = rgba.crop(bbox)
        cropped.thumbnail((args.max, args.max), Image.LANCZOS)
        dest = args.out / f"stand-{name}.webp"
        # method=4 is much faster than 6 with nearly the same quality at this size.
        cropped.save(dest, "WEBP", quality=92, method=4)
        out_size = cropped.size
        glow = sample_glow(cropped) if name != "off" else "#2a2a2e"
        glow_samples[name] = glow
        print(f"  {dest.name} {cropped.size} glow={glow}")
    if out_size:
        print(f"\n// HTML img dimensions: width=\"{out_size[0]}\" height=\"{out_size[1]}\"")

    remote_path = src_dir / f"{REMOTE_STEM}.jpg"
    if remote_path.exists():
        samples = sample_remote_colors(remote_path)
        print("\n// Remote button colors (for CSS --c) — paste into STAND_COLORS / STAND_REMOTE_LAYOUT")
        for k, v in samples.items():
            print(f'  {k}: "{v}",')
    print("\nGlow samples:")
    for name, g in glow_samples.items():
        print(f"  {name}: {g}")


if __name__ == "__main__":
    main()
