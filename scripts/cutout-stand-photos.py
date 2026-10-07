#!/usr/bin/env python3
"""
Cut the LED charger stand product photos (1000x1000, white studio background) out
to transparent PNGs, erase the USB cable, and add depth: a soft floor shadow under
the base and remote, and for lit frames a glow of the LED color on the floor.

Inputs (by number, as exported):
  1        the remote, front-on
  2        the stand unlit, no remote (camera framed slightly differently)
  3..19    the stand lit in each color with the remote; all one camera position

Frames 3..19 share one alpha so crossfades between colors stay locked. Frame 2 is
registered onto that layout (affine ECC on the dark shell) and gets its own alpha
inside the warped matte. The cable is cleared in two traced areas (left of the left
upright, and the gap between the arch and the base rim) before matting.

Usage:
  python3 scripts/cutout-stand-photos.py /path/to/photos --out assets/img/stand-cutouts
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.optimize import least_squares

WHITE = 255.0

# Layout of frames 3..19 (pixel coordinates in the 1000x1000 photos).
CABLE_LEFT = (296, 530, 640)  # clear x <= 296 for 530 <= y <= 640 (coil, plug, shadow)
# Gap between the arch's right edge and the base, above the base's top rim.
CABLE_STRIP = [
    (368, 540), (414, 540), (414, 583.5), (410, 583.5), (405, 584.5), (400, 585.5),
    (395, 587.5), (390, 589.5), (385, 591.5), (380, 594.5), (375, 597.5), (370, 601), (368, 602),
]
# The left upright's edge is a straight vertical, so rows behind the plug borrow
# the edge profile of a clean row above it.
UPRIGHT_EDGE = (290, 304, 515)  # x0, x1, clean source row

UNLIT = {2}
WHITE_ARCH = {14, 18}  # lit white: the arch is too close to the background to matte


def load(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32)


def lum(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def sat(rgb):
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    return np.where(mx > 1, (mx - mn) / np.maximum(mx, 1e-6), 0.0)


def cable_mask(shape, warp=None):
    """Cable areas in frame-3 coordinates, or warped into another frame's coordinates."""
    h, w = shape
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    x, y0, y1 = CABLE_LEFT
    d.rectangle([0, y0, x, y1], fill=255)
    d.polygon(CABLE_STRIP, fill=255)
    m = np.asarray(m)
    if warp is not None:
        m = cv2.warpAffine(m, warp, (w, h), flags=cv2.INTER_NEAREST + cv2.WARP_INVERSE_MAP)
    return m > 0


def keep_components(fg, min_frac=0.004):
    labels, n = ndimage.label(fg)
    if n == 0:
        raise SystemExit("empty matte")
    sizes = ndimage.sum(fg, labels, index=np.arange(1, n + 1))
    keep = np.nonzero(sizes >= fg.size * min_frac)[0] + 1
    return np.isin(labels, keep), labels


def fill_small_holes(fg, max_frac=0.004):
    hole = ndimage.binary_fill_holes(fg) & ~fg
    labels, n = ndimage.label(hole)
    if n:
        sizes = ndimage.sum(hole, labels, index=np.arange(1, n + 1))
        fg = fg | np.isin(labels, np.nonzero(sizes < fg.size * max_frac)[0] + 1)
    return fg


def hard_matte(frames: dict[int, np.ndarray]) -> np.ndarray:
    """Dark shell/base/remote in any frame, or the saturated lit arch in any color frame."""
    first = next(iter(frames.values()))
    fg = np.zeros(first.shape[:2], bool)
    for n, rgb in frames.items():
        fg |= lum(rgb) < 150
        if n not in WHITE_ARCH:
            dist_white = np.sqrt(((WHITE - rgb) ** 2).sum(axis=2))
            fg |= (sat(rgb) > 0.16) & (dist_white > 40)
    fg = ndimage.binary_opening(fg, np.ones((3, 3)))
    fg = ndimage.binary_closing(fg, np.ones((5, 5)), iterations=2)
    fg, _ = keep_components(fg)
    fg = fill_small_holes(fg)
    # The remote's light buttons sit inside its black body: fill every hole in it.
    labels, n = ndimage.label(fg)
    sizes = ndimage.sum(fg, labels, index=np.arange(1, n + 1))
    for i in np.argsort(sizes)[:-1] + 1:  # every component except the stand
        fg |= ndimage.binary_fill_holes(labels == i)
    return fg


