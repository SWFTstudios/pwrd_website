/* Coming-soon page: tapping the glass squishes what's behind it and changes its light, and the
   signup form posts to /api/notify (see worker.js). */
(() => {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const body = document.body;

  // Light colors, in the order a tap cycles them, ending with a rainbow chase.
  const MODES = [
    { id: "white", glow: "#fff1d2" },
    { id: "red", glow: "#ff3048" },
    { id: "green", glow: "#25e07a" },
    { id: "blue", glow: "#3d63ff" },
    { id: "purple", glow: "#d23cff" },
    { id: "chase", glow: null },
  ];
  const RAINBOW = ["#ff3b55", "#ffb21f", "#fff04a", "#2fe07a", "#2bc4ff", "#6a5bff", "#d53cff"];

  const squish = document.querySelector(".soon-squish");
  const frames = new Map([...document.querySelectorAll(".soon-frame")].map((img) => [img.dataset.mode, img]));
  let mode = 0;
  let frameOn = frames.get("white");

  function setMode(next) {
    mode = (next + MODES.length) % MODES.length;
    const m = MODES[mode];
    body.dataset.mode = m.id;
    if (m.glow) body.style.setProperty("--glow", m.glow);

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

  function tap(x, y) {
    setMode(mode + 1);
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

    const ripple = document.createElement("span");
    ripple.className = "soon-ripple";
    ripple.style.left = x + "px";
    ripple.style.top = y + "px";
    body.appendChild(ripple);
    ripple.animate([{ transform: "scale(.2)", opacity: 1 }, { transform: "scale(1.6)", opacity: 0 }], {
      duration: 800, easing: "cubic-bezier(.2, .7, .3, 1)",
    }).finished.then(() => ripple.remove());

    // Sparks fly behind the glass, so they show only as blurred light.
    const scene = document.querySelector(".soon-stage");
    for (let k = 0; k < 10; k++) {
      const spark = document.createElement("span");
      const color = MODES[mode].glow || RAINBOW[k % RAINBOW.length];
      Object.assign(spark.style, {
        position: "absolute", left: "50%", top: "50%", width: "18px", height: "18px", margin: "-9px 0 0 -9px",
        borderRadius: "50%", background: color, boxShadow: `0 0 20px ${color}`, zIndex: 4,
      });
      scene.appendChild(spark);
      const angle = (k / 10) * Math.PI * 2 + Math.random() * 0.5;
      const dist = scene.offsetWidth * (0.6 + Math.random() * 0.4);
      spark.animate(
        [
          { transform: "translate(0, 0)", opacity: 1 },
          { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(.3)`, opacity: 0 },
        ],
        { duration: 800 + Math.random() * 300, easing: "cubic-bezier(.15, .7, .3, 1)" }
      ).finished.then(() => spark.remove());
    }
  }

  // Tapping anywhere on the glass counts, except on the form, links and buttons.
  document.querySelector(".soon-main").addEventListener("click", (e) => {
    if (e.target.closest("a, button, input, label, form")) return;
    tap(e.clientX, e.clientY);
  });
  const tapButton = document.querySelector(".soon-tap");
  tapButton.addEventListener("click", () => {
    const r = document.querySelector(".soon-stage").getBoundingClientRect();
    tap(r.left + r.width / 2, Math.min(r.top + r.height / 2, innerHeight - 80));
  });

  // ---------- Signup form ----------
  const form = document.getElementById("notify-form");
  const note = document.getElementById("notify-status");
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
      note.textContent = `You're on the list! We'll email ${email} when it launches.`;
    } catch (err) {
      // A TypeError means the request never reached the server.
      showError((!(err instanceof TypeError) && err.message) || "Something went wrong. Please try again in a moment.");
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });
})();
