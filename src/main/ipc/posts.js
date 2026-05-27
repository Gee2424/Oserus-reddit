const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { hasPermission } = require('../permissions');

function canAccessAccount(user, accountId) {
  if (hasPermission(user, 'profiles.manage')) return true;
  const row = getDb()
    .prepare(
      `SELECT p.assigned_user_id FROM reddit_accounts a
       JOIN model_profiles p ON p.id = a.profile_id
       WHERE a.id = ?`
    )
    .get(accountId);
  return row && row.assigned_user_id === user.id;
}

function register(ipcMain) {
  ipcMain.handle('posts:list', (_e, { token, accountId }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    if (!canAccessAccount(user, accountId))
      return { ok: false, error: 'Not authorized' };
    const drafts = getDb()
      .prepare('SELECT * FROM post_drafts WHERE account_id = ? ORDER BY created_at DESC')
      .all(accountId);
    return { ok: true, drafts };
  });

  ipcMain.handle('posts:create', (_e, { token, draft }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessAccount(user, draft.account_id)) throw new Error('Not authorized');

      const info = getDb()
        .prepare(
          `INSERT INTO post_drafts
            (account_id, subreddit, title, body, link_url, kind, flair, nsfw, status, scheduled_for)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          draft.account_id, draft.subreddit, draft.title,
          draft.body || null, draft.link_url || null,
          draft.kind || 'self', draft.flair || null,
          draft.nsfw ? 1 : 0, draft.status || 'draft',
          draft.scheduled_for || null
        );
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('posts:delete', (_e, { token, draftId }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    const draft = getDb().prepare('SELECT * FROM post_drafts WHERE id = ?').get(draftId);
    if (!draft) return { ok: false, error: 'Not found' };
    if (!canAccessAccount(user, draft.account_id)) return { ok: false, error: 'Not authorized' };
    getDb().prepare('DELETE FROM post_drafts WHERE id = ?').run(draftId);
    return { ok: true };
  });
}

module.exports = register;