def to_frame(pt, warp=None):
    """A frame-3 point in another frame's coordinates (p3 = A p + t)."""
    if warp is None:
        return np.asarray(pt, float)
    A, t = warp[:, :2].astype(float), warp[:, 2].astype(float)
    return np.linalg.solve(A, np.asarray(pt, float) - t)


def fit_base(rgb, warp=None):
    """
    The base is a short cylinder: fit its top rim (back arc, crisp against the arch
    opening) and its bottom edge (front arc, crisp in the middle) as one ellipse
    shifted by the base height. Returns cx, cy (top ellipse center), a, b, h.
    """
    L = lum(rgb)
    (tx0, ty0), (tx1, ty1) = to_frame((420, 500), warp), to_frame((568, 720), warp)
    (bx0, by0), (bx1, by1) = to_frame((430, 700), warp), to_frame((560, 950), warp)
    ty0, ty1, by0, by1 = int(ty0), int(ty1), int(by0), int(by1)
    top = np.array([(x, ty0 + np.argmax(L[ty0:ty1, x] < 140)) for x in range(int(tx0), int(tx1), 2)], float)
    bot = np.array([(x, by0 + np.nonzero(L[by0:by1, x] < 85)[0].max()) for x in range(int(bx0), int(bx1), 2)], float)
    # Right side of the base, above where its shadow starts: pins the width.
    (sx0, sy0), (sx1, sy1) = to_frame((560, 690), warp), to_frame((720, 740), warp)
    side = np.array([(sx0 + np.nonzero(L[y, int(sx0):int(sx1)] < 140)[0].max(), y) for y in range(int(sy0), int(sy1), 2)], float)

    def res(p):
        cx, cy, a, b, h = p
        u = np.clip((top[:, 0] - cx) / a, -0.999, 0.999)
        v = np.clip((bot[:, 0] - cx) / a, -0.999, 0.999)
        return np.concatenate([
            cy - b * np.sqrt(1 - u * u) - top[:, 1],
            cy + h + b * np.sqrt(1 - v * v) - bot[:, 1],
            cx + a - side[:, 0],
        ])

    c0 = to_frame((480, 650), warp)
    p = least_squares(res, [c0[0], c0[1], 160, 75, 60], bounds=([0, 0, 100, 30, 20], [1000, 1000, 240, 130, 140])).x
    print("base fit cx=%.1f cy=%.1f a=%.1f b=%.1f h=%.1f" % tuple(p))
    return p


def cut_floor(matte, base, warp=None):
    """
    Clear everything below the base's bottom edge (the soft floor shadow the base
    fades into). Stops short of the arch leg on the left, which reaches lower.
    """
    cx, cy, a, b, h = base
    hgt, w = matte.shape
    y, x = np.mgrid[0:hgt, 0:w].astype(float)
    u = np.clip((x - cx) / a, -1, 1)
    bottom = cy + h + b * np.sqrt(1 - u * u)
    leg_x = to_frame((400, 760), warp)[0]
    below = (x >= leg_x) & (x <= cx + a) & (y > bottom + 0.5) & (y < bottom + 60)
    # Right of the base, below where the arch's right leg ends.
    right = (x > cx + a - 1.5) & (x < cx + a + 40) & (y > cy + h * 0.5) & (y < cy + h + b + 60)
    # Keep the remote (its own component).
    labels, n = ndimage.label(matte)
    sizes = ndimage.sum(matte, labels, index=np.arange(1, n + 1))
    stand = labels == int(np.argmax(sizes)) + 1
    return matte & ~((below | right) & stand)


