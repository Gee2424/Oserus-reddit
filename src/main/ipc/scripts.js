// Scripts — named content "Sets" per model, made of ordered "Steps" (one
// photo/video + its message text each). Chatters open a Set from Inbox and
// send Steps in order during a chat so content stays consistent across
// chatters on the same model. A Set belongs to one model, same as a linked
// account — access follows the same profile_assignments gate accounts use.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { userFromToken } = require('./auth');
const { getDb } = require('../db');
const { hasPermission, requirePermission } = require('../permissions');
const { canAccessProfile } = require('../lib/assignments');

function assertCanUse(user, profileId) {
  if (hasPermission(user, 'scripts.manage')) return;
  requirePermission(user, 'scripts.use');
  if (!canAccessProfile(user, profileId)) throw new Error('Not authorized for this model');
}

function mediaDir(setId) {
  const dir = path.join(app.getPath('userData'), 'content_set_media', String(setId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSetOr404(id) {
  const set = getDb().prepare('SELECT * FROM content_sets WHERE id = ?').get(id);
  if (!set) throw new Error('Set not found');
  return set;
}

// Shared by the ipcMain routes below AND the Browser side panel's mini
// Scripts viewer (browser.js), so both read Sets the same way.
function listSetsForUser(user, { profileId } = {}) {
  if (!user) throw new Error('Not authenticated');
  const db = getDb();
  if (profileId) {
    assertCanUse(user, profileId);
    return db.prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM content_set_steps st WHERE st.set_id = s.id) AS step_count
       FROM content_sets s WHERE s.profile_id = ? ORDER BY s.updated_at DESC`
    ).all(profileId);
  }
  // No model given — return Sets across every model this user can use,
  // filtered in JS since canAccessProfile isn't a SQL-friendly clause for
  // arbitrary custom roles here (list is small: sets, not accounts).
  const all = db.prepare(
    `SELECT s.*, p.name AS profile_name,
            (SELECT COUNT(*) FROM content_set_steps st WHERE st.set_id = s.id) AS step_count
     FROM content_sets s LEFT JOIN model_profiles p ON p.id = s.profile_id
     ORDER BY s.updated_at DESC`
  ).all();
  return all.filter((s) => {
    try { assertCanUse(user, s.profile_id); return true; } catch { return false; }
  });
}

function getSetForUser(user, { id }) {
  if (!user) throw new Error('Not authenticated');
  const set = getSetOr404(id);
  assertCanUse(user, set.profile_id);
  const steps = getDb().prepare(
    'SELECT * FROM content_set_steps WHERE set_id = ? ORDER BY ordinal ASC, id ASC'
  ).all(id);
  return { set, steps };
}

function readMediaForUser(user, { stepId }) {
  if (!user) throw new Error('Not authenticated');
  const step = getDb().prepare('SELECT * FROM content_set_steps WHERE id = ?').get(stepId);
  if (!step || !step.media_path) throw new Error('Not found');
  const set = getSetOr404(step.set_id);
  assertCanUse(user, set.profile_id);
  const data = fs.readFileSync(step.media_path);
  return { dataBase64: data.toString('base64'), mediaKind: step.media_kind };
}

function register(ipcMain) {
  // List Sets for one model (or every model the caller can reach, if
  // profileId is omitted — used by the Browser side panel + Inbox picker).
  ipcMain.handle('scripts:listSets', (_e, { token, profileId }) => {
    try {
      const user = userFromToken(token);
      return { ok: true, sets: listSetsForUser(user, { profileId }) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scripts:getSet', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      return { ok: true, ...getSetForUser(user, { id }) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scripts:createSet', (_e, { token, profileId, name }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'scripts.manage');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized for this model');
      if (!name || !name.trim()) throw new Error('Name required');
      const info = getDb().prepare(
        'INSERT INTO content_sets (profile_id, name, created_by_user_id) VALUES (?,?,?)'
      ).run(profileId, name.trim(), user.id);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scripts:renameSet', (_e, { token, id, name }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'scripts.manage');
      const set = getSetOr404(id);
      if (!canAccessProfile(user, set.profile_id)) throw new Error('Not authorized for this model');
      if (!name || !name.trim()) throw new Error('Name required');
      getDb().prepare("UPDATE content_sets SET name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name.trim(), id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scripts:deleteSet', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'scripts.manage');
      const set = getSetOr404(id);
      if (!canAccessProfile(user, set.profile_id)) throw new Error('Not authorized for this model');
      const steps = getDb().prepare('SELECT media_path FROM content_set_steps WHERE set_id = ?').all(id);
      getDb().prepare('DELETE FROM content_sets WHERE id = ?').run(id); // cascades steps
      for (const s of steps) { if (s.media_path) { try { fs.unlinkSync(s.media_path); } catch {} } }
      try { fs.rmSync(mediaDir(id), { recursive: true, force: true }); } catch {}
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Add a Step. Media is optional (a Step can be text-only) — send fileName +
  // dataBase64 to attach a photo/video, same upload shape as examples:addImage.
  ipcMain.handle('scripts:addStep', (_e, { token, setId, messageText, fileName, dataBase64, mediaKind }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'scripts.manage');
      const set = getSetOr404(setId);
      if (!canAccessProfile(user, set.profile_id)) throw new Error('Not authorized for this model');

      let mediaPath = null;
      if (dataBase64) {
        const buf = Buffer.from(dataBase64, 'base64');
        if (buf.length > 50 * 1024 * 1024) throw new Error('File too large (50MB max)');
        const safeName = String(fileName || 'media').replace(/[^a-zA-Z0-9._-]/g, '_');
        mediaPath = path.join(mediaDir(setId), `${Date.now()}_${safeName}`);
        fs.writeFileSync(mediaPath, buf);
      }
      const nextOrdinal = getDb().prepare(
        'SELECT COALESCE(MAX(ordinal), -1) + 1 AS n FROM content_set_steps WHERE set_id = ?'
      ).get(setId).n;
      const info = getDb().prepare(
        `INSERT INTO content_set_steps (set_id, ordinal, media_path, media_kind, message_text)
         VALUES (?,?,?,?,?)`
      ).run(setId, nextOrdinal, mediaPath, mediaPath ? (mediaKind || 'application/octet-stream') : null, messageText || '');
      getDb().prepare("UPDATE content_sets SET updated_at = datetime('now') WHERE id = ?").run(setId);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scripts:updateStep', (_e, { token, id, messageText }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'scripts.manage');
      const step = getDb().prepare('SELECT * FROM content_set_steps WHERE id = ?').get(id);
      if (!step) throw new Error('Step not found');
      const set = getSetOr404(step.set_id);
      if (!canAccessProfile(user, set.profile_id)) throw new Error('Not authorized for this model');
      getDb().prepare('UPDATE content_set_steps SET message_text = ? WHERE id = ?')
        .run(messageText || '', id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scripts:deleteStep', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'scripts.manage');
      const step = getDb().prepare('SELECT * FROM content_set_steps WHERE id = ?').get(id);
      if (!step) throw new Error('Step not found');
      const set = getSetOr404(step.set_id);
      if (!canAccessProfile(user, set.profile_id)) throw new Error('Not authorized for this model');
      if (step.media_path) { try { fs.unlinkSync(step.media_path); } catch {} }
      getDb().prepare('DELETE FROM content_set_steps WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Reorder = caller sends the full ordered list of step ids for a Set.
  ipcMain.handle('scripts:reorderSteps', (_e, { token, setId, orderedIds }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'scripts.manage');
      const set = getSetOr404(setId);
      if (!canAccessProfile(user, set.profile_id)) throw new Error('Not authorized for this model');
      if (!Array.isArray(orderedIds) || !orderedIds.length) throw new Error('orderedIds required');
      const db = getDb();
      const update = db.prepare('UPDATE content_set_steps SET ordinal = ? WHERE id = ? AND set_id = ?');
      const tx = db.transaction((ids) => { ids.forEach((id, i) => update.run(i, id, setId)); });
      tx(orderedIds);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scripts:readMedia', (_e, { token, stepId }) => {
    try {
      const user = userFromToken(token);
      return { ok: true, ...readMediaForUser(user, { stepId }) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
module.exports.listSetsForUser = listSetsForUser;
module.exports.getSetForUser = getSetForUser;
module.exports.readMediaForUser = readMediaForUser;
