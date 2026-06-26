/**
 * CDP Connection Manager
 *
 * Manages CDP connections to CloakManager profiles with:
 * - Connection pooling for reuse
 * - Automatic cleanup and lifecycle management
 * - Error handling and retry logic
 * - Connection verification and health checks
 *
 * @module cdp/connection-manager
 */

const { getDb } = require('../db');
const { connectToProfile, closeConnection: closeCDPConnection } = require('../cdp-automation');

/**
 * Connection pool cache
 * Map<profileName, { connection, createdAt, lastUsed, healthStatus, retryCount }>
 */
const connectionPool = new Map();

/**
 * Connection TTL in milliseconds - connections are reusable for 5 minutes
 */
const CONNECTION_TTL = 5 * 60 * 1000;

/**
 * Maximum retry attempts for failed connections
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Base retry delay in milliseconds
 */
const RETRY_DELAY_MS = 1000;

/**
 * Connection health check interval
 */
const HEALTH_CHECK_INTERVAL = 30 * 1000;

/**
 * Get or create a CDP connection for a profile
 *
 * @param {string} profileName - Profile name to connect to
 * @param {string} cdpWsUrl - WebSocket URL for CDP connection
 * @returns {Promise<Object>} Connection object with client and domains
 */
async function getConnection(profileName, cdpWsUrl) {
  try {
    // Check if we have a healthy cached connection
    const cached = connectionPool.get(profileName);
    if (cached && cached.healthStatus === 'healthy' && isConnectionValid(cached)) {
      console.log('[CDP Connection Manager] Reusing cached connection for:', profileName);
      cached.lastUsed = Date.now();
      return cached.connection;
    }

    // Clean up stale connection if exists
    if (cached) {
      console.log('[CDP Connection Manager] Cleaning up stale connection for:', profileName);
      await closeConnection(profileName).catch(() => {});
      connectionPool.delete(profileName);
    }

    // Create new connection with retry logic and startup delays
    let connection = null;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        console.log('[CDP Connection Manager] Connection attempt', attempt, 'for:', profileName);

        // Add progressive delays for browser startup time
        if (attempt > 1) {
          const startupDelay = Math.min(2000 * attempt, 5000); // Max 5s delay
          console.log('[CDP Connection Manager] Waiting', startupDelay, 'ms for browser startup...');
          await sleep(startupDelay);
        }

        connection = await connectToProfile(cdpWsUrl);
        break;
      } catch (error) {
        lastError = error;
        console.error('[CDP Connection Manager] Connection attempt', attempt, 'failed:', error.message);

        // Always retry on connection errors - browser might still be starting up
        if (attempt < MAX_RETRY_ATTEMPTS) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log('[CDP Connection Manager] Retrying in', delay, 'ms...');
          await sleep(delay);
        }
      }
    }

    if (!connection) {
      throw new Error(`Failed to connect to profile ${profileName}: ${lastError?.message || 'Unknown error'}`);
    }

    // Cache the connection
    connectionPool.set(profileName, {
      connection,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      healthStatus: 'healthy',
      retryCount: 0
    });

    console.log('[CDP Connection Manager] ✅ New connection created for:', profileName);
    return connection;

  } catch (error) {
    console.error('[CDP Connection Manager] ❌ Failed to get connection:', error.message);
    throw error;
  }
}

/**
 * Release a connection back to the pool (for reuse)
 *
 * @param {string} profileName - Profile name whose connection to release
 * @returns {Promise<boolean>} true if connection was released
 */
async function releaseConnection(profileName) {
  try {
    const cached = connectionPool.get(profileName);
    if (!cached) {
      return false;
    }

    // Mark connection as available for reuse
    cached.lastUsed = Date.now();
    console.log('[CDP Connection Manager] Released connection for:', profileName);

    return true;
  } catch (error) {
    console.error('[CDP Connection Manager] Error releasing connection:', error.message);
    return false;
  }
}

/**
 * Close and remove a connection from the pool
 *
 * @param {string} profileName - Profile name whose connection to close
 * @returns {Promise<boolean>} true if connection was closed
 */
