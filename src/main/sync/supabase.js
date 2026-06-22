const elog = require('electron-log');
const os = require('os');
const crypto = require('crypto');
const { BrowserWindow } = require('electron');
const { getDb, getKv, setKv } = require('../db');
const defaultBackend = require('./defaultBackend');
const { ALL_TABLES, ensureUpdatedAtColumns } = require('./syncSchema');

// `ws` shim for Supabase Realtime. Electron 32 ships Node 20, which
// (until 22) has no global WebSocket — supabase-realtime crashes with
// "Node.js 20 detected without native WebSocket support" if we don't
// hand it one. Require lazily so the rest of the module still loads
// in environments where ws couldn't install (we'll just skip realtime).
let WS = null;
try { WS = require('ws'); } catch (e) { elog.warn('[cloud] ws not installed:', e?.message); }

let createClient = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (e) {
  elog.warn('[cloud] @supabase/supabase-js not installed:', e?.message);
}

const TABLES = ALL_TABLES;

const PRESENCE_CHANNEL = 'oserus:presence';
// Tight push tick so a save on one machine reaches the others in ~1
// realtime round-trip + this interval. Remote pulls arrive instantly via
// the Realtime websocket — the push tick is only the upload side, and
// markDirty() can prod it sooner when an IPC handler knows it just wrote.
const PUSH_INTERVAL_MS = 1500;
const HEARTBEAT_MS = 15000;

const state = {
  client: null,
  channel: null,
  pushTimer: null,
  heartbeatTimer: null,
  starting: false,
  status: {
    connected: false,
    lastSyncAt: null,
    lastError: null,
    pushed: 0,
    pulled: 0,
    peers: [],
    // Per-table rollup so the Settings panel can show exactly which
    // tables move vs which silently fail. Keyed by local table name.
    // Each entry: { pushed, pulled, lastPushAt, lastPullAt,
    //   lastError, watermark, ok }. The previous single lastError
    //   field would clobber the most-recent error from any table on
    //   top of any prior, masking which table was actually broken.
    perTable: {},
  },
  userId: null,
  deviceName: null,
  appVersion: null,
};

function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length <= 8) return '*'.repeat(s.length);
  return '*'.repeat(Math.max(0, s.length - 8)) + s.slice(-8);
}

// Read order for URL + anon key: per-install override → baked-in
// defaults from src/main/sync/defaultBackend.js. When the build ships
// with baked credentials, every install auto-connects to the same
// Supabase project — the admin doesn't have to email each operator the
// URL + key. Local overrides via Settings still work for testing or
// when an operator needs to point at a staging project.
function readConfig() {
  const override = {
    url: getKv('cloud.supabase.url') || '',
    anonKey: getKv('cloud.supabase.anon_key') || '',
  };
  const usingBaked = !override.url && !override.anonKey && defaultBackend.hasBakedBackend();
  const url = override.url || defaultBackend.SUPABASE_URL || '';
  const anonKey = override.anonKey || defaultBackend.SUPABASE_ANON_KEY || '';
  // Two enable triggers:
  //   1. usingBaked → always on (build shipped with credentials,
  //      that's the central-backend contract).
  //   2. operator explicitly opted in via cloud.enabled='1' (set
  //      by Save-and-connect in Settings).
  // Older builds that shipped an empty SUPABASE_ANON_KEY may have
  // written cloud.enabled='0' as a side-effect of the operator
  // touching the Disconnect button when nothing was even configured.
  // We deliberately ignore that stale '0' when the current build has
  // baked credentials — otherwise central sync stays off forever for
  // every operator who poked the panel before the key got pasted.
  const explicit = getKv('cloud.enabled');
  const enabled = usingBaked
    ? true
    : explicit === '1';
  return {
    url, anonKey,
    deviceName: getKv('cloud.device.name') || os.hostname() || 'device',
    enabled,
    source: usingBaked ? 'baked' : (override.url ? 'override' : 'none'),
  };
}

