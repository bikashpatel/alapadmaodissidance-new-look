"use strict";
/*
 * Reset the admin password (e.g. if it is forgotten or leaked). A running server picks
 * up the new password immediately and signs out every existing admin session.
 *
 *   docker compose exec web node server/set-password.js "a-new-long-password"
 *   node server/set-password.js "a-new-long-password"          (local)
 */
const path = require("node:path");
const { openStores } = require("./lib/store");
const { hashPassword, MIN_PASSWORD_LENGTH } = require("./lib/auth");

const password = process.argv[2];
if (!password || password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Usage: node server/set-password.js "<new password, at least ${MIN_PASSWORD_LENGTH} characters>"`);
  process.exit(1);
}
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const store = openStores(dataDir);
store.admin.write({ passwordHash: hashPassword(password), updatedAt: new Date().toISOString() });
console.log(`Admin password updated (${dataDir}). Existing admin sessions are signed out automatically.`);