async function closeConnection(profileName) {
  try {
    const cached = connectionPool.get(profileName);
    if (!cached) {
      return false;
    }

    await closeCDPConnection(cached.connection);
    connectionPool.delete(profileName);
    console.log('[CDP Connection Manager] ❌ Connection closed and removed:', profileName);

    return true;
  } catch (error) {
    console.error('[CDP Connection Manager] Error closing connection:', error.message);
    return false;
  }
}

/**
 * Check if a cached connection is still valid (within TTL and not too old)
 *
 * @param {Object} cached - Cached connection object
 * @returns {boolean} true if connection is valid for reuse
 */
function isConnectionValid(cached) {
  const now = Date.now();

  // Check TTL
  if (now - cached.lastUsed > CONNECTION_TTL) {
    return false;
  }

  // Check if connection is healthy
  if (cached.healthStatus !== 'healthy') {
    return false;
  }

  // Check if connection exists
  if (!cached.connection || !cached.connection.client) {
    return false;
  }

  return true;
}

/**
 * Get CDP connection info for a profile
 * Always fetches fresh data from CloakManager API to avoid stale cache issues
 *
 * @param {string} profileName - Profile name
 * @returns {Promise<Object|null>} Profile info with CDP details
 */
async function getProfileCDPInfo(profileName) {
  try {
    console.log('[CDP Connection Manager] Fetching fresh CDP info from CloakManager API for:', profileName);

    // Always fetch from API to ensure we get the current/accurate CDP endpoint
    const apiProfile = await getProfileInfoFromAPI(profileName);

    if (!apiProfile) {
      console.error('[CDP Connection Manager] Failed to get profile info from CloakManager API');
      return null;
    }

    // Debug logging to see actual URL
    console.log('[CDP Connection Manager] ✅ Fresh CDP info fetched:', {
      cdp_port: apiProfile.cdp_port,
      cdp_ws_url: apiProfile.cdp_ws_url || 'MISSING',
      status: apiProfile.status
    });

    // Verify we have the required WebSocket URL
    if (!apiProfile.cdp_ws_url) {
      console.error('[CDP Connection Manager] API returned profile without cdp_ws_url');
      return null;
    }

    // Update database cache for reference, but always return fresh API data
    try {
      const db = getDb();
      db.prepare(`
        UPDATE cloakmanager_profiles
        SET cdp_port = ?, cdp_url = ?, cdp_ws_url = ?, fp_seed = ?, status = ?
        WHERE profile_name = ?
      `).run(
        apiProfile.cdp_port || null,
        apiProfile.cdp_url || null,
        apiProfile.cdp_ws_url || null,
        apiProfile.fp_seed || null,
        apiProfile.status || 'running',
        profileName
      );
    } catch (dbError) {
      console.warn('[CDP Connection Manager] Failed to update database cache:', dbError.message);
    }

    return apiProfile;
  } catch (error) {
    console.error('[CDP Connection Manager] Error getting profile CDP info:', error.message);
    return null;
  }
}

/**
 * Get profile info directly from CloakManager API
 * @param {string} profileName - Profile name
 * @returns {Promise<Object|null>} Profile info from API
 */
async function getProfileInfoFromAPI(profileName) {
  try {
    const client = require('../cloakmanager').getCloakManagerClient();
    console.log('[CDP Connection Manager] Fetching profile info from CloakManager API for:', profileName);

    const details = await client.getProfileInfo(profileName);
    console.log('[CDP Connection Manager] API response:', {
      profile_name: details.profile_name,
      cdp_port: details.cdp_port,
      cdp_ws_url: details.cdp_ws_url ? 'present' : 'missing'
    });

    if (!details.cdp_ws_url) {
      console.warn('[CDP Connection Manager] API response missing cdp_ws_url, profile might not be fully launched');
    }

    return details;
  } catch (apiError) {
    console.error('[CDP Connection Manager] Failed to get profile info from API:', apiError.message);
    return null;
  }
}

/**
 * Verify a connection is still alive and working
 *
 * @param {string} profileName - Profile name to verify
 * @returns {Promise<boolean>} true if connection is alive
 */
