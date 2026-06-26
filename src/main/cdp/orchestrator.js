/**
 * CDP Orchestrator
 *
 * Central coordination hub for CDP automation that:
 * - Manages connection lifecycle and pooling
 * - Triggers launch scripts on profile launch
 * - Coordinates task script execution
 * - Integrates with CloakManager WebSocket events
 * - Provides unified API for CDP operations
 *
 * @module cdp/orchestrator
 */

const { getCloakManagerClient } = require('../cloakmanager');
const { getDb } = require('../db');
const connectionManager = require('./connection-manager');
const scriptExecutor = require('./script-executor');

/**
 * Active launch sequences being executed
 * Map<profileName, { promise, startedAt, context }>
 */
const activeLaunches = new Map();

/**
 * Task execution queue
 * Array<{ scriptId, context, resolve, reject }>
 */
const taskQueue = [];

/**
 * Queue is being processed
 */
let queueProcessing = false;

/**
 * Initialize the orchestrator with CloakManager event handlers
 * This should be called once during application startup
 *
 * @param {Object} mainWindow - Electron mainWindow for event broadcasting
 * @param {Object} client - CloakManager client instance (optional, will use default if not provided)
 */
function initialize(mainWindow, client = null) {
  console.log('[CDP Orchestrator] Initializing...');

  if (!client) {
    client = getCloakManagerClient();
  }

  // Store mainWindow for progress broadcasting
  global.cdpMainWindow = mainWindow;

  // Start task queue processor
  startQueueProcessor();

  console.log('[CDP Orchestrator] ✅ Initialized');
}

/**
 * Handle profile launched event - trigger launch script sequence
 *
 * @param {Object} data - Event data from CloakManager
 * @param {Object} mainWindow - Electron mainWindow for event broadcasting
 */
async function handleProfileLaunched(data, mainWindow) {
  try {
    const profileName = data.profile;
    console.log('[CDP Orchestrator] handleProfileLaunched called for profile:', profileName);

    // DEBUG: Check what accounts exist with this profile name
    const debugAccounts = getDb().prepare(`
      SELECT a.id, a.username, a.platform, bs.browser_mode, bs.cloak_profile_name
      FROM reddit_accounts a
      LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
      WHERE bs.cloak_profile_name = ?
    `).all(profileName);
    console.log('[CDP Orchestrator] DEBUG: Found accounts with profile:', debugAccounts);

    // Check if this profile is using CloakManager mode
    // NOTE: More flexible query to handle existing profiles that might have browser_mode != 'cloakmanager'
    const account = getDb().prepare(`
      SELECT a.id, a.username, a.platform
      FROM reddit_accounts a
      LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
      WHERE bs.cloak_profile_name = ?
    `).get(profileName);

    if (!account) {
      console.log('[CDP Orchestrator] Profile not found, skipping auto-launch scripts');
      console.log('[CDP Orchestrator] DEBUG: No account found with profile_name:', profileName);
      return;
    }

    // Auto-fix: Update browser_mode if it's not set correctly
    const currentMode = getDb().prepare(`
      SELECT browser_mode FROM account_browser_settings WHERE account_id = ?
    `).get(account.id)?.browser_mode;

    if (currentMode !== 'cloakmanager') {
      console.log('[CDP Orchestrator] Auto-fixing browser_mode from', currentMode, 'to cloakmanager for account:', account.username);
      getDb().prepare(`
        UPDATE account_browser_settings
        SET browser_mode = 'cloakmanager'
        WHERE account_id = ?
      `).run(account.id);
    }

    // Don't start if there's already an active launch for this profile
    if (activeLaunches.has(profileName)) {
      console.log('[CDP Orchestrator] Launch already in progress for:', profileName);
      return;
    }

    console.log('[CDP Orchestrator] Starting launch sequence for account:', account.username);

    // Create launch context
    const context = {
      accountId: account.id,
      platform: account.platform,
      profileName: profileName
    };

    // Start launch sequence in background
    const launchPromise = executeLaunchSequenceWithTracking(profileName, context, mainWindow);

    activeLaunches.set(profileName, {
      promise: launchPromise,
      startedAt: Date.now(),
      context
    });

    // Clean up completed launches
    launchPromise.finally(() => {
      activeLaunches.delete(profileName);
    });

  } catch (error) {
    console.error('[CDP Orchestrator] Error handling profile launch:', error.message);
  }
}

