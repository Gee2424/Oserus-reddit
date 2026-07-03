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

    // Script files should export a function: module.exports = { metadata, execute }
    // We need to evaluate it in a safe context
    const scriptModule = { exports: null };

    // Evaluate the script (this is safe as we control the script files)
    const evalResult = eval(scriptContent);

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
      lastError = error;
      console.error('[CDP Script Executor] ❌ Script execution attempt', attempt, 'failed:', error.message);

      // Don't retry on certain errors
      if (error.message.includes('connection failed') ||
          error.message.includes('CDP connection failed') ||
          error.message.includes('Script not found') ||
          error.message.includes('Script format') ||
          error.message.includes('Target closed') ||
          error.message.includes('Session closed') ||
          error.message.includes('INCORRECT_CREDENTIALS') ||
          error.message.includes('incorrect password') ||
          error.message.includes('wrong password')) {
        console.log('[CDP Script Executor] Non-retryable error, stopping retries');
        break;
      }

      // Check for rate limiting errors - use longer backoff
      const isRateLimitError = error.message.includes('429') ||
                               error.message.includes('too many requests') ||
                               error.message.includes('rate limit') ||
                               error.message.includes('Try again later') ||
                               error.message.includes('prove you are human');

      // Retry with exponential backoff
      if (attempt < MAX_RETRY_ATTEMPTS) {
        // Longer delay for rate limits (5s, 10s, 20s instead of 1s, 2s, 4s)
        const baseDelay = isRateLimitError ? 5000 : 1000;
        const delay = baseDelay * Math.pow(2, attempt - 1);

        // Add some randomness to avoid synchronized retries
        const jitter = Math.random() * 1000;
        const totalDelay = delay + jitter;

        console.log(`[CDP Script Executor] ${isRateLimitError ? '⚠️ Rate limit detected' : 'Retrying'} in ${(totalDelay/1000).toFixed(1)}s...`);
        await sleep(totalDelay);
      }
    }
  }

  // All retries exhausted
  const finalError = lastError || new Error('Script execution failed after all retries');

  executionHistory.set(executionId, {
    scriptId,
    result: null,
    error: finalError.message,
    timestamp: new Date().toISOString(),
    executionTime: null,
    attempt: MAX_RETRY_ATTEMPTS
  });

  throw finalError;
}

/**
 * Execute a launch script sequence for a profile
 *
 * @param {string} profileName - Profile name
 * @param {number} accountId - Account ID
 * @param {string} platform - Platform name
 * @returns {Promise<Object>} Launch sequence result
 */
async function executeLaunchSequence(profileName, accountId, platform) {
  const db = getDb();

  console.log('[CDP Script Executor] Starting launch sequence for profile:', profileName);

  // Use the correct function that retrieves CDP info and connects
  const connectionManager = require('./connection-manager');
  const connection = await connectionManager.getConnectionForAccount(accountId);
  if (!connection) {
    throw new Error(`Failed to get connection for account: ${accountId} (profile: ${profileName})`);
  }

  // Get account credentials for login
  const account = db.prepare('SELECT username, password_encrypted FROM reddit_accounts WHERE id = ?').get(accountId);
  const credentials = account && account.password_encrypted
    ? { username: account.username, password: decryptSecret(account.password_encrypted) }
    : null;

  const context = {
    profileName,
    accountId,
    platform,
    connection,
    credentials
  };

  const results = {
    login: { success: false, error: null },
    navigation: { success: false, error: null },
    tiles: { success: false, error: null },
    inbox: { success: false, error: null },
    environment: { success: false, error: null }
  };

  try {
    // Helper: random delay to appear more human and avoid rate limiting
    const randomDelay = (min, max) => {
      const delay = min + Math.random() * (max - min);
      console.log(`[CDP Script Executor] ⏱️ Waiting ${(delay/1000).toFixed(1)}s before next script...`);
      return sleep(delay);
    };

    // 1. Auto-login script
    if (platform === 'reddit' && credentials) {
      console.log('[CDP Script Executor] Step 1/5: Reddit login');
      const loginResult = await executeScript('launch/authentication/reddit-login', context);
      results.login = { success: true, error: null };

      // Random delay before next script (2-4 seconds)
      await randomDelay(2000, 4000);
    }

    // 2. Initial navigation script
    console.log('[CDP Script Executor] Step 2/5: Initial navigation');
    const navResult = await executeScript('launch/navigation/initial', context);
    results.navigation = { success: true, error: null };

    // Random delay (1.5-3 seconds)
    await randomDelay(1500, 3000);

    // 3. Homepage tiles script
    console.log('[CDP Script Executor] Step 3/5: Homepage tiles setup');
    const tilesResult = await executeScript('launch/setup/homepage-tiles', context);
    results.tiles = { success: true, error: null };

    // Random delay (1-2 seconds)
    await randomDelay(1000, 2000);

    // 4. Inbox setup script
    console.log('[CDP Script Executor] Step 4/5: Inbox setup');
    const inboxResult = await executeScript('launch/setup/inbox-setup', context);
    results.inbox = { success: true, error: null };

    // Random delay (1-2 seconds)
    await randomDelay(1000, 2000);

    // 5. Environment setup script
    console.log('[CDP Script Executor] Step 5/5: Environment setup');
    const envResult = await executeScript('launch/setup/environment', context);
    results.environment = { success: true, error: null };

  } catch (error) {
    console.error('[CDP Script Executor] Launch sequence error:', error.message);
    // Record which step failed
    // (in production, individual script failures should be logged)
  }

  return results;
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