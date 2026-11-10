/* Squishy LED Unicorn page (squishy-led-unicorn.html).
   - Color demo: tap the unicorn (or a swatch) to cycle its light, ending with a rainbow chase.
     It cycles on its own while on screen until someone interacts. Same idea as coming-soon.js.
   - "Notify me" forms post to /api/notify with source "unicorn-walmart" (see worker.js). */
(() => {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Color demo ----------
  const demo = document.querySelector(".glow-demo");
  if (demo) {
    const MODES = [
      { id: "white", glow: "#fff1d2", name: "Warm white" },
      { id: "red", glow: "#ff3048", name: "Red" },
      { id: "green", glow: "#25e07a", name: "Green" },
      { id: "blue", glow: "#3d63ff", name: "Blue" },
      { id: "purple", glow: "#d23cff", name: "Purple" },
      { id: "chase", glow: null, name: "Rainbow chase" },
    ];
    const RAINBOW = ["#ff3b55", "#ffb21f", "#fff04a", "#2fe07a", "#2bc4ff", "#6a5bff", "#d53cff"];
    const stage = demo.querySelector(".glow-stage");
    const squish = demo.querySelector(".glow-squish");
    const now = demo.querySelector(".glow-now strong");
    const swatches = [...demo.querySelectorAll(".glow-swatches button")];
    const frames = new Map([...demo.querySelectorAll(".glow-frame")].map((img) => [img.dataset.mode, img]));
    let mode = 0;
    let frameOn = frames.get("white");
    let auto = null;
    let touched = false;

    // Load the other colors once the section is close, so the first swap doesn't flash.
    const warm = () => frames.forEach((img) => { img.loading = "eager"; });

    function setMode(next) {
      mode = (next + MODES.length) % MODES.length;
      const m = MODES[mode];
      demo.dataset.mode = m.id;
      if (m.glow) demo.style.setProperty("--glow", m.glow);
      if (now) now.textContent = m.name;
      swatches.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m.id)));

      const target = frames.get(m.id === "chase" ? "white" : m.id);
      if (target === frameOn) return;
      frames.forEach((img) => { if (img !== frameOn && img !== target) img.classList.remove("is-on", "is-prev"); });
      frameOn.classList.remove("is-on");
      frameOn.classList.add("is-prev");
      target.classList.remove("is-prev");
      target.classList.add("is-on", "is-entering");
      void target.offsetWidth; // start the fade from 0
      target.classList.remove("is-entering");
      const prev = frameOn;
      setTimeout(() => { if (prev !== frameOn) prev.classList.remove("is-prev"); }, 400);
      frameOn = target;
    }

    function bounce() {
      if (reduceMotion || !squish.animate) return;
      squish.animate(
        [
          { transform: "none" },
          { transform: "scale(1.08, .88)", offset: 0.22 },
          { transform: "scale(.96, 1.06)", offset: 0.5 },
          { transform: "scale(1.02, .98)", offset: 0.75 },
          { transform: "none" },
        ],
        { duration: 560, easing: "ease-out" }
      );
      for (let k = 0; k < 10; k++) {
        const spark = document.createElement("span");
        const color = MODES[mode].glow || RAINBOW[k % RAINBOW.length];
        spark.className = "glow-spark";
        spark.style.background = color;
        spark.style.boxShadow = `0 0 18px ${color}`;
        stage.appendChild(spark);
        const angle = (k / 10) * Math.PI * 2 + Math.random() * 0.5;
        const dist = stage.offsetWidth * (0.35 + Math.random() * 0.25);
        spark.animate(
          [
            { transform: "translate(0, 0)", opacity: 1 },
            { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(.3)`, opacity: 0 },
          ],
          { duration: 800 + Math.random() * 300, easing: "cubic-bezier(.15, .7, .3, 1)" }
        ).finished.then(() => spark.remove());
      }
    }

    function stopAuto() { clearInterval(auto); auto = null; }
    function startAuto() {
      if (reduceMotion || touched || auto) return;
      auto = setInterval(() => setMode(mode + 1), 2200);
    }
    function interact() { touched = true; stopAuto(); warm(); }

    stage.addEventListener("click", () => { interact(); setMode(mode + 1); bounce(); });
    swatches.forEach((b, i) => b.addEventListener("click", () => {
      interact();
      setMode(MODES.findIndex((m) => m.id === b.dataset.mode));
      bounce();
    }));
    // Arrow keys move between swatches, like a radio group.
    demo.querySelector(".glow-swatches").addEventListener("keydown", (e) => {
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const i = (swatches.indexOf(document.activeElement) + dir + swatches.length) % swatches.length;
      swatches[i].focus();
      swatches[i].click();
    });

    // Cycle on its own only while visible.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { warm(); startAuto(); } else stopAuto();
        });
      }, { rootMargin: "200px 0px" }).observe(demo);
    } else {
      warm();
    }
  }

  // ---------- Notify me forms ----------
  document.querySelectorAll(".notify-form").forEach((form) => {
    const note = form.querySelector(".notify-note");
    const input = form.elements.email;
    const submit = form.querySelector("button[type=submit]");
    const defaultNote = note.textContent;

    function showError(message) {
      form.classList.add("is-error");
      note.textContent = message;
    }

    input.addEventListener("input", () => {
      if (form.classList.contains("is-error")) { form.classList.remove("is-error"); note.textContent = defaultNote; }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!email || !input.checkValidity()) {
        showError("Please enter a valid email address.");
        input.focus();
        return;
      }
      const label = submit.textContent;
      submit.disabled = true;
      submit.textContent = "Adding…";
      try {
        const res = await fetch(form.action, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "");
        form.classList.remove("is-error");
        form.classList.add("is-done");
        note.textContent = `You're on the list! We'll email ${email} when the Squishy LED Unicorn is at Walmart.`;
      } catch (err) {
        // A TypeError means the request never reached the server.
        showError((!(err instanceof TypeError) && err.message) || "Something went wrong. Please try again in a moment.");
      } finally {
        submit.disabled = false;
        submit.textContent = label;
      }
    });
  });
})();
