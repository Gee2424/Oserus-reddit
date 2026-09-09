/**
 * CDP Script Executor
 *
 * Handles loading, executing, and managing CDP automation scripts with:
 * - Script loading from file system
 * - Execution with retry logic and error handling
 * - Result capture and storage
 * - Progress tracking and reporting
 *
 * @module cdp/script-executor
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const { sleep } = require('./connection-manager');
const { toCdpError, ScriptError } = require('./errors');

/**
 * Script cache to avoid repeated file reads
 * Map<scriptId, { script, metadata, loadedAt }>
 */
const scriptCache = new Map();

/**
 * Script execution TTL - cache scripts for 10 minutes
 */
const SCRIPT_CACHE_TTL = 10 * 60 * 1000;

/**
 * Default script execution timeout
 */
const DEFAULT_SCRIPT_TIMEOUT = 30000;

/**
 * Maximum retry attempts for failed scripts
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Script execution result storage
 */
const executionHistory = new Map(); // executionId -> { result, error, timestamp }

/**
 * Load a script by ID from the file system
 *
 * @param {string} scriptId - Script identifier (format: 'category-platform-name')
 * @returns {Promise<Object>} Script object with code and metadata
 */
async function loadScript(scriptId) {
  try {
    // Check cache first
    const cached = scriptCache.get(scriptId);
    if (cached && (Date.now() - cached.loadedAt < SCRIPT_CACHE_TTL)) {
      console.log('[CDP Script Executor] Using cached script:', scriptId);
      return cached.script;
    }

    // Parse script ID to find file path
    const parts = scriptId.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid script ID format: ${scriptId}`);
    }

    const [category, platform, ...nameParts] = parts;
    const scriptName = nameParts.join('-');

    // Build file path
    let scriptPath;
    if (platform) {
      scriptPath = path.join(__dirname, '..', 'cdp-scripts', category, platform, `${scriptName}.js`);
    } else {
      scriptPath = path.join(__dirname, '..', 'cdp-scripts', category, `${scriptName}.js`);
    }

    // Check if file exists
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Script file not found: ${scriptPath}`);
    }

    // Load and parse script
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');

    const prevExports = module.exports;
    const evalResult = eval(scriptContent);
    module.exports = prevExports;

    if (!evalResult || typeof evalResult.execute !== 'function') {
      throw new Error(`Invalid script format in: ${scriptPath}`);
    }

    const script = {
      id: scriptId,
      metadata: evalResult.metadata || {},
      execute: evalResult.execute,
      path: scriptPath
    };

    // Cache the script
    scriptCache.set(scriptId, {
      script,
      loadedAt: Date.now()
    });

    console.log('[CDP Script Executor] ✅ Loaded script:', scriptId);
    return script;
  } catch (error) {
    console.error('[CDP Script Executor] ❌ Failed to load script:', scriptId, error.message);
    throw error;
  }
}

/**
 * Execute a script with retry logic and error handling
 *
 * @param {string} scriptId - Script identifier
 * @param {Object} context - Execution context (profile, accountId, etc.)
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Execution result
 */
async function executeScript(scriptId, context = {}, options = {}) {
  const executionId = `${scriptId}-${Date.now()}`;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      console.log('[CDP Script Executor] Executing script:', scriptId, 'attempt:', attempt);

      // Load the script
      const script = await loadScript(scriptId);

      // Verify script requirements
      if (script.metadata.requires) {
        for (const requirement of script.metadata.requires) {
          if (requirement === 'cdpConnection' && !context.connection) {
            throw new Error('Script requires CDP connection but none provided');
          }
        }
      }

      // Execute the script
      const timeout = options.timeout || script.metadata.timeout || DEFAULT_SCRIPT_TIMEOUT;
      const startTime = Date.now();

      // Check if script wants native Playwright mode
      let connectionToPass = context.connection || context;
      if (script.metadata.nativeMode && context.connection && context.connection.native) {
        // CRITICAL FIX: Pass full native object { page, context, browser }
        // Individual scripts can destructure what they need
        connectionToPass = context.connection.native;
        console.log('[CDP Script Executor] Using native Playwright mode for:', scriptId);
      }

      // Create execution timeout promise
      const executionPromise = script.execute(connectionToPass, context);

      const result = await withTimeout(executionPromise, timeout);

      const executionTime = Date.now() - startTime;

      // Record successful execution
      executionHistory.set(executionId, {
        scriptId,
        result,
        error: null,
        timestamp: new Date().toISOString(),
        executionTime,
        attempt
      });

      console.log('[CDP Script Executor] ✅ Script executed successfully:', scriptId, 'time:', executionTime + 'ms');
      return result;

    } catch (error) {
      // Classify. Anything that could be a credentials / 2FA / challenge /
      // rate-limit signal is NOT retryable — retrying a login is exactly what
      // gets an account locked. Only pre-interaction transport failures retry.
      const cdpErr = toCdpError(error);
      lastError = cdpErr;
      console.error(
        `[CDP Script Executor] ❌ ${scriptId} attempt ${attempt} failed [${cdpErr.code}${cdpErr.retryable ? ', retryable' : ''}]:`,
        cdpErr.message
      );

      if (!cdpErr.retryable) {
        console.log('[CDP Script Executor] Non-retryable, stopping:', cdpErr.code);
        break;
      }

      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = 1000 * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.log(`[CDP Script Executor] Retrying in ${(delay / 1000).toFixed(1)}s…`);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  const finalError = lastError || new ScriptError('Script execution failed after all retries');

  executionHistory.set(executionId, {
    scriptId,
    result: null,
    error: finalError.message,
    code: finalError.code || null,
    timestamp: new Date().toISOString(),
    executionTime: null,
    attempt: MAX_RETRY_ATTEMPTS
  });

  throw finalError;
}

