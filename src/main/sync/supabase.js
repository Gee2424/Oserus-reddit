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
  // 'enabled' is the operator's explicit on/off. When baked credentials
  // exist AND the operator has never touched the switch (kv unset),
  // default to ON so the central backend just works after install.
  const explicit = getKv('cloud.enabled');
  const enabled = explicit === null || explicit === undefined
    ? usingBaked
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

async function pushTable(t) {
  const db = getDb();
  const cols = colsFor(t.local);
  if (!cols.length) return 0;
  // Skip tables that don't have the watermark column yet (a TEAM_SHARED
  // table whose ensureUpdatedAtColumns() failed, or hasn't run yet).
  if (!cols.includes(t.watermark)) return 0;
  const wm = getWatermark(t.local);
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT * FROM ${t.local} WHERE ${t.watermark} > ? ORDER BY ${t.watermark} ASC LIMIT 500`
    ).all(wm);
  } catch (e) {
    setError(`push ${t.local}: ${e?.message}`);
    return 0;
  }
  if (!rows.length) return 0;
  const payload = rows.map((r) => rowToPayload(r, cols));
  try {
    const { error } = await state.client.from(t.remote).upsert(payload, { onConflict: t.pk });
    if (error) {
      setError(`push ${t.remote}: ${error.message}`);
      return 0;
    }
    const maxWm = rows[rows.length - 1][t.watermark];
    setWatermark(t.local, Number(maxWm) || 0);
    state.status.pushed += rows.length;
    state.status.lastSyncAt = new Date().toISOString();
    broadcastStatus();
    return rows.length;
  } catch (e) {
    setError(`push ${t.remote}: ${e?.message}`);
    return 0;
  }
}

async function pushLoopTick() {
  if (!state.client) return;
  for (const t of TABLES) {
    await pushTable(t);
  }
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
  try {
    const cols = colsFor(t.local);
    if (!cols.length) return;
    const present = cols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    if (!present.length) return;
    const placeholders = present.map(() => '?').join(', ');
    const values = present.map((c) => {
      const v = row[c];
      if (v === undefined || v === null) return null;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    getDb().prepare(
      `INSERT OR REPLACE INTO ${t.local} (${present.join(', ')}) VALUES (${placeholders})`
    ).run(...values);
    state.status.pulled += 1;
    state.status.lastSyncAt = new Date().toISOString();
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
              getDb().prepare(`DELETE FROM ${t.local} WHERE ${t.pk} = ?`).run(row[t.pk]);
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
  if (!createClient) {
    setError('@supabase/supabase-js not installed');
    return { ok: false, error: 'supabase-js missing' };
  }
  if (state.client) {
    return { ok: true, alreadyRunning: true };
  }
  if (state.starting) return { ok: true, starting: true };
  const cfg = readConfig();
  if (!cfg.url || !cfg.anonKey) {
    setError('missing url or anon key');
    return { ok: false, error: 'Missing credentials' };
  }
  state.starting = true;
  state.userId = ensureUserId();
  state.deviceName = cfg.deviceName;
  try { ensureUpdatedAtColumns(getDb()); }
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
    return { ok: true };
  } catch (e) {
    setError(`start: ${e?.message}`);
    return { ok: false, error: e?.message };
  } finally {
    state.starting = false;
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

module.exports = { start, stop, getStatus, getConfig, setCredentials, testConnection, registerSyncIpc, markDirty };
