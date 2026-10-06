# PWRD. Website

Landing page and product page for the **PWRD. Liquid Glitter Headphones**, in Pink Liquid Glitter and Purple Liquid Glitter.

Plain HTML/CSS/JS, so there is no build step. Pages: `index.html`, `product.html` (both colorways), `pink.html`, `purple.html`, `colorways.html`, `features.html`, `specs.html`. Open them through any static server:

```bash
python3 -m http.server 5178
```

## How the "3D" hero works

The product photos are flat, so the hero uses a **2.5D depth effect** (`main.js` → `DepthViewer`):

- `assets/img/pwrd-<color>.webp` is the transparent cutout.
- `assets/img/pwrd-<color>-depth.png` holds the **depth** in the red channel and a **glitter mask** in the green channel.
- A WebGL shader shifts pixels by depth as the cursor moves, drag happens, or the phone tilts. It also adds sparkle that moves with the view, only inside the glitter ear cups.
- If WebGL isn't available, the page falls back to the static image with a CSS tilt.

To use a true 3D model later (for example a `.glb` from a 3D scan or an image-to-3D service), swap the hero canvas for `<model-viewer>`.

## Assets

| File | Use |
| --- | --- |
| `pwrd-purple.webp`, `pwrd-pink.webp` | Transparent product cutouts from the 2000px product photos (hero + colorway cards) |
| `pwrd-duo.webp` | Both colorways linked, transparent (from the 2000px studio photo) |
| `lifestyle-*.webp` | Lifestyle photos |
| `gallery/<color>/*` | Product page gallery. `.webp` files are white-background product shots turned into transparent cutouts; `.avif` files are lifestyle and infographic images, copied unaltered. The list and order live in `GALLERY` in `main.js`. |

## Reviews carousel

`reviews.json` holds the review cards on the product pages (`product.html`, `pink.html`, `purple.html`). Quotes are verbatim excerpts from Walmart.com, trimmed only with ellipses. The rating summary ("4.6 ★ from 204 ratings") is written in each page's HTML, so update it there when Walmart's count changes. All current reviews are incentivized, so keep the disclosure line under the carousel. Don't add `AggregateRating` structured data for these, because they're third-party reviews.

## Making cutouts from white-background photos

```bash
python3 scripts/remove-white-bg.py path/to/photo.avif --out assets/img/gallery/pink
```

Only white connected to the edges (plus large enclosed gaps, like under the headband) is removed, so white details on the product stay. Needs `pillow`, `numpy` and `scipy`.
