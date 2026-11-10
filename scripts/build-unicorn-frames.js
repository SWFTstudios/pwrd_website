// Usage: from a folder with lit-<color>-full.png made by scripts/lift-subject-full.swift
// and sharp installed: node build-unicorn-frames.js. Writes unicorn-<color>.webp (585x900, aligned).
// Note: sharp dilate() shrinks a white-on-black mask (erode grows it).
// Build aligned transparent frames from Vision full-frame cutouts.
// 1) drop studio-white from the alpha edge ring, 2) bleed the subject's own color outward
// under semi/fully transparent pixels so lossy WebP can't smear white into the edge.
const sharp = require("sharp");
const cs = ["white", "red", "green", "blue", "purple"];
const L = 878, T = 586, W = 1150, H = 1768, px = W * H;
const raw1 = (buf) => ({ raw: { width: W, height: H, channels: 1 } });
(async () => {
  for (const c of cs) {
    const img = await sharp(`lit-${c}-full.png`).extract({ left: L, top: T, width: W, height: H }).ensureAlpha().raw().toBuffer();
    const a = Buffer.alloc(px);
    for (let i = 0; i < px; i++) a[i] = img[i * 4 + 3];
    const core = await sharp(a, raw1()).dilate(18).extractChannel(0).raw().toBuffer();
    const out = Buffer.alloc(px);
    for (let i = 0; i < px; i++) {
      let al = a[i];
      if (al > 0 && al < 250) {
        const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2];
        const lum = (r + g + b) / 3, sat = Math.max(r, g, b) - Math.min(r, g, b);
        const whiteness = Math.min(1, Math.max(0, (lum - 200) / 40)) * Math.min(1, Math.max(0, (40 - sat) / 30));
        al = Math.round(al * (1 - whiteness));
      }
      out[i] = al;
    }
    const alpha = await sharp(out, raw1()).dilate(3).blur(1.2).extractChannel(0).raw().toBuffer();

    // Color bleed: average subject color (solid pixels only) spread outward.
    const solid = Buffer.alloc(px), pre = Buffer.alloc(px * 3);
    for (let i = 0; i < px; i++) {
      const s = alpha[i] >= 250 ? 255 : 0; solid[i] = s;
      for (let k = 0; k < 3; k++) pre[i * 3 + k] = s ? img[i * 4 + k] : 0;
    }
    const preB = await sharp(pre, { raw: { width: W, height: H, channels: 3 } }).blur(8).raw().toBuffer();
    const solB = await sharp(solid, raw1()).blur(8).extractChannel(0).raw().toBuffer();
    for (let i = 0; i < px; i++) {
      if (alpha[i] < 250) {
        const w = solB[i];
        for (let k = 0; k < 3; k++) img[i * 4 + k] = w > 0 ? Math.min(255, Math.round((preB[i * 3 + k] * 255) / w)) : 0;
      }
      img[i * 4 + 3] = alpha[i];
    }
    const png = await sharp(img, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    await sharp(png).resize({ width: 585, height: 900, fit: "fill" }).webp({ quality: 88, alphaQuality: 95, effort: 6 }).toFile(`unicorn-${c}.webp`);
    await sharp(`unicorn-${c}.webp`).flatten({ background: "#1c1720" }).resize({ height: 450 }).toFile(`prev-${c}.png`);
  }
  const pm = await sharp("prev-white.png").metadata();
  await sharp({ create: { width: pm.width * 5, height: pm.height, channels: 3, background: "#1c1720" } })
    .composite(cs.map((c, i) => ({ input: `prev-${c}.png`, left: i * pm.width, top: 0 }))).png().toFile("montage.png");
  await sharp("unicorn-red.webp").extract({ left: 330, top: 60, width: 220, height: 300 }).resize({ height: 520 }).flatten({ background: "#1c1720" }).toFile("edge-zoom.png");
  await sharp("unicorn-white.webp").extract({ left: 0, top: 300, width: 220, height: 300 }).resize({ height: 520 }).flatten({ background: "#1c1720" }).toFile("edge-zoom-white.png");
})();
