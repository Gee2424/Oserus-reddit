// Centralized key/value settings store. Previously this exact helper was
// copy-pasted into ai.js, votes.js, postgen.js, coordinator.js and
// ipc/protocols.js — now one source of truth.

const { getDb } = require('../db');

function ensure() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getSetting(key) {
  ensure();
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  ensure();
  getDb().prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value == null ? null : String(value));
}

module.exports = { getSetting, setSetting, ensureSettingsTable: ensure };
