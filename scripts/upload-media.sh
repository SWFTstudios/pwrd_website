#!/usr/bin/env bash
# Upload a file to the pwrd-media R2 bucket.
# Prefer scripts/sync-unicorn-media.py for the Squishy LED Unicorn pack.
# Usage: scripts/upload-media.sh path/to/file.webp [object-key]
set -euo pipefail
file="${1:?file required}"
key="${2:-$(basename "$file")}"
ct="application/octet-stream"
case "${file##*.}" in
  webp) ct=image/webp ;;
  jpg|jpeg) ct=image/jpeg ;;
  png) ct=image/png ;;
  avif) ct=image/avif ;;
  json) ct=application/json ;;
  svg) ct=image/svg+xml ;;
esac
exec ./node_modules/.bin/wrangler r2 object put "pwrd-media/${key}" \
  --file "$file" \
  --content-type "$ct" \
  --cache-control "public, max-age=31536000, immutable" \
  --remote
