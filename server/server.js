"use strict";
/*
 * Alapadma Odissi Dance Academy — web server
 *
 * Serves the public website from PUBLIC_DIR and a password-protected admin
 * panel at ADMIN_PATH. No third-party dependencies.
 *
 * Environment:
 *   PORT            listen port (default 8080)
 *   DATA_DIR        where settings, enquiries, gallery and uploads live (default ./data)
 *   PUBLIC_DIR      the website files (default ./public)
 *   ADMIN_PATH      URL of the admin panel (default /admin). Change it to keep the panel out of sight.
 *   ADMIN_PASSWORD  initial admin password, used only when no password has been set yet
 *   TRUST_PROXY     "1" when running behind Cloudflare or another proxy (uses its client-IP headers)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const vm = require("node:vm");
const net = require("node:net");
const { openStores } = require("./lib/store");
const { hashPassword, verifyPassword, generatePassword, Sessions, RateLimiter, MIN_PASSWORD_LENGTH } = require("./lib/auth");
const youtube = require("./lib/youtube");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(ROOT, "public"));
const ADMIN_DIR = path.join(__dirname, "admin");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const ADMIN_PATH = normaliseAdminPath(process.env.ADMIN_PATH || "/admin");
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const COOKIE = "alp_session";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MAX_ENQUIRIES = 5000;

const store = openStores(DATA_DIR);
const sessions = new Sessions();
const loginLimiter = new RateLimiter(8, 15 * 60 * 1000);       // 8 login attempts per 15 min per IP
const loginGlobal = new RateLimiter(200, 15 * 60 * 1000);      // and 200 per 15 min in total
const enquiryLimiter = new RateLimiter(6, 10 * 60 * 1000);     // 6 enquiries per 10 min per IP
const enquiryGlobal = new RateLimiter(100, 60 * 60 * 1000);    // and 100 per hour in total
let loginInflight = 0;

/* ==========================================================================
   Startup
   ========================================================================== */
function normaliseAdminPath(p) {
  p = "/" + String(p).trim().replace(/^\/+|\/+$/g, "");
  if (!/^\/[A-Za-z0-9_-]{3,64}$/.test(p)) throw new Error("ADMIN_PATH must be like /admin or /my-secret-panel (letters, digits, - and _)");
  return p;
}

function ensureAdminPassword() {
  const admin = store.admin.read();
  if (admin.passwordHash) return;
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    console.error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  if (!password) { password = generatePassword(); generated = true; }
  store.admin.write({ passwordHash: hashPassword(password), updatedAt: new Date().toISOString() });
  if (generated) {
    console.log("\n================================================================");
    console.log(" Admin password generated (shown once, change it after signing in):");
    console.log(`   ${password}`);
    console.log(`   Admin panel: ${ADMIN_PATH}/`);
    console.log("================================================================\n");
  } else {
    console.log("[admin] password initialised from ADMIN_PASSWORD");
  }
}

/* Defaults come from the static public/assets/js/site-config.js so there is one source of truth. */
function loadDefaultSettings() {
  try {
    const code = fs.readFileSync(path.join(PUBLIC_DIR, "assets/js/site-config.js"), "utf8");
    const sandbox = { window: {} };
    vm.runInNewContext(code, sandbox, { timeout: 200 });
    return sandbox.window.SITE || {};
  } catch (err) {
    console.error("[config] could not read default site-config.js:", err.message);
    return {};
  }
}
const DEFAULTS = loadDefaultSettings();

/* ==========================================================================
   Settings
   ========================================================================== */
const SETTING_FIELDS = ["phone", "whatsapp", "email", "address", "mapQuery", "mapLink", "hours", "youtubeChannel", "youtubeChannelId", "youtubeVideos", "instagram", "facebook", "web3formsKey", "announcement"];