/**
 * Execute a launch script sequence for a profile.
 *
 * Reads shared configuration from model_launch_scripts (one config for the
 * model's whole CloakManager profile — shared or a per-account override
 * instance alike, resolved via cloakmanager_profiles.profile_id). If no
 * config exists yet, seeds defaults from script-discovery.
 *
 * accountId may be null — a launch that wasn't targeted at any specific
 * account (e.g. the model-level generic "Open Browser" button). In that
 * case, only scripts NOT marked accountScoped run (shared setup like
 * cookie-warming/bookmarks); identity-scoped scripts (login, inbox-setup)
 * are skipped, since there's no account to act as.
 *
 * Supports:
 *   - Disk scripts (loaded from cdp-scripts/launch/)
 *   - Custom scripts (loaded from custom_cdp_scripts table — prefixed 'custom:')
 *   - run_mode 'once' — skips if previously completed successfully
 *   - run_mode 'always' — runs every launch
 *
 * @param {string} profileName - Profile name
 * @param {number|null} accountId - Account ID this launch was targeted at, or null
 * @param {string} [platform] - Platform of the targeted account, if any
 * @returns {Promise<Object>} Launch sequence result keyed by script_id
 */
async function executeLaunchSequence(profileName, accountId, platform) {
  const db = getDb();

  console.log('[CDP Script Executor] Starting dynamic launch sequence for profile:', profileName, 'account:', accountId ?? '(none — model-level launch)');

  const connectionManager = require('./connection-manager');
  const connection = accountId
    ? await connectionManager.getConnectionForAccount(accountId)
    : await connectionManager.getConnectionForProfile(profileName);
  if (!connection) {
    throw new Error(`Failed to get connection for profile: ${profileName}`);
  }

  let credentials = null;
  if (accountId) {
    const account = db.prepare('SELECT username FROM reddit_accounts WHERE id = ?').get(accountId);
    const { credentialVaultGet } = require('../db');
    let password = credentialVaultGet('account_password', accountId);
    if (!password) {
      const row = db.prepare('SELECT password_encrypted FROM reddit_accounts WHERE id = ?').get(accountId);
      password = row?.password_encrypted ? decryptSecret(row.password_encrypted) : null;
    }
    credentials = account && password
      ? { username: account.username, password }
      : null;
  }

  const context = {
    profileName,
    accountId,
    platform,
    connection,
    credentials
  };

  const results = {};

  try {
    const randomDelay = (min, max) => {
      const delay = min + Math.random() * (max - min);
      console.log(`[CDP Script Executor] ⏱️ Waiting ${(delay/1000).toFixed(1)}s before next script...`);
      return sleep(delay);
    };

    const owner = db.prepare('SELECT profile_id FROM cloakmanager_profiles WHERE profile_name = ?').get(profileName);
    if (!owner) {
      console.warn('[CDP Script Executor] No model found for profile, skipping launch sequence:', profileName);
      return results;
    }

    const { seedDefaultsForModel, discoverLaunchScripts } = require('./script-discovery');
    const modelPlatforms = db.prepare('SELECT DISTINCT platform FROM reddit_accounts WHERE profile_id = ?')
      .all(owner.profile_id).map(r => r.platform);
    seedDefaultsForModel(owner.profile_id, modelPlatforms);

    const diskScripts = discoverLaunchScripts();
    const accountScopedIds = new Set(diskScripts.filter(s => s.accountScoped).map(s => s.id));
    const scriptPlatform = new Map(diskScripts.map(s => [s.id, s.platform]));

    const scripts = db.prepare(`
      SELECT script_id, enabled, run_mode, sort_order
      FROM model_launch_scripts
      WHERE profile_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(owner.profile_id);

    console.log('[CDP Script Executor] Configured scripts:', scripts.map(s => `${s.script_id} (${s.run_mode})`));

    for (let i = 0; i < scripts.length; i++) {
      const cfg = scripts[i];
      const scriptKey = cfg.script_id;

      if (!cfg.enabled) {
        console.log(`[CDP Script Executor] Step ${i + 1}: ${scriptKey} — DISABLED, skipping`);
        results[scriptKey] = { success: false, skipped: true, reason: 'disabled' };
        continue;
      }

      if (accountScopedIds.has(scriptKey)) {
        if (!accountId) {
          console.log(`[CDP Script Executor] Step ${i + 1}: ${scriptKey} — account-scoped, no account targeted by this launch, skipping`);
          results[scriptKey] = { success: false, skipped: true, reason: 'no_account_targeted' };
          continue;
        }
        const declaredPlatform = scriptPlatform.get(scriptKey);
        if (declaredPlatform && declaredPlatform !== 'all' && declaredPlatform !== platform) {
          console.log(`[CDP Script Executor] Step ${i + 1}: ${scriptKey} — for ${declaredPlatform}, this launch is ${platform}, skipping`);
          results[scriptKey] = { success: false, skipped: true, reason: 'platform_mismatch' };
          continue;
        }
      }

      if (cfg.run_mode === 'once') {
        const priorSuccess = db.prepare(`
          SELECT 1 FROM cdp_script_executions
          WHERE profile_name = ? AND script_id = ? AND status = 'completed'
          LIMIT 1
        `).get(profileName, scriptKey);

        if (priorSuccess) {
          console.log(`[CDP Script Executor] Step ${i + 1}: ${scriptKey} — already completed (once), skipping`);
          results[scriptKey] = { success: true, skipped: true, reason: 'already_completed' };
          continue;
        }
      }

      try {
        console.log(`[CDP Script Executor] Step ${i + 1}/${scripts.length}: ${scriptKey}`);

        if (scriptKey.startsWith('custom:')) {
          const customId = parseInt(scriptKey.replace('custom:', ''), 10);
          const customScript = db.prepare(
            'SELECT * FROM custom_cdp_scripts WHERE id = ?'
          ).get(customId);

          if (!customScript) {
            console.error('[CDP Script Executor] Custom script not found:', scriptKey);
            results[scriptKey] = { success: false, error: 'Custom script not found' };
            continue;
          }

          await executeCustomScript(customScript, context);
        } else {
          await executeScript(scriptKey, context);
        }

        results[scriptKey] = { success: true, error: null };

        await recordExecution(profileName, scriptKey, 'launch', { success: true });
      } catch (error) {
        const cdpErr = toCdpError(error);
        console.error(`[CDP Script Executor] ${scriptKey} failed [${cdpErr.code}]:`, cdpErr.message);
        results[scriptKey] = { success: false, error: cdpErr.message, code: cdpErr.code };

        await recordExecution(profileName, scriptKey, 'launch', null, cdpErr.message);

        // A hard auth/challenge failure means every later identity-scoped
        // script (inbox, etc.) will fail too, and hammering them risks the
        // account. Stop the sequence here — the orchestrator flags the
        // account off the result.
        if (cdpErr.attention) {
          console.warn('[CDP Script Executor] Aborting remaining launch scripts —', cdpErr.code);
          break;
        }
      }

      if (i < scripts.length - 1) {
        await randomDelay(1500, 4000);
      }
    }

  } catch (error) {
    console.error('[CDP Script Executor] Launch sequence error:', error.message);
  }

  return results;
}

/**
 * Execute a custom inline CDP script from the database.
 * Wraps the stored code body in a full async function module.
 *
 * @param {Object} customScript - Row from custom_cdp_scripts table
 * @param {Object} context - Execution context
 * @returns {Promise<any>} Execution result
 */
async function executeCustomScript(customScript, context) {
  const connection = context.connection;

  let nativeConnection;
  if (connection.native) {
    nativeConnection = connection.native;
  } else {
    nativeConnection = { page: connection.page, context: connection.context, browser: connection.browser };
  }

  const wrappedCode = `
    return (async (nativeConnection, context) => {
      const { page, context: browserContext, browser } = nativeConnection;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      ${customScript.code}
    })(nativeConnection, context);
  `;

  const fn = new Function('nativeConnection', 'context', wrappedCode);
  const result = await fn(nativeConnection, context);

  console.log('[CDP Script Executor] Custom script executed:', customScript.name);
  return result;
}

/**
 * Execute a task script (posting, inbox sync, etc.)
 *
 * @param {string} scriptId - Task script identifier
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Task execution result
 */
async function executeTaskScript(scriptId, context) {
  try {
    console.log('[CDP Script Executor] Executing task script:', scriptId);

    // Get or create connection for the account
    if (!context.connection) {
      const connection = await require('./connection-manager').getConnectionForAccount(context.accountId);
      if (!connection) {
        throw new Error(`Failed to get CDP connection for account: ${context.accountId}`);
      }
      context.connection = connection;
    }

    // Execute the task script
    const result = await executeScript(scriptId, context);

    console.log('[CDP Script Executor] ✅ Task script completed:', scriptId);
    return { ok: true, result, scriptId };

  } catch (error) {
    console.error('[CDP Script Executor] ❌ Task script failed:', scriptId, error.message);
    return { ok: false, error: error.message, scriptId };
  }
}

/**
 * Record script execution in database
 *
 * @param {string} profileName - Profile name
 * @param {string} scriptId - Script identifier
 * @param {string} category - Script category
 * @param {Object} result - Execution result
 * @param {string} error - Error message if failed
 */
async function recordExecution(profileName, scriptId, category, result, error) {
  try {
    const db = getDb();

    db.prepare(`
      INSERT INTO cdp_script_executions
      (profile_name, script_id, category, started_at, completed_at, status, result_json, error, retry_count)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, 0)
    `).run(
      profileName,
      scriptId,
      category,
      result ? null : new Date().toISOString(),
      result ? 'completed' : 'failed',
      result ? JSON.stringify(result) : null,
      error || null
    );

    console.log('[CDP Script Executor] Execution recorded:', { profileName, scriptId, status: result ? 'completed' : 'failed' });
  } catch (error) {
    console.error('[CD Script Executor] Failed to record execution:', error.message);
  }
}

/**
 * Get execution history for a profile
 *
 * @param {string} profileName - Profile name
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<Array>} Execution history
 */
async function getExecutionHistory(profileName, limit = 50) {
  try {
    const db = getDb();

    const rows = db.prepare(`
      SELECT * FROM cdp_script_executions
      WHERE profile_name = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(profileName, limit);

    return rows || [];
  } catch (error) {
    console.error('[CDP Script Executor] Failed to get execution history:', error.message);
    return [];
  }
}

