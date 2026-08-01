const { getDb } = require('../db');

/**
 * Resolve the effective browser mode for an account.
 * 'inherit' resolves to the user's default_browser_mode, or the profile
 * owner's default if no userId is provided. Falls back to 'electron' when
 * no settings exist.
 *
 * This is the single source of truth for browser mode resolution — all
 * call sites that need to decide between electron/cloakmanager routing
 * should go through this function, not re-implement the logic.
 *
 * @param {number} accountId
 * @param {number|null} [userId] - The user making the request. If null,
 *   resolves via the profile owner's default_browser_mode.
 * @returns {{ mode: 'electron'|'cloakmanager', profileName: string|null }}
 */
function resolveBrowserMode(accountId, userId = null) {
  const db = getDb();
  const row = db.prepare(`
    SELECT browser_mode, cloak_profile_name
    FROM account_browser_settings WHERE account_id = ?
  `).get(accountId);

  const rawMode = row?.browser_mode || null;
  const profileName = row?.cloak_profile_name || null;

  // Direct modes — no fallback needed
  if (rawMode === 'cloakmanager') return { mode: 'cloakmanager', profileName };
  if (rawMode === 'electron')     return { mode: 'electron', profileName: null };

  // inherit or null → resolve from user default
  let defaultMode = 'electron';
  if (userId) {
    const userRow = db.prepare(
      'SELECT default_browser_mode FROM user_browser_settings WHERE user_id = ?'
    ).get(userId);
    defaultMode = userRow?.default_browser_mode || 'electron';
  } else {
    // No user context — fall back to profile owner's default
    const ownerRow = db.prepare(`
      SELECT ubs.default_browser_mode
      FROM reddit_accounts ra
      JOIN model_profiles mp ON mp.id = ra.profile_id
      LEFT JOIN user_browser_settings ubs ON ubs.user_id = mp.assigned_user_id
      WHERE ra.id = ?
    `).get(accountId);
    defaultMode = ownerRow?.default_browser_mode || 'electron';
  }

  return {
    mode: defaultMode,
    profileName: defaultMode === 'cloakmanager' ? profileName : null,
  };
}

module.exports = { resolveBrowserMode };
