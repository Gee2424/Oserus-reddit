/**
 * Profile Name Utilities
 *
 * Centralized logic for computing and managing CloakManager profile names.
 * Model-level names follow the pattern: model-{id}-{name}
 * Account-level overrides: model-{id}-{name}-{platform}{n}
 */

/**
 * CloakManager only accepts alphanumeric characters, hyphens, and
 * underscores in a profile name. Model names are free text ("mogan trace",
 * emoji, punctuation, etc.), so anything else has to be stripped before it
 * goes anywhere near the CM API — otherwise profile creation fails with an
 * opaque backend validation error.
 *
 * @param {string} str
 * @returns {string}
 */
function sanitizeForCmName(str) {
  return String(str || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'model';
}

/**
 * Get the default CM profile name for a model
 *
 * @param {Object} profile - Model profile object with id, name
 * @returns {string} Profile name
 */
function getDefaultProfileName(profile) {
  return `model-${profile.id}-${sanitizeForCmName(profile.name)}`;
}

/**
 * Get an override CM profile name for a same-platform account
 *
 * @param {Object} profile - Model profile object with id, name
 * @param {string} platform - Platform name (reddit, x, etc.)
 * @param {number} accountId - Account ID (used as unique suffix)
 * @returns {string} Profile name
 */
function getOverrideProfileName(profile, platform, accountId) {
  return `model-${profile.id}-${sanitizeForCmName(profile.name)}-${sanitizeForCmName(platform)}${accountId}`;
}

/**
 * True if a stored CM profile name is still valid under CloakManager's
 * naming rules — used to detect names saved before sanitization existed.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isValidCmName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name);
}

/**
 * Ensure model has a CM profile name set in database
 *
 * @param {Object} db - Database instance
 * @param {number} profileId - Model profile ID
 * @returns {string} The profile name (existing or computed)
 */
function ensureProfileName(db, profileId) {
  const profile = db.prepare(`
    SELECT id, name, cloak_profile_name FROM model_profiles WHERE id = ?
  `).get(profileId);

  if (!profile) {
    throw new Error(`Profile ${profileId} not found`);
  }

  if (profile.cloak_profile_name && isValidCmName(profile.cloak_profile_name)) {
    return profile.cloak_profile_name;
  }

  // Either never set, or set before sanitization existed (e.g. a name with
  // a space in it) — (re)compute and persist a valid one.
  const name = getDefaultProfileName(profile);
  db.prepare(`
    UPDATE model_profiles SET cloak_profile_name = ? WHERE id = ?
  `).run(name, profileId);

  console.log(`[profileName] Initialized CM profile name for model ${profileId}: ${name}`);
  return name;
}

/**
 * Get the effective CM profile name for an account (override or model default)
 *
 * @param {Object} db - Database instance
 * @param {number} accountId - Account ID
 * @returns {string|null} The effective CM profile name, or null if Electron mode
 */
function getEffectiveProfileName(db, accountId) {
  const row = db.prepare(`
    SELECT mp.browser_mode, mp.cloak_profile_name AS model_cm_name,
           bs.cloak_profile_override
    FROM reddit_accounts ra
    JOIN model_profiles mp ON mp.id = ra.profile_id
    LEFT JOIN account_browser_settings bs ON bs.account_id = ra.id
    WHERE ra.id = ?
  `).get(accountId);

  if (!row || row.browser_mode !== 'cloakmanager') return null;
  return row.cloak_profile_override || row.model_cm_name || null;
}

module.exports = {
  sanitizeForCmName,
  isValidCmName,
  getDefaultProfileName,
  getOverrideProfileName,
  ensureProfileName,
  getEffectiveProfileName,
};
