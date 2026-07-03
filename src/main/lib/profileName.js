/**
 * Profile Name Utilities
 *
 * Centralized logic for computing and managing CloakManager profile names.
 * Ensures consistency across all code paths.
 */

/**
 * Get profile name for an account, computing default if needed
 *
 * @param {Object} account - Account object with username, platform
 * @param {string} explicitName - Explicitly provided profile name (optional)
 * @returns {string} Profile name (never null)
 */
function getProfileName(account, explicitName = null) {
  if (explicitName) return explicitName;
  const platform = account.platform || 'reddit';
  return `${platform}-${account.username}`;
}

/**
 * Ensure account has a profile name set in database
 *
 * @param {Object} db - Database instance
 * @param {number} accountId - Account ID
 * @returns {string} The profile name (existing or computed)
 */
function ensureProfileName(db, accountId) {
  const account = db.prepare(`
    SELECT id, username, platform FROM reddit_accounts WHERE id = ?
  `).get(accountId);

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const current = db.prepare(`
    SELECT cloak_profile_name FROM account_browser_settings WHERE account_id = ?
  `).get(accountId);

  // If already set, return it
  if (current && current.cloak_profile_name) {
    return current.cloak_profile_name;
  }

  // Compute default
  const profileName = getProfileName(account);

  // Store it
  if (current) {
    db.prepare(`
      UPDATE account_browser_settings
      SET cloak_profile_name = ?
      WHERE account_id = ?
    `).run(profileName, accountId);
  } else {
    db.prepare(`
      INSERT INTO account_browser_settings (account_id, browser_mode, cloak_profile_name)
      VALUES (?, 'inherit', ?)
    `).run(accountId, profileName);
  }

  console.log(`[profileName] Initialized profile name for ${account.username}: ${profileName}`);
  return profileName;
}

module.exports = {
  getProfileName,
  ensureProfileName,
};
