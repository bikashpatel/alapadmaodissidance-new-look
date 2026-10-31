/*
 * Alapadma Odissi Dance Academy — Cloudflare Worker
 *
 * Serves the public website (static assets in ./public) and a password-protected
 * admin panel at ADMIN_PATH, with enquiries, settings, gallery photos and caches in D1.
 *
 * Bindings / variables (see wrangler.jsonc):
 *   ASSETS             static website
 *   DB                 D1 database
 *   ADMIN_PATH         secret: URL of the admin panel, e.g. /studio-desk-7381
 *   ADMIN_PASSWORD     secret: first-time admin password (used until a password is saved)
 *   PBKDF2_ITERATIONS  optional, default 60000 (max 100000)
 */
import adminHtml from "./admin/index.html";
import adminCss from "./admin/admin.css";
import adminJs from "./admin/admin.js";
import siteConfigSource from "../public/assets/js/site-config.js";
import * as youtube from "./lib/youtube.js";
import {
  MIN_PASSWORD_LENGTH, getAdmin, setPassword, verifyPassword, createSession, checkSession, destroySession,
  rateLimited, rateLimitReset, pruneAuthTables, randomId,
} from "./lib/auth.js";

const COOKIE = "alp_session";
const MAX_ENQUIRIES = 5000;
const MAX_IMAGE_BYTES = 1900 * 1024; // D1 rows are limited to 2 MB
const YT_TTL_MS = 60 * 60 * 1000;

/* ==========================================================================
   Defaults (from public/assets/js/site-config.js, strict JSON object)
   ========================================================================== */
const DEFAULTS = (() => {
  const start = siteConfigSource.indexOf("{", siteConfigSource.indexOf("window.SITE"));
  return JSON.parse(siteConfigSource.slice(start, siteConfigSource.lastIndexOf("}") + 1));
})();

