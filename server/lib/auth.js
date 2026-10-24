"use strict";
/* Admin authentication: scrypt password hashes, in-memory sessions, rate limits. */
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scryptAsync = promisify(crypto.scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;   // sign out after 2 hours of inactivity
const SESSION_MAX_MS = 12 * 60 * 60 * 1000;   // and after 12 hours regardless
const MIN_PASSWORD_LENGTH = 10;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

// async so a burst of login attempts cannot block the event loop for other visitors
async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string" || password.length > 1024) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function generatePassword() {
  // 16 characters from an unambiguous alphabet
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

/* ---------- sessions ---------- */
class Sessions {
  constructor() { this.map = new Map(); }

  create() {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    this.map.set(token, { created: now, seen: now, failures: 0 });
    if (this.map.size > 1000) {
      for (const [k, v] of this.map) if (now - v.seen > SESSION_IDLE_MS) this.map.delete(k);
    }
    return token;
  }

  get(token) { return this.map.get(token); }

  check(token, notBefore) {
    if (!token) return false;
    const s = this.map.get(token);
    if (!s) return false;
    const now = Date.now();
    if (now - s.seen > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS || (notBefore && s.created < notBefore)) {
      this.map.delete(token);
      return false;
    }
    s.seen = now;
    return true;
  }

  destroy(token) { this.map.delete(token); }
  destroyAll() { this.map.clear(); }
}

/* ---------- fixed-window rate limiter ---------- */
class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  // returns true when the key is over its limit
  hit(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || now - entry.start > this.windowMs) {
      entry = { start: now, count: 0 };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    if (this.hits.size > 10000) {
      this.prune(now);
      while (this.hits.size > 10000) this.hits.delete(this.hits.keys().next().value);
    }
    return entry.count > this.limit;
  }

  blocked(key) {
    const entry = this.hits.get(key);
    return Boolean(entry && Date.now() - entry.start <= this.windowMs && entry.count >= this.limit);
  }

  reset(key) { this.hits.delete(key); }

  prune(now) {
    for (const [k, v] of this.hits) if (now - v.start > this.windowMs) this.hits.delete(k);
  }
}

module.exports = { hashPassword, verifyPassword, generatePassword, Sessions, RateLimiter, MIN_PASSWORD_LENGTH };