function ensureUserId() {
  let id = getKv('cloud.device.user_id');
  if (!id) {
    id = crypto.randomUUID();
    setKv('cloud.device.user_id', id);
  }
  return id;
}

function broadcastStatus() {
  try {
    const payload = getStatus();
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('cloud:status', payload); } catch {}
    }
  } catch {}
}

function setError(msg) {
  state.status.lastError = msg ? String(msg) : null;
  if (msg) elog.warn('[cloud]', msg);
  broadcastStatus();
}

function setConnected(connected) {
  if (state.status.connected !== connected) {
    state.status.connected = connected;
    broadcastStatus();
  }
}

function colsFor(table) {
  try {
    return getDb().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  } catch {
    return [];
  }
}

function rowToPayload(row, cols) {
  const out = {};
  for (const c of cols) {
    const v = row[c];
    if (v instanceof Date) out[c] = v.toISOString();
    else if (typeof v === 'bigint') out[c] = Number(v);
    else out[c] = v == null ? null : v;
  }
  return out;
}

function getWatermark(table) {
  const v = getKv(`cloud.watermark.${table}`);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function setWatermark(table, n) {
  setKv(`cloud.watermark.${table}`, String(n));
}

function getOrCreateTableStatus(table) {
  if (!state.status.perTable[table]) {
    state.status.perTable[table] = {
      pushed: 0, pulled: 0,
      lastPushAt: null, lastPullAt: null,
      lastError: null, watermark: 0, ok: null,
    };
  }
  return state.status.perTable[table];
}

function recordTableError(table, message) {
  const ts = getOrCreateTableStatus(table);
  ts.lastError = String(message || 'unknown error');
  ts.ok = false;
  // Also bubble to the top-level lastError so the pill in the header
  // shows SOMETHING — but the perTable map is the source of truth for
  // diagnostics.
  setError(`${table}: ${message}`);
}

async function pushTable(t) {
  const db = getDb();
  const ts = getOrCreateTableStatus(t.local);
  const cols = colsFor(t.local);
  if (!cols.length) {
    recordTableError(t.local, 'local table missing');
    return 0;
  }
  // Skip tables that don't have the watermark column yet (a TEAM_SHARED
  // table whose ensureUpdatedAtColumns() failed, or hasn't run yet).
  if (!cols.includes(t.watermark)) {
    recordTableError(t.local, `watermark column "${t.watermark}" not present locally — run ensureUpdatedAtColumns`);
    return 0;
  }
  const wm = getWatermark(t.local);
  ts.watermark = wm;
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT * FROM ${t.local} WHERE ${t.watermark} > ? ORDER BY ${t.watermark} ASC LIMIT 500`
    ).all(wm);
  } catch (e) {
    recordTableError(t.local, `select: ${e?.message}`);
    return 0;
  }
  if (!rows.length) {
    // Nothing to push isn't an error — clear any stale error and mark ok.
    if (ts.ok !== true) { ts.lastError = null; ts.ok = true; }
    return 0;
  }
  const payload = rows.map((r) => rowToPayload(r, cols));
  try {
    const { error } = await state.client.from(t.remote).upsert(payload, { onConflict: t.pk });
    if (error) {
      recordTableError(t.local, `upsert: ${error.message}`);
      return 0;
    }
    const maxWm = rows[rows.length - 1][t.watermark];
    setWatermark(t.local, Number(maxWm) || 0);
    ts.watermark = Number(maxWm) || 0;
    ts.pushed += rows.length;
    ts.lastPushAt = new Date().toISOString();
    ts.lastError = null;
    ts.ok = true;
    state.status.pushed += rows.length;
    state.status.lastSyncAt = new Date().toISOString();
    broadcastStatus();
    return rows.length;
  } catch (e) {
    recordTableError(t.local, `upsert threw: ${e?.message}`);
    return 0;
  }
}

async function pushLoopTick() {
  if (!state.client) return;
  for (const t of TABLES) {
    await pushTable(t);
  }
}

// Manual "push everything now" — used by the diagnostics button in
// Settings → Cloud Sync. Returns a per-table summary so the renderer
// can paint each table's status without waiting for the next 1.5s
// timer tick.
async function pushNow() {
  if (!state.client) return { ok: false, error: 'sync is not running' };
  // Reset per-table state so any "no rows since" entries get re-evaluated.
  await pushLoopTick();
  return { ok: true, tables: tableDiagnostics() };
}

// Force a full re-sync of every TEAM_SHARED row. Wipes our watermark
// KVs back to 0 AND bumps every row's updated_at to "now + rowid" so
// the next push picks up everything regardless of whether the prior
// push thought it had already shipped it. The user-visible escape
// hatch for "I have data on machine A that never made it to Supabase
// even though sync says it's connected." Idempotent — running twice
// just re-sends the same data.
async function forceResync() {
  if (!state.client) return { ok: false, error: 'sync is not running' };
  const db = getDb();
  let bumped = 0;
  for (const t of TABLES) {
    if (t.watermark !== 'updated_at') continue;
    try { setKv(`cloud.watermark.${t.local}`, '0'); } catch {}
    try {
      const res = db.prepare(
        `UPDATE ${t.local} SET updated_at = CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER) + rowid`
      ).run();
      bumped += res.changes || 0;
    } catch (e) {
      elog.warn(`[cloud] forceResync bump ${t.local} failed:`, e?.message);
    }
  }
  await pushLoopTick();
  return { ok: true, bumped, tables: tableDiagnostics() };
}

// Initial-pull helper. Used by the "Pull everything now" diagnostics
// button. For each TEAM_SHARED table, query every row from Supabase
// and run it through applyRemoteRow — same code path as the realtime
// stream. Useful for a fresh install joining an existing project.
async function pullAll() {
  if (!state.client) return { ok: false, error: 'sync is not running' };
  for (const t of TABLES) {
    const ts = getOrCreateTableStatus(t.local);
    try {
      const { data, error } = await state.client.from(t.remote).select('*').limit(2000);
      if (error) { recordTableError(t.local, `pull: ${error.message}`); continue; }
      for (const row of (data || [])) applyRemoteRow(t, row);
      ts.lastPullAt = new Date().toISOString();
      if (ts.ok !== false) ts.ok = true;
    } catch (e) {
      recordTableError(t.local, `pull threw: ${e?.message}`);
    }
  }
  return { ok: true, tables: tableDiagnostics() };
}

function tableDiagnostics() {
  // Always include every TABLES entry so the UI can paint rows that
  // haven't ticked yet (otherwise tables with no recent activity look
  // like they don't exist).
  return TABLES.map((t) => {
    const ts = state.status.perTable[t.local] || { pushed: 0, pulled: 0, lastPushAt: null, lastPullAt: null, lastError: null, watermark: 0, ok: null };
    return {
      table: t.local,
      remote: t.remote,
      pk: t.pk,
      watermark: ts.watermark,
      pushed: ts.pushed, pulled: ts.pulled,
      lastPushAt: ts.lastPushAt, lastPullAt: ts.lastPullAt,
      lastError: ts.lastError,
      ok: ts.ok,
    };
  });
}

// Prods the push loop without waiting for the timer. Call from IPC
// handlers right after a local mutation so the change reaches Supabase
// (and other operators) within a few hundred ms.
let dirtyTimer = null;
function markDirty() {
  if (!state.client) return;
  if (dirtyTimer) return;
  dirtyTimer = setTimeout(() => {
    dirtyTimer = null;
    pushLoopTick().catch((e) => setError(`dirty push: ${e?.message}`));
  }, 250);
}

function broadcastDataChanged(table, eventType, row) {
  try {
    const payload = { table, eventType, id: row && (row.id ?? row.key) };
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('cloud:dataChanged', payload); } catch {}
    }
  } catch {}
}

function applyRemoteRow(t, row) {
  if (!row) return;
  const db = getDb();
  try {
    // Begin transaction for atomicity
    db.exec('BEGIN TRANSACTION');

    const cols = colsFor(t.local);
    if (!cols.length) {
      db.exec('ROLLBACK');
      return;
    }

    const present = cols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    if (!present.length) {
      db.exec('ROLLBACK');
      return;
    }

    // Validate that primary key columns are present
    const pkCols = t.pk.split(',').map((s) => s.trim());
    const missingPk = pkCols.filter((c) => !present.includes(c));
    if (missingPk.length > 0) {
      elog.warn(`[cloud] Missing primary key columns for ${t.local}: ${missingPk.join(', ')}`);
      db.exec('ROLLBACK');
      return;
    }

    // Validate that required columns are present (if specified)
    const required = t.required || [];
    const missing = required.filter((c) => !present.includes(c));
    if (missing.length > 0) {
      elog.warn(`[cloud] Missing required columns for ${t.local}: ${missing.join(', ')}`);
      db.exec('ROLLBACK');
      return;
    }

    const placeholders = present.map(() => '?').join(', ');
    const values = present.map((c) => {
      const v = row[c];
      if (v === undefined || v === null) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });

    // Build safe upsert using ON CONFLICT DO UPDATE
    // This preserves existing data instead of replacing the entire row
    const updateCols = present.filter((c) => !pkCols.includes(c));
    const updateClause = updateCols.map((c) => `${c}=excluded.${c}`).join(', ');

    const sql = `INSERT INTO ${t.local} (${present.join(', ')})
                 VALUES (${placeholders})
                 ON CONFLICT(${t.pk}) DO UPDATE SET
                   ${updateClause}`;

    db.prepare(sql).run(...values);
    db.exec('COMMIT');

    state.status.pulled += 1;
    state.status.lastSyncAt = new Date().toISOString();
    const ts = getOrCreateTableStatus(t.local);
    ts.pulled += 1;
    ts.lastPullAt = new Date().toISOString();
    ts.lastError = null;
    ts.ok = true;
    // Advance our watermark past whatever just arrived so we don't try
    // to push it back out as if it were our own write.
    const wmValue = row[t.watermark];
    if (wmValue != null && Number.isFinite(Number(wmValue))) {
      const wm = getWatermark(t.local);
      const n = Number(wmValue);
      if (n > wm) setWatermark(t.local, n);
    }
    broadcastStatus();
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    setError(`apply ${t.local}: ${e?.message}`);
  }
}

function subscribeRealtime() {
  for (const t of TABLES) {
    try {
      state.client
        .channel(`oserus:db:${t.remote}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: t.remote }, (payload) => {
          const row = payload.new || payload.old;
          if (payload.eventType === 'DELETE') {
            try {
              // PK may be composite — split on comma. role_permissions
              // uses (role_key, perm_key); supabase-js sends both
              // values in payload.old, so a multi-column WHERE clause
              // is required to find and delete the right row.
              const pkCols = t.pk.split(',').map((s) => s.trim());
              const where  = pkCols.map((c) => `${c} = ?`).join(' AND ');
              const params = pkCols.map((c) => row[c]);
              getDb().prepare(`DELETE FROM ${t.local} WHERE ${where}`).run(...params);
              broadcastStatus();
              broadcastDataChanged(t.local, 'DELETE', row);
            } catch (e) {
              setError(`delete ${t.local}: ${e?.message}`);
            }
            return;
          }
          applyRemoteRow(t, row);
          broadcastDataChanged(t.local, payload.eventType, row);
        })
        .subscribe();
    } catch (e) {
      setError(`subscribe ${t.remote}: ${e?.message}`);
    }
  }
}