async function verifyConnection(profileName) {
  try {
    const cached = connectionPool.get(profileName);
    if (!cached) {
      return false;
    }

    // Simple health check - try to execute a simple script
    const { Runtime } = cached.connection;
    await Runtime.evaluate({
      expression: 'document.readyState',
      timeout: 5000
    });

    cached.healthStatus = 'healthy';
    cached.retryCount = 0;
    return true;
  } catch (error) {
    console.error('[CDP Connection Manager] Health check failed for', profileName, ':', error.message);

    const cached = connectionPool.get(profileName);
    if (cached) {
      cached.healthStatus = 'unhealthy';
      cached.retryCount = (cached.retryCount || 0) + 1;

      // If too many retries, close the connection
      if (cached.retryCount >= 3) {
        await closeConnection(profileName);
      }
    }

    return false;
  }
}

/**
 * Get connection for an account (by resolving profile name)
 *
 * @param {number} accountId - Account ID
 * @returns {Promise<Object|null>} Connection or null
 */
async function getConnectionForAccount(accountId) {
  try {
    const db = getDb();

    // Get account and its CloakManager profile name
    const account = db.prepare(`
      SELECT a.username, a.platform, bs.cloak_profile_name
      FROM reddit_accounts a
      LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
      WHERE a.id = ?
    `).get(accountId);

    if (!account || !account.cloak_profile_name) {
      return null;
    }

    // Get CDP connection info
    const profileInfo = await getProfileCDPInfo(account.cloak_profile_name);
    if (!profileInfo || !profileInfo.cdp_ws_url) {
      console.error('[CDP Connection Manager] Missing cdp_ws_url in profile info:', profileInfo);
      return null;
    }

    // Get or create connection
    const connection = await getConnection(account.cloak_profile_name, profileInfo.cdp_ws_url);
    return connection;
  } catch (error) {
    console.error('[CDP Connection Manager] Error getting connection for account:', error.message);
    return null;
  }
}

/**
 * Clean up stale connections (connections not used recently)
 * Should be called periodically
 *
 * @returns {Promise<number>} Number of connections cleaned up
 */
async function cleanupStaleConnections() {
  const now = Date.now();
  const profilesToClose = [];

  // Find stale connections
  for (const [profileName, cached] of connectionPool.entries()) {
    if (!isConnectionValid(cached)) {
      profilesToClose.push(profileName);
    }
  }

  // Close stale connections
  for (const profileName of profilesToClose) {
    await closeConnection(profileName);
  }

  console.log('[CDP Connection Manager] Cleaned up', profilesToClose.length, 'stale connections');
  return profilesToClose.length;
}

/**
 * Get statistics about current connection pool
 *
 * @returns {Object} Connection pool statistics
 */
function getConnectionStats() {
  const now = Date.now();
  const stats = {
    total: connectionPool.size,
    healthy: 0,
    unhealthy: 0,
    stale: 0,
    oldestConnection: null,
    newestConnection: null
  };

  let oldestTime = now;
  let newestTime = 0;

  for (const [profileName, cached] of connectionPool.entries()) {
    if (cached.healthStatus === 'healthy') {
      stats.healthy++;
    } else {
      stats.unhealthy++;
    }

    if (!isConnectionValid(cached)) {
      stats.stale++;
    }

    if (cached.createdAt < oldestTime) {
      oldestTime = cached.createdAt;
    }
    if (cached.createdAt > newestTime) {
      newestTime = cached.createdAt;
    }
  }

  if (oldestTime !== now) {
    stats.oldestConnection = new Date(oldestTime).toISOString();
  }
  if (newestTime !== 0) {
    stats.newestConnection = new Date(newestTime).toISOString();
  }

  return stats;
}

/**
 * Initialize periodic cleanup of stale connections
 */
function startPeriodicCleanup() {
  // Run cleanup every 2 minutes
  setInterval(async () => {
    try {
      await cleanupStaleConnections();
    } catch (error) {
      console.error('[CDP Connection Manager] Periodic cleanup error:', error.message);
    }
  }, 2 * 60 * 1000);

  console.log('[CDP Connection Manager] Periodic cleanup started');
}

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test CDP connection directly
 * @param {string} cdpWsUrl - WebSocket URL for CDP connection
 * @returns {Promise<Object>} Test result with success status
 */