/**
 * Execute launch sequence with progress tracking
 *
 * @param {string} profileName - Profile name
 * @param {Object} context - Execution context
 * @param {Object} mainWindow - Electron mainWindow
 * @returns {Promise<Object>} Launch sequence results
 */
async function executeLaunchSequenceWithTracking(profileName, context, mainWindow) {
  try {
    broadcastProgress(mainWindow, {
      profile: profileName,
      stage: 'connecting',
      progress: 0,
      message: 'Connecting to profile...'
    });

    const results = await scriptExecutor.executeLaunchSequence(profileName, context.accountId, context.platform);

    // Broadcast final status
    broadcastProgress(mainWindow, {
      profile: profileName,
      stage: 'completed',
      progress: 100,
      message: 'Launch sequence completed'
    });

    // Record execution in database
    await scriptExecutor.recordExecution(profileName, 'launch-sequence', 'launch', results);

    return results;

  } catch (error) {
    console.error('[CDP Orchestrator] Launch sequence failed:', error.message);

    broadcastProgress(mainWindow, {
      profile: profileName,
      stage: 'failed',
      progress: 0,
      message: `Launch failed: ${error.message}`
    });

    await scriptExecutor.recordExecution(profileName, 'launch-sequence', 'launch', null, error.message);

    throw error;
  }
}

/**
 * Handle profile stopped event - cleanup connections
 *
 * @param {Object} data - Event data from CloakManager
 */
async function handleProfileStopped(data) {
  try {
    const profileName = data.profile;
    console.log('[CDP Orchestrator] Cleaning up for stopped profile:', profileName);

    // Close CDP connection
    await connectionManager.closeConnection(profileName);

    // Cancel any active launch sequence
    const activeLaunch = activeLaunches.get(profileName);
    if (activeLaunch) {
      // The launch promise will be rejected, triggering cleanup
    }

    console.log('[CDP Orchestrator] Cleanup completed for:', profileName);
  } catch (error) {
    console.error('[CDP Orchestrator] Error handling profile stop:', error.message);
  }
}

/**
 * Handle CDP ready event - mark profile as ready for task scripts
 *
 * @param {Object} data - Event data from CloakManager
 */
function handleCDPReady(data) {
  try {
    const profileName = data.profile;
    console.log('[CDP Orchestrator] Profile marked as CDP ready:', profileName);

    // Mark profile as ready for task execution
    // (In production, this could update a state store or notify waiting tasks)

    // Verify connection is healthy
    connectionManager.verifyConnection(profileName).catch(error => {
      console.error('[CDP Orchestrator] CDP connection verification failed:', profileName, error.message);
    });

  } catch (error) {
    console.error('[CDP Orchestrator] Error handling CDP ready:', error.message);
  }
}

/**
 * Handle browser crashed event
 *
 * @param {Object} data - Event data from CloakManager
 */
async function handleBrowserCrashed(data) {
  try {
    console.error('[CDP Orchestrator] Browser crashed for profile:', data.profile);

    // Mark connection as unhealthy
    const connection = connectionManager.getProfileCDPInfo(data.profile);
    if (connection) {
      // Connection will be cleaned up by profile_stopped event
    }

    // Record crash event
    // (In production, might want to notify user)
  } catch (error) {
    console.error('[CDP Orchestrator] Error handling browser crash:', error.message);
  }
}

/**
 * Execute a task script on-demand
 *
 * @param {string} scriptId - Task script identifier
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Execution result
 */