/* ==========================================================================
   Validation
   ========================================================================== */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => new HttpError(400, msg);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const EMAIL_RE = /^[^\s@<>"?&#%,;:()[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function cleanUrl(v, { allowRelative = false } = {}) {
  const s = str(v, 500);
  if (!s) return "";
  if (allowRelative && /^(\/(?!\/)|[a-z0-9-]+\.html)[A-Za-z0-9\-._~/?#=&%]*$/i.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch (_) { /* fall through */ }
  throw bad(`"${s}" is not a valid web address (it should start with https://)`);
}

function youtubeId(v) {
  const s = str(v, 300);
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com") {
      id = u.searchParams.get("v") || (u.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#]+)/) || [])[1] || "";
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
  } catch (_) { /* fall through */ }
  throw bad(`"${s}" is not a YouTube video link or ID`);
}

function validateSettings(input) {
  if (!input || typeof input !== "object") throw bad("Invalid settings");
  const out = {};
  out.phone = str(input.phone, 40);
  out.whatsapp = str(input.whatsapp, 40).replace(/\D/g, "");
  if (out.whatsapp && (out.whatsapp.length < 8 || out.whatsapp.length > 15)) throw bad("WhatsApp number should be 8–15 digits including the country code, e.g. 919876543210");
  out.email = str(input.email, 150);
  if (out.email && !EMAIL_RE.test(out.email)) throw bad("Email address looks incorrect");
  out.address = str(input.address, 300);
  out.mapQuery = str(input.mapQuery, 200);
  out.mapLink = cleanUrl(input.mapLink);
  out.hours = str(input.hours, 200);
  out.youtubeChannel = cleanUrl(input.youtubeChannel);
  if (out.youtubeChannel) {
    out.youtubeChannel = youtube.normaliseChannelUrl(out.youtubeChannel);
    if (!/^https:\/\/(www\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+)$/.test(out.youtubeChannel)) {
      throw bad("YouTube channel should look like https://www.youtube.com/@yourchannel");
    }
  }
  out.instagram = cleanUrl(input.instagram);
  out.facebook = cleanUrl(input.facebook);
  out.web3formsKey = str(input.web3formsKey, 64);
  if (out.web3formsKey && !/^[A-Za-z0-9-]{8,64}$/.test(out.web3formsKey)) throw bad("Web3Forms key looks incorrect");
  const vids = Array.isArray(input.youtubeVideos) ? input.youtubeVideos.slice(0, 24) : [];
  out.youtubeVideos = vids
    .map(v => (typeof v === "string" ? { id: v } : v || {}))
    .filter(v => str(v.id, 300))
    .map(v => ({ id: youtubeId(v.id), title: str(v.title, 120) }));
  const a = input.announcement || {};
  out.announcement = {
    enabled: Boolean(a.enabled),
    text: str(a.text, 200),
    linkText: str(a.linkText, 40),
    linkUrl: cleanUrl(a.linkUrl, { allowRelative: true }),
  };
  if (out.announcement.enabled && !out.announcement.text) throw bad("Write the announcement text, or switch the announcement off");
  return out;
}

const ENQUIRY_FIELDS = { name: 100, phone: 40, email: 150, learner: 40, programme: 80, mode: 20, city: 100, time: 40, message: 2000, page: 100 };
const ENQUIRY_STATUSES = ["new", "contacted", "enrolled", "closed"];

function validateEnquiry(input) {
  const out = {};
  for (const [k, max] of Object.entries(ENQUIRY_FIELDS)) out[k] = str(input[k], max);
  if (!out.name) throw bad("Please tell us your name");
  if (!out.phone || out.phone.replace(/\D/g, "").length < 6) throw bad("Please share a phone or WhatsApp number");
  if (out.email && !EMAIL_RE.test(out.email)) throw bad("Email address looks incorrect");
  return out;
}

/* ==========================================================================
   Settings (one JSON row in D1, merged over the defaults)
   ========================================================================== */
const SETTING_FIELDS = ["phone", "whatsapp", "email", "address", "mapQuery", "mapLink", "hours", "youtubeChannel", "youtubeChannelId", "youtubeVideos", "instagram", "facebook", "web3formsKey", "announcement"];

async function getSettings(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'site'").first();
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch (_) { saved = {}; }
  const out = { name: DEFAULTS.name || "Alapadma Odissi Dance Academy" };
  for (const key of SETTING_FIELDS) out[key] = key in saved ? saved[key] : DEFAULTS[key];
  if (!Array.isArray(out.youtubeVideos)) out.youtubeVideos = [];
  out.youtubeVideos = out.youtubeVideos.map(v => (typeof v === "string" ? { id: v, title: "" } : v));
  out.announcement = Object.assign({ enabled: false, text: "", linkText: "", linkUrl: "" }, out.announcement || {});
  return out;
}

function publicSiteConfig(s) {
  return Object.assign({}, s, {
    youtubeVideos: s.youtubeVideos.map(v => (v.title ? { id: v.id, title: v.title } : v.id)),
    announcement: s.announcement.enabled && s.announcement.text ? s.announcement : null,
    enquiryEndpoint: "/api/enquiries",
    galleryEndpoint: "/api/gallery",
    youtubeEndpoint: "/api/youtube",
  });
}

/* ==========================================================================
   YouTube feed (cached in D1, refreshed hourly by the cron trigger)
   ========================================================================== */
async function refreshYoutube(env, settings) {
  const id = settings.youtubeChannelId;
  const videos = await youtube.fetchChannelVideos(id);
  const data = { channelUrl: settings.youtubeChannel, channelId: id, updated: new Date().toISOString(), videos };
  await env.DB.prepare("INSERT INTO cache (key, value, fetched_at) VALUES ('youtube', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?1, fetched_at = ?2")
    .bind(JSON.stringify(data), Date.now()).run();
  return data;
}

async function snapshotFeed(env, origin, id) {
  try {
    const res = await env.ASSETS.fetch(new Request(origin + "/assets/data/youtube.json"));
    const data = res.ok ? await res.json() : null;
    return data && data.channelId === id && Array.isArray(data.videos) ? data : null;
  } catch (_) { return null; }
}

async function youtubeFeed(env, ctx, origin) {
  const s = await getSettings(env.DB);
  const id = s.youtubeChannelId;
  const empty = { channelUrl: s.youtubeChannel || "", channelId: id || "", videos: [] };
  if (!id) return empty;
  const row = await env.DB.prepare("SELECT value, fetched_at FROM cache WHERE key = 'youtube'").first();
  let cached = null;
  try { cached = row ? JSON.parse(row.value) : null; } catch (_) { cached = null; }
  if (cached && cached.channelId !== id) cached = null;
  if (cached) {
    if (Date.now() - row.fetched_at > YT_TTL_MS) ctx.waitUntil(refreshYoutube(env, s).catch(err => console.warn("[youtube]", err.message)));
    return cached;
  }
  try { return await refreshYoutube(env, s); }
  catch (err) {
    console.warn("[youtube] feed unavailable:", err.message);
    return (await snapshotFeed(env, origin, id)) || empty;
  }
}

/* ==========================================================================
   HTTP helpers
   ========================================================================== */
const INLINE_SCRIPT_HASH = "'sha256-GdI8OFcl8Ugd5Iy63/sFH0uY+b36cr4uk9eNu7HlZ3I='"; // the "js" class snippet in every page <head>
const SITE_CSP = "default-src 'self'; script-src 'self' " + INLINE_SCRIPT_HASH + "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://i.ytimg.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com https://www.google.com https://maps.google.com; connect-src 'self' https://api.web3forms.com; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'self'";
const ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://i.ytimg.com; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'";
const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

function applyHeaders(headers, extra, url) {
  for (const [k, v] of Object.entries(Object.assign({}, BASE_HEADERS, extra))) headers.set(k, v);
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000");
  return headers;
}
const siteExtra = { "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": SITE_CSP };
const adminExtra = { "X-Frame-Options": "DENY", "Content-Security-Policy": ADMIN_CSP, "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "no-store" };

function respond(url, body, status, extra, admin = false) {
  const headers = applyHeaders(new Headers(), Object.assign({}, admin ? adminExtra : siteExtra, extra), url);
  return new Response(body, { status, headers });
}
function json(url, status, data, { admin = true, cache, cookie } = {}) {
  const extra = { "Content-Type": "application/json; charset=utf-8" };
  if (!admin) extra["Cache-Control"] = cache || "no-store";
  const res = respond(url, JSON.stringify(data), status, extra, admin);
  if (cookie) res.headers.append("Set-Cookie", cookie);
  return res;
}

async function readJson(request, limit) {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") || "")) throw new HttpError(415, "Expected JSON");
  if (Number(request.headers.get("content-length") || 0) > limit) throw new HttpError(413, "Request too large");
  const buf = await request.arrayBuffer();
  if (buf.byteLength > limit) throw new HttpError(413, "Request too large");
  let v;
  try { v = JSON.parse(new TextDecoder().decode(buf) || "{}"); }
  catch (_) { throw bad("Invalid JSON"); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("Invalid JSON");
  return v;
}

function clientIp(request) {
  let ip = request.headers.get("CF-Connecting-IP") || "unknown"; // set by Cloudflare, cannot be spoofed
  ip = ip.replace(/^::ffff:/, "");
  if (ip.includes(":")) ip = ip.split(":").slice(0, 4).join(":") + "::/64";
  return ip;
}

function sameOrigin(request, url, { required = false } = {}) {
  const origin = request.headers.get("Origin");
  if (!origin) return !required;
  try { return new URL(origin).host === url.host; } catch (_) { return false; }
}

function cookieValue(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return ""; }
    }
  }
  return "";
}

function sessionCookie(url, adminPath, token, maxAge) {
  return `${COOKIE}=${token}; Path=${adminPath}/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === "https:" ? "; Secure" : ""}`;
}

function adminPathFrom(env) {
  const p = "/" + String(env.ADMIN_PATH || "/admin").trim().replace(/^\/+|\/+$/g, "");
  return /^\/[A-Za-z0-9_-]{3,64}$/.test(p) ? p : "/admin";
}

async function notFound(env, url) {
  // any missing path makes the assets binding return 404.html with status 404
  const res = await env.ASSETS.fetch(new Request(url.origin + "/__not-found__"));
  return new Response(res.body, { status: 404, headers: applyHeaders(new Headers(res.headers), siteExtra, url) });
}

const csvCell = v => {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s.trimStart())) s = "'" + s; // neutralise spreadsheet formulas
  return `"${s.replace(/"/g, '""')}"`;
};

