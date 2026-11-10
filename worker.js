// PWRD. site Worker. Static pages are served from assets; this handles /api/*, /unsubscribe and /media/*.
//
//   POST /api/notify              Signup: { email, source, company (honeypot) }.
//                                 source is the page/launch, e.g. "coming-soon" or "unicorn-walmart".
//   GET  /api/notify/export       Every signup as an Excel file (.xlsx), always current.
//   GET  /api/notify/export.csv   The same list as CSV, for a live Google Sheet:
//                                 =IMPORTDATA("https://staypwrd.com/api/notify/export.csv?key=WAITLIST_KEY")
//                                 Both exports take ?source=unicorn-walmart to show one list.
//                                 Auth: HTTP Basic (any username, password = WAITLIST_KEY) or ?key=.
//   GET  /unsubscribe?t=<token>   Confirm page; the button POSTs back to unsubscribe.
//   POST /unsubscribe?t=<token>   Unsubscribe (also used by one-click List-Unsubscribe in email apps).
//   GET  /media/<key>             Product media from the MEDIA R2 bucket (pwrd-media).
//
// Signups live in the D1 database bound as DB. The table is created (and upgraded) on first use.
// Each signup gets a private token; its unsubscribe link is in the export, ready for a mail merge.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN_RE = /^[a-f0-9]{32}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/api/notify") {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return signup(request, env);
    }
    if (pathname === "/api/notify/export") return exportSignups(request, env, url, "xlsx");
    if (pathname === "/api/notify/export.csv") return exportSignups(request, env, url, "csv");
    if (pathname === "/unsubscribe" || pathname === "/api/unsubscribe") return unsubscribe(request, env, url);
    if (pathname.startsWith("/api/")) return json({ ok: false, error: "Not found" }, 404);
    if (pathname.startsWith("/media/")) return serveMedia(request, env, pathname);
    return env.ASSETS.fetch(request);
  },
};

async function serveMedia(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  // /media/unicorn/unicorn-box.webp → key unicorn/unicorn-box.webp
  const key = decodeURIComponent(pathname.slice("/media/".length));
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\") || key.includes("\0")) {
    return new Response("Not found", { status: 404 });
  }
  const object = await env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=86400");
  if (request.method === "HEAD") return new Response(null, { headers });
  return new Response(object.body, { headers });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function newToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

