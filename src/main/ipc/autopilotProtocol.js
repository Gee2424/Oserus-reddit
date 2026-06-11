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
const { setSetting } = require('../services/settings');

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
      // Saving a protocol with enabled=1 implicitly turns on the master
      // background loop — operators expect "I enabled it for this scope
      // and saved" to actually make things happen, not to silently no-op
      // because a separate master kv was off.
      if (row && row.enabled) {
        try { setSetting('autopilot_enabled', '1'); } catch {}
      }
      return { ok: true, protocol: row };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // autopilot:runNow is the single canonical "run" channel and lives in
  // ipc/protocols.js. When called with {profileId, platform} it routes
  // to one engagement session (this scope's "test my settings now"
  // button); without those, it runs the whole-system coordinator pass.
  // See ipc/protocols.js for the actual handler.
}

module.exports = register;
