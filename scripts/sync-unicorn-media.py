#!/usr/bin/env python3
"""
Upload Squishy LED Unicorn source photos into the pwrd-media R2 bucket using
data/media-catalog.json as the source of truth (repo ↔ R2).

Usage:
  python3 scripts/sync-unicorn-media.py
  python3 scripts/sync-unicorn-media.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "media-catalog.json"
BUCKET = "pwrd-media"
PRODUCT = "squishy-led-unicorn"

SOURCE_DIRS = [
    Path.home() / "Downloads" / "2026-10-07-2480dc89-5f18-466a-84d9-302399ad7bbf",
    Path.home() / "Downloads" / "2026-10-07-af2f7807-fa98-42b0-b604-8fdf98fce57d",
    Path.home() / "Downloads" / "2026-10-07-70659ab3-d20d-4cd0-8a0a-be5ff8eac40a",
    Path.home() / "Downloads" / "2026-10-07-946c0769-f752-403a-b8bf-7fd0b6b5c7c9",
]

CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".json": "application/json",
}


def find_source(name: str) -> Path | None:
    for folder in SOURCE_DIRS:
        candidate = folder / name
        if candidate.is_file():
            return candidate
    return None


def ensure_shop_card(dest: Path) -> Path:
    """Build a transparent box cutout for the shop card if missing."""
    if dest.is_file():
        return dest
    from importlib.machinery import SourceFileLoader

    cut = SourceFileLoader("cut", str(ROOT / "scripts" / "remove-white-bg.py")).load_module()
    from PIL import Image

    src = find_source("PWRD0004R_02.jpg")
    if not src:
        raise SystemExit("Missing PWRD0004R_02.jpg for shop-card cutout")
    dest.parent.mkdir(parents=True, exist_ok=True)
    img = cut.cutout(Image.open(src), tolerance=42, feather=24, hole_area=0.01, grow=1.15)
    img.thumbnail((1200, 1200), Image.LANCZOS)
    img.save(dest, "WEBP", quality=90, method=6)
    return dest


def upload(file: Path, key: str, dry_run: bool) -> tuple[str, bool, str]:
    ct = CONTENT_TYPES.get(file.suffix.lower(), "application/octet-stream")
    cmd = [
        str(ROOT / "node_modules" / ".bin" / "wrangler"),
        "r2",
        "object",
        "put",
        f"{BUCKET}/{key}",
        "--file",
        str(file),
        "--content-type",
        ct,
        "--cache-control",
        "public, max-age=31536000, immutable",
        "--remote",
    ]
    if dry_run:
        return key, True, "dry-run"
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        return key, True, "ok"
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or str(e)).strip().splitlines()[-1:] or [str(e)]
        return key, False, err[0]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--jobs", type=int, default=4)
    args = ap.parse_args()

    catalog = json.loads(CATALOG.read_text())
    product = catalog["products"][PRODUCT]
    jobs: list[tuple[Path, str]] = []

    shop_card = ROOT / "data" / "_staging" / "shop-card.webp"
    ensure_shop_card(shop_card)

    for asset in product["assets"]:
        source = asset["source"]
        key = asset["key"]
        if source.startswith("derived:"):
            file = shop_card
        else:
            file = find_source(source)
            if not file:
                print(f"MISSING source {source} for {key}", file=sys.stderr)
                return 1
        jobs.append((file, key))

    # Also upload the catalog itself into R2 so storage mirrors the repo index.
    jobs.append((CATALOG, "catalog.json"))
    jobs.append((CATALOG, f"products/{PRODUCT}/catalog.json"))

    print(f"Uploading {len(jobs)} objects to {BUCKET}…")
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(upload, f, k, args.dry_run) for f, k in jobs]
        for fut in as_completed(futures):
            key, success, msg = fut.result()
            if success:
                ok += 1
                print(f"  ✓ {key}")
            else:
                fail += 1
                print(f"  ✗ {key}: {msg}", file=sys.stderr)

    print(f"Done. {ok} ok, {fail} failed.")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