const IMAGE_MAGIC = [
  { mime: "image/jpeg", ext: "jpg", test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mime: "image/webp", ext: "webp", test: b => String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP" },
];

const toBytes = d => (d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d || []));

async function galleryList(db) {
  const { results } = await db.prepare("SELECT id, file, alt, caption, width, height FROM gallery ORDER BY position ASC, created_at DESC").all();
  return results.map(g => ({ id: g.id, src: `/uploads/${g.file}`, alt: g.alt, caption: g.caption, width: g.width, height: g.height }));
}

/* ==========================================================================
   Public API
   ========================================================================== */
async function handlePublicApi(request, env, ctx, url, pathname) {
  const db = env.DB;
  const method = request.method;

  if (pathname === "/api/enquiries" && method === "POST") {
    if (!sameOrigin(request, url)) return json(url, 403, { error: "Forbidden" }, { admin: false });
    if (await rateLimited(db, "enq:" + clientIp(request), 6, 10 * 60 * 1000)) {
      return json(url, 429, { error: "Too many enquiries. Please try again a little later" }, { admin: false });
    }
    const body = await readJson(request, 16 * 1024);
    if (str(body.website, 200)) return json(url, 201, { ok: true }, { admin: false }); // honeypot
    const count = (await db.prepare("SELECT COUNT(*) AS n FROM enquiries").first()).n;
    if (count >= MAX_ENQUIRIES || await rateLimited(db, "enq:all", 100, 60 * 60 * 1000)) {
      return json(url, 503, { error: "Our enquiry form is busy right now. Please contact us on WhatsApp or by email" }, { admin: false });
    }
    const e = validateEnquiry(body);
    await db.prepare(`INSERT INTO enquiries (id, created_at, status, notes, name, phone, email, learner, programme, mode, city, time, message, page)
                      VALUES (?1, ?2, 'new', '', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
      .bind(randomId(8), new Date().toISOString(), e.name, e.phone, e.email, e.learner, e.programme, e.mode, e.city, e.time, e.message, e.page).run();
    return json(url, 201, { ok: true }, { admin: false });
  }
  if (pathname === "/api/gallery" && (method === "GET" || method === "HEAD")) {
    return json(url, 200, await galleryList(db), { admin: false, cache: "public, max-age=60" });
  }
  if (pathname === "/api/youtube" && (method === "GET" || method === "HEAD")) {
    return json(url, 200, await youtubeFeed(env, ctx, url.origin), { admin: false, cache: "public, max-age=600" });
  }
  return json(url, 404, { error: "Not found" }, { admin: false });
}

/* ==========================================================================
   Admin API (lives under ADMIN_PATH/api/ so a private ADMIN_PATH hides it too)
   ========================================================================== */
async function handleAdminApi(request, env, ctx, url, route, adminPath) {
  const db = env.DB;
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request, url)) return json(url, 403, { error: "Forbidden" });

  if (route === "/login" && method === "POST") {
    const ip = clientIp(request);
    const body = await readJson(request, 4 * 1024);
    // the attempt is counted before it is checked, so parallel requests cannot slip past the limit
    if (await rateLimited(db, "login:" + ip, 8, 15 * 60 * 1000) || await rateLimited(db, "login:all", 200, 15 * 60 * 1000)) {
      return json(url, 429, { error: "Too many attempts. Please wait 15 minutes and try again." });
    }
    const admin = await getAdmin(db, env);
    if (!admin) return json(url, 503, { error: "The admin password has not been set up yet." });
    if (!(await verifyPassword(String(body.password || ""), admin.password_hash))) {
      await new Promise(r => setTimeout(r, 400));
      return json(url, 401, { error: "Incorrect password" });
    }
    await rateLimitReset(db, "login:" + ip);
    const token = await createSession(db);
    return json(url, 200, { ok: true }, { cookie: sessionCookie(url, adminPath, token, 12 * 60 * 60) });
  }

  const token = cookieValue(request, COOKIE);
  const admin = await getAdmin(db, env);
  const session = admin ? await checkSession(db, token, admin.updated_at) : null;

  if (route === "/session" && method === "GET") return json(url, 200, { authenticated: Boolean(session) });
  if (route === "/logout" && method === "POST") {
    await destroySession(db, token);
    return json(url, 200, { ok: true }, { cookie: sessionCookie(url, adminPath, "", 0) });
  }
  if (!session) return json(url, 401, { error: "Please sign in" });

  if (route === "/summary" && method === "GET") {
    const { results } = await db.prepare("SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status").all();
    const counts = Object.fromEntries(ENQUIRY_STATUSES.map(s => [s, 0]));
    let total = 0;
    for (const r of results) { counts[r.status] = r.n; total += r.n; }
    const recent = (await db.prepare("SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 5").all()).results.map(enquiryOut);
    const galleryCount = (await db.prepare("SELECT COUNT(*) AS n FROM gallery").first()).n;
    return json(url, 200, {
      enquiries: Object.assign({ total }, counts), recent, galleryCount,
      enquiryCapacity: MAX_ENQUIRIES, announcement: (await getSettings(db)).announcement,
    });
  }

  /* enquiries */
  if (route === "/enquiries" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM enquiries ORDER BY created_at DESC LIMIT ?1").bind(MAX_ENQUIRIES).all();
    return json(url, 200, results.map(enquiryOut));
  }
  if (route === "/enquiries.csv" && method === "GET") {
    const cols = ["created_at", "status", "name", "phone", "email", "learner", "programme", "mode", "city", "time", "message", "notes", "page"];
    const { results } = await db.prepare("SELECT * FROM enquiries ORDER BY created_at DESC").all();
    const rows = [cols.join(",")].concat(results.map(e => cols.map(c => csvCell(e[c])).join(",")));
    return respond(url, "﻿" + rows.join("\r\n"), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="alapadma-enquiries-${new Date().toISOString().slice(0, 10)}.csv"`,
    }, true);
  }
  let m = /^\/enquiries\/([a-f0-9]{16})$/.exec(route);
  if (m && method === "PATCH") {
    const body = await readJson(request, 16 * 1024);
    const sets = [], vals = [];
    if (body.status !== undefined) {
      if (!ENQUIRY_STATUSES.includes(body.status)) throw bad("Unknown status");
      sets.push("status = ?"); vals.push(body.status);
    }
    if (body.notes !== undefined) { sets.push("notes = ?"); vals.push(str(body.notes, 4000)); }
    sets.push("updated_at = ?"); vals.push(new Date().toISOString());
    const row = await db.prepare(`UPDATE enquiries SET ${sets.join(", ")} WHERE id = ? RETURNING *`).bind(...vals, m[1]).first();
    return row ? json(url, 200, enquiryOut(row)) : json(url, 404, { error: "Enquiry not found" });
  }
  if (m && method === "DELETE") {
    const r = await db.prepare("DELETE FROM enquiries WHERE id = ?1").bind(m[1]).run();
    return r.meta.changes ? json(url, 200, { ok: true }) : json(url, 404, { error: "Enquiry not found" });
  }

  /* settings */
  if (route === "/settings" && method === "GET") return json(url, 200, await getSettings(db));
  if (route === "/settings" && method === "PUT") {
    const clean = validateSettings(await readJson(request, 64 * 1024));
    const prev = await getSettings(db);
    let warning = "";
    clean.youtubeChannelId = "";
    if (clean.youtubeChannel) {
      if (clean.youtubeChannel === prev.youtubeChannel && prev.youtubeChannelId) clean.youtubeChannelId = prev.youtubeChannelId;
      else {
        try { clean.youtubeChannelId = await youtube.resolveChannelId(clean.youtubeChannel); }
        catch (err) {
          console.warn("[youtube] could not resolve channel:", err.message);
          warning = "Saved, but the YouTube channel could not be reached just now, so its latest videos will not show yet. Check the channel link, or save again later.";
        }
      }
    }
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES ('site', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(JSON.stringify(clean)),
      db.prepare("DELETE FROM cache WHERE key = 'youtube'"),
    ]);
    return json(url, 200, Object.assign(await getSettings(db), warning ? { warning } : {}));
  }

  /* gallery */
  if (route === "/gallery" && method === "GET") return json(url, 200, await galleryList(db));
  if (route === "/gallery" && method === "POST") {
    if (!sameOrigin(request, url, { required: true })) return json(url, 403, { error: "Forbidden" });
    if (Number(request.headers.get("content-length") || 0) > MAX_IMAGE_BYTES + 64 * 1024) throw new HttpError(413, "Image is too large");
    let form;
    try { form = await request.formData(); } catch (_) { throw bad("Please upload a JPG, PNG or WebP image"); }
    const file = form.get("image");
    if (!file || typeof file === "string") throw bad("Please upload a JPG, PNG or WebP image");
    if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is larger than 1.9 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = IMAGE_MAGIC.find(t => t.test(bytes));
    if (!type) throw bad("The file is not a valid JPG, PNG or WebP image");
    const id = randomId(8), name = `${randomId(12)}.${type.ext}`;
    const width = Math.max(1, Math.min(10000, Math.round(Number(form.get("width")) || 1200)));
    const height = Math.max(1, Math.min(10000, Math.round(Number(form.get("height")) || 900)));
    const minPos = (await db.prepare("SELECT MIN(position) AS p FROM gallery").first()).p;
    await db.batch([
      db.prepare("INSERT INTO uploads (file, mime, data) VALUES (?1, ?2, ?3)").bind(name, type.mime, bytes),
      db.prepare("INSERT INTO gallery (id, file, alt, caption, width, height, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(id, name, str(form.get("alt"), 200) || "Odissi photograph from Alapadma Odissi Dance Academy", str(form.get("caption"), 200),
          width, height, minPos == null ? 0 : minPos - 1, new Date().toISOString()),
    ]);
    return json(url, 201, (await galleryList(db)).find(g => g.id === id));
  }
  if (route === "/gallery/order" && method === "POST") {
    const body = await readJson(request, 16 * 1024);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(id => /^[a-f0-9]{16}$/.test(id)).slice(0, 1000) : [];
    if (ids.length) await db.batch(ids.map((id, i) => db.prepare("UPDATE gallery SET position = ?1 WHERE id = ?2").bind(i, id)));
    return json(url, 200, await galleryList(db));
  }
  m = /^\/gallery\/([a-f0-9]{16})$/.exec(route);
  if (m && method === "PATCH") {
    const body = await readJson(request, 8 * 1024);
    const cur = await db.prepare("SELECT alt, caption FROM gallery WHERE id = ?1").bind(m[1]).first();
    if (!cur) return json(url, 404, { error: "Photo not found" });
    const alt = body.alt !== undefined ? (str(body.alt, 200) || cur.alt) : cur.alt;
    const caption = body.caption !== undefined ? str(body.caption, 200) : cur.caption;
    await db.prepare("UPDATE gallery SET alt = ?1, caption = ?2 WHERE id = ?3").bind(alt, caption, m[1]).run();
    return json(url, 200, (await galleryList(db)).find(g => g.id === m[1]));
  }
  if (m && method === "DELETE") {
    const item = await db.prepare("SELECT file FROM gallery WHERE id = ?1").bind(m[1]).first();
    if (!item) return json(url, 404, { error: "Photo not found" });
    await db.batch([
      db.prepare("DELETE FROM gallery WHERE id = ?1").bind(m[1]),
      db.prepare("DELETE FROM uploads WHERE file = ?1").bind(item.file),
    ]);
    ctx.waitUntil(caches.default.delete(new Request(`${url.origin}/uploads/${item.file}`)));
    return json(url, 200, { ok: true });
  }

  /* account */
  if (route === "/password" && method === "POST") {
    const body = await readJson(request, 4 * 1024);
    if (!(await verifyPassword(String(body.current || ""), admin.password_hash))) {
      const f = await db.prepare("UPDATE sessions SET failures = failures + 1 WHERE token_hash = ?1 RETURNING failures").bind(session.token_hash).first();
      if (f && f.failures >= 5) {
        await destroySession(db, token);
        return json(url, 401, { error: "Too many incorrect attempts. Please sign in again" }, { cookie: sessionCookie(url, adminPath, "", 0) });
      }
      return json(url, 400, { error: "Current password is incorrect" });
    }
    const next = String(body.next || "");
    if (next.length < MIN_PASSWORD_LENGTH) return json(url, 400, { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    await setPassword(db, env, next); // signs out every session
    const fresh = await createSession(db);
    return json(url, 200, { ok: true }, { cookie: sessionCookie(url, adminPath, fresh, 12 * 60 * 60) });
  }

  return json(url, 404, { error: "Not found" });
}

function enquiryOut(e) {
  return {
    id: e.id, createdAt: e.created_at, updatedAt: e.updated_at || undefined, status: e.status, notes: e.notes,
    name: e.name, phone: e.phone, email: e.email, learner: e.learner, programme: e.programme, mode: e.mode,
    city: e.city, time: e.time, message: e.message, page: e.page,
  };
}

/* ==========================================================================
   Admin panel files (bundled into the Worker, never part of the public assets)
   ========================================================================== */
const ADMIN_FILES = {
  "/": [adminHtml, "text/html; charset=utf-8"],
  "/index.html": [adminHtml, "text/html; charset=utf-8"],
  "/admin.css": [adminCss, "text/css; charset=utf-8"],
  "/admin.js": [adminJs, "application/javascript; charset=utf-8"],
};

function serveAdmin(request, url, pathname, adminPath) {
  if (request.method !== "GET" && request.method !== "HEAD") return respond(url, "Method not allowed", 405, { Allow: "GET, HEAD" }, true);
  if (pathname === adminPath) return respond(url, null, 301, { Location: `${adminPath}/` }, true);
  const file = ADMIN_FILES[pathname.slice(adminPath.length)];
  if (!file) return respond(url, "Not found", 404, { "Content-Type": "text/plain; charset=utf-8" }, true);
  return respond(url, request.method === "HEAD" ? null : file[0], 200, { "Content-Type": file[1] }, true);
}

/* ==========================================================================
   Uploaded photos (from D1, cached at the edge)
   ========================================================================== */
async function serveUpload(request, env, ctx, url, pathname) {
  const name = pathname.slice("/uploads/".length);
  if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(name)) return notFound(env, url);
  const cacheKey = new Request(url.origin + pathname);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  const row = await env.DB.prepare("SELECT mime, data FROM uploads WHERE file = ?1").bind(name).first();
  if (!row) return notFound(env, url);
  const res = respond(url, toBytes(row.data), 200, { "Content-Type": row.mime, "Cache-Control": "public, max-age=604800" });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

/* ==========================================================================
   Entry points
   ========================================================================== */
async function handle(request, env, ctx) {
  const url = new URL(request.url);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch (_) { return respond(url, "Bad request", 400, { "Content-Type": "text/plain; charset=utf-8" }); }
  if (pathname.includes("\0")) return respond(url, "Bad request", 400, { "Content-Type": "text/plain; charset=utf-8" });

  const adminPath = adminPathFrom(env);

  if (pathname === "/healthz") return respond(url, "ok\n", 200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  if (pathname.startsWith(adminPath + "/api/")) return handleAdminApi(request, env, ctx, url, pathname.slice((adminPath + "/api").length), adminPath);
  if (pathname.startsWith("/api/")) return handlePublicApi(request, env, ctx, url, pathname);
  if (pathname === adminPath || pathname.startsWith(adminPath + "/")) return serveAdmin(request, url, pathname, adminPath);

  if (request.method !== "GET" && request.method !== "HEAD") return respond(url, "Method not allowed", 405, { Allow: "GET, HEAD" });

  // live settings for the pages
  if (pathname === "/assets/js/site-config.js") {
    const body = "/* generated from the admin settings */\nwindow.SITE = " +
      JSON.stringify(publicSiteConfig(await getSettings(env.DB))).replace(/</g, "\\u003c")
        .split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029") + ";\n";
    return respond(url, body, 200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" });
  }
  if (pathname.startsWith("/uploads/")) return serveUpload(request, env, ctx, url, pathname);

  // never serve dotfiles/host config; reject "//" and "\" (open-redirect tricks)
  if (/(^|\/)[._]/.test(pathname) || pathname.includes("//") || pathname.includes("\\")) return notFound(env, url);

  const res = await env.ASSETS.fetch(request);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: applyHeaders(new Headers(res.headers), siteExtra, url) });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      const url = new URL(request.url);
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error("[error]", request.method, url.pathname, err && err.stack || err);
      return json(url, status, { error: status >= 500 ? "Something went wrong" : err.message });
    }
  },

  // hourly: refresh the YouTube feed and tidy expired sessions / rate-limit rows
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await pruneAuthTables(env.DB);
      const s = await getSettings(env.DB);
      if (s.youtubeChannelId) await refreshYoutube(env, s).catch(err => console.warn("[youtube] cron refresh failed:", err.message));
    })());
  },
};
