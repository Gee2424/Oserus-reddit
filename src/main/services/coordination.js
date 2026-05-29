// Coordination repository — the swappable boundary between local-only
// operation and shared multi-VA coordination.
//
// The autopilot/scheduler need three things to coordinate across machines:
//   1. distributed locks (TTL) so two PCs don't post the same account at once
//   2. a shared post-event log so each machine sees what others have done
//   3. post counts / last-post lookups derived from that shared log
//
// Today everything lives in local SQLite (per-machine). Point a single
// setting at Supabase and the same calls coordinate across every VA's app —
// no caller changes. This module is the ONLY place that knows which backend
// is active.
//
// Setup for Supabase (when you're ready): create the two tables with the SQL
// in docs/supabase-schema.sql, then set coordination_backend=supabase plus
// supabase_url / supabase_key in Settings. Falls back to local automatically
// if unset or if a remote call fails.

const { getDb } = require('../db');
const { getSetting } = require('./settings');

const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const plusSql = (sec) => new Date(Date.now() + sec * 1000).toISOString().replace('T', ' ').slice(0, 19);

/* ----------------------------- LOCAL BACKEND ----------------------------- */
// All synchronous (better-sqlite3). Wrapped in Promise.resolve by the facade
// so the public interface is uniformly async.

const local = {
  id: 'local',
  acquireLock(platform, accountId, holder, ttlSeconds) {
    const db = getDb();
    db.prepare('DELETE FROM post_locks WHERE platform = ? AND account_id = ? AND expires_at < ?')
      .run(platform, accountId, nowSql());
    try {
      db.prepare('INSERT INTO post_locks (platform, account_id, holder, acquired_at, expires_at) VALUES (?,?,?,?,?)')
        .run(platform, accountId, holder, nowSql(), plusSql(ttlSeconds));
      return true;
    } catch { return false; }
  },
  releaseLock(platform, accountId) {
    getDb().prepare('DELETE FROM post_locks WHERE platform = ? AND account_id = ?').run(platform, accountId);
  },
  recordEvent(ev) {
    getDb().prepare(
      `INSERT INTO post_events (platform, account_id, profile_id, subreddit, title, remote_id, status, source, error, created_by_user_id)
       VALUES (@platform,@account_id,@profile_id,@subreddit,@title,@remote_id,@status,@source,@error,@created_by_user_id)`
    ).run({
      platform: ev.platform, account_id: ev.account_id, profile_id: ev.profile_id ?? null,
      subreddit: ev.subreddit ?? null, title: ev.title ?? null, remote_id: ev.remote_id ?? null,
      status: ev.status || 'posted', source: ev.source || 'manual', error: ev.error ?? null,
      created_by_user_id: ev.created_by_user_id ?? null,
    });
  },
  countPostsSince(platform, accountId, sinceIso) {
    return getDb().prepare(
      "SELECT COUNT(*) AS n FROM post_events WHERE platform=? AND account_id=? AND status='posted' AND created_at >= ?"
    ).get(platform, accountId, sinceIso).n;
  },
  lastPostAt(platform, accountId) {
    const row = getDb().prepare(
      "SELECT created_at FROM post_events WHERE platform=? AND account_id=? AND status='posted' ORDER BY id DESC LIMIT 1"
    ).get(platform, accountId);
    return row ? row.created_at : null;
  },
};

/* --------------------------- SUPABASE BACKEND ---------------------------- */
// PostgREST over fetch. Same semantics, shared across all machines. Lock
// acquisition relies on a UNIQUE(platform, account_id) constraint: an INSERT
// that 409s means someone else holds it. Expired locks are pruned first.

function supabaseClient() {
  const url = getSetting('supabase_url');
  const key = getSetting('supabase_key');
  if (!url || !key) return null;
  const base = url.replace(/\/$/, '') + '/rest/v1';
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  return { base, headers };
}

