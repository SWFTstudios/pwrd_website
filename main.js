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
  const setInput = (x, y) => {
    input.x = Math.max(-1, Math.min(1, x));
    input.y = Math.max(-1, Math.min(1, y));
    input.active = true;
    input.last = performance.now();
  };
  window.addEventListener("pointermove", (e) => {
    setInput((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  });
  window.addEventListener("deviceorientation", (e) => {
    if (e.gamma == null) return;
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
    : "purple";
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

  // Drag on the stage to "turn" the headphones on touch screens.
  const stage = document.getElementById("stage");
  if (stage) {
    stage.addEventListener("pointerdown", (e) => {
      const start = { x: e.clientX, y: e.clientY };
      const move = (ev) => setInput((ev.clientX - start.x) / 160, (ev.clientY - start.y) / 160);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
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

  setup();
})();