function currentSettings() {
  const saved = store.settings.read();
  const out = { name: DEFAULTS.name || "Alapadma Odissi Dance Academy" };
  for (const key of SETTING_FIELDS) out[key] = key in saved ? saved[key] : DEFAULTS[key];
  if (!Array.isArray(out.youtubeVideos)) out.youtubeVideos = [];
  out.youtubeVideos = out.youtubeVideos.map(v => (typeof v === "string" ? { id: v, title: "" } : v));
  out.announcement = Object.assign({ enabled: false, text: "", linkText: "", linkUrl: "" }, out.announcement || {});
  return out;
}

function publicSiteConfig() {
  const s = currentSettings();
  return Object.assign({}, s, {
    youtubeVideos: s.youtubeVideos.map(v => (v.title ? { id: v.id, title: v.title } : v.id)),
    announcement: s.announcement.enabled && s.announcement.text ? s.announcement : null,
    enquiryEndpoint: "/api/enquiries",
    galleryEndpoint: "/api/gallery",
    youtubeEndpoint: "/api/youtube",
  });
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanUrl(v, { allowRelative = false } = {}) {
  const s = str(v, 500);
  if (!s) return "";
  if (allowRelative && /^(\/(?!\/)|[a-z0-9-]+\.html)[A-Za-z0-9\-._~/?#=&%]*$/i.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch (_) { /* fall through */ }
  throw new ValidationError(`"${s}" is not a valid web address (it should start with https://)`);
}

function youtubeId(v) {
  const s = str(v, 300);
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id = "";
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      id = u.searchParams.get("v") || (u.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#]+)/) || [])[1] || "";
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
  } catch (_) { /* fall through */ }
  throw new ValidationError(`"${s}" is not a YouTube video link or ID`);
}

class ValidationError extends Error {}
const EMAIL_RE = /^[^\s@<>"?&#%,;:()[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function validateSettings(input) {
  if (!input || typeof input !== "object") throw new ValidationError("Invalid settings");
  const out = {};
  out.phone = str(input.phone, 40);
  out.whatsapp = str(input.whatsapp, 40).replace(/\D/g, "");
  if (out.whatsapp && (out.whatsapp.length < 8 || out.whatsapp.length > 15)) throw new ValidationError("WhatsApp number should be 8–15 digits including the country code, e.g. 919876543210");
  out.email = str(input.email, 150);
  if (out.email && !EMAIL_RE.test(out.email)) throw new ValidationError("Email address looks incorrect");
  out.address = str(input.address, 300);
  out.mapQuery = str(input.mapQuery, 200);
  out.mapLink = cleanUrl(input.mapLink);
  out.hours = str(input.hours, 200);
  out.youtubeChannel = cleanUrl(input.youtubeChannel);
  if (out.youtubeChannel) {
    out.youtubeChannel = youtube.normaliseChannelUrl(out.youtubeChannel);
    if (!/^https:\/\/(www\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+)$/.test(out.youtubeChannel)) {
      throw new ValidationError("YouTube channel should look like https://www.youtube.com/@yourchannel");
    }
  }
  out.instagram = cleanUrl(input.instagram);
  out.facebook = cleanUrl(input.facebook);
  out.web3formsKey = str(input.web3formsKey, 64);
  if (out.web3formsKey && !/^[A-Za-z0-9-]{8,64}$/.test(out.web3formsKey)) throw new ValidationError("Web3Forms key looks incorrect");
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
  if (out.announcement.enabled && !out.announcement.text) throw new ValidationError("Write the announcement text, or switch the announcement off");
  return out;
}

/* ==========================================================================
   Enquiries
   ========================================================================== */
const ENQUIRY_FIELDS = { name: 100, phone: 40, email: 150, learner: 40, programme: 80, mode: 20, city: 100, time: 40, message: 2000, page: 100 };
const ENQUIRY_STATUSES = ["new", "contacted", "enrolled", "closed"];

function validateEnquiry(input) {
  const out = {};
  for (const [k, max] of Object.entries(ENQUIRY_FIELDS)) out[k] = str(input[k], max);
  if (!out.name) throw new ValidationError("Please tell us your name");
  if (!out.phone || out.phone.replace(/\D/g, "").length < 6) throw new ValidationError("Please share a phone or WhatsApp number");
  if (out.email && !EMAIL_RE.test(out.email)) throw new ValidationError("Email address looks incorrect");
  return out;
}

/* ==========================================================================
   Gallery uploads
   ========================================================================== */
const IMAGE_TYPES = {
  "image/jpeg": { ext: "jpg", magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { ext: "webp", magic: b => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP" },
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function decodeImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new ValidationError("Please upload a JPG, PNG or WebP image");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_IMAGE_BYTES) throw new ValidationError("Image is larger than 8 MB");
  const type = IMAGE_TYPES[m[1]];
  if (!type.magic(buf)) throw new ValidationError("The file is not a valid image");
  return { buf, ext: type.ext };
}

function publicGallery() {
  return store.gallery.read().map(g => ({
    id: g.id, src: `/uploads/${g.file}`, alt: g.alt, caption: g.caption, width: g.width, height: g.height,
  }));
}

/* ==========================================================================
   YouTube: latest videos from the channel, refreshed hourly
   ========================================================================== */
const YT_TTL_MS = 60 * 60 * 1000;
const YT_RETRY_MS = 5 * 60 * 1000;
const YT_CACHE_FILE = path.join(DATA_DIR, "youtube-cache.json");
const YT_SNAPSHOT_FILE = path.join(PUBLIC_DIR, "assets/data/youtube.json");
const ytCache = { at: 0, id: "", data: null, inflight: null };

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}

function youtubeFeed() {
  const s = currentSettings();
  const id = s.youtubeChannelId;
  const empty = { channelUrl: s.youtubeChannel || "", channelId: id || "", videos: [] };
  if (!id) return Promise.resolve(empty);
  if (ytCache.id === id && ytCache.data && Date.now() - ytCache.at < YT_TTL_MS) return Promise.resolve(ytCache.data);
  if (ytCache.inflight) return ytCache.inflight;
  ytCache.inflight = youtube.fetchChannelVideos(id)
    .then(videos => {
      const data = { channelUrl: s.youtubeChannel, channelId: id, updated: new Date().toISOString(), videos };
      Object.assign(ytCache, { at: Date.now(), id, data });
      try { fs.writeFileSync(YT_CACHE_FILE, JSON.stringify(data)); } catch (_) { /* cache is optional */ }
      return data;
    })
    .catch(err => {
      console.warn("[youtube] feed unavailable:", err.message);
      // last good copy, then the snapshot shipped with the site, as long as it is the same channel
      const fallback = [ytCache.data, readJsonFile(YT_CACHE_FILE), readJsonFile(YT_SNAPSHOT_FILE)]
        .find(d => d && d.channelId === id && Array.isArray(d.videos)) || empty;
      Object.assign(ytCache, { at: Date.now() - YT_TTL_MS + YT_RETRY_MS, id, data: fallback });
      return fallback;
    })
    .finally(() => { ytCache.inflight = null; });
  return ytCache.inflight;
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
function siteHeaders(extra) { return Object.assign({}, BASE_HEADERS, { "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": SITE_CSP }, extra); }
function httpsHeaders(req, res) {
  if (!isHttps(req)) return;
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
}
function adminHeaders(extra) {
  return Object.assign({}, BASE_HEADERS, {
    "X-Frame-Options": "DENY", "Content-Security-Policy": ADMIN_CSP,
    "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "no-store",
  }, extra);
}

function send(req, res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

function json(req, res, status, data, admin = true) {
  const body = JSON.stringify(data);
  const h = admin ? adminHeaders() : siteHeaders({ "Cache-Control": "no-store" });
  h["Content-Type"] = "application/json; charset=utf-8";
  send(req, res, status, body, h);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("Request too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, limit) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
    throw Object.assign(new Error("Expected JSON"), { status: 415 });
  }
  const buf = await readBody(req, limit);
  let v;
  try { v = JSON.parse(buf.toString("utf8") || "{}"); }
  catch (_) { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  return v;
}

function clientIp(req) {
  let ip = req.socket.remoteAddress || "unknown";
  if (TRUST_PROXY) {
    const cf = String(req.headers["cf-connecting-ip"] || "").trim();
    if (net.isIP(cf)) ip = cf;
  }
  ip = ip.replace(/^::ffff:/, "");
  if (net.isIPv6(ip)) ip = ip.split(":").slice(0, 4).join(":") + "::/64";
  return ip;
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || (TRUST_PROXY && /^https$/i.test(String(req.headers["x-forwarded-proto"] || "")));
}

// Reject cross-site state-changing requests (defence in depth alongside SameSite=Strict cookies)
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* ignore malformed cookie */ }
  }
  return out;
}

function isLocalHost(req) { return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || "")); }

function sessionCookie(req, token, maxAge) {
  const secure = isHttps(req) || (IS_PRODUCTION && !isLocalHost(req));
  return `${COOKIE}=${token}; Path=${ADMIN_PATH}/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function passwordChangedAt() { return Date.parse(store.admin.read().updatedAt || "") || 0; }
const isAuthed = req => sessions.check(parseCookies(req)[COOKIE], passwordChangedAt());

/* ==========================================================================
   Static files
   ========================================================================== */
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".txt", ".xml", ".webmanifest"]);
const gzipCache = new Map();

function resolveInside(base, rel) {
  const full = path.resolve(base, "." + rel);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

function serveFile(req, res, file, { status = 200, cache, headers } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const h = Object.assign({}, headers, {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": cache || "no-cache",
    ETag: etag,
  });
  if (status === 200 && req.headers["if-none-match"] === etag) { send(req, res, 304, undefined, h); return true; }
  let body = fs.readFileSync(file);
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "") && body.length > 512) {
    const key = `${file}:${etag}`;
    let gz = gzipCache.get(key);
    if (!gz) {
      gz = zlib.gzipSync(body, { level: 6 });
      if (gzipCache.size > 300) gzipCache.clear();
      gzipCache.set(key, gz);
    }
    body = gz;
    h["Content-Encoding"] = "gzip";
    h.Vary = "Accept-Encoding";
  }
  h["Content-Length"] = body.length;
  send(req, res, status, body, h);
  return true;
}

function notFound(req, res) {
  if (!serveFile(req, res, path.join(PUBLIC_DIR, "404.html"), { status: 404, headers: siteHeaders() })) {
    send(req, res, 404, "Not found", siteHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
  }
}

function servePublic(req, res, pathname) {
  // never expose dotfiles or host config such as _headers; reject "//" and "\\" (open-redirect tricks)
  if (/(^|\/)[._]/.test(pathname) || pathname.includes("//") || pathname.includes("\\")) return notFound(req, res);

  // /page.html → /page (clean URLs, like the Cloudflare Pages behaviour)
  const htmlMatch = /^\/(.+)\.html$/.exec(pathname);
  if (htmlMatch) {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const target = htmlMatch[1] === "index" ? "/" : `/${htmlMatch[1]}`;
    return send(req, res, 301, undefined, siteHeaders({ Location: encodeURI(target) + qs }));
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return send(req, res, 301, undefined, siteHeaders({ Location: encodeURI(pathname.slice(0, -1)) + qs }));
  }

  const isAsset = pathname.startsWith("/assets/");
  const cache = isAsset ? "public, max-age=604800, stale-while-revalidate=86400" : "no-cache";
  const candidates = pathname === "/" ? ["/index.html"] : isAsset || path.extname(pathname) ? [pathname] : [`${pathname}.html`];
  for (const c of candidates) {
    const file = resolveInside(PUBLIC_DIR, c);
    if (file && serveFile(req, res, file, { cache, headers: siteHeaders() })) return;
  }
  notFound(req, res);
}

/* ==========================================================================
   Routes
   ========================================================================== */
async function handleApi(req, res, pathname) {
  const method = req.method;

  /* ---------- public ---------- */
  if (pathname === "/api/enquiries" && method === "POST") {
    if (!sameOrigin(req)) return json(req, res, 403, { error: "Forbidden" }, false);
    const ip = clientIp(req);
    if (enquiryLimiter.hit(ip)) return json(req, res, 429, { error: "Too many enquiries. Please try again a little later" }, false);
    const body = await readJson(req, 16 * 1024);
    if (store.enquiries.read().length >= MAX_ENQUIRIES || enquiryGlobal.hit("all")) {
      return json(req, res, 503, { error: "Our enquiry form is busy right now. Please contact us on WhatsApp or by email" }, false);
    }
    if (str(body.website, 200)) return json(req, res, 201, { ok: true }, false); // honeypot: pretend success
    const data = validateEnquiry(body);
    const enquiry = Object.assign({ id: crypto.randomBytes(8).toString("hex"), createdAt: new Date().toISOString(), status: "new", notes: "" }, data);
    store.enquiries.update(list => { list.unshift(enquiry); return list; });
    return json(req, res, 201, { ok: true }, false);
  }
  if (pathname === "/api/gallery" && (method === "GET" || method === "HEAD")) {
    return json(req, res, 200, publicGallery(), false);
  }
  if (pathname === "/api/youtube" && (method === "GET" || method === "HEAD")) {
    const data = await youtubeFeed();
    const body = JSON.stringify(data);
    return send(req, res, 200, body, siteHeaders({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=600" }));
  }

  return json(req, res, 404, { error: "Not found" }, false);
}

/* The admin API lives under ADMIN_PATH/api/ so a secret ADMIN_PATH hides it too. */
async function handleAdminApi(req, res, route) {
  const method = req.method;
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) return json(req, res, 403, { error: "Forbidden" });

  if (route === "/login" && method === "POST") {
    const ip = clientIp(req);
    const body = await readJson(req, 4 * 1024);
    // count the attempt before checking it, so parallel requests cannot slip past the limit
    if (loginInflight >= 4 || loginLimiter.hit(ip) || loginGlobal.hit("all")) {
      return json(req, res, 429, { error: "Too many attempts. Please wait 15 minutes and try again." });
    }
    let ok = false;
    loginInflight++;
    try { ok = await verifyPassword(String(body.password || ""), store.admin.read().passwordHash); }
    finally { loginInflight--; }
    if (!ok) {
      await new Promise(r => setTimeout(r, 400));
      return json(req, res, 401, { error: "Incorrect password" });
    }
    loginLimiter.reset(ip);
    const token = sessions.create();
    res.setHeader("Set-Cookie", sessionCookie(req, token, 12 * 60 * 60));
    return json(req, res, 200, { ok: true });
  }
  if (route === "/session" && method === "GET") {
    return json(req, res, 200, { authenticated: isAuthed(req) });
  }
  if (route === "/logout" && method === "POST") {
    sessions.destroy(parseCookies(req)[COOKIE]);
    res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
    return json(req, res, 200, { ok: true });
  }

  // everything below requires a signed-in admin
  if (!isAuthed(req)) return json(req, res, 401, { error: "Please sign in" });

  if (route === "/summary" && method === "GET") {
    const enquiries = store.enquiries.read();
    const counts = Object.fromEntries(ENQUIRY_STATUSES.map(s => [s, 0]));
    for (const e of enquiries) counts[e.status] = (counts[e.status] || 0) + 1;
    return json(req, res, 200, {
      enquiries: { total: enquiries.length, ...counts },
      recent: enquiries.slice(0, 5),
      galleryCount: store.gallery.read().length,
      enquiryCapacity: MAX_ENQUIRIES,
      announcement: currentSettings().announcement,
    });
  }

  /* enquiries */
  if (route === "/enquiries" && method === "GET") return json(req, res, 200, store.enquiries.read());
  if (route === "/enquiries.csv" && method === "GET") {
    const cols = ["createdAt", "status", "name", "phone", "email", "learner", "programme", "mode", "city", "time", "message", "notes", "page"];
    const cell = v => {
      let s = String(v == null ? "" : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = [cols.join(",")].concat(store.enquiries.read().map(e => cols.map(c => cell(e[c])).join(",")));
    return send(req, res, 200, "﻿" + rows.join("\r\n"), adminHeaders({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="alapadma-enquiries-${new Date().toISOString().slice(0, 10)}.csv"`,
    }));
  }
  let m = /^\/enquiries\/([a-f0-9]{16})$/.exec(route);
  if (m && method === "PATCH") {
    const body = await readJson(req, 16 * 1024);
    let found = null;
    store.enquiries.update(list => list.map(e => {
      if (e.id !== m[1]) return e;
      if (body.status !== undefined) {
        if (!ENQUIRY_STATUSES.includes(body.status)) throw new ValidationError("Unknown status");
        e.status = body.status;
      }
      if (body.notes !== undefined) e.notes = str(body.notes, 4000);
      e.updatedAt = new Date().toISOString();
      found = e;
      return e;
    }));
    return found ? json(req, res, 200, found) : json(req, res, 404, { error: "Enquiry not found" });
  }
  if (m && method === "DELETE") {
    const before = store.enquiries.read().length;
    store.enquiries.update(list => list.filter(e => e.id !== m[1]));
    return store.enquiries.read().length < before ? json(req, res, 200, { ok: true }) : json(req, res, 404, { error: "Enquiry not found" });
  }

  /* settings */
  if (route === "/settings" && method === "GET") return json(req, res, 200, currentSettings());
  if (route === "/settings" && method === "PUT") {
    const body = await readJson(req, 64 * 1024);
    const clean = validateSettings(body);
    const prev = currentSettings();
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
    store.settings.write(clean);
    ytCache.at = 0;
    return json(req, res, 200, Object.assign(currentSettings(), warning ? { warning } : {}));
  }

  /* gallery */
  if (route === "/gallery" && method === "GET") return json(req, res, 200, publicGallery());
  if (route === "/gallery" && method === "POST") {
    const body = await readJson(req, 12 * 1024 * 1024);
    const { buf, ext } = decodeImage(body.image);
    const file = `${crypto.randomBytes(12).toString("hex")}.${ext}`;
    fs.writeFileSync(path.join(store.uploadsDir, file), buf, { mode: 0o644 });
    const item = {
      id: crypto.randomBytes(8).toString("hex"), file,
      alt: str(body.alt, 200) || "Odissi photograph from Alapadma Odissi Dance Academy",
      caption: str(body.caption, 200),
      width: Math.max(1, Math.min(10000, Math.round(Number(body.width) || 1200))),
      height: Math.max(1, Math.min(10000, Math.round(Number(body.height) || 900))),
      createdAt: new Date().toISOString(),
    };
    store.gallery.update(list => { list.unshift(item); return list; });
    return json(req, res, 201, publicGallery()[0]);
  }
  if (route === "/gallery/order" && method === "POST") {
    const body = await readJson(req, 16 * 1024);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    store.gallery.update(list => {
      const byId = new Map(list.map(g => [g.id, g]));
      const ordered = ids.filter(id => byId.has(id)).map(id => byId.get(id));
      const rest = list.filter(g => !ids.includes(g.id));
      return ordered.concat(rest);
    });
    return json(req, res, 200, publicGallery());
  }
  m = /^\/gallery\/([a-f0-9]{16})$/.exec(route);
  if (m && method === "PATCH") {
    const body = await readJson(req, 8 * 1024);
    let found = false;
    store.gallery.update(list => list.map(g => {
      if (g.id !== m[1]) return g;
      found = true;
      if (body.alt !== undefined) g.alt = str(body.alt, 200) || g.alt;
      if (body.caption !== undefined) g.caption = str(body.caption, 200);
      return g;
    }));
    return found ? json(req, res, 200, publicGallery().find(g => g.id === m[1])) : json(req, res, 404, { error: "Photo not found" });
  }
  if (m && method === "DELETE") {
    const item = store.gallery.read().find(g => g.id === m[1]);
    if (!item) return json(req, res, 404, { error: "Photo not found" });
    store.gallery.update(list => list.filter(g => g.id !== m[1]));
    const file = resolveInside(store.uploadsDir, `/${item.file}`);
    if (file) fs.rm(file, { force: true }, () => {});
    return json(req, res, 200, { ok: true });
  }

  /* account */
  if (route === "/password" && method === "POST") {
    const body = await readJson(req, 4 * 1024);
    const token = parseCookies(req)[COOKIE];
    const session = sessions.get(token);
    if (!(await verifyPassword(String(body.current || ""), store.admin.read().passwordHash))) {
      if (session && ++session.failures >= 5) {
        sessions.destroy(token);
        return json(req, res, 401, { error: "Too many incorrect attempts. Please sign in again" });
      }
      return json(req, res, 400, { error: "Current password is incorrect" });
    }
    const next = String(body.next || "");
    if (next.length < MIN_PASSWORD_LENGTH) return json(req, res, 400, { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    store.admin.write({ passwordHash: hashPassword(next), updatedAt: new Date().toISOString() });
    sessions.destroyAll();
    const fresh = sessions.create();
    res.setHeader("Set-Cookie", sessionCookie(req, fresh, 12 * 60 * 60));
    return json(req, res, 200, { ok: true });
  }

  return json(req, res, 404, { error: "Not found" });
}

function serveAdmin(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(req, res, 405, "Method not allowed", adminHeaders({ Allow: "GET, HEAD" }));
  if (pathname === ADMIN_PATH) return send(req, res, 301, undefined, adminHeaders({ Location: `${ADMIN_PATH}/` }));
  const rel = pathname.slice(ADMIN_PATH.length) || "/";
  const file = resolveInside(ADMIN_DIR, rel === "/" ? "/index.html" : rel);
  if (!file || /(^|\/)\./.test(rel) || !serveFile(req, res, file, { cache: "no-store", headers: adminHeaders() })) {
    send(req, res, 404, "Not found", adminHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
  }
}

async function handle(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch (_) { return send(req, res, 400, "Bad request", siteHeaders({ "Content-Type": "text/plain; charset=utf-8" })); }
  if (pathname.includes("\0")) return send(req, res, 400, "Bad request", siteHeaders());

  if (pathname === "/healthz") return send(req, res, 200, "ok\n", { "Content-Type": "text/plain", "Cache-Control": "no-store" });

  httpsHeaders(req, res);

  if (pathname.startsWith(ADMIN_PATH + "/api/")) return handleAdminApi(req, res, pathname.slice((ADMIN_PATH + "/api").length));
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);

  if (pathname === ADMIN_PATH || pathname.startsWith(ADMIN_PATH + "/")) return serveAdmin(req, res, pathname);

  if (req.method !== "GET" && req.method !== "HEAD") return send(req, res, 405, "Method not allowed", siteHeaders({ Allow: "GET, HEAD" }));

  // live settings for the public pages (falls back to the static file on static hosting)
  if (pathname === "/assets/js/site-config.js") {
    const body = "/* generated from the admin settings */\nwindow.SITE = " +
      JSON.stringify(publicSiteConfig()).replace(/</g, "\\u003c").split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029") + ";\n";
    return send(req, res, 200, body, siteHeaders({ "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" }));
  }

  if (pathname.startsWith("/uploads/")) {
    const name = pathname.slice("/uploads/".length);
    if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(name)) return notFound(req, res);
    if (!serveFile(req, res, path.join(store.uploadsDir, name), { cache: "public, max-age=604800", headers: siteHeaders() })) return notFound(req, res);
    return;
  }

  servePublic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    const status = err instanceof ValidationError ? 400 : err.status || 500;
    if (status >= 500) console.error("[error]", req.method, req.url, err);
    if (res.headersSent) return res.end();
    json(req, res, status, { error: status >= 500 ? "Something went wrong" : err.message });
  });
});
server.headersTimeout = 15000;
server.requestTimeout = 60000;
server.maxConnections = 500;

if (require.main === module) {
  ensureAdminPassword();
  if (IS_PRODUCTION && ADMIN_PATH === "/admin") {
    console.warn("[admin] The admin panel is at the default /admin. Set ADMIN_PATH to a private address, e.g. /studio-desk-7381");
  }
  server.listen(PORT, () => {
    console.log(`Alapadma site on http://0.0.0.0:${PORT}  (admin panel: ${ADMIN_PATH}/, data: ${DATA_DIR})`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

module.exports = { server, validateSettings, youtubeId };
