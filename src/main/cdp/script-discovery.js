/**
 * CDP Script Discovery
 *
 * Scans the cdp-scripts/launch/ directory to discover available CDP scripts
 * and extract their metadata. Used by the LaunchScriptsPanel to present
 * disk scripts alongside custom inline scripts.
 *
 * @module cdp/script-discovery
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');

let diskScriptsCache = null;
let cacheLoadedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Recursively walk a directory to collect all .js script files
 */
function walkScripts(dir, basePath) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkScripts(fullPath, basePath));
    } else if (entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Derive a script ID from a file path relative to cdp-scripts/
 * e.g. .../cdp-scripts/launch/authentication/reddit-login.js -> 'launch/authentication/reddit-login'
 */
function deriveScriptId(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.indexOf('/cdp-scripts/');
  if (idx === -1) return null;

  const relative = normalized.slice(idx + '/cdp-scripts/'.length);
  return relative.replace(/\.js$/, '');
}

/**
 * Load metadata from a single script file without caching side effects.
 * Uses require() which leverages Node's own module cache but we
 * bust the cache before each load so script edits are picked up.
 */
function loadScriptMetadata(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);
    if (!mod || !mod.metadata) return null;

    const scriptId = deriveScriptId(filePath);
    if (!scriptId) return null;

    return {
      id: mod.metadata.id || scriptId,
      name: mod.metadata.name || path.basename(filePath, '.js'),
      platform: mod.metadata.platform || 'all',
      category: mod.metadata.category || 'launch',
      description: mod.metadata.description || '',
      timeout: mod.metadata.timeout || 30000,
      nativeMode: !!mod.metadata.nativeMode,
      version: mod.metadata.version || '1.0.0',
      // True for scripts that need one specific account's identity/session
      // (login, opening that account's inbox) — on a model-level
      // CloakManager profile shared across platforms, these only run when a
      // launch was targeted at a matching account, never on a generic
      // model-level launch or for a sibling account on another platform.
      accountScoped: !!mod.metadata.accountScoped,
      path: filePath,
    };
  } catch (e) {
    console.error('[Script Discovery] Failed to load metadata from', filePath, e.message);
    return null;
  }
}

/**
 * Discover all launch scripts available on disk
 * @returns {Array<Object>} Array of script metadata objects
 */
function discoverLaunchScripts() {
  const now = Date.now();
  if (diskScriptsCache && (now - cacheLoadedAt < CACHE_TTL)) {
    return diskScriptsCache;
  }

  console.log('[Script Discovery] Scanning cdp-scripts/launch/ for scripts...');

  const launchDir = path.join(__dirname, '..', 'cdp-scripts', 'launch');
  const files = walkScripts(launchDir, launchDir);

  const scripts = [];
  for (const filePath of files) {
    const meta = loadScriptMetadata(filePath);
    if (meta) scripts.push(meta);
  }

  scripts.sort((a, b) => a.id.localeCompare(b.id));

  diskScriptsCache = scripts;
  cacheLoadedAt = now;

  console.log('[Script Discovery] Found', scripts.length, 'launch scripts on disk');
  return scripts;
}

/**
 * Invalidate the cache (called after modifying scripts directory)
 */
function invalidateCache() {
  diskScriptsCache = null;
  cacheLoadedAt = 0;
}

/**
 * Get the default launch script configuration for a given platform.
 * These are auto-populated into model_launch_scripts when no config exists.
 *
 * @param {string} platform - Platform name (reddit, x, instagram, tiktok)
 * @returns {Array<{scriptId: string, enabled: boolean, runMode: string, sortOrder: number}>}
 */
function getDefaultScripts(platform) {
  const defaults = [
    { scriptId: 'launch/navigation/initial',    enabled: true, runMode: 'always', sortOrder: 1 },
    { scriptId: 'launch/setup/cookie-warmer',   enabled: true, runMode: 'once',   sortOrder: 2 },
    { scriptId: 'launch/setup/homepage-tiles',  enabled: true, runMode: 'always', sortOrder: 3 },
    { scriptId: 'launch/setup/inbox-setup',     enabled: true, runMode: 'always', sortOrder: 4 },
    { scriptId: 'launch/setup/environment',     enabled: true, runMode: 'once',   sortOrder: 5 },
    { scriptId: 'launch/setup/bookmarks',       enabled: true, runMode: 'once',   sortOrder: 6 },
  ];

  if (platform === 'reddit') {
    defaults.unshift({ scriptId: 'launch/authentication/reddit-login', enabled: true, runMode: 'always', sortOrder: 0 });
  }

  return defaults;
}

/**
 * Auto-populate missing default launch script configuration for a model's
 * shared CloakManager profile — one config shared by every account on the
 * model, covering each distinct platform the model actually has an account
 * on (so e.g. a Reddit+X model gets both
 * reddit-login and any future x-login, each still accountScoped so it only
 * fires for a launch targeted at a matching account).
 *
 * @param {number} profileId
 * @param {string[]} platforms - distinct platforms linked to this model
 * @returns {number} Number of scripts inserted
 */
function seedDefaultsForModel(profileId, platforms) {
  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO model_launch_scripts (profile_id, script_id, enabled, run_mode, sort_order) VALUES (?, ?, ?, ?, ?)'
  );

  const txn = db.transaction(() => {
    let count = 0;
    const seen = new Set();
    for (const platform of (platforms && platforms.length ? platforms : ['reddit'])) {
      for (const d of getDefaultScripts(platform)) {
        if (seen.has(d.scriptId)) continue; // same shared script for another platform — already queued
        seen.add(d.scriptId);
        const res = insert.run(profileId, d.scriptId, d.enabled ? 1 : 0, d.runMode, d.sortOrder);
        if (res.changes > 0) count++;
      }
    }
    return count;
  });

  return txn();
}

module.exports = {
  discoverLaunchScripts,
  invalidateCache,
  getDefaultScripts,
  seedDefaultsForModel,
};