const supabase = {
  id: 'supabase',
  async acquireLock(platform, accountId, holder, ttlSeconds) {
    const c = supabaseClient(); if (!c) throw new Error('Supabase not configured');
    // prune expired
    await fetch(`${c.base}/post_locks?platform=eq.${platform}&account_id=eq.${accountId}&expires_at=lt.${encodeURIComponent(nowSql())}`,
      { method: 'DELETE', headers: c.headers });
    const res = await fetch(`${c.base}/post_locks`, {
      method: 'POST',
      headers: { ...c.headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ platform, account_id: accountId, holder, acquired_at: nowSql(), expires_at: plusSql(ttlSeconds) }),
    });
    if (res.status === 409) return false; // unique violation → held elsewhere
    return res.ok;
  },
  async releaseLock(platform, accountId) {
    const c = supabaseClient(); if (!c) return;
    await fetch(`${c.base}/post_locks?platform=eq.${platform}&account_id=eq.${accountId}`,
      { method: 'DELETE', headers: c.headers });
  },
  async recordEvent(ev) {
    const c = supabaseClient(); if (!c) throw new Error('Supabase not configured');
    await fetch(`${c.base}/post_events`, {
      method: 'POST',
      headers: { ...c.headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        platform: ev.platform, account_id: ev.account_id, profile_id: ev.profile_id ?? null,
        subreddit: ev.subreddit ?? null, title: ev.title ?? null, remote_id: ev.remote_id ?? null,
        status: ev.status || 'posted', source: ev.source || 'manual', error: ev.error ?? null,
        created_by_user_id: ev.created_by_user_id ?? null, created_at: nowSql(),
      }),
    });
  },
  async countPostsSince(platform, accountId, sinceIso) {
    const c = supabaseClient(); if (!c) throw new Error('Supabase not configured');
    const res = await fetch(
      `${c.base}/post_events?select=id&platform=eq.${platform}&account_id=eq.${accountId}&status=eq.posted&created_at=gte.${encodeURIComponent(sinceIso)}`,
      { headers: { ...c.headers, Prefer: 'count=exact' } });
    const range = res.headers.get('content-range') || '';
    const total = range.split('/')[1];
    if (total && total !== '*') return Number(total);
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows.length : 0;
  },
  async lastPostAt(platform, accountId) {
    const c = supabaseClient(); if (!c) throw new Error('Supabase not configured');
    const res = await fetch(
      `${c.base}/post_events?select=created_at&platform=eq.${platform}&account_id=eq.${accountId}&status=eq.posted&order=created_at.desc&limit=1`,
      { headers: c.headers });
    const rows = await res.json().catch(() => []);
    return rows && rows[0] ? rows[0].created_at : null;
  },
};

/* ------------------------------- FACADE ---------------------------------- */

function activeBackend() {
  if (getSetting('coordination_backend') === 'supabase' && supabaseClient()) return supabase;
  return local;
}

// Public async interface. Remote failures degrade to local so a Supabase
// outage never blocks posting on a VA's machine.
async function withFallback(method, args, localFallback) {
  const backend = activeBackend();
  if (backend.id === 'local') return local[method](...args);
  try {
    return await backend[method](...args);
  } catch (e) {
    if (localFallback !== undefined) return localFallback;
    return local[method](...args);
  }
}

module.exports = {
  backendName: () => activeBackend().id,
  acquireLock: (platform, accountId, holder, ttl = 300) => withFallback('acquireLock', [platform, accountId, holder, ttl]),
  releaseLock: (platform, accountId) => withFallback('releaseLock', [platform, accountId]),
  recordEvent: (ev) => withFallback('recordEvent', [ev]),
  countPostsSince: (platform, accountId, sinceIso) => withFallback('countPostsSince', [platform, accountId, sinceIso], 0),
  lastPostAt: (platform, accountId) => withFallback('lastPostAt', [platform, accountId], null),
  // Sync local-only reads for the synchronous IPC eligibility preview.
  localCountPostsSince: local.countPostsSince,
  localLastPostAt: local.lastPostAt,
  async testConnection() {
    const c = supabaseClient();
    if (!c) return { ok: false, error: 'No Supabase URL/key set' };
    try {
      const res = await fetch(`${c.base}/post_events?select=id&limit=1`, { headers: c.headers });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} — check key and that tables exist` };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },
};
