const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');
const { log } = require('./activity');
const { requirePermission } = require('../permissions');
const { getSetting, setSetting } = require('../services/settings');

// upvote.biz uses the SMM-panel-standard API: POST form-encoded body to /api/v2
// with key=API_KEY and action=balance|services|add|status. If their base URL
// or shape differs, the only change required is here.
const API_URL = 'https://upvote.biz/api/v1';

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
  const db = getDb();
  db.exec(`
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
  // Additive migrations: status responses include start_count; orders can be
  // attributed to a model profile and carry a refill request + its status.
  const cols = db.prepare("PRAGMA table_info(upvote_orders)").all();
  const have = (name) => cols.some((c) => c.name === name);
  if (!have('start_count')) db.exec('ALTER TABLE upvote_orders ADD COLUMN start_count TEXT');
  if (!have('profile_id')) db.exec('ALTER TABLE upvote_orders ADD COLUMN profile_id INTEGER REFERENCES model_profiles(id) ON DELETE SET NULL');
  if (!have('refill_id')) db.exec('ALTER TABLE upvote_orders ADD COLUMN refill_id TEXT');
  if (!have('refill_status')) db.exec('ALTER TABLE upvote_orders ADD COLUMN refill_status TEXT');
}

function register(ipcMain) {
  ipcMain.handle('votes:setApiKey', (_e, { token, apiKey }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.upvotes.admin');
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

  ipcMain.handle('votes:order', async (_e, { token, serviceId, serviceName, link, quantity, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.upvotes.place_order');
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
        `INSERT INTO upvote_orders (remote_order_id, service_id, service_name, link, quantity, charge, currency, status, placed_by_user_id, profile_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        String(remoteId),
        String(serviceId),
        serviceName || null,
        link,
        Number(quantity),
        data.charge != null ? String(data.charge) : null,
        data.currency || null,
        'pending',
        user.id,
        profileId != null ? Number(profileId) : null
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
        .prepare(
          `SELECT o.*, p.name AS profile_name, p.avatar_color AS profile_color,
                  u.display_name AS placed_by_name
           FROM upvote_orders o
           LEFT JOIN model_profiles p ON p.id = o.profile_id
           LEFT JOIN users u ON u.id = o.placed_by_user_id
           ORDER BY o.id DESC LIMIT 200`
        )
        .all();
      return { ok: true, orders: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Single order status by remote_order_id (raw passthrough to upvote.biz).
  // Returns { order, status, charge, start_count, remains, currency } per their docs.
  ipcMain.handle('votes:status', async (_e, { token, remoteOrderId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!remoteOrderId) throw new Error('remoteOrderId is required');
      const data = await call(getKey(), 'status', { order: String(remoteOrderId) });
      return { ok: true, ...data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Multi-order status. upvote.biz returns a map keyed by order id:
  // { "1": { order, status, charge, ... }, "2": { ... } }
  ipcMain.handle('votes:statusMulti', async (_e, { token, remoteOrderIds }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!Array.isArray(remoteOrderIds) || remoteOrderIds.length === 0) {
        throw new Error('remoteOrderIds must be a non-empty array');
      }
      const data = await call(getKey(), 'status', { orders: remoteOrderIds.join(',') });
      // Persist each status update so the table reflects what we just fetched.
      ensureOrdersTable();
      const upd = getDb().prepare(
        "UPDATE upvote_orders SET status = ?, charge = ?, currency = ?, remains = ?, start_count = ?, last_checked_at = datetime('now') WHERE remote_order_id = ?"
      );
      const tx = getDb().transaction((entries) => {
        for (const [id, s] of entries) {
          if (!s || typeof s !== 'object') continue;
          upd.run(
            s.status || null,
            s.charge != null ? String(s.charge) : null,
            s.currency || null,
            s.remains != null ? Number(s.remains) : null,
            s.start_count != null ? Number(s.start_count) : null,
            String(id),
          );
        }
      });
      tx(Object.entries(data || {}));
      return { ok: true, statuses: data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Refill an order. Returns { refill: <refill_id> }.
  ipcMain.handle('votes:refill', async (_e, { token, remoteOrderId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.upvotes.place_order');
      if (!remoteOrderId) throw new Error('remoteOrderId is required');
      const data = await call(getKey(), 'refill', { order_id: String(remoteOrderId) });
      const refillId = data.refill || data.refill_id || data.id;
      if (!refillId) throw new Error('Refill did not return an id');
      ensureOrdersTable();
      getDb()
        .prepare("UPDATE upvote_orders SET refill_id = ?, refill_status = 'Pending' WHERE remote_order_id = ?")
        .run(String(refillId), String(remoteOrderId));
      log(user, 'votes.refill', 'order', remoteOrderId, `refill_id=${refillId}`);
      return { ok: true, refillId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Refill status. Returns { status: "Pending" | "Completed" | ... }.
  ipcMain.handle('votes:refillStatus', async (_e, { token, refillId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!refillId) throw new Error('refillId is required');
      const data = await call(getKey(), 'refill_status', { refill: String(refillId) });
      ensureOrdersTable();
      getDb()
        .prepare('UPDATE upvote_orders SET refill_status = ? WHERE refill_id = ?')
        .run(data.status || null, String(refillId));
      return { ok: true, status: data.status };
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
          "UPDATE upvote_orders SET status = ?, charge = ?, currency = ?, remains = ?, start_count = ?, last_checked_at = datetime('now') WHERE id = ?"
        )
        .run(
          data.status || row.status,
          data.charge != null ? String(data.charge) : row.charge,
          data.currency || row.currency,
          data.remains != null ? String(data.remains) : row.remains,
          data.start_count != null ? String(data.start_count) : row.start_count,
          orderId
        );
      return { ok: true, status: data.status, charge: data.charge, remains: data.remains, start_count: data.start_count };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