function joinPresence(cfg, username) {
  state.channel = state.client.channel(PRESENCE_CHANNEL, {
    config: { presence: { key: state.userId } },
  });
  state.channel
    .on('presence', { event: 'sync' }, () => {
      const presenceState = state.channel.presenceState();
      const peers = [];
      for (const k of Object.keys(presenceState)) {
        const metas = presenceState[k];
        if (!metas || !metas.length) continue;
        const m = metas[metas.length - 1];
        peers.push({
          deviceName: m.deviceName || 'unknown',
          userId: m.userId || k,
          lastSeen: m.online_at || null,
        });
      }
      state.status.peers = peers;
      broadcastStatus();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await state.channel.track({
            userId: state.userId,
            deviceName: state.deviceName,
            username: username || null,
            app_version: state.appVersion,
            online_at: new Date().toISOString(),
          });
          setConnected(true);
        } catch (e) {
          setError(`presence track: ${e?.message}`);
        }
      }
    });
}

async function start() {
  elog.info('[cloud] start() called. createClient=', !!createClient, 'client=', !!state.client, 'starting=', state.starting);
  if (!createClient) {
    setError('@supabase/supabase-js not installed');
    return { ok: false, error: 'supabase-js missing' };
  }
  if (state.client) {
    elog.info('[cloud] start() skipped — already running');
    return { ok: true, alreadyRunning: true };
  }
  if (state.starting) return { ok: true, starting: true };
  const cfg = readConfig();
  elog.info('[cloud] config: source=', cfg.source, 'enabled=', cfg.enabled, 'url=', cfg.url, 'key=', cfg.anonKey ? cfg.anonKey.slice(0, 18) + '…' : '(empty)');
  if (!cfg.url || !cfg.anonKey) {
    setError('missing url or anon key');
    elog.warn('[cloud] start() bailed — missing credentials');
    return { ok: false, error: 'Missing credentials' };
  }
  state.starting = true;
  state.userId = ensureUserId();
  state.deviceName = cfg.deviceName;
  try { ensureUpdatedAtColumns(getDb()); elog.info('[cloud] ensureUpdatedAtColumns OK'); }
  catch (e) { elog.warn('[cloud] ensureUpdatedAtColumns failed:', e?.message); }
  try {
    const { app } = require('electron');
    state.appVersion = app.getVersion();
  } catch { state.appVersion = 'unknown'; }
  try {
    state.client = createClient(cfg.url, cfg.anonKey, {
      // Node 20 (Electron 32) has no native WebSocket. Hand realtime a
      // 'ws' instance or every channel subscribe fails out of the gate.
      realtime: {
        params: { eventsPerSecond: 5 },
        ...(WS ? { transport: WS } : {}),
      },
      auth: { persistSession: false },
    });
    subscribeRealtime();
    joinPresence(cfg, null);
    state.pushTimer = setInterval(() => {
      pushLoopTick().catch((e) => setError(`push loop: ${e?.message}`));
    }, PUSH_INTERVAL_MS);
    state.heartbeatTimer = setInterval(async () => {
      if (!state.channel) return;
      try {
        await state.channel.track({
          userId: state.userId,
          deviceName: state.deviceName,
          app_version: state.appVersion,
          online_at: new Date().toISOString(),
        });
      } catch (e) {
        setError(`heartbeat: ${e?.message}`);
      }
    }, HEARTBEAT_MS);
    state.status.lastError = null;
    elog.info('[cloud] started');

    // Automatic first-launch behaviour. Two things have to happen
    // exactly once per install, and neither should require the operator
    // to click anything:
    //
    //   1. First time the local install ever connected to Supabase
    //      (cloud.first_sync_done unset) → pullAll() so a freshly-
    //      installed machine inherits whatever the team has already
    //      pushed. Without this the operator on a new PC sees an empty
    //      Models page and has to know to click "Pull all" to fix it.
    //
    //   2. The app version changed since the last successful sync
    //      (cloud.last_synced_version != current). Forces every local
    //      row's updated_at forward so the next push tick covers
    //      everything, even rows whose updated_at was set by an older
    //      build before sync was wired up. Without this, an upgrader
    //      with pre-existing data has the data sit locally forever
    //      because its updated_at is older than the current watermark.
    //
    // Both run in the background so start() returns immediately. Errors
    // surface in the per-table diagnostic — they don't block startup.
    setTimeout(() => { autoBootstrap().catch(() => {}); }, 1000);

    return { ok: true };
  } catch (e) {
    setError(`start: ${e?.message}`);
    return { ok: false, error: e?.message };
  } finally {
    state.starting = false;
  }
}