def solve_alpha(rgb, matte, band=2, min_contrast=30.0):
    """
    Alpha in a band around the hard matte edge, from the pixel's position between the
    nearest sure-foreground color F and the nearest sure-background color B.
    Returns alpha, the foreground color estimate, and where F/B were too close to trust.
    """
    sure_fg = ndimage.binary_erosion(matte, iterations=band)
    sure_bg = ~ndimage.binary_dilation(matte, iterations=band)
    _, (fy, fx) = ndimage.distance_transform_edt(~sure_fg, return_indices=True)
    _, (by, bx) = ndimage.distance_transform_edt(~sure_bg, return_indices=True)
    F = rgb[fy, fx]
    B = rgb[by, bx]
    fb = F - B
    denom = (fb ** 2).sum(axis=2)
    a = ((rgb - B) * fb).sum(axis=2) / np.maximum(denom, 1e-3)
    a = np.clip(a, 0, 1)
    unknown = ~sure_fg & ~sure_bg
    alpha = sure_fg.astype(np.float32)
    alpha[unknown] = a[unknown]
    weak = unknown & (np.sqrt(denom) < min_contrast)
    return alpha, F, B, weak


def unmix(rgb, alpha, F, B):
    """Foreground color with the background pulled out of semi-transparent edge pixels."""
    a = np.clip(alpha, 1e-3, 1)[..., None]
    un = np.clip((rgb - (1 - a) * B) / a, 0, 255)
    # Very thin edges carry little color information; use the nearest solid color.
    out = np.where((alpha < 0.35)[..., None], F, un)
    return np.where((alpha >= 0.999)[..., None], rgb, out)


def fix_upright_edge(alpha, warp=None):
    """Rows where the plug touched the upright copy the edge profile of a clean row."""
    x0, x1, src = UPRIGHT_EDGE
    _, y0, y1 = CABLE_LEFT
    if warp is None:
        alpha[y0 : y1 + 1, x0:x1] = alpha[src, x0:x1]
        return alpha
    # Map the frame-3 band into this frame: p3 = A p2 + t  ->  p2 = A^-1 (p3 - t)
    A, t = warp[:, :2], warp[:, 2]
    inv = np.linalg.inv(A)
    (ax0, ay0), (ax1, ay1) = [(inv @ (np.array(p) - t)).round().astype(int) for p in [(x0, y0), (x1, y1)]]
    sy = int(round((inv @ (np.array([x0, src]) - t))[1]))
    alpha[ay0 : ay1 + 1, ax0:ax1] = alpha[sy, ax0:ax1]
    return alpha


