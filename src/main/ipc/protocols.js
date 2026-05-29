// IPC surface for posting protocols + the autopilot coordinator.
// Renderer never touches the DB directly — everything goes through here.

const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');
const { log } = require('./activity');
const protocols = require('../services/protocols');
const coordinator = require('../services/coordinator');
const { getDb } = require('../db');
const { getSetting, setSetting } = require('../services/settings');

function register(ipcMain) {
  // --- Protocol config CRUD (override hierarchy) ---
  ipcMain.handle('protocols:get', (_e, { token, scope, scopeId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const raw = protocols.getRawConfig(scope || 'global', scopeId ?? null);
      const effective = protocols.resolveProtocol({
        platform: scope === 'platform' ? scopeId : null,
        profileId: scope === 'model' ? scopeId : null,
        accountId: scope === 'account' ? scopeId : null,
      });
      return { ok: true, raw: raw || {}, effective, defaults: protocols.DEFAULT_PROTOCOL };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('protocols:set', (_e, { token, scope, scopeId, config }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      protocols.setConfig(scope || 'global', scopeId ?? null, config || {});
      log(user, 'protocols.set', scope || 'global', scopeId ?? null, JSON.stringify(config || {}).slice(0, 200));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Effective protocol + live eligibility for one account (preview in UI).
  ipcMain.handle('protocols:eligibility', (_e, { token, platform, accountId, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const result = protocols.checkEligibility({ platform: platform || 'reddit', accountId, profileId });
      const last = protocols.lastPostAt(platform || 'reddit', accountId);
      return { ok: true, ...result, lastPostAt: last };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- Autopilot controls ---
  ipcMain.handle('autopilot:status', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      return { ok: true, ...coordinator.status() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('autopilot:setEnabled', (_e, { token, enabled }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      setSetting('autopilot_enabled', enabled ? '1' : '0');
      log(user, 'autopilot.toggle', 'system', null, enabled ? 'enabled' : 'disabled');
      return { ok: true, enabled: !!enabled };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('autopilot:setInterval', (_e, { token, minutes }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      setSetting('autopilot_interval_min', Math.max(5, Number(minutes) || 30));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Run one pass right now. dryRun => decide only, don't post (safe preview).
  ipcMain.handle('autopilot:runNow', async (_e, { token, dryRun }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.run');
      const summary = await coordinator.runOnce({ dryRun: !!dryRun });
      log(user, 'autopilot.runNow', 'system', null, dryRun ? 'dry-run' : `posted=${summary.posted} skipped=${summary.skipped} failed=${summary.failed}`);
      return { ok: true, summary };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Recent post events (autopilot + manual), for the activity feed on the page.
  ipcMain.handle('protocols:events', (_e, { token, limit }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      protocols.ensureTables();
      const rows = getDb().prepare(
        `SELECT e.*, a.username AS account_username, p.name AS profile_name
         FROM post_events e
         LEFT JOIN reddit_accounts a ON a.id = e.account_id
         LEFT JOIN model_profiles p ON p.id = e.profile_id
         ORDER BY e.id DESC LIMIT ?`
      ).all(Math.min(Number(limit) || 100, 500));
      return { ok: true, events: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