async function testCDPConnection(cdpWsUrl) {
  console.log('[CDP Connection Manager] Testing CDP connection to:', cdpWsUrl);

  try {
    const CDP = require('chrome-remote-interface');

    // Check if this is a browser-level or page-level endpoint
    const isBrowserEndpoint = cdpWsUrl.includes('/devtools/browser/');

    let client, targetInfo;

    if (isBrowserEndpoint) {
      console.log('[CDP Connection Manager] 🔍 Browser-level endpoint detected, need to find page target');

      // Connect to browser endpoint first
      const browserClient = await CDP({ target: cdpWsUrl, local: true });
      console.log('[CDP Connection Manager] 🔍 Connected to browser, fetching targets...');

      // Get the first available page target
      const { targetInfos } = await browserClient.Target.getTargets();
      console.log('[CDP Connection Manager] 🔍 Available targets:', targetInfos?.length || 0);

      // Debug: Log target structure to understand what fields are available
      if (targetInfos && targetInfos.length > 0) {
        console.log('[CDP Connection Manager] 🔍 First target structure:', JSON.stringify(targetInfos[0], null, 2));
      }

      // Find a page target
      const pageTarget = targetInfos?.find(target =>
        target.type === 'page' ||
        target.type === 'webview' ||
        target.url?.startsWith('http') ||
        target.url?.startsWith('about:blank')
      );

      if (!pageTarget) {
        console.error('[CDP Connection Manager] ❌ No page target found, available targets:', targetInfos);
        await browserClient.close();
        return { success: false, error: 'No page target found in browser' };
      }

      console.log('[CDP Connection Manager] ✅ Found page target:', pageTarget.type, pageTarget.url);
      targetInfo = pageTarget;

      // Try different methods to get the WebSocket URL
      let pageWsUrl;
      if (pageTarget.webSocketDebuggerUrl) {
        pageWsUrl = `ws://127.0.0.1:${cdpWsUrl.match(/:(\d+)\//)[1]}${pageTarget.webSocketDebuggerUrl}`;
      } else if (pageTarget.targetId) {
        // Use targetId to construct page WebSocket URL
        pageWsUrl = `ws://127.0.0.1:${cdpWsUrl.match(/:(\d+)\//)[1]}/devtools/page/${pageTarget.targetId}`;
      } else if (pageTarget.id) {
        // Alternative: construct from legacy id field
        pageWsUrl = `ws://127.0.0.1:${cdpWsUrl.match(/:(\d+)\//)[1]}/devtools/page/${pageTarget.id}`;
      } else {
        console.error('[CDP Connection Manager] ❌ Cannot construct page WebSocket URL. Target fields:', Object.keys(pageTarget));
        console.error('[CDP Connection Manager] ❌ Target data:', pageTarget);
        await browserClient.close();
        return { success: false, error: 'Cannot determine page WebSocket URL from target' };
      }

      console.log('[CDP Connection Manager] 🔍 Connecting to page target for test:', pageWsUrl);

      // Close browser connection
      await browserClient.close();

      // Connect to the page target
      client = await CDP({ target: pageWsUrl, local: true });

    } else {
      // Direct connection to page endpoint
      client = await CDP({ target: cdpWsUrl, local: true });

      // For page-level connections, we can't use Target domain
      // Use basic page info instead
      targetInfo = { type: 'page', url: cdpWsUrl };
    }

    // Test basic CDP functionality
    await client.Page.enable();

    await client.close();

    console.log('[CDP Connection Manager] ✅ CDP connection test SUCCESS');
    console.log('[CDP Connection Manager] Target info:', targetInfo);
    return { success: true, targetInfo: targetInfo };
  } catch (error) {
    console.error('[CDP Connection Manager] ❌ CDP connection test FAILED:', error.message);
    console.error('[CDP Connection Manager] Error details:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  // Connection lifecycle
  getConnection,
  releaseConnection,
  closeConnection,
  getConnectionForAccount,

  // Profile info
  getProfileCDPInfo,
  verifyConnection,

  // Testing
  testCDPConnection,

  // Pool management
  cleanupStaleConnections,
  getConnectionStats,

  // Initialization
  startPeriodicCleanup,

  // Utilities
  sleep
};