def glow_color(rgb, alpha):
    """Brightest, most saturated arch color (top half of the frame)."""
    h = rgb.shape[0]
    region, a = rgb[: h // 2], alpha[: h // 2]
    s = sat(region)
    mask = (a > 0.95) & (s > 0.25) & (region.max(axis=2) > 90)
    if mask.sum() < 50:
        return np.array([255.0, 255.0, 255.0])
    pick = mask & (s >= np.percentile(s[mask], 80))
    c = region[pick].mean(axis=0)
    return np.clip(c / max(c.max(), 1) * 255, 0, 255)


def blur(a, sigma):
    return ndimage.gaussian_filter(a, sigma)


def ellipse_mask(shape, center, axes):
    m = np.zeros(shape, np.float32)
    cv2.ellipse(m, (int(round(center[0])), int(round(center[1]))), (int(round(axes[0])), int(round(axes[1]))), 0, 0, 360, 1.0, -1, cv2.LINE_AA)
    return m


def depth_layer(shape, matte, base, color=None, remote=True):
    """Shadow (and optional colored floor glow) as an RGBA float layer under the object."""
    h, w = shape
    # Floor contact = the base's bottom ellipse.
    bx, by, ax, ay, bh = base
    cx, cy = bx, by + bh
    labels, n = ndimage.label(matte)
    sizes = ndimage.sum(matte, labels, index=np.arange(1, n + 1))
    stand = labels == int(np.argmax(sizes)) + 1
    # Ambient occlusion: soft pool a little wider than the base, nudged down-right
    # (the key light is front-left).
    amb = ellipse_mask(shape, (cx + ax * 0.04, cy + ay * 0.1), (ax * 1.08, ay * 1.1))
    amb = blur(amb, max(ax * 0.12, 6)) * 0.42
    # Contact shadow: tight and dark right where the base meets the floor.
    con = ellipse_mask(shape, (cx, cy + 2), (ax * 0.98, ay * 0.98))
    con = blur(con, max(ax * 0.025, 2)) * 0.55
    shadow = np.maximum(amb, con)

    others = matte & ~stand  # the remote, if present
    if remote and others.any():
        # It lies flat: its own outline, offset down a touch and blurred.
        r = others.astype(np.float32)
        r_amb = blur(np.roll(r, (5, 3), axis=(0, 1)), 9) * 0.38
        r_con = blur(np.roll(r, (2, 1), axis=(0, 1)), 2.2) * 0.5
        shadow = np.maximum(shadow, np.maximum(r_amb, r_con))

    rgb = np.zeros((h, w, 3), np.float32)
    a = shadow.copy()
    if color is not None:
        # A flat pool of LED light on the floor around the base.
        g = ellipse_mask(shape, (cx, cy + ay * 0.1), (ax * 1.35, ay * 1.3))
        strength = 0.28 if sat(color[None, None, :])[0, 0] < 0.15 else 0.4
        g = blur(g, ax * 0.2) * strength
        # Glow under shadow: composite shadow over glow.
        a = shadow + g * (1 - shadow)
        rgb = (color[None, None, :] * (g * (1 - shadow))[..., None]) / np.maximum(a, 1e-4)[..., None]
    return rgb, np.clip(a, 0, 1)


def over(fg_rgb, fg_a, bg_rgb, bg_a):
    out_a = fg_a + bg_a * (1 - fg_a)
    out_rgb = (fg_rgb * fg_a[..., None] + bg_rgb * (bg_a * (1 - fg_a))[..., None]) / np.maximum(out_a, 1e-4)[..., None]
    return out_rgb, out_a


def bbox(a, thresh=0.01, pad=0):
    ys, xs = np.nonzero(a > thresh)
    h, w = a.shape
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + 1 + pad), min(h, ys.max() + 1 + pad)


def save(rgb, a, box, path):
    x0, y0, x1, y1 = box
    out = np.dstack([rgb, a * 255.0])[y0:y1, x0:x1]
    Image.fromarray(out.round().clip(0, 255).astype(np.uint8)).save(path, optimize=True)
    return x1 - x0, y1 - y0


