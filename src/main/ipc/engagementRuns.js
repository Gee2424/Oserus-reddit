// IPC for saved engagement "runs" (see services/engagementRuns.js).
//
// list  — runs for a model (or the account's assigned models) + team-wide ones
// get / upsert / delete — CRUD, mutations gated on protocols.manage
// apply — write a run's knobs into the (profile, platform) autopilot_protocols
//         row so the background loop uses them
// runNow — one engagement session for an account using the run's knobs

const { userFromToken } = require('./auth');
const { hasPermission, requirePermission } = require('../permissions');
const { getDb } = require('../db');
const { assignedProfileIds, canAccessProfile } = require('../lib/assignments');
const engagementRuns = require('../services/engagementRuns');
const autopilotProtocol = require('../services/autopilotProtocol');

// Shared by the ipcMain route below AND the Browser side panel bridge
// (browser.js), so both list runs the same way instead of drifting apart.
function listForUser(user, { teamId, profileId } = {}) {
  if (!user) throw new Error('Not authenticated');
  let profileIds = null;
  if (profileId) {
    if (!canAccessProfile(user, profileId)) throw new Error('Not authorized for this model');
    profileIds = [Number(profileId)];
  } else if (!hasPermission(user, 'profiles.manage')) {
    profileIds = assignedProfileIds(user, teamId);
  }
  return engagementRuns.list({ profileIds, teamId });
}

// Same run — used by the Runs page's "Run now" AND the Browser side panel's
// mini picker (which only runs saved runs, never builds them).
async function runNowForUser(user, { id, accountId, dryRun }) {
  if (!user) throw new Error('Not authenticated');
  requirePermission(user, 'protocols.run');
  const run = engagementRuns.get(id);
  if (!run) throw new Error('Run not found');
  const row = getDb().prepare('SELECT profile_id FROM reddit_accounts WHERE id = ?').get(accountId);
  if (!row || !canAccessProfile(user, row.profile_id)) throw new Error('Not authorized for this account');
  const engagement = require('../services/engagement');
  return engagement.runSession(Number(accountId), { dryRun: !!dryRun, runId: Number(id) });
}

function register(ipcMain) {
  ipcMain.handle('engagementRuns:list', (_e, { token, teamId, profileId }) => {
    try {
      const user = userFromToken(token);
      return { ok: true, runs: listForUser(user, { teamId, profileId }) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('engagementRuns:get', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const run = engagementRuns.get(id);
      if (!run) throw new Error('Run not found');
      if (run.profile_id && !canAccessProfile(user, run.profile_id)) throw new Error('Not authorized');
      return { ok: true, run };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('engagementRuns:upsert', (_e, { token, id, patch, teamId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');

      // Coerce array/object inputs from the UI into JSON columns (same shape
      // as autopilot:set).
      const norm = { ...(patch || {}) };
      const toJson = (k) => { if (Array.isArray(norm[k])) norm[k + '_json'] = JSON.stringify(norm[k]); };
      toJson('hashtags'); toJson('follow_list'); toJson('target_subs');
      if (norm.target_filter && typeof norm.target_filter === 'object') {
        norm.target_filter_json = JSON.stringify(norm.target_filter);
      }

      if (norm.profile_id && !canAccessProfile(user, norm.profile_id)) {
        throw new Error('Not authorized for that model');
      }
      if (id) {
        const existing = engagementRuns.get(id);
        if (!existing) throw new Error('Run not found');
        if (existing.profile_id && !canAccessProfile(user, existing.profile_id)) throw new Error('Not authorized');
      }
      const run = engagementRuns.upsert(id || null, norm, { teamId, userId: user.id });
      return { ok: true, run };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('engagementRuns:delete', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      const run = engagementRuns.get(id);
      if (run && run.profile_id && !canAccessProfile(user, run.profile_id)) throw new Error('Not authorized');
      engagementRuns.remove(id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('engagementRuns:apply', (_e, { token, id, profileId, platform }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized for this model');
      if (!platform) throw new Error('Platform required');
      const run = engagementRuns.get(id);
      if (!run) throw new Error('Run not found');
      const knobs = {};
      for (const c of engagementRuns.COLS) knobs[c] = run[c];
      const protocol = autopilotProtocol.upsert(Number(profileId), platform, knobs);
      return { ok: true, protocol };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('engagementRuns:runNow', async (_e, { token, id, accountId, dryRun }) => {
    try {
      const user = userFromToken(token);
      return await runNowForUser(user, { id, accountId, dryRun });
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = register;
module.exports.listForUser = listForUser;
module.exports.runNowForUser = runNowForUser;