async function autoBootstrap() {
  const currentVer = state.appVersion || 'unknown';
  const lastSyncedVer = getKv('cloud.last_synced_version');
  const firstSyncDone = getKv('cloud.first_sync_done') === '1';

  // (1) First sync ever — pull everything from Supabase. Run before
  // push so we don't immediately race the watermark forward and miss
  // remote rows whose updated_at is older than our backfill timestamp.
  if (!firstSyncDone) {
    try {
      elog.info('[cloud] autoBootstrap: first sync — running pullAll()');
      await pullAll();
      setKv('cloud.first_sync_done', '1');
    } catch (e) {
      elog.warn('[cloud] autoBootstrap pullAll failed:', e?.message);
    }
  }

  // (2) Version changed — force-bump every row so a fresh push covers
  // any data that older builds left at a stale watermark.
  if (lastSyncedVer !== currentVer) {
    try {
      elog.info('[cloud] autoBootstrap: version', lastSyncedVer || '(none)', '→', currentVer, '— running forceResync()');
      await forceResync();
      setKv('cloud.last_synced_version', currentVer);
    } catch (e) {
      elog.warn('[cloud] autoBootstrap forceResync failed:', e?.message);
    }
  }
}

async function stop() {
  try {
    if (state.pushTimer) { clearInterval(state.pushTimer); state.pushTimer = null; }
    if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
    if (state.channel) {
      try { await state.channel.unsubscribe(); } catch {}
      state.channel = null;
    }
    if (state.client) {
      try { await state.client.removeAllChannels(); } catch {}
      state.client = null;
    }
    setConnected(false);
    state.status.peers = [];
    broadcastStatus();
    elog.info('[cloud] stopped');
    return { ok: true };
  } catch (e) {
    setError(`stop: ${e?.message}`);
    return { ok: false, error: e?.message };
  }
}