/**
 * Promise with timeout wrapper
 *
 * @param {Promise} promise - Promise to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise} Promise with timeout
 */
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Execution timeout')), timeoutMs);
    })
  ]);
}

/**
 * Decrypt secret from database
 *
 * @param {string} encrypted - Encrypted value
 * @returns {string} Decrypted value
 */
function decryptSecret(encrypted) {
  try {
    const { decryptSecret } = require('../db');
    return decryptSecret(encrypted);
  } catch (error) {
    console.error('[CDP Script Executor] Decryption failed:', error.message);
    return '';
  }
}

/**
 * Clear script cache (useful when scripts are updated)
 *
 * @param {string} scriptId - Script ID to clear from cache (optional, clears all if not provided)
 */
function clearScriptCache(scriptId = null) {
  if (scriptId) {
    scriptCache.delete(scriptId);
    console.log('[CDP Script Executor] Cleared cache for script:', scriptId);
  } else {
    const count = scriptCache.size;
    scriptCache.clear();
    console.log('[CDP Script Executor] Cleared all script cache (', count, 'scripts)');
  }
}

/**
 * Get cache statistics
 *
 * @returns {Object} Cache statistics
 */
function getCacheStats() {
  const now = Date.now();
  const stats = {
    total: scriptCache.size,
    valid: 0,
    stale: 0
  };

  for (const [scriptId, cached] of scriptCache.entries()) {
    if (now - cached.loadedAt < SCRIPT_CACHE_TTL) {
      stats.valid++;
    } else {
      stats.stale++;
    }
  }

  return stats;
}

module.exports = {
  // Script execution
  executeScript,
  executeLaunchSequence,
  executeTaskScript,

  // Script loading
  loadScript,

  // Recording and history
  recordExecution,
  getExecutionHistory,

  // Cache management
  clearScriptCache,
  getCacheStats,

  // Utilities
  sleep
};