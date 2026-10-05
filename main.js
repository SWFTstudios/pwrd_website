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
      img: "assets/img/pwrd-purple.png",
      depth: "assets/img/pwrd-purple-depth.png",
      label: "Purple",
      walmart: "https://www.walmart.com/ip/PWRD-Pink-Liquid-Glitter-Wireless-Bluetooth-Headphones-Over-Ear-with-Microphone/19416250961",
    },
    pink: {
      img: "assets/img/pwrd-pink.png",
      depth: "assets/img/pwrd-pink-depth.png",
      label: "Pink",
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
    if (productColorLine) productColorLine.textContent = `in ${COLORWAYS[key].label.toLowerCase()}.`;
    if (ctaPrimary && ctaPrimaryLabel) {
      ctaPrimary.href = COLORWAYS[key].walmart;
      ctaPrimaryLabel.textContent = `Shop ${COLORWAYS[key].label} Walmart`;
    }
    if (ctaSecondary) {
      ctaSecondary.href = COLORWAYS[other].walmart;
      ctaSecondary.textContent = `Shop ${COLORWAYS[other].label} Walmart`;
    }
    document.querySelectorAll("[data-select-colorway]").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.selectColorway === key);
    });
    if (isProductPage) {
      const url = new URL(location.href);
      url.searchParams.set("color", key);
      history.replaceState(null, "", url);
    }
  }

  async function setup() {
    syncProductUI(initialColor);
    if (heroFallback) {
      heroFallback.src = COLORWAYS[initialColor].img;
      heroFallback.alt = `PWRD glitter headphones in ${COLORWAYS[initialColor].label.toLowerCase()}`;
    }
    document.querySelectorAll(".swatch").forEach((b) => {
      const on = b.dataset.colorway === initialColor;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on);
    });

    try {
      if (!heroCanvas) throw new Error("No hero canvas");
      hero = new DepthViewer(heroCanvas, { strength: 0.045 });
      await hero.load(COLORWAYS[initialColor].img, COLORWAYS[initialColor].depth);
      viewers.push({ v: hero, el: tilt, tiltEl: tilt, deg: 14 });

      if (duoCanvas) {
        const duo = new DepthViewer(duoCanvas, { strength: 0.05 });
        await duo.load("assets/img/pwrd-duo.png", "assets/img/pwrd-duo-depth.png");
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
  async function setColorway(key, { fromSwatch } = {}) {
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
      heroFallback.alt = `PWRD glitter headphones in ${COLORWAYS[key].label.toLowerCase()}`;
    }
    if (hero && heroCanvas) {
      heroCanvas.style.opacity = 0;
      await new Promise((r) => setTimeout(r, 300));
      await hero.load(COLORWAYS[key].img, COLORWAYS[key].depth);
      heroCanvas.style.opacity = 1;
    }
    if (fromSwatch) {
      /* no-op: keeps API explicit for callers */
    }
    switching = false;
  }

  document.querySelectorAll(".swatch").forEach((btn) => {
    btn.addEventListener("click", () => setColorway(btn.dataset.colorway, { fromSwatch: true }));
  });

  document.querySelectorAll("[data-select-colorway]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      setColorway(card.dataset.selectColorway);
    });
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