function getStatus() {
  return {
    connected: state.status.connected,
    lastSyncAt: state.status.lastSyncAt,
    lastError: state.status.lastError,
    pushed: state.status.pushed,
    pulled: state.status.pulled,
    peers: state.status.peers.slice(),
  };
}

function getConfig() {
  const cfg = readConfig();
  return {
    url: cfg.url,
    anonKey: cfg.anonKey ? maskKey(cfg.anonKey) : '',
    deviceName: cfg.deviceName,
    enabled: cfg.enabled,
    source: cfg.source,
    hasBaked: defaultBackend.hasBakedBackend(),
  };
}

async function setCredentials({ url, anonKey, deviceName, enabled } = {}) {
  if (url != null) setKv('cloud.supabase.url', String(url || ''));
  if (anonKey != null && anonKey !== '' && !/^\*+/.test(String(anonKey))) {
    setKv('cloud.supabase.anon_key', String(anonKey));
  }
  if (deviceName != null) setKv('cloud.device.name', String(deviceName || ''));
  if (enabled != null) setKv('cloud.enabled', enabled ? '1' : '0');
  if (state.client) {
    await stop();
  }
  const cfg = readConfig();
  if (cfg.enabled && cfg.url && cfg.anonKey) {
    return start();
  }
  return { ok: true };
}

