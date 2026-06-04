// IPC for the unified per-profile-per-platform autopilot protocol.
// Replaces the per-account engagement:get/set + autoComment:get/set
// pair. The renderer picks a model + platform, reads or writes one
// row in autopilot_protocols.
//
// Hashtag / follow-list / target-keyword / sub list inputs all arrive
// as arrays from the UI and are JSON-encoded for storage.

const { userFromToken } = require('./auth');
const { hasPermission } = require('../permissions');
const autopilotProtocol = require('../services/autopilotProtocol');
const { getDb } = require('../db');

function canAccessProfile(user, profileId) {
  if (hasPermission(user, 'profiles.manage')) return true;
  const row = getDb()
    .prepare('SELECT assigned_user_id FROM model_profiles WHERE id = ?')
    .get(profileId);
  return !!row && row.assigned_user_id === user.id;
}

function register(ipcMain) {
  ipcMain.handle('autopilot:listForProfile', (_e, { token, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized');
      return { ok: true, protocols: autopilotProtocol.listForProfile(profileId) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autopilot:get', (_e, { token, profileId, platform }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized');
      return { ok: true, protocol: autopilotProtocol.rowFor(profileId, platform) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autopilot:set', (_e, { token, profileId, platform, patch }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized');
      // Coerce array inputs from the UI into JSON columns.
      const norm = { ...patch };
      const toJson = (k) => {
        if (Array.isArray(norm[k])) norm[k + '_json'] = JSON.stringify(norm[k]);
      };
      toJson('hashtags');
      toJson('follow_list');
      toJson('target_subs');
      if (norm.target_filter && typeof norm.target_filter === 'object') {
        norm.target_filter_json = JSON.stringify(norm.target_filter);
      }
      const row = autopilotProtocol.upsert(profileId, platform, norm);
      return { ok: true, protocol: row };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // Run one session right now for a hand-picked account in this profile
  // + platform. Useful for "test my settings" buttons.
  ipcMain.handle('autopilot:runNow', async (_e, { token, profileId, platform, accountId, dryRun }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized');
      let id = accountId;
      if (!id) {
        const row = getDb().prepare(
          `SELECT id FROM reddit_accounts
            WHERE profile_id = ? AND platform = ? AND status IN ('warming','ready')
            ORDER BY RANDOM() LIMIT 1`
        ).get(profileId, platform);
        if (!row) throw new Error(`No active ${platform} accounts for this profile`);
        id = row.id;
      }
      const { runSession } = require('../services/engagement');
      const res = await runSession(id, { dryRun: !!dryRun });
      return res;
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = register;
