const elog = require('electron-log');
const os = require('os');
const crypto = require('crypto');
const { BrowserWindow } = require('electron');
const { getDb, getKv, setKv } = require('../db');
const defaultBackend = require('./defaultBackend');
const { getAnonClient, getAuthClient } = require('../supabaseClient');

const TABLES = [
  'teams', 'team_members', 'account_assignments', 'machine_sessions', 'post_locks',
  'reddit_accounts', 'model_profiles', 'proxies', 'post_events', 'activity_log',
  'scheduled_posts', 'content_sources', 'docs',
];

const PRESENCE_CHANNEL = 'oserus:presence';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 15000;

const state = {
  client: null,
  channel: null,
  refreshTimer: null,
  heartbeatTimer: null,
  starting: false,
  accessToken: null,
  authClient: null,
  status: {
    connected: false,
    lastSyncAt: null,
    lastError: null,
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

function readConfig() {
  const override = {
    url: getKv('cloud.supabase.url') || '',
    anonKey: getKv('cloud.supabase.anon_key') || '',
  };
  const usingBaked = !override.url && !override.anonKey && defaultBackend.hasBakedBackend();
  const url = override.url || defaultBackend.SUPABASE_URL || '';
  const anonKey = override.anonKey || defaultBackend.SUPABASE_ANON_KEY || '';
  const explicit = getKv('cloud.enabled');
  const enabled = usingBaked ? true : explicit === '1';
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
  } catch { return []; }
}

function applyRemoteRow(table, row) {
  if (!row) return;
  const db = getDb();
  try {
    const localCols = colsFor(table);
    if (!localCols.length) return;
    const present = localCols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
    if (!present.length) return;

    const pkCols = ['id'];
    const updateCols = present.filter((c) => !pkCols.includes(c));
    if (!updateCols.length) return;

    const placeholders = present.map(() => '?').join(', ');
    const values = present.map((c) => {
      const v = row[c];
      return (v === undefined || v === null) ? null : v;
    });

    const updateClause = updateCols.map((c) => `${c}=excluded.${c}`).join(', ');
    const sql = `INSERT INTO ${table} (${present.join(', ')})
                 VALUES (${placeholders})
                 ON CONFLICT(${pkCols.join(',')}) DO UPDATE SET ${updateClause}`;
    db.prepare(sql).run(...values);

    state.status.pulled += 1;
    state.status.lastSyncAt = new Date().toISOString();
    broadcastStatus();
  } catch (e) {
    setError(`apply ${table}: ${e?.message}`);
  }
}

function subscribeRealtime(client) {
  if (!client) return;
  for (const table of TABLES) {
    try {
      client
        .channel(`oserus:db:${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          const row = payload.new || payload.old;
          if (payload.eventType === 'DELETE') {
            try {
              getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(row?.id);
            } catch {}
            broadcastDataChanged(table, 'DELETE', row);
            return;
          }
          applyRemoteRow(table, row);
          broadcastDataChanged(table, payload.eventType, row);
        })
        .subscribe();
    } catch (e) {
      setError(`subscribe ${table}: ${e?.message}`);
    }
  }
}

function broadcastDataChanged(table, eventType, row) {
  try {
    const payload = { table, eventType, id: row && (row.id ?? row.key) };
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('cloud:dataChanged', payload); } catch {}
    }
  } catch {}
}

function joinPresence(client, cfg, username) {
  state.channel = client.channel(PRESENCE_CHANNEL, {
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
        peers.push({ deviceName: m.deviceName || 'unknown', userId: m.userId || k, lastSeen: m.online_at || null });
      }
      state.status.peers = peers;
      broadcastStatus();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await state.channel.track({
            userId: state.userId, deviceName: state.deviceName, username: username || null,
            app_version: state.appVersion, online_at: new Date().toISOString(),
          });
          setConnected(true);
        } catch (e) {
          setError(`presence track: ${e?.message}`);
        }
      }
    });
}

function populateCache() {
  const db = getDb();
  const client = state.client;
  if (!client) return;

  const localCache = [
    { local: 'teams', remote: 'teams' },
    { local: 'model_profiles', remote: 'model_profiles' },
    { local: 'proxies', remote: 'proxies' },
    { local: 'content_sources', remote: 'content_sources' },
    { local: 'docs', remote: 'docs' },
    { local: 'settings', remote: 'settings' },
  ];

  for (const t of localCache) {
    try {
      client.from(t.remote).select('*').limit(2000).then(({ data, error }) => {
        if (error || !data) return;
        const localCols = colsFor(t.local);
        if (!localCols.length) return;
        for (const row of data) {
          const present = localCols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
          if (!present.length) continue;
          const placeholders = present.map(() => '?').join(', ');
          const values = present.map((c) => (row[c] === undefined || row[c] === null) ? null : row[c]);
          const pkCols = ['id'];
          const updateCols = present.filter((c) => !pkCols.includes(c));
          const updateClause = updateCols.map((c) => `${c}=excluded.${c}`).join(', ');
          const sql = `INSERT INTO ${t.local} (${present.join(', ')})
                       VALUES (${placeholders})
                       ON CONFLICT(${pkCols.join(',')}) DO UPDATE SET ${updateClause}`;
          try { db.prepare(sql).run(...values); } catch {}
        }
      }).catch(() => {});
    } catch {}
  }
}

async function start(config) {
  elog.info('[cloud] start() called');
  const cfg = config || readConfig();
  if (!cfg.url || !cfg.anonKey) {
    setError('missing url or anon key');
    return { ok: false, error: 'Missing credentials' };
  }

  state.starting = true;
  state.userId = ensureUserId();
  state.deviceName = cfg.deviceName;

  try {
    const { app } = require('electron');
    state.appVersion = app.getVersion();
  } catch { state.appVersion = 'unknown'; }

  try {
    const client = getAnonClient();
    if (!client) throw new Error('Failed to create Supabase client');
    state.client = client;

    subscribeRealtime(client);
    joinPresence(client, cfg, null);

    state.status.lastError = null;

    setTimeout(() => {
      populateCache();
    }, 1000);

    state.refreshTimer = setInterval(() => {
      populateCache();
    }, REFRESH_INTERVAL_MS);

    state.heartbeatTimer = setInterval(async () => {
      if (!state.channel) return;
      try {
        await state.channel.track({
          userId: state.userId, deviceName: state.deviceName,
          app_version: state.appVersion, online_at: new Date().toISOString(),
        });
      } catch (e) {
        setError(`heartbeat: ${e?.message}`);
      }
    }, HEARTBEAT_MS);

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
    if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
    if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
    if (state.channel) {
      try { await state.channel.unsubscribe(); } catch {}
      state.channel = null;
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
  try {
    const { createClient } = require('@supabase/supabase-js');
    if (!url || !anonKey) return { ok: false, error: 'Missing url or anon key' };
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error } = await client.from('activity_log').select('id').limit(1);
    if (error) {
      const msg = error.message || String(error);
      if (/does not exist|schema cache|relation/i.test(msg)) {
        return { ok: false, error: 'Required tables missing on Supabase. Run the setup SQL first.' };
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Unknown error' };
  }
}

function isRunning() { return !!state.client; }

function setAccessToken(token) {
  state.accessToken = token;
  if (state.authClient) {
    try { state.authClient.removeAllChannels(); } catch {}
    state.authClient = null;
  }
  if (token) {
    state.authClient = getAuthClient(token);
    if (state.authClient) {
      subscribeRealtime(state.authClient);
      elog.info('[cloud] Rewired realtime to auth client');
    }
  }
}

module.exports = { start, stop, getStatus, getConfig, setCredentials, testConnection, isRunning, populateCache, setAccessToken };
