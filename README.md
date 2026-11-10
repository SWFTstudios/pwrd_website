# PWRD. Website

Website for **PWRD.** products, all sold on Walmart.com: the **Liquid Glitter Headphones** (Pink Liquid Glitter and Purple Liquid Glitter) and the **3 in 1 LED Wireless Charger with Headphone Stand**.

Plain HTML/CSS/JS, so there is no build step. `worker.js` answers `/api/*` (signups), `/unsubscribe` and `/media/*` (product media from R2); everything else is served as static assets. Pages: `index.html`, `shop.html` (all products), `support.html` (FAQ), product pages `pink.html`, `purple.html`, `product.html` (both headphone colorways) and `led-charger-stand.html`, plus headphone pages `colorways.html`, `features.html`, `specs.html` (linked from the footer). `coming-soon.html` is a teaser for an unannounced product (not linked from the nav yet). The top nav is just Shop and Support, plus Instagram and TikTok. Open them through any static server:

```bash
python3 -m http.server 5178
```

To try the signup form too, run the Worker locally with `npx wrangler dev` (needs `WAITLIST_KEY=...` in a `.dev.vars` file for the export).

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
| `brand/pwrd-logo-white.svg` | Official PWRD. logo (with ™), vector paths taken from `PWRD_Logo.ai`. White, for the dark header and footer |
| `/favicon.svg`, `/favicon.ico`, `/apple-touch-icon.png` | "P." monogram built from the official logo's P and period, on the site's dark tile |
| `gallery/<color>/*` | Product page gallery. `.webp` files are white-background product shots turned into transparent cutouts; `.avif` files are lifestyle and infographic images, copied unaltered. The list and order live in `GALLERY` in `main.js`. |

## Adding a product

1. Add photos under `assets/img/gallery/<product>/` (cut out white-background shots with the script below) and list them under a new key in `GALLERY` in `main.js`.
2. Create its page from `led-charger-stand.html`: point the gallery at the new key with `data-gallery`, and the reviews at a new `reviews/<product>.json` with `data-src`.
3. Copy a card in `shop.html` and set its `data-category` (add a filter button for a new category).
4. Add the page to `sitemap.xml`, and an FAQ group to `support.html` if needed.

## Motion

`motion.js` (loaded on every page) handles all animation, with shared timing and easing:

- **Intro:** on the first page load of a session, glitter settles in a liquid-glitter ear cup, then the cup opens onto the page. Click or press a key to skip.
- **Page transitions:** cross-document View Transitions keep the nav in place while the page slides and fades (Chrome, Edge, Safari 18.2+). Other browsers get a quick fade-out.
- **Reveals:** headings rise in word by word, eyebrows wipe in, stats count up, and cards, photos and FAQ items fade up in order as they scroll into view.
- **Hover and press:** glitter sheen on buttons, a pointer spotlight on cards, link underlines, and a glitter burst on press. The header compacts on scroll.

A small inline script in each page's `<head>` turns motion on before first paint, so content starts hidden instead of flashing. Motion is skipped entirely for `prefers-reduced-motion`, and if `motion.js` fails to load, everything is shown. To animate a new kind of element, add its selector to `REVEAL` in `motion.js` and to the matching list in the MOTION section of `styles.css`.

## Reviews carousel

`reviews/headphones.json` and `reviews/led-charger-stand.json` hold the review cards on the product pages; each reviews section picks its file with `data-src`. Quotes are verbatim excerpts from Walmart.com, trimmed only with ellipses. The rating summary (for example "4.6 ★ from 204 ratings") is written in each page's HTML, so update it there when Walmart's count changes. All current reviews are incentivized, so keep the disclosure line under the carousel. Don't add `AggregateRating` structured data for these, because they're third-party reviews.

## Making cutouts from white-background photos

```bash
python3 scripts/remove-white-bg.py path/to/photo.avif --out assets/img/gallery/pink
```

Only white connected to the edges (plus large enclosed gaps, like under the headband) is removed, so white details on the product stay. Needs `pillow`, `numpy` and `scipy`.

## Coming-soon page

`coming-soon.html` + `coming-soon.css` + `coming-soon.js`. The whole page sits behind frosted glass: only the product's light shows through, and tapping the glass squishes it and changes its color. Keep product names and descriptions out of this page, its assets and this repo (the repo is public) until launch.

- `assets/img/soon/glow-<color>.webp` are already heavily blurred, so nothing sharp is ever served; the glass blurs them again.
- Launch-day files live in `_launch/`, which is ignored by git and by deploys. Don't commit them before launch.

### Signups

The forms post to `/api/notify`, which stores the email, the page it came from (`source`) and the date in the D1 database `pwrd-signups` (Wrangler creates it on the first `npm run deploy`). Signing up twice from the same page keeps one row. Sources so far: `coming-soon` (teaser page) and `unicorn-walmart` (the "Notify me when it's at Walmart" forms on `squishy-led-unicorn.html`).

Set the export password once:

```bash
npx wrangler secret put WAITLIST_KEY
```

The list is always current; there is nothing to sync by hand:

- **Excel:** open `https://staypwrd.com/api/notify/export` and sign in with any username and that password. Add `?source=unicorn-walmart` for just the unicorn list.
- **Live Google Sheet:** in cell A1 put `=IMPORTDATA("https://staypwrd.com/api/notify/export.csv?source=unicorn-walmart&key=YOUR_WAITLIST_KEY")`. Google refreshes it about every hour. Anyone who can open that sheet can see the key, so keep the sheet private.

Columns: Email, Signed up from, Signed up (UTC), Status (Subscribed / Unsubscribed), Unsubscribed (UTC), Unsubscribe link.

**Confirmation emails.** A new signup (or someone re-subscribing) gets a "You're on the list" email from `hello@staypwrd.com`, sent by the Worker through Cloudflare Email Sending (the `EMAIL` binding in `wrangler.jsonc`). It includes their unsubscribe link and the one-click `List-Unsubscribe` header. Submitting the same address again sends nothing. staypwrd.com must be onboarded under **Email Service → Email Sending** in the Cloudflare account that serves the site; until then sends fail quietly (the signup is still saved; the error shows in the Worker's logs). Wording lives in `LISTS` in `worker.js`. To get replies to hello@, add an Email Routing rule forwarding it to your inbox.

**Unsubscribes.** Every signup has its own private link (`/unsubscribe?t=…`, in the last column). When you send the launch email, mail-merge that link into each message (e.g. "Don't want these emails? Unsubscribe: {Unsubscribe link}") and only send to rows whose Status is **Subscribed**. Opening the link shows a confirm button, so email link scanners can't unsubscribe people by accident; the click marks the row Unsubscribed. If your email tool supports it, also set the `List-Unsubscribe` header to the same link with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, which turns on the built-in Unsubscribe button in Gmail and Apple Mail. Someone who signs up again after unsubscribing is switched back to Subscribed.
