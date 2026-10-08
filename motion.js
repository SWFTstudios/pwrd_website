/*
 * PWRD. motion
 * One shared motion language for every page:
 *  - a liquid-glitter ear cup intro on the first page load of a session,
 *  - page transitions (native cross-document View Transitions, with a fade fallback),
 *  - word-by-word heading reveals, eyebrow and stat animations,
 *  - staggered scroll-in reveals, hover spotlights and glitter bursts on press.
 * The inline script in each page's <head> adds `motion` to <html> (skipped for
 * prefers-reduced-motion) so hidden start states apply before first paint. If this
 * file never runs, that script removes the class again so nothing stays hidden.
 */
(() => {
  const root = document.documentElement;
  if (!root.classList.contains("motion")) return;
  window.pwrdMotion = true;

  const GLITTER = ["#f2a6c2", "#ffd1e6", "#b9a2ea", "#dccdff", "#ffffff", "#e7b6ff"];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[(Math.random() * list.length) | 0];

  // ---------- Ready gate: reveals wait for the intro to open ----------
  let isReady = false;
  const readyQueue = [];
  const whenReady = (fn) => (isReady ? fn() : readyQueue.push(fn));
  function ready() {
    if (isReady) return;
    isReady = true;
    root.classList.add("is-ready");
    readyQueue.splice(0).forEach((fn) => fn());
  }

  // ---------- Intro: glitter settling in an ear cup ----------
  function playIntro() {
    try { sessionStorage.setItem("pwrd-intro", "1"); } catch (e) { /* private mode */ }

    const el = document.createElement("div");
    el.className = "intro";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<canvas class="intro-canvas"></canvas>' +
      '<div class="intro-brand"><img src="assets/img/brand/pwrd-logo-white.svg" alt="" width="216" height="68" />' +
      '<span class="intro-bar"><i></i></span></div>';
    document.body.appendChild(el);
    root.classList.add("intro-mounted");

    const canvas = el.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    let W, H, cx, cy, cw, ch, k;
    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cw = Math.min(190, W * 0.42); ch = cw * 1.18; k = cw / 190;
      cx = W / 2; cy = H * 0.45;
      el.style.setProperty("--cup-h", ch + "px");
    }
    size();
    addEventListener("resize", size);

    // Flakes live in the cup's own coordinates (origin at its center).
    // Mostly fine glitter with some chunky hex flakes, like the real ear cups.
    const flakes = Array.from({ length: 320 }, () => {
      const a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.42;
      const chunky = Math.random() < 0.18;
      return {
        x: Math.cos(a) * r * cw, y: Math.sin(a) * r * ch, vx: 0, vy: 0,
        s: chunky ? rnd(2.6, 4.2) : rnd(1, 2.4), c: pick(GLITTER),
        rot: rnd(0, 6.28), spin: rnd(-3, 3), ph: rnd(0, 6.28), hex: chunky || Math.random() < 0.3,
      };
    });

    function cupPath() {
      const w = cw, h = ch, r = cw * 0.36, x = -w / 2, y = -h / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function drawFlake(f, t, alphaScale) {
      const tw = Math.pow(Math.max(0, Math.sin(f.ph + t * 4 + f.x * 0.05)), 12);
      const s = f.s * k;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.globalAlpha = (0.55 + 0.45 * tw) * alphaScale;
      ctx.fillStyle = f.c;
      if (f.hex) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * s * 1.3, Math.sin(a) * s * 1.3);
        }
        ctx.fill();
      } else {
        ctx.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
      }
      if (tw > 0.55) {
        // Glint: a small four-point star when the flake catches the light.
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = tw * alphaScale;
        ctx.fillStyle = "#fff";
        ctx.fillRect(-s * 3, -0.4, s * 6, 0.8);
        ctx.fillRect(-0.4, -s * 3, 0.8, s * 6);
      }
      ctx.restore();
    }

    const t0 = performance.now();
    let last = t0, leaveAt = 0, raf = 0, done = false;
    let loaded = document.readyState === "complete";
    addEventListener("load", () => { loaded = true; }, { once: true });
    const MIN = 1700, MAX = 3200;

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      const exit = leaveAt ? Math.min(1, (now - leaveAt) / 650) : 0;
      const shake = Math.exp(-t * 1.5);
      const tilt = 0.22 * Math.sin(t * 10) * shake * (1 - exit);

      // Physics: slow "liquid" gravity in the tilted cup, plus a swirl that dies down.
      const g = 60 * k, swirl = 260 * k * shake;
      const gx = g * Math.sin(tilt), gy = g * Math.cos(tilt);
      const drag = Math.pow(leaveAt ? 0.6 : 0.35, dt);
      const a = cw / 2 - cw * 0.06, b = ch / 2 - cw * 0.06;
      for (const f of flakes) {
        if (!leaveAt) {
          const d = Math.hypot(f.x, f.y) + 1;
          f.vx += (gx - (f.y / d) * swirl) * dt;
          f.vy += (gy + (f.x / d) * swirl) * dt;
        }
        f.vx *= drag; f.vy *= drag;
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.rot += f.spin * dt * (0.3 + shake);
        if (leaveAt) continue;
        // Keep flakes inside the rounded cup (a superellipse).
        const q = Math.pow(Math.abs(f.x) / a, 4) + Math.pow(Math.abs(f.y) / b, 4);
        if (q > 1) {
          const sc = Math.pow(q, -0.25);
          f.x *= sc; f.y *= sc;
          let nx = Math.sign(f.x) * Math.pow(Math.abs(f.x) / a, 3) / a;
          let ny = Math.sign(f.y) * Math.pow(Math.abs(f.y) / b, 3) / b;
          const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
          const vn = f.vx * nx + f.vy * ny;
          if (vn > 0) { f.vx -= 1.5 * vn * nx; f.vy -= 1.5 * vn * ny; }
        }
      }

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      const cupAlpha = 1 - exit;
      ctx.scale(1 + exit * 0.5, 1 + exit * 0.5);

      // Glass body.
      ctx.globalAlpha = cupAlpha;
      cupPath();
      const body = ctx.createRadialGradient(-cw * 0.2, -ch * 0.25, cw * 0.1, 0, 0, ch * 0.7);
      body.addColorStop(0, "rgba(255, 235, 248, 0.16)");
      body.addColorStop(1, "rgba(120, 90, 170, 0.10)");
      ctx.fillStyle = body;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Glitter (clipped to the cup until it bursts out), in a faint pink-lilac liquid.
      ctx.save();
      if (!leaveAt) {
        cupPath(); ctx.clip();
        const liquid = ctx.createLinearGradient(0, -ch / 2, 0, ch / 2);
        liquid.addColorStop(0, "rgba(242, 166, 194, 0.04)");
        liquid.addColorStop(1, "rgba(185, 162, 234, 0.16)");
        ctx.fillStyle = liquid;
        ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      }
      for (const f of flakes) drawFlake(f, t, 1 - exit * exit);
      ctx.restore();

      // Metallic rim and glass highlight.
      ctx.globalAlpha = cupAlpha;
      const rim = ctx.createLinearGradient(-cw / 2, -ch / 2, cw / 2, ch / 2);
      rim.addColorStop(0, "#f8d9ea");
      rim.addColorStop(0.35, "#c9b2f0");
      rim.addColorStop(0.55, "#ffffff");
      rim.addColorStop(0.8, "#b79ad6");
      rim.addColorStop(1, "#f2a6c2");
      ctx.lineWidth = cw * 0.075;
      ctx.strokeStyle = rim;
      cupPath();
      ctx.stroke();
      ctx.beginPath();
      ctx.lineWidth = cw * 0.03;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.moveTo(-cw * 0.3, -ch * 0.1);
      ctx.quadraticCurveTo(-cw * 0.3, -ch * 0.33, -cw * 0.1, -ch * 0.35);
      ctx.stroke();
      ctx.restore();

      const elapsed = now - t0;
      if (!leaveAt && ((loaded && elapsed > MIN) || elapsed > MAX)) leave();
      if (!done) raf = requestAnimationFrame(frame);
    }

    function leave() {
      if (leaveAt) return;
      leaveAt = performance.now();
      // Burst: every flake flies out from the cup's center.
      for (const f of flakes) {
        const ang = Math.atan2(f.y, f.x) + rnd(-0.4, 0.4);
        const sp = rnd(450, 1300) * k;
        f.vx = Math.cos(ang) * sp; f.vy = Math.sin(ang) * sp;
      }
      el.classList.add("is-leaving");
      setTimeout(ready, 250);
      setTimeout(() => {
        done = true;
        cancelAnimationFrame(raf);
        removeEventListener("resize", size);
        el.remove();
        root.classList.remove("intro", "intro-mounted");
      }, 1000);
    }

    el.addEventListener("pointerdown", leave);
    addEventListener("keydown", leave, { once: true });
    setTimeout(leave, MAX + 400); // in case animation frames are paused (background tab)
    raf = requestAnimationFrame(frame);
  }

  if (root.classList.contains("intro")) playIntro();
  else ready();

  // ---------- Headings: split into words for a staggered rise ----------
  function splitWords(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let n = 0;
    nodes.forEach((node) => {
      if (!node.textContent.trim()) return;
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (!part.trim()) { frag.appendChild(document.createTextNode(part)); return; }
        const word = document.createElement("span");
        word.className = "word";
        const inner = document.createElement("span");
        inner.className = "word-in";
        inner.style.setProperty("--w", n++);
        inner.textContent = part;
        word.appendChild(inner);
        frag.appendChild(word);
      });
      node.replaceWith(frag);
    });
    el.classList.add("split");
    return n;
  }

  // ---------- Scroll-in reveals ----------
  // Keep this list in sync with the hidden start state in styles.css (MOTION section).
  const REVEAL = [
    ".eyebrow", ".lede", ".hero-copy > .cta", ".product-ctas", ".duo-copy > p", ".ticks li",
    ".stats > div", ".cw-card", ".feat-grid article", ".shop-filters", ".shop-count", ".shop-card",
    ".pdp-gallery-count", ".pdp-grid", ".gallery figure", ".lifestyle-item", ".spec-table > div",
    ".reviews-meta", ".reviews-toggle", ".reviews-viewport", ".reviews-disclosure", ".faq", ".faq-note",
    ".support-jump", ".stage", ".swatches", ".sub-visual", ".duo-media", ".footer > *",
  ].join(", ");
  const STEP = 80; // ms between staggered siblings

  const headings = [...document.querySelectorAll("main h1, main h2")];
  const words = new Map(headings.map((h) => [h, splitWords(h)]));
  const targets = [...document.querySelectorAll(REVEAL), ...headings];

  // Stagger by position among revealed siblings, so groups cascade in order.
  const siblingIndex = new Map();
  targets
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .forEach((el) => {
      const p = el.parentElement;
      const i = siblingIndex.get(p) || 0;
      siblingIndex.set(p, i + 1);
      el.style.setProperty("--i", Math.min(i, 8));
      el.style.setProperty("--d", Math.min(i, 8) * STEP + "ms");
    });

  function countUp(strong) {
    const m = strong && strong.textContent.trim().match(/^(\d+(?:\.\d+)?)(\D.*)?$/);
    if (!m || (m[2] || "").startsWith("-")) return;
    const end = parseFloat(m[1]), decimals = (m[1].split(".")[1] || "").length, suffix = m[2] || "";
    const t0 = performance.now(), dur = 1200;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      strong.textContent = (end * e).toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function show(el) {
    el.classList.add("is-in");
    if (el.matches(".stats > div")) countUp(el.querySelector("strong"));
    const i = parseFloat(el.style.getPropertyValue("--i")) || 0;
    const extra = words.has(el) ? words.get(el) * 40 : 0;
    // Once the entrance is over, hand transitions back to the element's own styles.
    setTimeout(() => el.classList.add("reveal-done"), i * STEP + extra + 1100);
  }

  whenReady(() => {
    // Hidden eyebrows are clipped to nothing, which Chrome counts as never intersecting,
    // so they're watched through their parent instead.
    const watched = new Map();
    targets.forEach((el) => {
      const proxy = el.matches(".eyebrow") ? el.parentElement : el;
      watched.set(proxy, [...(watched.get(proxy) || []), el]);
    });
    const observe = (margin) => {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          watched.get(e.target).forEach(show);
        });
      }, { rootMargin: margin, threshold: 0.08 });
      return io;
    };
    // Content waits until it's a little way up the screen; the footer sits at the very
    // bottom of the page, so it reveals as soon as it's visible.
    const content = observe("0px 0px -6% 0px"), edge = observe("0px");
    watched.forEach((_, el) => (el.closest(".footer") ? edge : content).observe(el));
  });

  // Colorway swaps (product page) replace heading text: give the new name a quick rise.
  const swapTargets = document.querySelectorAll("#product-color-line, #gallery-color-name, [data-color-name]");
  const swapObserver = new MutationObserver((records) => {
    records.forEach(({ target }) => {
      const el = target.nodeType === 1 ? target : target.parentElement;
      el.classList.remove("swap-in");
      void el.offsetWidth; // restart the animation
      el.classList.add("swap-in");
    });
  });
  swapTargets.forEach((el) => swapObserver.observe(el, { childList: true, characterData: true, subtree: true }));

  // ---------- Header: compact once the page scrolls ----------
  const nav = document.querySelector(".nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 24);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ---------- Hover: a soft spotlight that follows the pointer on cards ----------
  document.querySelectorAll(".cw-card, .feat-grid article, .shop-media").forEach((card) => {
    card.setAttribute("data-spotlight", "");
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", e.clientX - r.left + "px");
      card.style.setProperty("--my", e.clientY - r.top + "px");
    });
  });

  // ---------- Press: a little burst of glitter ----------
  const BURST = ".cta, .swatch, .shop-filters button, .carousel-btn, .reviews-toggle, .support-jump a, .social";
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(BURST)) return;
    for (let i = 0; i < 14; i++) {
      const p = document.createElement("span");
      p.className = "spark";
      const size = rnd(3, 7);
      p.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;width:${size}px;height:${size}px;background:${pick(GLITTER)}`;
      document.body.appendChild(p);
      const ang = rnd(0, Math.PI * 2), dist = rnd(28, 72);
      p.animate(
        [
          { transform: "translate(-50%, -50%) rotate(45deg) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) rotate(225deg) scale(0)`, opacity: 0 },
        ],
        { duration: rnd(500, 800), easing: "cubic-bezier(.2,.8,.2,1)" }
      ).onfinish = () => p.remove();
    }
  });

  // ---------- Page transitions ----------
  // Browsers with cross-document View Transitions animate natively (see styles.css).
  // Others get a quick fade-out before navigating.
  if (!("onpageswap" in window)) {
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same-page link
      e.preventDefault();
      root.classList.add("is-leaving");
      setTimeout(() => { location.href = url.href; }, 260);
    });
    addEventListener("pageshow", (e) => { if (e.persisted) root.classList.remove("is-leaving"); });
  }
})();
