const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');
const { hasPermission } = require('../permissions');

function isAdminOrManager(user) {
  return hasPermission(user, 'webviews.manage');
}

function register(ipcMain) {
  // List tabs visible to this user: their own personal tabs (user_id = me)
  // PLUS all shared locked tabs (user_id IS NULL and is_locked = 1).
  ipcMain.handle('webviews:list', (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    const rows = getDb()
      .prepare(
        `SELECT * FROM webview_tabs
         WHERE user_id = ? OR (user_id IS NULL AND is_locked = 1)
         ORDER BY is_locked DESC, sort_order ASC, id ASC`
      )
      .all(user.id);
    return { ok: true, tabs: rows };
  });

  // Create a personal tab (any user). Admins/managers can also create locked shared tabs.
  ipcMain.handle('webviews:create', (_e, { token, title, url, isLocked }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'URL must start with http:// or https://' };
    }
    if (isLocked && !isAdminOrManager(user)) {
      return { ok: false, error: 'Only admins/managers can create locked tabs' };
    }
    const owner = isLocked ? null : user.id;
    // For locked tabs use the global max sort_order; for personal, per-user
    const max = isLocked
      ? getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM webview_tabs WHERE user_id IS NULL').get()
      : getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM webview_tabs WHERE user_id = ?').get(user.id);
    const info = getDb()
      .prepare('INSERT INTO webview_tabs (user_id, title, url, sort_order, is_locked) VALUES (?,?,?,?,?)')
      .run(owner, title, url, max.m + 1, isLocked ? 1 : 0);
    return { ok: true, id: info.lastInsertRowid };
  });

  // Update a tab. Locked tabs only editable by admin/manager.
  ipcMain.handle('webviews:update', (_e, { token, tabId, updates }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const tab = getDb().prepare('SELECT * FROM webview_tabs WHERE id = ?').get(tabId);
      if (!tab) throw new Error('Tab not found');
      if (tab.is_locked || tab.user_id === null) {
        if (!isAdminOrManager(user)) throw new Error('Only admins/managers can edit locked tabs');
      } else if (tab.user_id !== user.id) {
        throw new Error('Not authorized');
      }
      const allowed = ['title', 'url', 'sort_order'];
      const sets = [], params = [];
      for (const k of allowed) {
        if (updates[k] !== undefined) { sets.push(`${k} = ?`); params.push(updates[k]); }
      }
      // Lock/unlock toggle (admin/manager only)
      if (updates.isLocked !== undefined && isAdminOrManager(user)) {
        sets.push('is_locked = ?');
        params.push(updates.isLocked ? 1 : 0);
        sets.push('user_id = ?');
        params.push(updates.isLocked ? null : user.id);
      }
      if (!sets.length) return { ok: true };
      params.push(tabId);
      getDb().prepare(`UPDATE webview_tabs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('webviews:delete', (_e, { token, tabId }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    const tab = getDb().prepare('SELECT * FROM webview_tabs WHERE id = ?').get(tabId);
    if (!tab) return { ok: false, error: 'Tab not found' };
    if (tab.is_locked || tab.user_id === null) {
      if (!isAdminOrManager(user)) return { ok: false, error: 'Only admins/managers can delete locked tabs' };
    } else if (tab.user_id !== user.id) {
      return { ok: false, error: 'Not authorized' };
    }
    getDb().prepare('DELETE FROM webview_tabs WHERE id = ?').run(tabId);
    return { ok: true };
  });

  // --- CREDENTIALS FOR LOCKED TABS ---
  // List credentials for a tab. Admin/manager sees all; regular users see global ones
  // plus those matching one of their assigned model profiles.
  ipcMain.handle('webviews:listCredentials', (_e, { token, tabId }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    const db = getDb();
    const all = db.prepare(
      `SELECT c.id, c.tab_id, c.profile_id, c.label, c.username, c.password_encrypted, c.notes,
              p.name AS profile_name
       FROM locked_tab_credentials c
       LEFT JOIN model_profiles p ON p.id = c.profile_id
       WHERE c.tab_id = ?
       ORDER BY (c.profile_id IS NULL) DESC, p.name`
    ).all(tabId);

    let visible;
    if (isAdminOrManager(user)) {
      visible = all;
    } else {
      // Regular user: see global + creds for profiles they're assigned to
      const myProfiles = db.prepare('SELECT id FROM model_profiles WHERE assigned_user_id = ?').all(user.id);
      const myProfileIds = new Set(myProfiles.map(p => p.id));
      visible = all.filter(c => c.profile_id === null || myProfileIds.has(c.profile_id));
    }
    return {
      ok: true,
      credentials: visible.map(c => ({
        id: c.id,
        tab_id: c.tab_id,
        profile_id: c.profile_id,
        profile_name: c.profile_name,
        label: c.label,
        username: c.username,
        password: decryptSecret(c.password_encrypted),
        notes: c.notes,
        is_global: c.profile_id === null,
      })),
    };
  });

  ipcMain.handle('webviews:createCredential', (_e, args) => {
    try {
      const { token, tabId, profileId, label, username, password, notes } = args;
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!isAdminOrManager(user)) throw new Error('Only admins/managers can set up pre-logins');
      const tab = getDb().prepare('SELECT * FROM webview_tabs WHERE id = ?').get(tabId);
      if (!tab) throw new Error('Tab not found');
      if (!tab.is_locked) throw new Error('Pre-login is only for locked tabs');
      const info = getDb()
        .prepare(
          'INSERT INTO locked_tab_credentials (tab_id, profile_id, label, username, password_encrypted, notes) VALUES (?,?,?,?,?,?)'
        )
        .run(tabId, profileId || null, label || null, username || null, encryptSecret(password), notes || null);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('webviews:deleteCredential', (_e, { token, credentialId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!isAdminOrManager(user)) throw new Error('Only admins/managers can manage pre-logins');
      getDb().prepare('DELETE FROM locked_tab_credentials WHERE id = ?').run(credentialId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