async function executeTask(scriptId, context) {
  try {
    console.log('[CDP Orchestrator] Executing task:', scriptId, 'for account:', context.accountId);

    // Add to task queue
    const task = { scriptId, context };
    taskQueue.push(task);

    // Start queue processor if not running
    if (!queueProcessing) {
      startQueueProcessor();
    }

    // Wait for task to complete
    // (In production, this could use a proper task queue system)
    // For now, we'll execute immediately
    return await executeTaskNow(task);

  } catch (error) {
    console.error('[CDP Orchestrator] Task execution failed:', error.message);
    return { ok: false, error: error.message, scriptId };
  }
}

/**
 * Execute a task immediately (bypass queue)
 *
 * @param {Object} task - Task object with scriptId and context
 * @returns {Promise<Object>} Execution result
 */
async function executeTaskNow(task) {
  try {
    const { scriptId, context } = task;

    // Record execution start
    const startTime = Date.now();

    const result = await scriptExecutor.executeTaskScript(scriptId, context);

    // Record execution in database
    const profileName = await getProfileNameForAccount(context.accountId);
    if (profileName) {
      await scriptExecutor.recordExecution(
        profileName,
        scriptId,
        'task',
        result.ok ? result.result : null,
        result.ok ? null : result.error
      );
    }

    const executionTime = Date.now() - startTime;
    console.log('[CDP Orchestrator] Task completed in', executionTime, 'ms');

    return result;

  } catch (error) {
    console.error('[CDP Orchestrator] Immediate task execution failed:', error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Start task queue processor
 */
function startQueueProcessor() {
  if (queueProcessing) {
    return;
  }

  queueProcessing = true;
  processQueue();
}

/**
 * Process task queue
 */
async function processQueue() {
  while (taskQueue.length > 0 && queueProcessing) {
    const task = taskQueue.shift();
    try {
      await executeTaskNow(task);
    } catch (error) {
      console.error('[CDP Orchestrator] Queue task failed:', error.message);
    }
  }

  queueProcessing = false;
}

/**
 * Broadcast progress to renderer via main window
 *
 * @param {Object} mainWindow - Electron mainWindow
 * @param {Object} progressData - Progress data to broadcast
 */
function broadcastProgress(mainWindow, progressData) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cdp:progress', progressData);
    }
  } catch (error) {
    console.error('[CDP Orchestrator] Failed to broadcast progress:', error.message);
  }
}

/**
 * Get profile name for account
 *
 * @param {number} accountId - Account ID
 * @returns {Promise<string>} Profile name
 */
async function getProfileNameForAccount(accountId) {
  try {
    const db = getDb();

    const account = db.prepare(`
      SELECT bs.cloak_profile_name
      FROM reddit_accounts a
      LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
      WHERE a.id = ?
    `).get(accountId);

    return account?.cloak_profile_name || null;
  } catch (error) {
    console.error('[CDP Orchestrator] Failed to get profile name for account:', error.message);
    return null;
  }
}

/**
 * Check if an account has CDP capabilities available
 *
 * @param {number} accountId - Account ID to check
 * @returns {Promise<boolean>} true if CDP is available
 */
async function hasCDPAvailable(accountId) {
  try {
    // Check if account is in CloakManager mode
    const account = getDb().prepare(`
      SELECT a.username, a.platform, bs.cloak_profile_name, bs.browser_mode
      FROM reddit_accounts a
      LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
      WHERE a.id = ?
    `).get(accountId);

    if (!account || account.browser_mode !== 'cloakmanager' || !account.cloak_profile_name) {
      return false;
    }

    // Check if CloakManager backend is available
    const client = getCloakManagerClient();
    const available = await client.isAvailable();

    if (!available) {
      return false;
    }

    // Check if profile is running
    const running = await client.getRunningProfiles();
    const profileRunning = running.running && running.running[account.cloak_profile_name];

    return !!profileRunning;

  } catch (error) {
    console.error('[CDP Orchestrator] Failed to check CDP availability:', error.message);
    return false;
  }
}

/**
 * Get statistics about CDP operations
 *
 * @returns {Promise<Object>} Statistics object
 */
