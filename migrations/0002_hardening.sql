-- Hardening after the security review

-- cheap enquiry count (avoids COUNT(*) over the whole table on every public POST)
CREATE TABLE counters (
  key TEXT PRIMARY KEY,
  n   INTEGER NOT NULL
);
INSERT INTO counters (key, n) SELECT 'enquiries', COUNT(*) FROM enquiries;
CREATE TRIGGER enquiries_count_insert AFTER INSERT ON enquiries
BEGIN
  UPDATE counters SET n = n + 1 WHERE key = 'enquiries';
END;
CREATE TRIGGER enquiries_count_delete AFTER DELETE ON enquiries
BEGIN
  UPDATE counters SET n = n - 1 WHERE key = 'enquiries';
END;

-- sessions are bound to the password version they were created under
ALTER TABLE sessions ADD COLUMN pw_at INTEGER NOT NULL DEFAULT 0;
DELETE FROM sessions;

-- browsers that have signed in before: their logins are rate-limited per device,
-- so attackers hammering the login cannot lock the academy out
CREATE TABLE devices (
  token_hash TEXT    PRIMARY KEY,
  created    INTEGER NOT NULL,
  seen       INTEGER NOT NULL
);