let tableReady = false;
async function ensureTable(env) {
  if (tableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (email, source)
    )`
  ).run();
  // Upgrade older tables: a private unsubscribe token per signup and when they opted out.
  const { results } = await env.DB.prepare("PRAGMA table_info(waitlist)").all();
  const cols = new Set(results.map((c) => c.name));
  if (!cols.has("token")) await env.DB.prepare("ALTER TABLE waitlist ADD COLUMN token TEXT").run();
  if (!cols.has("unsubscribed_at")) await env.DB.prepare("ALTER TABLE waitlist ADD COLUMN unsubscribed_at TEXT").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS waitlist_token ON waitlist (token)").run();
  // Signups from before tokens existed get one now.
  await env.DB.prepare("UPDATE waitlist SET token = lower(hex(randomblob(16))) WHERE token IS NULL").run();
  tableReady = true;
}

async function signup(request, env) {
  let data;
  try {
    const type = request.headers.get("content-type") || "";
    data = type.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return json({ ok: false, error: "Bad request" }, 400);
  }

  // Bots fill the hidden field; tell them it worked and store nothing.
  if (data.company) return json({ ok: true });

  const email = String(data.email || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  }
  // Which page the signup came from, so one list can serve more than one launch.
  const source = String(data.source || "coming-soon").replace(/[^\w-]/g, "").slice(0, 60) || "coming-soon";

  await ensureTable(env);
  // Signing up twice from the same page keeps the first date; signing up again after
  // unsubscribing turns notifications back on.
  await env.DB.prepare(
    `INSERT INTO waitlist (email, source, created_at, token) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (email, source) DO UPDATE SET unsubscribed_at = NULL`
  )
    .bind(email, source, new Date().toISOString(), newToken())
    .run();

  return json({ ok: true });
}

async function exportSignups(request, env, url, format) {
  const auth = request.headers.get("authorization") || "";
  const password = auth.startsWith("Basic ")
    ? atob(auth.slice(6)).split(":").slice(1).join(":")
    : url.searchParams.get("key") || "";
  if (!env.WAITLIST_KEY || !(await safeEqual(password, env.WAITLIST_KEY))) {
    return new Response("Sign in to download the signup list.", {
      status: 401,
      headers: { "www-authenticate": 'Basic realm="PWRD. signups", charset="UTF-8"', "cache-control": "no-store" },
    });
  }

  await ensureTable(env);
  const source = (url.searchParams.get("source") || "").replace(/[^\w-]/g, "");
  const stmt = source
    ? env.DB.prepare("SELECT * FROM waitlist WHERE source = ?1 ORDER BY created_at").bind(source)
    : env.DB.prepare("SELECT * FROM waitlist ORDER BY created_at");
  const { results } = await stmt.all();

  const when = (iso) => (iso ? iso.replace("T", " ").slice(0, 19) : "");
  const rows = [
    ["Email", "Signed up from", "Signed up (UTC)", "Status", "Unsubscribed (UTC)", "Unsubscribe link"],
    ...results.map((r) => [
      r.email,
      r.source,
      when(r.created_at),
      r.unsubscribed_at ? "Unsubscribed" : "Subscribed",
      when(r.unsubscribed_at),
      `${url.origin}/unsubscribe?t=${r.token}`,
    ]),
  ];
  const date = new Date().toISOString().slice(0, 10);
  const name = `pwrd-signups${source ? "-" + source : ""}-${date}`;
  if (format === "csv") {
    const cell = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    // Starting a cell with = + - @ would make spreadsheets run it as a formula.
    const safe = (v) => (/^[=+\-@]/.test(String(v)) ? "'" + v : v);
    return new Response(rows.map((r) => r.map((v) => cell(safe(v))).join(",")).join("\r\n") + "\r\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `inline; filename="${name}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return new Response(xlsx(rows), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

// GET shows a confirm button (so email link scanners can't unsubscribe people by opening the link);
// POST does it. Email apps' one-click "Unsubscribe" (List-Unsubscribe-Post) also POSTs here.
async function unsubscribe(request, env, url) {
  const token = (url.searchParams.get("t") || "").toLowerCase();
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
  }
  if (!TOKEN_RE.test(token)) {
    return page("Link not recognized", "<p>This unsubscribe link isn't valid. Please use the link from your most recent PWRD. email.</p>", 404);
  }
  await ensureTable(env);
  const row = await env.DB.prepare("SELECT email, unsubscribed_at FROM waitlist WHERE token = ?1").bind(token).first();
  if (!row) {
    return page("Link not recognized", "<p>This unsubscribe link isn't valid. Please use the link from your most recent PWRD. email.</p>", 404);
  }
  const shown = escapeHtml(row.email);
  if (request.method === "POST") {
    if (!row.unsubscribed_at) {
      await env.DB.prepare("UPDATE waitlist SET unsubscribed_at = ?1 WHERE token = ?2").bind(new Date().toISOString(), token).run();
    }
    return page("You're unsubscribed", `<p><strong>${shown}</strong> won't get any more PWRD. launch emails for this list.</p><p>Changed your mind? Sign up again any time on our site.</p><p><a class="cta" href="/">Back to PWRD.</a></p>`);
  }
  if (row.unsubscribed_at) {
    return page("Already unsubscribed", `<p><strong>${shown}</strong> is already off this list. You won't get any more emails from it.</p><p><a class="cta" href="/">Back to PWRD.</a></p>`);
  }
  return page(
    "Unsubscribe?",
    `<p>Stop PWRD. launch emails to <strong>${shown}</strong>?</p>
     <form method="post" action="/unsubscribe?t=${token}"><button class="cta" type="submit">Unsubscribe</button></form>
     <p class="unsub-small">Did it by mistake? Just close this page and you'll stay on the list.</p>`
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page(title, body, status = 200) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} | PWRD.</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    .unsub { min-height: 100vh; display: grid; place-items: center; padding: 40px var(--gutter); text-align: center; }
    .unsub-card { max-width: 520px; }
    .unsub-card img { display: block; width: 140px; height: auto; margin: 0 auto 36px; }
    .unsub-card h1 { font-size: clamp(32px, 6vw, 52px); margin-bottom: 20px; }
    .unsub-card p { color: #d9d4de; font-size: 17px; margin: 0 0 22px; }
    .unsub-card form { margin: 8px 0 22px; }
    .unsub-card .cta { padding: 14px 28px; justify-content: center; }
    .unsub-card .unsub-small { font-size: 14px; color: var(--ink-dim); }
  </style>
</head>
<body>
  <main class="unsub">
    <div class="unsub-card">
      <a href="/"><img src="/assets/img/brand/pwrd-logo-white.svg" alt="PWRD. home" width="216" height="68" /></a>
      <h1>${title}</h1>
      ${body}
    </div>
  </main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------- Minimal .xlsx writer (one sheet of text cells, bold header row) ----------

function xmlEscape(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colName(i) {
  let s = "";
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function xlsx(rows) {
  const widths = rows[0].map((_, c) => Math.min(60, Math.max(...rows.map((r) => String(r[c]).length)) + 2));
  const sheetRows = rows
    .map((row, r) =>
      `<row r="${r + 1}">` +
      row.map((v, c) =>
        `<c r="${colName(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t>${xmlEscape(v)}</t></is></c>`
      ).join("") +
      "</row>"
    )
    .join("");

  const files = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Signups" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return zip(files);
}

// Stored (uncompressed) zip archive, which is all an .xlsx needs.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);

    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // UTF-8 names
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, nameBytes.length, true);
    local.push(new Uint8Array(head.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }
  const dirSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length / 2, true);
  end.setUint16(10, central.length / 2, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);

  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