async function getStats() {
  try {
    const connectionStats = connectionManager.getConnectionStats();
    const cacheStats = scriptExecutor.getCacheStats();
    const activeLaunchCount = activeLaunches.size;
    const queueLength = taskQueue.length;

    return {
      connections: connectionStats,
      cache: cacheStats,
      activeLaunches: activeLaunchCount,
      queuedTasks: queueLength,
      queueProcessing
    };
  } catch (error) {
    console.error('[CDP Orchestrator] Failed to get stats:', error.message);
    return {
      connections: { total: 0, healthy: 0, unhealthy: 0 },
      cache: { total: 0, valid: 0, stale: 0 },
      activeLaunches: 0,
      queuedTasks: 0,
      queueProcessing: false
    };
  }
}

/**
 * Shutdown cleanup - close all connections and stop queue processing
 *
 * @returns {Promise<void>}
 */
async function shutdown() {
  console.log('[CDP Orchestrator] Shutting down...');

  // Stop queue processing
  queueProcessing = false;
  taskQueue.length = 0;

  // Wait for active launches to complete (with timeout)
  const timeout = 30000; // 30 seconds
  const startTime = Date.now();

  while (activeLaunches.size > 0 && Date.now() - startTime < timeout) {
    console.log('[CDP Orchestrator] Waiting for', activeLaunches.size, 'active launches to complete...');
    await sleep(1000);
  }

  // Clean up all connections
  await connectionManager.cleanupAllConnections();

  console.log('[CDP Orchestrator] Shutdown complete');
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Record execution (wrapper for script-executor function)
 * @param {string} profileName - Profile name
 * @param {string} scriptId - Script identifier
 * @param {string} category - Script category
 * @param {Object} result - Execution result
 * @param {string} error - Error message if failed
 */
async function recordExecution(profileName, scriptId, category, result, error) {
  try {
    await scriptExecutor.recordExecution(profileName, scriptId, category, result, error);
  } catch (error) {
    console.error('[CDP Orchestrator] Failed to record execution:', error.message);
  }
}

/**
 * Get execution history (wrapper for script-executor function)
 * @param {string} profileName - Profile name
 * @param {number} limit - Maximum records
 * @returns {Promise<Array>} Execution history
 */
async function getExecutionHistory(profileName, limit) {
  try {
    return await scriptExecutor.getExecutionHistory(profileName, limit);
  } catch (error) {
    console.error('[CDP Orchestrator] Failed to get execution history:', error.message);
    return [];
  }
}

/**
 * Test CDP connection for a profile
 * @param {number} accountId - Account ID to test connection for
 * @returns {Promise<Object>} Test result
 */
async function testConnection(accountId) {
  try {
    console.log('[CDP Orchestrator] Testing CDP connection for account:', accountId);

    // Get connection for account
    const connection = await connectionManager.getConnectionForAccount(accountId);
    if (!connection) {
      return {
        success: false,
        error: 'Failed to establish CDP connection',
        message: 'Could not connect to profile via CDP'
      };
    }

    // Run basic connection test
    const testScript = require('../cdp-scripts/test/basic-connection-test');
    const profileName = await getProfileNameForAccount(accountId);

    const result = await testScript.execute(connection, {
      accountId,
      profileName: profileName || 'unknown'
    });

    console.log('[CDP Orchestrator] Connection test result:', result);
    return result;

  } catch (error) {
    console.error('[CDP Orchestrator] Connection test failed:', error.message);
    return {
      success: false,
      error: error.message,
      message: 'CDP connection test failed'
    };
  }
}

module.exports = {
  // Initialization
  initialize,

  // Launch handling
  handleProfileLaunched,
  handleProfileStopped,
  handleCDPReady,
  handleBrowserCrashed,

  // Task execution
  executeTask,

  // Status checks
  hasCDPAvailable,
  getStats,

  // Testing
  testConnection,

  // Shutdown
  shutdown,

  // Utilities
  getProfileNameForAccount,
  recordExecution,
  getExecutionHistory,
  sleep
};