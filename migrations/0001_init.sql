-- Alapadma Odissi Dance Academy: D1 schema

-- site settings saved from the admin panel (one JSON document)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- the single admin account
CREATE TABLE admin (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT    NOT NULL,
  updated_at    INTEGER NOT NULL          -- ms since epoch; sessions older than this are invalid
);

-- admin sessions (only a SHA-256 hash of the cookie token is stored)
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  created    INTEGER NOT NULL,
  seen       INTEGER NOT NULL,
  failures   INTEGER NOT NULL DEFAULT 0
);

-- fixed-window rate limits (logins, enquiries)
CREATE TABLE rate_limits (
  key   TEXT    PRIMARY KEY,
  start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- enquiry form submissions
CREATE TABLE enquiries (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  notes      TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  learner    TEXT NOT NULL DEFAULT '',
  programme  TEXT NOT NULL DEFAULT '',
  mode       TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  time       TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  page       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX enquiries_created ON enquiries (created_at DESC);

-- gallery photos uploaded from the admin panel
CREATE TABLE gallery (
  id         TEXT    PRIMARY KEY,
  file       TEXT    NOT NULL UNIQUE,
  alt        TEXT    NOT NULL,
  caption    TEXT    NOT NULL DEFAULT '',
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT    NOT NULL
);
-- the image bytes live in their own table so listing the gallery stays light
CREATE TABLE uploads (
  file TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);

-- small cache (e.g. the YouTube channel feed)
CREATE TABLE cache (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL
);