async function testConnection({ url, anonKey } = {}) {
  if (!createClient) return { ok: false, error: '@supabase/supabase-js not installed' };
  if (!url || !anonKey) return { ok: false, error: 'Missing url or anon key' };
  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false },
      realtime: { ...(WS ? { transport: WS } : {}) },
    });
    const { error } = await client.from('activity_log').select('id').limit(1);
    if (error) {
      const msg = error.message || String(error);
      if (/does not exist|schema cache|relation/i.test(msg)) {
        return { ok: false, error: 'Required tables missing on Supabase. Run the setup SQL from "Copy setup SQL" first.' };
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Unknown error' };
  }
}

function registerSyncIpc() {}

function isRunning() { return !!state.client; }

// Self-diagnosis. Hits every checkpoint that could be silently
// blocking sync, returns a copy-pasteable multi-line text block, and
// runs a live round-trip against Supabase using a probe row. The
// output is exhaustive on purpose — if any line says "FAIL" we know
// exactly which step to fix instead of guessing through screenshots.
async function probe() {
  const lines = [];
  const tag = (k, v) => lines.push(`${k.padEnd(28)} : ${v}`);

  // --- version + build info ----------------------------------------
  let appVer = state.appVersion;
  try {
    if (!appVer) appVer = require('electron').app.getVersion();
  } catch {}
  tag('app version', appVer || '(unknown)');
  tag('node version', process.versions.node);
  let sbVer = '(unknown)';
  try { sbVer = require('@supabase/supabase-js/package.json').version; } catch {}
  tag('supabase-js version', sbVer);

  // --- config ------------------------------------------------------
  const cfg = readConfig();
  tag('config source', cfg.source);
  tag('config enabled', cfg.enabled);
  tag('config url', cfg.url || '(empty)');
  tag('config anon key', cfg.anonKey ? `${cfg.anonKey.slice(0, 18)}…(${cfg.anonKey.length} chars)` : '(empty)');
  tag('device name', cfg.deviceName);

  // --- runtime state ----------------------------------------------
  tag('client created', !!state.client);
  tag('starting', state.starting);
  tag('push timer', !!state.pushTimer);
  tag('presence channel', !!state.channel);
  tag('peers online', Array.isArray(state.status.peers) ? state.status.peers.length : 0);
  tag('last global error', state.status.lastError || '(none)');

  // --- live round-trip --------------------------------------------
  if (!state.client) {
    tag('round-trip', 'SKIP — client is not initialized');
    return { ok: true, text: lines.join('\n') };
  }
  // 1. Select 1 row from model_profiles to see if the table even
  //    exists remotely.
  try {
    const r = await state.client.from('model_profiles').select('id', { count: 'exact', head: true });
    if (r.error) tag('remote model_profiles', `FAIL — ${r.error.message}`);
    else tag('remote model_profiles', `OK (${r.count ?? '?'} rows on the server)`);
  } catch (e) {
    tag('remote model_profiles', `THROW — ${e?.message}`);
  }
  // 2. Same for users.
  try {
    const r = await state.client.from('users').select('id', { count: 'exact', head: true });
    if (r.error) tag('remote users', `FAIL — ${r.error.message}`);
    else tag('remote users', `OK (${r.count ?? '?'} rows on the server)`);
  } catch (e) {
    tag('remote users', `THROW — ${e?.message}`);
  }
  // 3. Probe push — write a heartbeat row to settings (which is the
  //    simplest schema: key/value/updated_at) so we can confirm
  //    auth + RLS allow writes.
  try {
    const key = `cloud.probe.${state.userId || 'anon'}`;
    const r = await state.client.from('settings').upsert(
      [{ key, value: new Date().toISOString(), updated_at: Date.now() }],
      { onConflict: 'key' }
    );
    if (r.error) tag('probe write', `FAIL — ${r.error.message}`);
    else tag('probe write', 'OK — write to settings succeeded');
  } catch (e) {
    tag('probe write', `THROW — ${e?.message}`);
  }
  // 4. Local row counts on the highest-priority tables. Tells us if
  //    we actually have data to send.
  try {
    const db = getDb();
    for (const tbl of ['users','model_profiles','reddit_accounts','roles']) {
      try {
        const c = db.prepare(`SELECT COUNT(*) AS c FROM ${tbl}`).get();
        tag(`local ${tbl} rows`, c.c);
      } catch { tag(`local ${tbl} rows`, 'TABLE MISSING'); }
    }
  } catch (e) {
    tag('local counts', `THROW — ${e?.message}`);
  }
  return { ok: true, text: lines.join('\n') };
}

module.exports = { start, stop, getStatus, getConfig, setCredentials, testConnection, registerSyncIpc, markDirty, pushNow, pullAll, forceResync, tableDiagnostics, isRunning, probe };
