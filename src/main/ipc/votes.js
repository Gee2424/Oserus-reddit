const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');
const { log } = require('./activity');

// upvote.biz uses the SMM-panel-standard API: POST form-encoded body to /api/v2
// with key=API_KEY and action=balance|services|add|status. If their base URL
// or shape differs, the only change required is here.
const API_URL = 'https://upvote.biz/api/v1';

function ensureSettingsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function setSetting(key, value) {
  ensureSettingsTable();
  getDb().prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')'
  ).run(key, value);
}

function getSetting(key) {
  ensureSettingsTable();
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

async function call(apiKey, action, extra = {}) {
  const body = new URLSearchParams({ key: apiKey, action, ...extra });
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    // upvote.biz returns plain text in some error states (e.g. account
    // suspended, balance issue) — surface that text as-is.
    throw new Error(text.trim().slice(0, 240) || `HTTP ${res.status} from upvote.biz`);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function ensureOrdersTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS upvote_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_order_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT,
      link TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      charge TEXT,
      currency TEXT,
      status TEXT,
      remains TEXT,
      placed_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked_at TEXT
    );
  `);
}

function register(ipcMain) {
  ipcMain.handle('votes:setApiKey', (_e, { token, apiKey }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (user.role !== 'admin') throw new Error('Admin only');
      setSetting('upvote_api_key', apiKey ? encryptSecret(apiKey) : null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('votes:hasApiKey', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      return { ok: true, hasKey: !!getSetting('upvote_api_key') };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  function getKey() {
    const enc = getSetting('upvote_api_key');
    if (!enc) throw new Error('No upvote.biz API key set. Admin needs to add one under Settings.');
    const key = decryptSecret(enc);
    if (!key) throw new Error('API key could not be decrypted');
    return key;
  }

  ipcMain.handle('votes:balance', async (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const data = await call(getKey(), 'balance');
      return { ok: true, balance: data.balance, currency: data.currency };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('votes:services', async (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const data = await call(getKey(), 'services');
      const list = Array.isArray(data) ? data : (data.services || []);
      const reddit = list.filter((s) => {
        const blob = `${s.name || ''} ${s.category || ''} ${s.type || ''}`.toLowerCase();
        return blob.includes('reddit');
      });
      return { ok: true, services: reddit, all: list };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('votes:order', async (_e, { token, serviceId, serviceName, link, quantity }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Manager or admin only');
      if (!serviceId || !link || !quantity) throw new Error('Service, link, and quantity are required');
      const data = await call(getKey(), 'add', {
        service: String(serviceId),
        link: String(link),
        quantity: String(quantity),
      });
      const remoteId = data.order || data.orderid || data.id;
      if (!remoteId) throw new Error('Order did not return an id');
      ensureOrdersTable();
      getDb().prepare(
        `INSERT INTO upvote_orders (remote_order_id, service_id, service_name, link, quantity, charge, currency, status, placed_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        String(remoteId),
        String(serviceId),
        serviceName || null,
        link,
        Number(quantity),
        data.charge != null ? String(data.charge) : null,
        data.currency || null,
        'pending',
        user.id
      );
      log(user, 'votes.order', 'order', remoteId, `${serviceName || serviceId} qty=${quantity} link=${link}`);
      return { ok: true, orderId: remoteId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('votes:orders', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureOrdersTable();
      const rows = getDb()
        .prepare('SELECT * FROM upvote_orders ORDER BY id DESC LIMIT 200')
        .all();
      return { ok: true, orders: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('votes:refreshStatus', async (_e, { token, orderId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureOrdersTable();
      const row = getDb().prepare('SELECT * FROM upvote_orders WHERE id = ?').get(orderId);
      if (!row) throw new Error('Order not found');
      const data = await call(getKey(), 'status', { order: row.remote_order_id });
      getDb()
        .prepare(
          'UPDATE upvote_orders SET status = ?, charge = ?, currency = ?, remains = ?, last_checked_at = datetime(\'now\') WHERE id = ?'
        )
        .run(
          data.status || row.status,
          data.charge != null ? String(data.charge) : row.charge,
          data.currency || row.currency,
          data.remains != null ? String(data.remains) : row.remains,
          orderId
        );
      return { ok: true, status: data.status, charge: data.charge, remains: data.remains };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
