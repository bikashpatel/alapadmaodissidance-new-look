"use strict";
/*
 * Tiny JSON file store. Each collection is one file in DATA_DIR, cached in
 * memory and written atomically (temp file + rename) so a crash never leaves
 * a half-written file behind.
 */
const fs = require("node:fs");
const path = require("node:path");

class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
    this.cache = null;
  }

  read() {
    // reload when the file was changed by another process (e.g. set-password.js)
    let mtime;
    try { mtime = fs.statSync(this.file).mtimeMs; } catch (_) { mtime = undefined; }
    if (this.cache !== null && mtime !== this.mtime) this.cache = null;
    if (this.cache === null) {
      this.mtime = mtime;
      try {
        this.cache = JSON.parse(fs.readFileSync(this.file, "utf8"));
      } catch (err) {
        if (err.code !== "ENOENT") console.error(`[store] could not read ${this.file}:`, err.message);
        this.cache = structuredClone(this.fallback);
      }
    }
    return this.cache;
  }

  write(data) {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.cache = data;
    this.mtime = fs.statSync(this.file).mtimeMs;
    return data;
  }

  update(fn) {
    const next = fn(structuredClone(this.read()));
    return this.write(next);
  }
}

function openStores(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  const file = name => path.join(dataDir, name);
  return {
    settings: new JsonStore(file("settings.json"), {}),
    enquiries: new JsonStore(file("enquiries.json"), []),
    gallery: new JsonStore(file("gallery.json"), []),
    admin: new JsonStore(file("admin.json"), {}),
    uploadsDir: path.join(dataDir, "uploads"),
  };
}

module.exports = { JsonStore, openStores };
