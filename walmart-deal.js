/* Walmart deal for the Squishy LED Unicorn: price blocks, countdown, sticky buy bar and promo pop-up.
   Customers can't buy on this site; every button goes to the Walmart listing.

   To change the price or promo, edit DEAL below. Nothing else needs to change.
   - When `dealEnds` passes, prices and the pop-up hide themselves and buttons just say "Shop at Walmart",
     so the site never shows a stale sale price. Set a new deal (or price: null) when Walmart changes.

   Markup hooks (any page that loads this file):
   - a[data-wm-link]        href is set to DEAL.url
   - [data-wm-price]        filled with price / was / save
   - [data-wm-deal]         filled with the deal label + countdown; hidden when no deal
   - [data-wm-rating]       filled with the Walmart rating
   - [data-wm-promo]        on <body>: show the promo pop-up on this page (once per session)
   - [data-wm-buybar]       on <body>: show a sticky buy bar once [data-wm-buybar-after] scrolls away
   - [data-wm-open-promo]   any button that opens the pop-up */
(() => {
  const DEAL = {
    url: "https://www.walmart.com/ip/PWRD-LED-Blind-Box-Unicorn-Tap-Light/20416705601?classType=REGULAR&athbdg=L1800",
    name: "Squishy LED Unicorn Blind Box",
    image: "/assets/img/unicorn/glow-white.webp",
    price: 9.0, // Walmart price now (null to hide prices)
    was: 14.88, // strikethrough price (null for none)
    dealLabel: "Black Friday Deal",
    dealEnds: "2026-11-16T07:59:00Z", // Nov 15, 11:59 PM Pacific
    rating: 4.8,
    ratingCount: 12,
  };

  const money = (n) => "$" + n.toFixed(2);
  const ends = DEAL.dealEnds ? new Date(DEAL.dealEnds) : null;
  const dealOn = () => !ends || Date.now() < ends.getTime();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const showPrice = () => DEAL.price != null && dealOn();

  function countdown() {
    if (!ends) return "";
    const ms = ends.getTime() - Date.now();
    if (ms <= 0) return "";
    const h = Math.floor(ms / 3.6e6);
    const d = Math.floor(h / 24);
    const m = Math.floor((ms % 3.6e6) / 6e4);
    if (d >= 1) return `Ends in ${d}d ${h % 24}h`;
    if (h >= 1) return `Ends in ${h}h ${m}m`;
    return `Ends in ${Math.max(m, 1)}m`;
  }

  function priceHTML() {
    if (!showPrice()) return "";
    let html = `<span class="wm-now">${money(DEAL.price)}</span>`;
    if (DEAL.was && DEAL.was > DEAL.price) {
      html += `<span class="wm-was"><span class="sr-only">Was </span>${money(DEAL.was)}</span>` +
        `<span class="wm-save">Save ${money(DEAL.was - DEAL.price)}</span>`;
    }
    return html;
  }

  function dealHTML() {
    if (!dealOn() || !DEAL.dealLabel) return "";
    const c = countdown();
    return `<span class="wm-deal-dot" aria-hidden="true"></span>${DEAL.dealLabel}` +
      (c ? ` <span class="wm-deal-time">· ${c}</span>` : "");
  }

  function render() {
    document.querySelectorAll("a[data-wm-link]").forEach((a) => {
      a.href = DEAL.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
    document.querySelectorAll("[data-wm-price]").forEach((el) => {
      const html = priceHTML();
      el.innerHTML = html;
      el.hidden = !html;
    });
    document.querySelectorAll("[data-wm-deal]").forEach((el) => {
      const html = dealHTML();
      el.innerHTML = html;
      el.hidden = !html;
    });
    document.querySelectorAll("[data-wm-rating]").forEach((el) => {
      if (!DEAL.rating) { el.hidden = true; return; }
      el.innerHTML = `<span class="wm-stars" style="--r:${DEAL.rating}" aria-hidden="true">★★★★★</span>` +
        `<span><strong>${DEAL.rating.toFixed(1)}</strong><span class="sr-only"> out of 5 stars</span> · ${DEAL.ratingCount} Walmart ratings</span>`;
    });
  }

  render();
  setInterval(render, 60000);

  // ---------- Sticky buy bar ----------
  if (document.body.hasAttribute("data-wm-buybar")) {
    const bar = document.createElement("div");
    bar.className = "wm-buybar";
    bar.innerHTML =
      `<img src="${DEAL.image}" alt="" width="585" height="900" />` +
      `<div class="wm-buybar-info"><strong>${DEAL.name}</strong><span class="wm-price wm-price-sm" data-wm-price></span></div>` +
      `<a class="cta" data-wm-link href="${DEAL.url}">Shop at Walmart</a>`;
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    render();
    const after = document.querySelector("[data-wm-buybar-after]");
    const link = bar.querySelector("a");
    const set = (on) => {
      bar.classList.toggle("is-on", on);
      bar.setAttribute("aria-hidden", String(!on));
      link.tabIndex = on ? 0 : -1;
    };
    set(false);
    if (after && "IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => set(!e.isIntersecting && e.boundingClientRect.top < 0)).observe(after);
    }
  }

  // ---------- Promo pop-up ----------
  const wantsPromo = document.body.hasAttribute("data-wm-promo");
  const openers = document.querySelectorAll("[data-wm-open-promo]");
  if (!wantsPromo && !openers.length) return;

  let dialog = null;
  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "wm-promo";
    dialog.setAttribute("aria-labelledby", "wm-promo-title");
    dialog.innerHTML =
      `<div class="wm-promo-panel">` +
        `<button class="wm-promo-x" type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` +
        `<div class="wm-promo-media" aria-hidden="true"><span class="wm-promo-halo"></span><img src="${DEAL.image}" alt="" width="585" height="900" /></div>` +
        `<div class="wm-promo-copy">` +
          `<p class="wm-deal" data-wm-deal></p>` +
          `<p class="eyebrow">Just launched at Walmart</p>` +
          `<h2 id="wm-promo-title">Squishy LED <span class="dim">unicorn.</span></h2>` +
          `<p class="wm-promo-sub">Squish it to light it up. 5 colors plus a rainbow chase, and one of six mystery styles in every box.</p>` +
          `<p class="wm-price" data-wm-price></p>` +
          `<a class="cta" data-wm-link autofocus href="${DEAL.url}">` +
            `<span class="cta-icon"><svg viewBox="0 0 24 24"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M6 6 5 3H2"/></svg></span>` +
            `${showPrice() ? "Get the deal at Walmart" : "Shop at Walmart"}` +
            `<svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></a>` +
          `<button class="wm-promo-later" type="button">Maybe later</button>` +
          `<p class="wm-promo-fine">Sold on Walmart.com. Price and availability set by Walmart and may change.</p>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(dialog);
    render();
    dialog.querySelector(".wm-promo-x").addEventListener("click", close);
    dialog.querySelector(".wm-promo-later").addEventListener("click", close);
    dialog.querySelector("a[data-wm-link]").addEventListener("click", () => setTimeout(close, 300));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    // Click on the backdrop closes it.
    dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  }

  function open() {
    if (!dialog) build();
    if (dialog.open) return;
    dialog.showModal();
    document.documentElement.classList.add("wm-promo-lock");
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("is-open")));
  }

  function close() {
    if (!dialog || !dialog.open || dialog.classList.contains("is-closing")) return;
    dialog.classList.add("is-closing");
    dialog.classList.remove("is-open");
    const done = () => {
      dialog.classList.remove("is-closing");
      dialog.close();
      document.documentElement.classList.remove("wm-promo-lock");
    };
    if (reduceMotion) done(); else setTimeout(done, 380);
  }

  openers.forEach((b) => b.addEventListener("click", open));

  // Show once per browser session, only while a deal is running, and never over the page intro.
  if (!wantsPromo || !dealOn() || typeof HTMLDialogElement !== "function") return;
  const KEY = "pwrd-wm-promo";
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) { /* private mode: show it */ }

  let fired = false;
  let retry = null;
  function trigger() {
    if (fired) return;
    if (document.documentElement.classList.contains("intro")) {
      if (!retry) retry = setTimeout(() => { retry = null; trigger(); }, 800);
      return;
    }
    fired = true;
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    cleanup();
    open();
  }
  const timer = setTimeout(trigger, 7000);
  function onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max > 0 && scrollY / max > 0.4) trigger();
  }
  function onLeave(e) { if (e.clientY <= 0 && !e.relatedTarget) trigger(); }
  function cleanup() {
    clearTimeout(timer);
    removeEventListener("scroll", onScroll);
    document.removeEventListener("mouseout", onLeave);
  }
  addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("mouseout", onLeave);
})();
