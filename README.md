# PWRD. Website

Landing page for the **PWRD. Glitter Headphones**, in pink and purple.

Plain HTML/CSS/JS, so there is no build step. Open `index.html` through any static server:

```bash
python3 -m http.server 5178
```

## How the "3D" hero works

The product photos are flat, so the hero uses a **2.5D depth effect** (`main.js` → `DepthViewer`):

- `assets/img/pwrd-<color>.png` is the transparent cutout.
- `assets/img/pwrd-<color>-depth.png` holds the **depth** in the red channel and a **glitter mask** in the green channel.
- A WebGL shader shifts pixels by depth as the cursor moves, drag happens, or the phone tilts. It also adds sparkle that moves with the view, only inside the glitter ear cups.
- If WebGL isn't available, the page falls back to the static PNG with a CSS tilt.

To use a true 3D model later (for example a `.glb` from a 3D scan or an image-to-3D service), swap the hero canvas for `<model-viewer>`.

## Assets

| File | Use |
| --- | --- |
| `pwrd-purple.png`, `pwrd-pink.png` | Transparent product cutouts (hero + colorway cards) |
| `pwrd-duo.png` | Both colorways linked, transparent |
| `pwrd-purple-top.png`, `pwrd-pink-top.png` | Transparent top-down shots |
| `lifestyle-*.webp`, `duo-studio.webp` | Lifestyle / studio photos |

> The pink product cutout was made from a small gallery thumbnail, so it's softer than the purple one. Swap in a full-resolution pink product photo when you have it, and rebuild its depth map the same way.
