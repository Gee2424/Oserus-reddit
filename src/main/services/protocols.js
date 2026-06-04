// Posting Protocol engine.
//
// A "protocol" is a set of rules that govern how often an account may post:
//   - hoursBetweenMin / hoursBetweenMax : randomized gap between posts
//   - postsBeforeBreak                  : after N posts, force a longer rest
//   - breakHoursMin / breakHoursMax     : how long that rest lasts
//   - dailyCap                          : max posts per account per day
//   - quietStart / quietEnd             : no-post window (account-local-ish, 0-23)
//   - jitterMinutes                     : ± randomization so timing isn't robotic
//   - enabled                           : master switch
//
// Override hierarchy (most specific wins): account > model > platform > global.
// Configs are stored as JSON rows in the `posting_protocols` table keyed by
// (scope, scope_id). The engine merges them top-down.
//
// This module is pure logic over the DB — no Electron, no IPC — so it can be
// lifted to a hosted backend later without changes.

const { getDb } = require('../db');
const coordination = require('./coordination');

const DEFAULT_PROTOCOL = {
  enabled: false,            // safe by default — nothing posts until turned on
  hoursBetweenMin: 4,
  hoursBetweenMax: 8,
  postsBeforeBreak: 3,
  breakHoursMin: 6,
  breakHoursMax: 12,
  dailyCap: 6,
  quietStart: 2,             // 2am
  quietEnd: 6,               // 6am
  jitterMinutes: 20,
};

function ensureTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS posting_protocols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK(scope IN ('global','platform','model','account')),
      scope_id TEXT,                       -- platform name, model id, or account id; NULL for global
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scope, scope_id)
    );

    CREATE TABLE IF NOT EXISTS post_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      profile_id INTEGER,
      subreddit TEXT,
      title TEXT,
      remote_id TEXT,
      status TEXT NOT NULL DEFAULT 'posted',  -- posted | failed | skipped
      source TEXT NOT NULL DEFAULT 'manual',  -- manual | auto
      error TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Distributed-ish lock so one machine (or one pass) claims an account
    -- before posting. TTL via expires_at prevents a crashed run from
    -- wedging an account forever. Lifts cleanly to a shared DB later.
    CREATE TABLE IF NOT EXISTS post_locks (
      platform TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      holder TEXT,                          -- machine/instance id
      acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_id)
    );
  `);
}

function getRawConfig(scope, scopeId) {
  ensureTables();
  const row = getDb()
    .prepare('SELECT config_json FROM posting_protocols WHERE scope = ? AND scope_id IS ?')
    .get(scope, scopeId == null ? null : String(scopeId));
  if (!row) return null;
  try { return JSON.parse(row.config_json); } catch { return null; }
}

function setConfig(scope, scopeId, config) {
  ensureTables();
  const json = JSON.stringify(config || {});
  getDb().prepare(
    `INSERT INTO posting_protocols (scope, scope_id, config_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(scope, scope_id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`
  ).run(scope, scopeId == null ? null : String(scopeId), json);
}

// Resolve the effective protocol for an account by merging the hierarchy.
// Each level only overrides keys it actually sets (partial configs allowed).
function resolveProtocol({ platform, profileId, accountId }) {
  const layers = [
    DEFAULT_PROTOCOL,
    getRawConfig('global', null),
    platform ? getRawConfig('platform', platform) : null,
    profileId != null ? getRawConfig('model', profileId) : null,
    accountId != null ? getRawConfig('account', accountId) : null,
  ];
  const merged = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined && v !== null && v !== '') merged[k] = v;
    }
  }
  return merged;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function isQuietHour(hour, quietStart, quietEnd) {
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return false;
  // Window may wrap midnight (e.g. 22 -> 6).
  if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
  return hour >= quietStart || hour < quietEnd;
}

function countPostsSince(platform, accountId, sinceIso) {
  return getDb()
    .prepare("SELECT COUNT(*) AS n FROM post_events WHERE platform = ? AND account_id = ? AND status = 'posted' AND created_at >= ?")
    .get(platform, accountId, sinceIso).n;
}

function lastPostAt(platform, accountId) {
  const row = getDb()
    .prepare("SELECT created_at FROM post_events WHERE platform = ? AND account_id = ? AND status = 'posted' ORDER BY id DESC LIMIT 1")
    .get(platform, accountId);
  return row ? row.created_at : null;
}

// Decide whether an account may post right now. Returns
// { eligible: bool, reason, nextEligibleAt? }.
function checkEligibility({ platform, accountId, profileId, now = new Date() }) {
  const p = resolveProtocol({ platform, profileId, accountId });
  if (!p.enabled) return { eligible: false, reason: 'Protocol disabled' };

  const hour = now.getHours();
  if (isQuietHour(hour, p.quietStart, p.quietEnd)) {
    return { eligible: false, reason: `Quiet hours (${p.quietStart}:00–${p.quietEnd}:00)` };
  }

  // Daily cap (rolling 24h).
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const postsToday = countPostsSince(platform, accountId, dayAgo);
  if (p.dailyCap && postsToday >= p.dailyCap) {
    return { eligible: false, reason: `Daily cap reached (${postsToday}/${p.dailyCap})` };
  }

  const last = lastPostAt(platform, accountId);
  if (last) {
    const lastMs = new Date(last.replace(' ', 'T') + 'Z').getTime();
    const sinceH = (now.getTime() - lastMs) / 3600000;

    // Forced break after N posts: look at the most recent burst.
    if (p.postsBeforeBreak) {
      const burstWindow = new Date(now.getTime() - (p.breakHoursMax || 12) * 3600 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);
      const recent = countPostsSince(platform, accountId, burstWindow);
      if (recent >= p.postsBeforeBreak) {
        const breakH = rand(p.breakHoursMin || 6, p.breakHoursMax || 12);
        if (sinceH < breakH) {
          return { eligible: false, reason: `On break after ${recent} posts (resting ~${breakH.toFixed(1)}h)` };
        }
      }
    }

    // Normal randomized gap.
    const gapH = rand(p.hoursBetweenMin || 4, p.hoursBetweenMax || 8);
    if (sinceH < gapH) {
      return { eligible: false, reason: `Too soon (waited ${sinceH.toFixed(1)}h, needs ~${gapH.toFixed(1)}h)` };
    }
  }

  return { eligible: true, reason: 'Eligible', protocol: p };
}

// Locks + events delegate to the coordination repository (local SQLite, or
// shared Supabase when configured). ensureTables() keeps the local tables
// present either way — they're the fallback target. These are async because
// a remote backend may be active.
function acquireLock(platform, accountId, holder, ttlSeconds = 300) {
  ensureTables();
  return coordination.acquireLock(platform, accountId, holder, ttlSeconds);
}
function releaseLock(platform, accountId) {
  ensureTables();
  return coordination.releaseLock(platform, accountId);
}
function recordEvent(ev) {
  ensureTables();
  return coordination.recordEvent(ev);
}

// Async eligibility check that consults the shared post log (cross-machine
// when Supabase is active). The synchronous checkEligibility() above stays
// for the local IPC preview; the coordinator uses this one before posting.
async function checkEligibilityShared({ platform, accountId, profileId, now = new Date() }) {
  const p = resolveProtocol({ platform, profileId, accountId });
  if (!p.enabled) return { eligible: false, reason: 'Protocol disabled' };

  const hour = now.getHours();
  if (isQuietHour(hour, p.quietStart, p.quietEnd)) {
    return { eligible: false, reason: `Quiet hours (${p.quietStart}:00–${p.quietEnd}:00)` };
  }

  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const postsToday = await coordination.countPostsSince(platform, accountId, dayAgo);
  if (p.dailyCap && postsToday >= p.dailyCap) {
    return { eligible: false, reason: `Daily cap reached (${postsToday}/${p.dailyCap})` };
  }

  const last = await coordination.lastPostAt(platform, accountId);
  if (last) {
    const lastMs = new Date(last.replace(' ', 'T') + 'Z').getTime();
    const sinceH = (now.getTime() - lastMs) / 3600000;
    if (p.postsBeforeBreak) {
      const burstWindow = new Date(now.getTime() - (p.breakHoursMax || 12) * 3600 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19);
      const recent = await coordination.countPostsSince(platform, accountId, burstWindow);
      if (recent >= p.postsBeforeBreak) {
        const breakH = rand(p.breakHoursMin || 6, p.breakHoursMax || 12);
        if (sinceH < breakH) return { eligible: false, reason: `On break after ${recent} posts (resting ~${breakH.toFixed(1)}h)` };
      }
    }
    const gapH = rand(p.hoursBetweenMin || 4, p.hoursBetweenMax || 8);
    if (sinceH < gapH) return { eligible: false, reason: `Too soon (waited ${sinceH.toFixed(1)}h, needs ~${gapH.toFixed(1)}h)` };
  }
  return { eligible: true, reason: 'Eligible', protocol: p };
}

module.exports = {
  DEFAULT_PROTOCOL,
  ensureTables,
  getRawConfig,
  setConfig,
  resolveProtocol,
  checkEligibility,
  checkEligibilityShared,
  acquireLock,
  releaseLock,
  recordEvent,
  lastPostAt,
  countPostsSince,
  isQuietHour,
  backendName: coordination.backendName,
};
