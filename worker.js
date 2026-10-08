// PWRD. site Worker. Static pages are served from assets; this only handles /api/*.
//
//   POST /api/notify          Coming-soon signup: { email, source, company (honeypot) }
//   GET  /api/notify/export   Download every signup as an Excel file (.xlsx).
//                             Password protected with HTTP Basic auth: any username,
//                             password = the WAITLIST_KEY secret.
//
// Signups live in the D1 database bound as DB. The table is created on first use.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/notify") {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return signup(request, env);
    }
    if (pathname === "/api/notify/export") return exportSignups(request, env);
    if (pathname.startsWith("/api/")) return json({ ok: false, error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (email, source)
    )`
  ).run();
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
  // Signing up twice from the same page keeps the first date.
  await env.DB.prepare(
    "INSERT INTO waitlist (email, source, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (email, source) DO NOTHING"
  )
    .bind(email, source, new Date().toISOString())
    .run();

  return json({ ok: true });
}

async function exportSignups(request, env) {
  const auth = request.headers.get("authorization") || "";
  const password = auth.startsWith("Basic ") ? atob(auth.slice(6)).split(":").slice(1).join(":") : "";
  if (!env.WAITLIST_KEY || !(await safeEqual(password, env.WAITLIST_KEY))) {
    return new Response("Sign in to download the signup list.", {
      status: 401,
      headers: { "www-authenticate": 'Basic realm="PWRD. signups", charset="UTF-8"', "cache-control": "no-store" },
    });
  }

  await ensureTable(env);
  const { results } = await env.DB.prepare(
    "SELECT email, source, created_at FROM waitlist ORDER BY created_at"
  ).all();

  const rows = [
    ["Email", "Signed up from", "Signed up (UTC)"],
    ...results.map((r) => [r.email, r.source, r.created_at.replace("T", " ").slice(0, 19)]),
  ];
  const date = new Date().toISOString().slice(0, 10);
  return new Response(xlsx(rows), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="pwrd-signups-${date}.xlsx"`,
      "cache-control": "no-store",
    },
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