def register(src_rgb, ref_rgb):
    """Affine map p_ref = W p_src, from the dark shell (cable and remote zeroed)."""
    d_ref = (lum(ref_rgb) < 120).astype(np.float32)
    d_src = (lum(src_rgb) < 120).astype(np.float32)
    d_ref[:, : CABLE_LEFT[0] + 4] = 0
    d_ref[800:, 560:] = 0
    d_src[:, :325] = 0
    d_ref, d_src = blur(d_ref, 3), blur(d_src, 3)
    W = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 500, 1e-7)
    cc, W = cv2.findTransformECC(d_src, d_ref, W, cv2.MOTION_AFFINE, crit, None, 5)
    print(f"frame 2 registration: corr={cc:.4f}")
    return W


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("source", type=Path)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--names", default="", help="comma list n=name, e.g. 3=green,4=orange")
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    names = dict(kv.split("=") for kv in args.names.split(",") if kv)

    frames = {n: load(args.source / f"{n}.jpg") for n in range(3, 20)}
    shape = frames[3].shape[:2]

    # Paint the cable areas white so they read as background.
    cm = cable_mask(shape)
    for rgb in frames.values():
        rgb[cm] = WHITE

    matte = hard_matte(frames)
    base = fit_base(frames[3])
    matte = cut_floor(matte, base)
    # Shared alpha: median over the lit color frames (where the arch has contrast).
    alphas = []
    solved = {}
    for n, rgb in frames.items():
        a, F, B, weak = solve_alpha(rgb, matte)
        solved[n] = (F, B)
        if n not in WHITE_ARCH:
            alphas.append(np.where(weak, np.nan, a))
    alpha = np.nanmedian(np.stack(alphas), axis=0)
    soft = blur(matte.astype(np.float32), 0.8)
    alpha = np.where(np.isnan(alpha), soft, alpha).astype(np.float32)
    # Background trapped inside the matte (e.g. the gap at the arch/base corner):
    # near-white in every lit color frame.
    gap = np.ones(shape, bool)
    for n, rgb in frames.items():
        if n not in WHITE_ARCH:
            gap &= np.sqrt(((WHITE - rgb) ** 2).sum(axis=2)) < 30
    alpha[gap] = 0
    alpha = fix_upright_edge(alpha)

    layers = {}
    for n, rgb in frames.items():
        F, B = solved[n]
        col = unmix(rgb, alpha, F, B)
        color = None if n in UNLIT else glow_color(col, alpha)
        d_rgb, d_a = depth_layer(shape, matte, base, color)
        layers[n] = over(col, alpha, d_rgb, d_a)
    union = None
    for _, a in layers.values():
        b = bbox(a, pad=6)
        union = b if union is None else (min(union[0], b[0]), min(union[1], b[1]), max(union[2], b[2]), max(union[3], b[3]))
    for n, (rgb, a) in layers.items():
        name = f"stand-{n:02d}" + (f"-{names[str(n)]}" if str(n) in names else "")
        size = save(rgb, a, union, args.out / f"{name}.png")
        print(f"{name}.png {size[0]}x{size[1]}")

    # Frame 2: unlit, no remote, different framing.
    rgb2 = load(args.source / "2.jpg")
    W = register(rgb2, load(args.source / "3.jpg"))
    rgb2[cable_mask(shape, W)] = WHITE
    labels, n = ndimage.label(matte)
    sizes = ndimage.sum(matte, labels, index=np.arange(1, n + 1))
    stand_only = (labels == int(np.argmax(sizes)) + 1).astype(np.uint8)
    m2 = cv2.warpAffine(stand_only, W, (shape[1], shape[0]), flags=cv2.INTER_NEAREST + cv2.WARP_INVERSE_MAP) > 0
    base2 = fit_base(rgb2, W)
    m2 = cut_floor(m2, base2, W)
    a2, F2, B2, weak2 = solve_alpha(rgb2, m2)
    shared2 = cv2.warpAffine(alpha, W, (shape[1], shape[0]), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
    a2 = np.where(weak2, shared2, a2)
    a2 = fix_upright_edge(a2, W)
    a2[np.sqrt(((WHITE - rgb2) ** 2).sum(axis=2)) < 14] = 0
    col2 = unmix(rgb2, a2, F2, B2)
    d_rgb, d_a = depth_layer(shape, m2, base2, None, remote=False)
    rgb2o, a2o = over(col2, a2, d_rgb, d_a)
    name = "stand-02" + (f"-{names['2']}" if "2" in names else "")
    size = save(rgb2o, a2o, bbox(a2o, pad=6), args.out / f"{name}.png")
    print(f"{name}.png {size[0]}x{size[1]}")

    # Frame 1: the remote alone, front-on, with a soft shadow beneath.
    rgb1 = load(args.source / "1.jpg")
    m1 = ndimage.binary_closing(lum(rgb1) < 150, np.ones((5, 5)), iterations=2)
    m1, _ = keep_components(m1)
    m1 = ndimage.binary_fill_holes(m1)
    a1, F1, B1, weak1 = solve_alpha(rgb1, m1)
    a1 = np.where(weak1, blur(m1.astype(np.float32), 0.8), a1)
    col1 = unmix(rgb1, a1, F1, B1)
    r = m1.astype(np.float32)
    sh = np.maximum(blur(np.roll(r, 14, axis=0), 14) * 0.40, blur(np.roll(r, 4, axis=0), 4) * 0.35)
    rgb1o, a1o = over(col1, a1, np.zeros_like(col1), sh)
    name = "remote" + (f"-{names['1']}" if "1" in names else "")
    size = save(rgb1o, a1o, bbox(a1o, pad=6), args.out / f"{name}.png")
    print(f"{name}.png {size[0]}x{size[1]}")


if __name__ == "__main__":
    main()
