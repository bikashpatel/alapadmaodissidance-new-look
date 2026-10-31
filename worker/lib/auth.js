/*
 * Admin authentication for Cloudflare Workers (Web Crypto + D1).
 * Passwords: PBKDF2-SHA256. Sessions: random token in an HttpOnly cookie, only its
 * SHA-256 hash is stored in D1. Rate limits: fixed windows in D1.
 */

// Workers caps PBKDF2 at 100,000 iterations; 60,000 keeps a login under the
// free plan's CPU budget. On the paid plan PBKDF2_ITERATIONS can be raised to 100000.
export const DEFAULT_ITERATIONS = 60000;
export const MIN_PASSWORD_LENGTH = 10;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;   // 2 hours without activity
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;   // 12 hours in total

const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations, bits = 256) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, bits));
}

export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string" || password.length > 1024) return false;
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100000) return false;
  const expected = unb64(parts[4]);
  const actual = await pbkdf2(password, unb64(parts[3]), iterations, expected.length * 8);
  return equalBytes(actual, expected);
}

export function randomId(bytes = 8) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return Array.from(d, b => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- admin account ---------- */
export async function getAdmin(db, env) {
  let row = await db.prepare("SELECT password_hash, updated_at FROM admin WHERE id = 1").first();
  if (row) return row;
  // first run: take the initial password from the ADMIN_PASSWORD secret
  const initial = env.ADMIN_PASSWORD;
  if (!initial || initial.length < MIN_PASSWORD_LENGTH) return null;
  const hash = await hashPassword(initial, Number(env.PBKDF2_ITERATIONS) || DEFAULT_ITERATIONS);
  await db.prepare("INSERT OR IGNORE INTO admin (id, password_hash, updated_at) VALUES (1, ?1, ?2)").bind(hash, Date.now()).run();
  return db.prepare("SELECT password_hash, updated_at FROM admin WHERE id = 1").first();
}

export async function setPassword(db, env, password) {
  const hash = await hashPassword(password, Number(env.PBKDF2_ITERATIONS) || DEFAULT_ITERATIONS);
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO admin (id, password_hash, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET password_hash = ?1, updated_at = ?2").bind(hash, now),
    db.prepare("DELETE FROM sessions"),
  ]);
  return now;
}

/* ---------- sessions ---------- */
export async function createSession(db) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.prepare("INSERT INTO sessions (token_hash, created, seen) VALUES (?1, ?2, ?2)").bind(await sha256hex(token), now).run();
  return token;
}

// returns the session row when valid (and refreshes its idle timer), otherwise null
export async function checkSession(db, token, passwordChangedAt) {
  if (!token || token.length > 100) return null;
  const hash = await sha256hex(token);
  const s = await db.prepare("SELECT token_hash, created, seen, failures FROM sessions WHERE token_hash = ?1").bind(hash).first();
  if (!s) return null;
  const now = Date.now();
  if (now - s.seen > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS || s.created < (passwordChangedAt || 0)) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(hash).run();
    return null;
  }
  if (now - s.seen > 60 * 1000) await db.prepare("UPDATE sessions SET seen = ?2 WHERE token_hash = ?1").bind(hash, now).run();
  return s;
}

export async function destroySession(db, token) {
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256hex(token)).run();
}

/* ---------- rate limits (atomic upsert, fixed window) ---------- */
// returns true when `key` is over `limit` hits within `windowMs`
export async function rateLimited(db, key, limit, windowMs) {
  const now = Date.now();
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ?2 - start > ?3 THEN 1 ELSE count + 1 END,
       start = CASE WHEN ?2 - start > ?3 THEN ?2 ELSE start END
     RETURNING count`).bind(key, now, windowMs).first();
  return row.count > limit;
}

export async function rateLimitReset(db, key) {
  await db.prepare("DELETE FROM rate_limits WHERE key = ?1").bind(key).run();
}

export async function pruneAuthTables(db) {
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM rate_limits WHERE start < ?1").bind(now - 24 * 60 * 60 * 1000),
    db.prepare("DELETE FROM sessions WHERE seen < ?1 OR created < ?2").bind(now - SESSION_IDLE_MS, now - SESSION_MAX_MS),
  ]);
}
