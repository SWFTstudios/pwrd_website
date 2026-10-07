/*
 * PWRD. landing page
 * DepthViewer turns a flat cutout + depth map into a 2.5D object: each pixel is
 * shifted by its depth as the pointer moves (parallax), and a glitter shader adds
 * view-dependent sparkles so the ear cups glint as you "turn" the headphones.
 */
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const VERT = `
    attribute vec2 p;
    varying vec2 uv;
    void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }
  `;

  const FRAG = `
    precision mediump float;
    varying vec2 uv;
    uniform sampler2D img;
    uniform sampler2D dep;
    uniform vec2 look;      // -1..1 pointer / orientation
    uniform float t;
    uniform float strength;
    uniform float fade;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      // Iterative parallax: refine the depth lookup a few times so edges don't smear.
      vec2 coord = uv;
      for (int i = 0; i < 4; i++) {
        float d = texture2D(dep, coord).r;
        coord = uv - look * (d - 0.45) * strength;
      }
      vec4 c = texture2D(img, coord);
      vec4 dm = texture2D(dep, coord);
      float d = dm.r;
      float glitterMask = dm.g; // painted from the ear-cup glitter areas

      // Soft key light that follows the pointer, stronger on raised areas.
      vec2 L = normalize(vec2(look.x, -look.y) + vec2(0.0001));
      float rim = dot(uv - 0.5, L) * 0.18 * length(look);
      c.rgb += rim * d * c.a;

      // Glitter: flakes slosh opposite the tilt (like loose glitter in liquid)
      // and flare when the view angle catches them. Only inside the ear cups.
      vec2 slosh = look * vec2(-5.0, -9.0) + vec2(0.0, t * 0.6);
      vec2 gp = coord * 260.0 + slosh;
      vec2 cell = floor(gp);
      float h = hash(cell);
      vec2 f = fract(gp) - 0.5;
      float flake = smoothstep(0.42, 0.0, length(f));
      float phase = h * 50.0 + t * 2.2 + dot(look, vec2(11.0, 7.0));
      float glint = pow(max(0.0, sin(phase)), 30.0) * step(0.72, h) * flake;
      vec3 tint = mix(vec3(1.0), c.rgb * 1.6 + 0.2, 0.45);
      c.rgb += glint * tint * c.a * glitterMask * 1.4;
      c.rgb += glitterMask * c.a * 0.04 * sin(t * 1.3 + dot(coord, vec2(20.0, 14.0)) + look.x * 4.0);

      gl_FragColor = vec4(c.rgb, c.a * fade);
    }
  `;

  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }

  class DepthViewer {
    constructor(canvas, { strength = 0.04 } = {}) {
      this.canvas = canvas;
      this.strength = strength;
      this.look = [0, 0];
      this.target = [0, 0];
      this.fade = 1;
      this.gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: true });
      if (!this.gl) throw new Error("WebGL unavailable");
      this._init();
    }

    _init() {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      this.prog = prog;

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this.u = {};
      ["img", "dep", "look", "t", "strength", "fade"].forEach((n) => (this.u[n] = gl.getUniformLocation(prog, n)));
      gl.uniform1i(this.u.img, 0);
      gl.uniform1i(this.u.dep, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.texImg = gl.createTexture();
      this.texDep = gl.createTexture();
    }

    _upload(tex, unit, image) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    async load(src, depthSrc) {
      const [im, dm] = await Promise.all([loadImage(src), loadImage(depthSrc)]);
      this._upload(this.texImg, 0, im);
      this._upload(this.texDep, 1, dm);
      this.aspect = im.width / im.height;
      this.resize();
      return this;
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    render(time) {
      const gl = this.gl;
      const ease = 0.08;
      this.look[0] += (this.target[0] - this.look[0]) * ease;
      this.look[1] += (this.target[1] - this.look[1]) * ease;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.u.look, this.look[0], this.look[1]);
      gl.uniform1f(this.u.t, time / 1000);
      gl.uniform1f(this.u.strength, this.strength);
      gl.uniform1f(this.u.fade, this.fade);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  // ---------- Pointer / orientation input ----------
  const input = { x: 0, y: 0, active: false, last: 0 };
  let dragging = false;
  const stage = document.getElementById("stage");

  const setInput = (x, y) => {
    input.x = Math.max(-1, Math.min(1, x));
    input.y = Math.max(-1, Math.min(1, y));
    input.active = true;
    input.last = performance.now();
  };

  // Map pointer to look relative to the stage center (not the viewport),
  // so hovering the headphones actually covers the full -1..1 range.
  const lookFromStage = (clientX, clientY) => {
    if (!stage) return null;
    const r = stage.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return {
      x: ((clientX - r.left) / r.width) * 2 - 1,
      y: ((clientY - r.top) / r.height) * 2 - 1,
    };
  };

  const pointerOverStage = (clientX, clientY) => {
    if (!stage) return false;
    const r = stage.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  };

  window.addEventListener("pointermove", (e) => {
    if (dragging || reduceMotion) return;
    if (!pointerOverStage(e.clientX, e.clientY)) return;
    const look = lookFromStage(e.clientX, e.clientY);
    if (look) setInput(look.x, look.y);
  });
  window.addEventListener("deviceorientation", (e) => {
    if (e.gamma == null || reduceMotion) return;
    setInput(e.gamma / 30, (e.beta - 45) / 30);
  });

  // Idle drift so the object feels alive when nobody's touching it.
  const idle = (t) => [Math.sin(t / 2200) * 0.55, Math.cos(t / 3100) * 0.35];

  // ---------- Hero ----------
  const COLORWAYS = {
    purple: {
      img: "assets/img/pwrd-purple.webp",
      depth: "assets/img/pwrd-purple-depth.png",
      label: "Purple",
      name: "Purple Liquid Glitter",
      walmart: "https://www.walmart.com/ip/PWRD-Purple-Liquid-Glitter-Wireless-Bluetooth-Headphones-Over-Ear-with-Microphone/19416250961",
    },
    pink: {
      img: "assets/img/pwrd-pink.webp",
      depth: "assets/img/pwrd-pink-depth.png",
      label: "Pink",
      name: "Pink Liquid Glitter",
      walmart: "https://www.walmart.com/ip/PWRD-Pink-Liquid-Glitter-Wireless-Bluetooth-Headphones-Over-Ear-with-Microphone/19459660128",
    },
  };

  const isProductPage = document.body.dataset.page === "product";
  const params = new URLSearchParams(location.search);
  const paramColor = (params.get("color") || "").toLowerCase();
  const initialColor =
    COLORWAYS[paramColor] ? paramColor
    : COLORWAYS[document.body.dataset.colorway] ? document.body.dataset.colorway
    : "pink";
  document.body.dataset.colorway = initialColor;

  const tilt = document.getElementById("tilt");
  const heroCanvas = document.getElementById("hero-canvas");
  const heroFallback = document.getElementById("hero-fallback");
  const duoCanvas = document.getElementById("duo-canvas");
  const duoFallback = document.getElementById("duo-fallback");
  const label = document.getElementById("swatch-label");
  const productColorLine = document.getElementById("product-color-line");
  const ctaPrimary = document.getElementById("cta-primary");
  const ctaPrimaryLabel = document.getElementById("cta-primary-label");
  const ctaSecondary = document.getElementById("cta-secondary");
  const viewers = [];
  let hero = null;

  function syncProductUI(key) {
    const other = key === "pink" ? "purple" : "pink";
    if (label) label.textContent = COLORWAYS[key].label;
    if (productColorLine) productColorLine.textContent = COLORWAYS[key].name;
    document.querySelectorAll("[data-color-name]").forEach((el) => (el.textContent = COLORWAYS[key].name));
    if (ctaPrimary && ctaPrimaryLabel) {
      ctaPrimary.href = COLORWAYS[key].walmart;
      ctaPrimaryLabel.textContent = `Shop ${COLORWAYS[key].name}`;
    }
    if (ctaSecondary) {
      ctaSecondary.href = COLORWAYS[other].walmart;
      ctaSecondary.textContent = `Shop ${COLORWAYS[other].name}`;
    }
    // A gallery pinned to one product (data-gallery) ignores colorway changes.
    renderGallery((grid && grid.dataset.gallery) || key);
    document.querySelectorAll("[data-select-colorway]").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.selectColorway === key);
    });
    if (isProductPage) {
      // Mirror the Walmart listing title so the hand-off reads as the same product.
      document.title = `PWRD ${COLORWAYS[key].name} Wireless Bluetooth Headphones, Over Ear with Microphone | PWRD.`;
      const url = new URL(location.href);
      url.searchParams.set("color", key);
      history.replaceState(null, "", url);
    }
  }

  // ---------- PDP gallery + lightbox ----------
  // `cutout` images are transparent product shots; everything else is shown as shot.
  const G = "assets/img/gallery/";
  const GALLERY = {
    pink: [
      { src: "assets/img/pwrd-pink.webp", alt: "PWRD Pink Liquid Glitter wireless headphones, side view", cutout: true },
      { src: G + "pink/pink-features.avif", alt: "PWRD Pink Liquid Glitter headphones features: Bluetooth 5.3, built-in microphone, USB-C charging, foldable, up to 6–11 hours of playtime" },
      { src: G + "pink/pink-earcup.webp", alt: "Close-up of the PWRD Pink Liquid Glitter ear cushion and on-ear controls", cutout: true },
      { src: G + "pink/pink-ports.webp", alt: "PWRD Pink Liquid Glitter ear cup with microphone, aux and USB-C ports", cutout: true },
      { src: G + "pink/pink-lifestyle-neck.avif", alt: "PWRD Pink Liquid Glitter headphones worn around the neck" },
      { src: G + "pink/pink-lifestyle-tote.avif", alt: "PWRD Pink Liquid Glitter headphones clipped to a tote bag" },
      { src: G + "pink/pink-lifestyle-vanity.avif", alt: "PWRD Pink Liquid Glitter headphones on a vanity" },
      { src: G + "pink/pink-lifestyle-flatlay.avif", alt: "PWRD Pink Liquid Glitter headphones in a flat lay with a sweatshirt and water bottle" },
    ],
    purple: [
      { src: "assets/img/pwrd-purple.webp", alt: "PWRD Purple Liquid Glitter wireless headphones, side view", cutout: true },
      { src: G + "purple/purple-front.webp", alt: "PWRD Purple Liquid Glitter wireless headphones, front view", cutout: true },
      { src: G + "purple/purple-features.avif", alt: "PWRD Purple Liquid Glitter headphones features: Bluetooth 5.3, built-in microphone, USB-C charging, foldable, up to 6–11 hours of playtime" },
      { src: G + "purple/purple-controls.avif", alt: "PWRD Purple Liquid Glitter over-ear design with on-ear controls explained" },
      { src: G + "purple/purple-earcup.webp", alt: "Close-up of the PWRD Purple Liquid Glitter ear cushion and on-ear controls", cutout: true },
      { src: G + "purple/purple-ports.webp", alt: "PWRD Purple Liquid Glitter ear cup with microphone, aux and USB-C ports", cutout: true },
      { src: G + "purple/purple-lifestyle-worn.avif", alt: "PWRD Purple Liquid Glitter headphones being worn" },
      { src: G + "purple/purple-lifestyle-neck.avif", alt: "PWRD Purple Liquid Glitter headphones worn around the neck" },
      { src: G + "purple/purple-lifestyle-vanity.avif", alt: "PWRD Purple Liquid Glitter headphones on a vanity" },
      { src: G + "purple/purple-lifestyle-flatlay.avif", alt: "PWRD Purple Liquid Glitter headphones in a flat lay with a sweatshirt and water bottle" },
    ],
    stand: [
      { src: G + "stand/stand-rgb.webp", alt: "PWRD. 3 in 1 LED Wireless Charger with Headphone Stand lit in rainbow RGB, with its infrared remote", cutout: true },
      { src: G + "stand/stand-light-modes.avif", alt: "Dynamic RGB lights: 16 light color modes with brightness control, plus Chase, Strobe, Fade and Smooth modes on the remote" },
      { src: G + "stand/stand-compatibility.avif", alt: "Wireless charging pad compatible with iPhone 11 to 17, AirPods 2nd and 3rd gen, and Android devices. Infrared remote included" },
      { src: G + "stand/stand-features.avif", alt: "PWRD Pink Liquid Glitter headphones on the stand: universal headset stand, wireless charging pad, compact design, USB power cord included" },
      { src: G + "stand/stand-white.webp", alt: "PWRD. 3 in 1 LED Wireless Charger with Headphone Stand with a white light, and its remote", cutout: true },
      { src: G + "stand/stand-lifestyle-gaming.avif", alt: "LED charger stand glowing on a gaming desk next to a keyboard" },
      { src: G + "stand/stand-lifestyle-desk.avif", alt: "LED charger stand glowing pink on a desk with a phone charging on the base" },
      { src: G + "stand/stand-lifestyle-bedside.avif", alt: "LED charger stand glowing orange on a nightstand: dimmer and brightener, 16 color functions, 4 light modes, infrared remote" },
    ],
  };

  const grid = document.getElementById("pdp-grid");
  const galleryCount = document.getElementById("gallery-count");
  const galleryColorName = document.getElementById("gallery-color-name");
  const photoGroups = [...document.querySelectorAll("[data-lightbox]")];
  if (grid || photoGroups.length) {
    document.body.insertAdjacentHTML("beforeend", `
      <dialog class="lightbox" id="lightbox" aria-label="Photo viewer">
        <div class="lb-top">
          <span class="lb-counter" id="lb-counter" aria-live="polite"></span>
          <button class="lb-btn lb-close" id="lb-close" aria-label="Close photo viewer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="lb-stage">
          <button class="lb-btn lb-nav lb-prev" id="lb-prev" aria-label="Previous photo"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
          <div class="lb-track" id="lb-track"></div>
          <button class="lb-btn lb-nav lb-next" id="lb-next" aria-label="Next photo"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>
        </div>
        <div class="lb-thumbs" id="lb-thumbs" role="tablist" aria-label="Photos"></div>
      </dialog>`);
  }
  const lb = document.getElementById("lightbox");
  const lbTrack = document.getElementById("lb-track");
  const lbThumbs = document.getElementById("lb-thumbs");
  const lbCounter = document.getElementById("lb-counter");
  let galleryKey = null;
  let lbIndex = 0;
  let lbOpener = null;
  let lbItems = null;

  function renderGallery(key) {
    if (!grid || galleryKey === key) return;
    galleryKey = key;
    const items = GALLERY[key];
    if (galleryColorName && COLORWAYS[key]) galleryColorName.textContent = COLORWAYS[key].name;
    if (galleryCount) galleryCount.textContent = items.length;
    grid.innerHTML = "";
    items.forEach((item, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pdp-tile" + (item.cutout ? " is-cutout" : "") + (i === 0 ? " is-lead" : "");
      btn.setAttribute("role", "listitem");
      btn.setAttribute("aria-label", `View photo ${i + 1} of ${items.length}: ${item.alt}`);
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = "";
      img.loading = i < 3 ? "eager" : "lazy";
      img.decoding = "async";
      btn.appendChild(img);
      btn.addEventListener("click", () => openLightbox(items, i, btn));
      grid.appendChild(btn);
    });
    grid.scrollLeft = 0;
  }

  function buildLightbox(items) {
    lbTrack.innerHTML = "";
    lbThumbs.innerHTML = "";
    items.forEach((item, i) => {
      const slide = document.createElement("figure");
      slide.className = "lb-slide" + (item.cutout ? " is-cutout" : "");
      slide.setAttribute("aria-roledescription", "slide");
      const img = document.createElement("img");
      img.dataset.src = item.src;
      img.alt = item.alt;
      img.decoding = "async";
      slide.appendChild(img);
      lbTrack.appendChild(slide);

      const th = document.createElement("button");
      th.type = "button";
      th.className = "lb-thumb" + (item.cutout ? " is-cutout" : "");
      th.setAttribute("role", "tab");
      th.setAttribute("aria-label", `Photo ${i + 1}`);
      const ti = document.createElement("img");
      ti.src = item.src;
      ti.alt = "";
      ti.loading = "lazy";
      th.appendChild(ti);
      th.addEventListener("click", () => goTo(i));
      lbThumbs.appendChild(th);
    });
  }

  function goTo(i, { instant } = {}) {
    const n = lbTrack.children.length;
    lbIndex = (i + n) % n;
    lbTrack.style.transition = instant || reduceMotion ? "none" : "";
    lbTrack.style.transform = `translateX(${-lbIndex * 100}%)`;
    // Load the current slide and its neighbours.
    [lbIndex - 1, lbIndex, lbIndex + 1].forEach((j) => {
      const img = lbTrack.children[(j + n) % n].querySelector("img");
      if (!img.src) img.src = img.dataset.src;
    });
    [...lbTrack.children].forEach((s, j) => s.setAttribute("aria-hidden", j !== lbIndex));
    [...lbThumbs.children].forEach((t, j) => {
      t.classList.toggle("is-active", j === lbIndex);
      t.setAttribute("aria-selected", j === lbIndex);
    });
    lbThumbs.children[lbIndex].scrollIntoView({ block: "nearest", inline: "center", behavior: instant ? "auto" : "smooth" });
    lbCounter.textContent = `${lbIndex + 1} / ${n}`;
  }

  function openLightbox(items, i, opener) {
    if (!lb) return;
    if (items !== lbItems) {
      buildLightbox(items);
      lbItems = items;
    }
    lbOpener = opener;
    document.documentElement.classList.add("lb-open");
    lb.showModal();
    goTo(i, { instant: true });
    document.getElementById("lb-close").focus();
  }

  if (lb) {
    lb.addEventListener("close", () => {
      document.documentElement.classList.remove("lb-open");
      if (lbOpener) lbOpener.focus();
    });
    document.getElementById("lb-close").addEventListener("click", () => lb.close());
    document.getElementById("lb-prev").addEventListener("click", () => goTo(lbIndex - 1));
    document.getElementById("lb-next").addEventListener("click", () => goTo(lbIndex + 1));
    lb.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); goTo(lbIndex - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(lbIndex + 1); }
    });
    // Swipe / drag between photos.
    const swipe = { x: 0, dx: 0, active: false };
    lbTrack.addEventListener("pointerdown", (e) => {
      Object.assign(swipe, { x: e.clientX, dx: 0, active: true });
      lbTrack.style.transition = "none";
    });
    window.addEventListener("pointermove", (e) => {
      if (!swipe.active) return;
      swipe.dx = e.clientX - swipe.x;
      lbTrack.style.transform = `translateX(calc(${-lbIndex * 100}% + ${swipe.dx}px))`;
    });
    const endSwipe = () => {
      if (!swipe.active) return;
      swipe.active = false;
      const threshold = Math.min(80, lbTrack.clientWidth * 0.15);
      if (swipe.dx < -threshold) goTo(lbIndex + 1);
      else if (swipe.dx > threshold) goTo(lbIndex - 1);
      else goTo(lbIndex);
    };
    window.addEventListener("pointerup", endSwipe);
    window.addEventListener("pointercancel", endSwipe);
  }

  // Static photo grids (e.g. the home page lifestyle photos) open in the same viewer.
  photoGroups.forEach((group) => {
    const links = [...group.querySelectorAll("a[href]")];
    const items = links.map((a) => ({ src: a.getAttribute("href"), alt: a.querySelector("img").alt }));
    links.forEach((a, i) => {
      a.setAttribute("aria-haspopup", "dialog");
      a.setAttribute("aria-label", `View photo ${i + 1} of ${links.length}: ${items[i].alt}`);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openLightbox(items, i, a);
      });
    });
  });

  // ---------- Reviews marquee ----------
  // The list is rendered twice so the CSS loop is seamless; the copy is hidden from assistive tech.
  const reviewsSection = document.querySelector(".reviews");
  const reviewTrack = document.getElementById("review-track");
  const reviewDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  function reviewCard(r, hidden) {
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const li = el("li", "review-card");
    if (hidden) li.setAttribute("aria-hidden", "true");
    const fig = el("figure");
    const stars = el("div", "review-stars", "★".repeat(r.rating));
    stars.setAttribute("role", "img");
    stars.setAttribute("aria-label", `${r.rating} out of 5 stars`);
    const cap = el("figcaption");
    const who = el("span", "review-name", r.name);
    if (r.date) who.appendChild(el("span", "review-date", reviewDate.format(new Date(r.date))));
    cap.append(who);
    if (r.tag) cap.append(el("span", "review-tag", r.tag));
    fig.append(stars, el("blockquote", null, `“${r.quote}”`), cap);
    li.appendChild(fig);
    return li;
  }

  if (reviewsSection && reviewTrack) {
    fetch(reviewsSection.dataset.src || "reviews/headphones.json")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((reviews) => {
        reviewTrack.append(...reviews.map((r) => reviewCard(r, false)), ...reviews.map((r) => reviewCard(r, true)));
      })
      .catch((err) => {
        console.warn("Reviews unavailable:", err);
        reviewsSection.hidden = true;
      });

    const toggle = reviewsSection.querySelector(".reviews-toggle");
    toggle.addEventListener("click", () => {
      const paused = reviewsSection.classList.toggle("is-paused");
      toggle.querySelector("span").textContent = paused ? "Play reviews" : "Pause reviews";
    });
  }

  // ---------- Shop filters ----------
  // Cards carry data-category (and data-featured); a #hash like shop.html#headphones preselects a filter.
  const filterButtons = [...document.querySelectorAll("[data-filter]")];
  const shopCards = [...document.querySelectorAll("[data-category]")];
  const shopCount = document.getElementById("shop-count");
  const carousel = document.querySelector(".shop-carousel");
  const scroller = document.getElementById("shop-scroller");
  const prevBtn = carousel && carousel.querySelector(".carousel-prev");
  const nextBtn = carousel && carousel.querySelector(".carousel-next");

  // Arrows only appear when the visible cards overflow the row.
  function updateCarousel() {
    if (!scroller) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    const overflowing = max > 2;
    carousel.classList.toggle("is-overflowing", overflowing);
    prevBtn.hidden = nextBtn.hidden = !overflowing;
    prevBtn.disabled = scroller.scrollLeft <= 2;
    nextBtn.disabled = scroller.scrollLeft >= max - 2;
  }
  function scrollCarousel(dir) {
    const card = scroller.querySelector(".shop-card:not([hidden])");
    const step = card ? card.getBoundingClientRect().width + 24 : scroller.clientWidth;
    // Move by all fully visible cards but one, so there's always context.
    const amount = Math.max(step, Math.floor(scroller.clientWidth / step - 1) * step);
    scroller.scrollBy({ left: dir * amount, behavior: reduceMotion ? "auto" : "smooth" });
  }
  if (scroller) {
    prevBtn.addEventListener("click", () => scrollCarousel(-1));
    nextBtn.addEventListener("click", () => scrollCarousel(1));
    scroller.addEventListener("scroll", updateCarousel, { passive: true });
    window.addEventListener("resize", updateCarousel);
  }

  function applyFilter(filter) {
    let shown = 0;
    filterButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.filter === filter));
    shopCards.forEach((card) => {
      const match = filter === "featured" ? card.hasAttribute("data-featured") : card.dataset.category === filter;
      card.hidden = !match;
      if (match) shown++;
    });
    if (shopCount) shopCount.textContent = `${shown} ${shown === 1 ? "product" : "products"}`;
    if (scroller) {
      scroller.scrollLeft = 0;
      updateCarousel();
    }
  }
  if (filterButtons.length) {
    filterButtons.forEach((b) => b.addEventListener("click", () => {
      applyFilter(b.dataset.filter);
      history.replaceState(null, "", b.dataset.filter === "featured" ? location.pathname : `#${b.dataset.filter}`);
    }));
    const filterFromHash = () => {
      const fromHash = location.hash.slice(1);
      applyFilter(filterButtons.some((b) => b.dataset.filter === fromHash) ? fromHash : "featured");
    };
    window.addEventListener("hashchange", filterFromHash);
    filterFromHash();
  }

  // ---------- Layout: the fixed nav's height, for sticky bars and anchor offsets ----------
  const siteNav = document.querySelector(".nav");
  const setVar = (name, px) => document.documentElement.style.setProperty(name, px + "px");
  if (siteNav && "ResizeObserver" in window) {
    // The nav compacts on scroll, so keep this live rather than measuring once.
    new ResizeObserver(() => setVar("--nav-h", siteNav.offsetHeight)).observe(siteNav);
  }

  // ---------- Support page: sticky topic tabs, with the topic in view highlighted ----------
  const jump = document.querySelector(".support-jump");
  if (jump) {
    const strip = jump.querySelector(".support-jump-links");
    const links = [...jump.querySelectorAll('a[href^="#"]')];
    const groups = links.map((a) => document.querySelector(a.getAttribute("href")));
    if ("ResizeObserver" in window) new ResizeObserver(() => setVar("--jump-h", jump.offsetHeight)).observe(jump);
    let current;
    const updateJump = () => {
      const navH = siteNav ? siteNav.offsetHeight : 0;
      jump.classList.toggle("is-stuck", jump.getBoundingClientRect().top <= navH + 1);
      // The active topic is the last group whose top has passed just below the tabs.
      const line = navH + jump.offsetHeight + 24;
      let active = null;
      groups.forEach((g, i) => { if (g && g.getBoundingClientRect().top <= line) active = links[i]; });
      const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) active = links[links.length - 1];
      if (active === current) return;
      current = active;
      links.forEach((a) => (a === active ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
      // On phones the tabs scroll sideways: keep the active one in view.
      if (active && strip.scrollWidth > strip.clientWidth) {
        strip.scrollTo({ left: active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2, behavior: reduceMotion ? "auto" : "smooth" });
      }
    };
    let queued = false;
    addEventListener("scroll", () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; updateJump(); });
    }, { passive: true });
    addEventListener("resize", updateJump);
    updateJump();
  }

  async function setup() {
    syncProductUI(initialColor);
    if (heroFallback) {
      heroFallback.src = COLORWAYS[initialColor].img;
      heroFallback.alt = `PWRD ${COLORWAYS[initialColor].name} wireless headphones`;
    }
    document.querySelectorAll(".swatch").forEach((b) => {
      const on = b.dataset.colorway === initialColor;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on);
    });

    if (!heroCanvas && !duoCanvas) return;
    try {
      if (heroCanvas) {
        hero = new DepthViewer(heroCanvas, { strength: 0.045 });
        await hero.load(COLORWAYS[initialColor].img, COLORWAYS[initialColor].depth);
        tilt.style.aspectRatio = hero.aspect;
        viewers.push({ v: hero, el: tilt, tiltEl: tilt, deg: 14 });
      }

      if (duoCanvas) {
        const duo = new DepthViewer(duoCanvas, { strength: 0.05 });
        await duo.load("assets/img/pwrd-duo.webp", "assets/img/pwrd-duo-depth.png");
        viewers.push({ v: duo, el: duoCanvas, tiltEl: duoCanvas, deg: 8 });
      }
    } catch (err) {
      console.warn("Falling back to static images:", err);
      document.documentElement.classList.add("no-webgl");
      // Keep CSS tilt on the static images so it still feels dimensional.
      viewers.length = 0;
      if (tilt) viewers.push({ v: null, el: tilt, tiltEl: tilt, deg: 14 });
      if (duoFallback) viewers.push({ v: null, el: duoFallback, tiltEl: duoFallback, deg: 8 });
    }
    requestAnimationFrame(loop);
  }

  function loop(t) {
    const useIdle = !input.active || t - input.last > 2500;
    const [ix, iy] = useIdle ? idle(t) : [input.x, input.y];
    for (const item of viewers) {
      const r = item.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue; // offscreen: skip work
      if (item.v) {
        item.v.target = reduceMotion ? [0, 0] : [ix, iy];
        item.v.render(t);
      }
      if (!reduceMotion) {
        item.tiltEl.style.transform = `rotateY(${ix * item.deg}deg) rotateX(${-iy * item.deg * 0.6}deg)`;
      }
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener("resize", () => viewers.forEach((i) => i.v && i.v.resize()));

  // Colorway switching with a quick fade.
  let switching = false;
  async function setColorway(key) {
    if (switching || !COLORWAYS[key] || document.body.dataset.colorway === key) {
      if (document.body.dataset.colorway === key) syncProductUI(key);
      return;
    }
    switching = true;
    document.querySelectorAll(".swatch").forEach((b) => {
      const on = b.dataset.colorway === key;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on);
    });
    document.body.dataset.colorway = key;
    syncProductUI(key);
    if (heroFallback) {
      heroFallback.src = COLORWAYS[key].img;
      heroFallback.alt = `PWRD ${COLORWAYS[key].name} wireless headphones`;
    }
    if (hero && heroCanvas) {
      heroCanvas.style.opacity = 0;
      await new Promise((r) => setTimeout(r, 300));
      await hero.load(COLORWAYS[key].img, COLORWAYS[key].depth);
      if (tilt) tilt.style.aspectRatio = hero.aspect;
      hero.resize();
      heroCanvas.style.opacity = 1;
    }
    switching = false;
  }

  document.querySelectorAll(".swatch").forEach((btn) => {
    btn.addEventListener("click", () => setColorway(btn.dataset.colorway));
  });

  // Drag on the stage to "turn" the headphones (touch + mouse).
  if (stage) {
    stage.addEventListener("pointerdown", (e) => {
      if (reduceMotion) return;
      if (e.button != null && e.button !== 0) return;
      dragging = true;
      const start = { x: e.clientX, y: e.clientY };
      const base = { x: input.x, y: input.y };
      try {
        stage.setPointerCapture(e.pointerId);
      } catch (_) {
        /* capture unsupported — drag still works via stage events */
      }
      const move = (ev) => {
        setInput(base.x + (ev.clientX - start.x) / 160, base.y + (ev.clientY - start.y) / 160);
      };
      const up = (ev) => {
        dragging = false;
        try {
          stage.releasePointerCapture(ev.pointerId);
        } catch (_) {
          /* already released */
        }
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerup", up);
        stage.removeEventListener("pointercancel", up);
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerup", up);
      stage.addEventListener("pointercancel", up);
    });
  }

  // Hover tilt on colorway cards.
  document.querySelectorAll("[data-depth-card]").forEach((card) => {
    const img = card.querySelector(".cw-media img") || card.querySelector("img");
    card.addEventListener("pointermove", (e) => {
      if (reduceMotion || !img) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      img.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 12}deg) scale(1.04)`;
    });
    card.addEventListener("pointerleave", () => {
      if (img) img.style.transform = "";
    });
  });

  // ---------- Interactive LED stand color remote ----------
  const STAND_BASE = "assets/img/stand-colors/";
  // glow = sampled from lit arch; btn = remote face color for CSS --c
  const STAND_COLORS = {
    red: { name: "Red", glow: "#ff5056", btn: "#c51324", label: "R" },
    green: { name: "Green", glow: "#8eda92", btn: "#3c7e42", label: "G" },
    blue: { name: "Blue", glow: "#8cb7ff", btn: "#2b508f", label: "B" },
    white: { name: "White", glow: "#f2f2f6", btn: "#e8e7e7", label: "W" },
    "orange-red": { name: "Orange red", glow: "#ff655d", btn: "#c41e24" },
    lime: { name: "Lime", glow: "#abed97", btn: "#5da44c" },
    sky: { name: "Sky", glow: "#6fccff", btn: "#2c74bb" },
    orange: { name: "Orange", glow: "#ff7d57", btn: "#c43e22" },
    mint: { name: "Mint", glow: "#9ae6f9", btn: "#478899" },
    violet: { name: "Violet", glow: "#e596da", btn: "#52224d" },
    amber: { name: "Amber", glow: "#ff983c", btn: "#ce692a" },
    cyan: { name: "Cyan", glow: "#88d8fc", btn: "#2d728f" },
    magenta: { name: "Magenta", glow: "#f795d9", btn: "#6e2756" },
    yellow: { name: "Yellow", glow: "#fff711", btn: "#e5c821" },
    teal: { name: "Teal", glow: "#83c9e2", btn: "#3a8a96" },
    pink: { name: "Pink", glow: "#ff74d4", btn: "#c23672" },
  };

  // 4×6 remote grid matching the physical IR remote.
  // Chase/Strobe stay decorative; Fade/Smooth drive autoplay color cycles.
  const STAND_REMOTE_GRID = [
    [
      { kind: "inert", label: "−", aria: "Brightness down (preview only)" },
      { kind: "inert", label: "+", aria: "Brightness up (preview only)" },
      { kind: "power", id: "off", label: "OFF", aria: "Turn light off", btn: "#1a1a1a" },
      { kind: "power", id: "on", label: "ON", aria: "Turn light on", btn: "#d2272d" },
    ],
    [
      { kind: "color", id: "red" },
      { kind: "color", id: "green" },
      { kind: "color", id: "blue" },
      { kind: "color", id: "white" },
    ],
    [
      { kind: "color", id: "orange-red" },
      { kind: "color", id: "lime" },
      { kind: "color", id: "sky" },
      { kind: "inert", label: "CHASE", aria: "Chase mode (preview only)" },
    ],
    [
      { kind: "color", id: "orange" },
      { kind: "color", id: "mint" },
      { kind: "color", id: "violet" },
      { kind: "inert", label: "STROBE", aria: "Strobe mode (preview only)" },
    ],
    [
      { kind: "color", id: "amber" },
      { kind: "color", id: "cyan" },
      { kind: "color", id: "magenta" },
      { kind: "mode", id: "fade", label: "FADE", aria: "Fade through colors" },
    ],
    [
      { kind: "color", id: "yellow" },
      { kind: "color", id: "teal" },
      { kind: "color", id: "pink" },
      { kind: "mode", id: "smooth", label: "SMOOTH", aria: "Smooth color cycle" },
    ],
  ];

  // Remote column order for mode cycles (skip off).
  const STAND_COLOR_ORDER = [
    "red", "orange-red", "orange", "amber", "yellow",
    "green", "lime", "mint", "cyan", "teal",
    "blue", "sky", "violet", "magenta", "pink", "white",
  ];

  const STAND_MODES = {
    fade: { dwell: 2400, crossfade: reduceMotion ? 0 : 900 },
    smooth: { dwell: 1100, crossfade: reduceMotion ? 0 : 500 },
  };

  const STAND_OFF = { frame: "off" };
  const STAND_DEFAULT = "pink";
  const STAND_FADE_MS = reduceMotion ? 0 : 350;
  const STAND_PRESS_MS = 120;
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  function standFrameSrc(id) {
    return `${STAND_BASE}stand-${id}.webp`;
  }

  function pressBtn(btn) {
    btn.classList.add("is-pressing");
    window.setTimeout(() => btn.classList.remove("is-pressing"), STAND_PRESS_MS);
  }

  function initStandDemo(root) {
    const host = root.closest(".stand-visual") || root;
    const front = root.querySelector("img.stand-frame") || root.querySelector("img");
    if (!front) return;

    // Frames live in a floating stage; remote sits below outside the float.
    let stage = root.querySelector(".stand-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.className = "stand-stage";
      root.insertBefore(stage, front);
      stage.appendChild(front);
    }

    front.classList.add("stand-frame", "is-front");
    front.alt = front.alt || "PWRD. LED charger stand";
    front.width = 501;
    front.height = 720;
    front.decoding = "async";

    const back = document.createElement("img");
    back.className = "stand-frame is-back";
    back.alt = "";
    back.width = 501;
    back.height = 720;
    back.decoding = "async";
    back.setAttribute("aria-hidden", "true");
    stage.insertBefore(back, front);

    const remote = document.createElement("div");
    remote.className = "stand-remote";
    remote.setAttribute("role", "group");
    remote.setAttribute("aria-label", "LED stand remote");

    const face = document.createElement("div");
    face.className = "stand-remote-face";

    const colorGroup = document.createElement("div");
    colorGroup.className = "stand-remote-grid";
    colorGroup.setAttribute("role", "group");
    colorGroup.setAttribute("aria-label", "Remote controls");

    const colorButtons = {};
    const modeButtons = {};
    let onBtn = null;
    let offBtn = null;

    STAND_REMOTE_GRID.forEach((row) => {
      row.forEach((cell) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rbtn";

        if (cell.kind === "color") {
          const meta = STAND_COLORS[cell.id];
          btn.classList.add("rbtn-color");
          btn.dataset.standColor = cell.id;
          btn.setAttribute("role", "radio");
          btn.setAttribute("aria-checked", "false");
          btn.setAttribute("aria-label", meta.name);
          btn.style.setProperty("--c", meta.btn);
          if (meta.label) {
            btn.dataset.label = meta.label;
            btn.textContent = meta.label;
          }
          colorGroup.appendChild(btn);
          colorButtons[cell.id] = btn;
          return;
        }

        if (cell.kind === "power") {
          btn.classList.add("rbtn-power", cell.id === "on" ? "rbtn-on" : "rbtn-off");
          btn.dataset.standPower = cell.id;
          btn.setAttribute("aria-label", cell.aria);
          btn.setAttribute("aria-pressed", cell.id === "on" ? "true" : "false");
          btn.style.setProperty("--c", cell.btn);
          btn.textContent = cell.label;
          colorGroup.appendChild(btn);
          if (cell.id === "on") onBtn = btn;
          else offBtn = btn;
          return;
        }

        if (cell.kind === "mode") {
          btn.classList.add("rbtn-mode");
          btn.dataset.standMode = cell.id;
          btn.setAttribute("aria-label", cell.aria);
          btn.setAttribute("aria-pressed", "false");
          btn.style.setProperty("--c", "#8a8d92");
          btn.textContent = cell.label;
          colorGroup.appendChild(btn);
          modeButtons[cell.id] = btn;
          return;
        }

        // Inert: brightness / Chase / Strobe — visible for authenticity only.
        btn.classList.add("rbtn-inert");
        btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("aria-label", cell.aria);
        btn.tabIndex = -1;
        btn.disabled = true;
        btn.style.setProperty("--c", "#6a6d72");
        btn.textContent = cell.label;
        colorGroup.appendChild(btn);
      });
    });

    face.appendChild(colorGroup);
    remote.appendChild(face);

    const live = document.createElement("p");
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");

    root.appendChild(remote);
    root.appendChild(live);

    let current = STAND_DEFAULT;
    let powered = true;
    let busy = false;
    let queued = null;
    let frontEl = front;
    let backEl = back;
    let activeMode = null;
    let modeTimer = null;
    let modeCrossfade = STAND_FADE_MS;

    const applyGlow = (id, on) => {
      if (!on || id === STAND_OFF.frame) {
        host.classList.add("is-stand-off");
        host.classList.remove("has-stand-glow");
        return;
      }
      host.classList.remove("is-stand-off");
      host.classList.add("has-stand-glow");
      host.style.setProperty("--stand-glow", STAND_COLORS[id]?.glow || "#ffffff");
    };

    const syncButtons = () => {
      for (const [id, btn] of Object.entries(colorButtons)) {
        const on = powered && id === current;
        btn.setAttribute("aria-checked", on ? "true" : "false");
        btn.classList.toggle("is-active", on);
      }
      for (const [id, btn] of Object.entries(modeButtons)) {
        const on = activeMode === id;
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.classList.toggle("is-active", on);
      }
      if (onBtn) onBtn.setAttribute("aria-pressed", powered ? "true" : "false");
      if (offBtn) offBtn.setAttribute("aria-pressed", powered ? "false" : "true");
      remote.classList.toggle("is-off", !powered);
      root.classList.toggle("is-mode-fade", activeMode === "fade");
      root.classList.toggle("is-mode-smooth", activeMode === "smooth");
    };

    const announce = (id, on) => {
      if (!on) live.textContent = "Stand light: Off";
      else if (activeMode) live.textContent = `Stand light: ${STAND_COLORS[id]?.name || id} (${activeMode})`;
      else live.textContent = `Stand light: ${STAND_COLORS[id]?.name || id}`;
    };

    const loadFrame = (img, src) =>
      new Promise((resolve, reject) => {
        if (img.getAttribute("src") === src && img.complete) {
          resolve();
          return;
        }
        const done = () => {
          img.decode?.().then(resolve).catch(resolve);
        };
        img.onload = done;
        img.onerror = reject;
        img.src = src;
        if (img.complete) done();
      });

    const showFrame = async (id, on, fadeMs = modeCrossfade) => {
      const frameId = on ? id : STAND_OFF.frame;
      const src = standFrameSrc(frameId);
      const wait = fadeMs == null ? STAND_FADE_MS : fadeMs;
      busy = true;
      try {
        await loadFrame(backEl, src);
        if (wait === 0) {
          frontEl.classList.remove("is-front");
          frontEl.classList.add("is-back");
          backEl.classList.remove("is-back");
          backEl.classList.add("is-front");
          const tmp = frontEl;
          frontEl = backEl;
          backEl = tmp;
        } else {
          backEl.classList.add("is-fading-in");
          await new Promise((r) => setTimeout(r, wait));
          frontEl.classList.remove("is-front");
          frontEl.classList.add("is-back");
          backEl.classList.remove("is-back", "is-fading-in");
          backEl.classList.add("is-front");
          const tmp = frontEl;
          frontEl = backEl;
          backEl = tmp;
        }
        frontEl.alt = on
          ? `PWRD. LED charger stand lit ${STAND_COLORS[id]?.name?.toLowerCase() || id}`
          : "PWRD. LED charger stand with light off";
        applyGlow(id, on);
        syncButtons();
        announce(id, on);
      } catch (err) {
        console.warn("Stand frame failed to load:", err);
      } finally {
        busy = false;
        if (queued) {
          const next = queued;
          queued = null;
          next();
        }
      }
    };

    const requestShow = (id, on, fadeMs) => {
      const run = () => showFrame(id, on, fadeMs);
      if (busy) queued = run;
      else run();
    };

    const stopMode = () => {
      if (modeTimer != null) {
        window.clearTimeout(modeTimer);
        modeTimer = null;
      }
      activeMode = null;
      modeCrossfade = STAND_FADE_MS;
      root.classList.remove("is-mode-fade", "is-mode-smooth");
      syncButtons();
    };

    const scheduleModeStep = () => {
      if (!activeMode || !STAND_MODES[activeMode]) return;
      const { dwell, crossfade } = STAND_MODES[activeMode];
      modeCrossfade = crossfade;
      modeTimer = window.setTimeout(() => {
        modeTimer = null;
        if (!activeMode) return;
        const idx = STAND_COLOR_ORDER.indexOf(current);
        const next = STAND_COLOR_ORDER[(idx < 0 ? 0 : idx + 1) % STAND_COLOR_ORDER.length];
        current = next;
        powered = true;
        const step = async () => {
          await showFrame(next, true, crossfade);
          if (activeMode) scheduleModeStep();
        };
        if (busy) queued = step;
        else step();
      }, dwell);
    };

    const startMode = (modeId) => {
      if (!STAND_MODES[modeId]) return;
      if (activeMode === modeId) {
        stopMode();
        announce(current, powered);
        return;
      }
      stopMode();
      activeMode = modeId;
      powered = true;
      modeCrossfade = STAND_MODES[modeId].crossfade;
      syncButtons();
      requestShow(current, true, modeCrossfade);
      scheduleModeStep();
      live.textContent = `Stand light: ${modeId} mode`;
    };

    const setColor = (id) => {
      if (!STAND_COLORS[id]) return;
      stopMode();
      current = id;
      powered = true;
      requestShow(id, true, STAND_FADE_MS);
    };

    const setPower = (on) => {
      stopMode();
      powered = on;
      requestShow(current, on, STAND_FADE_MS);
    };

    colorGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("button.rbtn");
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
      pressBtn(btn);
      if (btn.dataset.standColor) setColor(btn.dataset.standColor);
      else if (btn.dataset.standPower === "on") setPower(true);
      else if (btn.dataset.standPower === "off") setPower(false);
      else if (btn.dataset.standMode) startMode(btn.dataset.standMode);
    });

    // Pointer tilt for a light 2.5D feel (mouse / trackpad only).
    if (canHover && !reduceMotion) {
      remote.addEventListener("pointermove", (e) => {
        const r = remote.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 2 - 1;
        const y = ((e.clientY - r.top) / r.height) * 2 - 1;
        face.style.transform = `rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
      });
      remote.addEventListener("pointerleave", () => {
        face.style.transform = "";
      });
    }

    if (!frontEl.getAttribute("src")?.includes("stand-colors/")) {
      frontEl.src = standFrameSrc(STAND_DEFAULT);
    }
    applyGlow(STAND_DEFAULT, true);
    syncButtons();
    announce(STAND_DEFAULT, true);

    let preloaded = false;
    const preload = () => {
      if (preloaded) return;
      preloaded = true;
      [...Object.keys(STAND_COLORS), STAND_OFF.frame].forEach((id) => {
        if (id === STAND_DEFAULT) return;
        const img = new Image();
        img.decoding = "async";
        img.src = standFrameSrc(id);
      });
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            preload();
            io.disconnect();
          }
        },
        { rootMargin: "200px" }
      );
      io.observe(root);
    } else {
      preload();
    }
  }

  document.querySelectorAll("[data-stand-demo]").forEach(initStandDemo);

  setup();
})();
