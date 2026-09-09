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
const { chromium } = require('playwright');
const { PlaywrightCDPAdapter } = require('./playwright-adapter');

/**
 * Connection pool cache
 * Map<profileName, { adapter, browser, context, page, createdAt, lastUsed, healthStatus, retryCount }>
 * `adapter` is the PlaywrightCDPAdapter handed to scripts (its `.native`
 * carries { browser, context, page }); `browser` is kept so we can really
 * close the CDP connection on stop.
 */
const connectionPool = new Map();

/** How stale a pooled connection may be before we re-verify it on reuse. */
const REVERIFY_AFTER_MS = 30 * 1000;

// A "real" page — not a blank/internal tab. Launch/task scripts should drive
// one of these, never chrome://newtab or about:blank.
function isRealPageUrl(u) {
  return !!u && !/^(about:|chrome:|chrome-extension:|devtools:|edge:)/i.test(u);
}

/**
 * Deterministically choose the page a script should drive.
 * Prefer the most-recently-opened real tab; fall back to page 0; last resort
 * wait for a page to appear.
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<import('playwright').Page>}
 */
async function pickPage(context) {
  const pages = context.pages();
  const real = pages.filter((p) => {
    try { return isRealPageUrl(p.url()); } catch { return false; }
  });
  if (real.length) return real[real.length - 1];
  if (pages.length) return pages[0];
  return context.waitForEvent('page', { timeout: 15000 });
}

/**
 * Attach to an already-running CloakManager profile over CDP.
 * Reuses the existing context/page — never creates a new context — so the
 * profile's fingerprint + session state are preserved.
 *
 * @param {string} cdpWsUrl
 * @returns {Promise<{ adapter: PlaywrightCDPAdapter, browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page }>}
 */
async function connectToProfile(cdpWsUrl) {
  const browser = await chromium.connectOverCDP(cdpWsUrl);
  try {
    const contexts = browser.contexts();
    if (!contexts || contexts.length === 0) {
      throw new Error('No browser contexts available');
    }
    const context = contexts[0];
    const page = await pickPage(context);
    const adapter = new PlaywrightCDPAdapter(browser, context, page);
    return { adapter, browser, context, page };
  } catch (err) {
    try { await browser.close(); } catch { /* ignore */ }
    throw new Error(`Playwright connection failed: ${err.message}`);
  }
}

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
    // Reuse a healthy cached connection. If it's been idle a while, verify it
    // still responds before handing it back.
    const cached = connectionPool.get(profileName);
    if (cached && cached.healthStatus === 'healthy' && isConnectionValid(cached)) {
      const stale = Date.now() - cached.lastUsed > REVERIFY_AFTER_MS;
      if (!stale || await verifyConnection(profileName)) {
        console.log('[CDP Connection Manager] Reusing cached connection for:', profileName);
        cached.lastUsed = Date.now();
        return cached.adapter;
      }
      console.log('[CDP Connection Manager] Cached connection failed re-verify, reconnecting:', profileName);
    }

    // Clean up stale/dead connection if exists
    if (connectionPool.has(profileName)) {
      await closeConnection(profileName).catch(() => {});
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

    // Cache it — `connection` is { adapter, browser, context, page }.
    connectionPool.set(profileName, {
      ...connection,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      healthStatus: 'healthy',
      retryCount: 0
    });

    console.log('[CDP Connection Manager] ✅ New connection created for:', profileName);
    return connection.adapter;

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
  const cached = connectionPool.get(profileName);
  if (!cached) return false;
  connectionPool.delete(profileName);
  // Real close. `browser` is a connectOverCDP client — closing it detaches
  // our CDP session; it does NOT terminate the CloakManager Chromium (that's
  // CloakManager's `stopProfile`). Verified by testCDPConnection() which
  // close()s after every launch check.
  try {
    await cached.browser.close();
  } catch (error) {
    console.warn('[CDP Connection Manager] browser.close() error:', error.message);
  }
  try { cached.adapter && cached.adapter.close && cached.adapter.close(); } catch { /* ignore */ }
  console.log('[CDP Connection Manager] ❌ Connection closed and removed:', profileName);
  return true;
}

/**
 * Check if a cached connection is still valid (within TTL and not too old)
 *
 * @param {Object} cached - Cached connection object
 * @returns {boolean} true if connection is valid for reuse
 */
function isConnectionValid(cached) {
  if (Date.now() - cached.lastUsed > CONNECTION_TTL) return false;
  if (cached.healthStatus !== 'healthy') return false;
  if (!cached.adapter || !cached.browser) return false;
  // Playwright browsers expose isConnected(); if the CDP socket dropped this
  // is false and we must reconnect.
  try {
    if (typeof cached.browser.isConnected === 'function' && !cached.browser.isConnected()) {
      return false;
    }
  } catch { return false; }
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

    // Lightweight liveness probe against the pooled page.
    await Promise.race([
      cached.page.evaluate('1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('health probe timeout')), 3000)),
    ]);

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

    // Get effective CM profile name from model_profiles or override
    const account = db.prepare(`
      SELECT a.username, a.platform,
             COALESCE(bs.cloak_profile_override, mp.cloak_profile_name) AS effective_cm_name
      FROM reddit_accounts a
      JOIN model_profiles mp ON mp.id = a.profile_id
      LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
      WHERE a.id = ?
    `).get(accountId);

    if (!account || !account.effective_cm_name) {
      return null;
    }

    // Get CDP connection info
    const profileInfo = await getProfileCDPInfo(account.effective_cm_name);
    if (!profileInfo || !profileInfo.cdp_ws_url) {
      console.error('[CDP Connection Manager] Missing cdp_ws_url in profile info:', profileInfo);
      return null;
    }

    // Get or create connection
    const connection = await getConnection(account.effective_cm_name, profileInfo.cdp_ws_url);
    return connection;
  } catch (error) {
    console.error('[CDP Connection Manager] Error getting connection for account:', error.message);
    return null;
  }
}

/**
 * Get connection for a profile directly by name — for a model-level launch
 * with no specific account in play (e.g. the generic "Open Browser" button
 * on a model's shared CloakManager profile, before any account is targeted).
 *
 * @param {string} profileName
 * @returns {Promise<Object|null>} Connection or null
 */
async function getConnectionForProfile(profileName) {
  try {
    if (!profileName) return null;
    const profileInfo = await getProfileCDPInfo(profileName);
    if (!profileInfo || !profileInfo.cdp_ws_url) {
      console.error('[CDP Connection Manager] Missing cdp_ws_url in profile info:', profileInfo);
      return null;
    }
    return await getConnection(profileName, profileInfo.cdp_ws_url);
  } catch (error) {
    console.error('[CDP Connection Manager] Error getting connection for profile:', error.message);
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
 * Close every pooled connection. Called on app shutdown.
 * @returns {Promise<number>} number closed
 */
async function cleanupAllConnections() {
  const names = [...connectionPool.keys()];
  for (const profileName of names) {
    await closeConnection(profileName).catch(() => {});
  }
  console.log('[CDP Connection Manager] Closed', names.length, 'connections');
  return names.length;
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
  console.log('[CDP Connection Manager] Testing Playwright connection to:', cdpWsUrl);

  try {
    const { chromium } = require('playwright');

    // Playwright handles browser/page endpoints automatically
    const browser = await chromium.connectOverCDP(cdpWsUrl);

    // CRITICAL FIX: browser.contexts() is a method, not a property
    const contexts = browser.contexts();
    if (!contexts || contexts.length === 0) {
      throw new Error('No contexts available');
    }

    const context = contexts[0];

    // CRITICAL FIX: context.pages() is a method, not a property
    const pages = context.pages();
    const page = (pages && pages.length > 0)
      ? pages[0]
      : await context.waitForEvent('page');

    // Test basic functionality
    await page.goto('about:blank');
    const title = await page.title();

    // NOTE: Test empirically whether browser.close() is safe
    // May need to just drop reference instead
    // For now, we'll test the safer approach - just drop references
    await browser.close();

    console.log('[CDP Connection Manager] ✅ Playwright connection test SUCCESS');
    console.log('[CDP Connection Manager] Page title:', title);
    return { success: true, title };
  } catch (error) {
    console.error('[CDP Connection Manager] ❌ Connection test FAILED:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  // Connection lifecycle
  getConnection,
  releaseConnection,
  closeConnection,
  getConnectionForAccount,
  getConnectionForProfile,

  // Profile info
  getProfileCDPInfo,
  verifyConnection,

  // Testing
  testCDPConnection,

  // Pool management
  cleanupStaleConnections,
  cleanupAllConnections,
  getConnectionStats,

  // Initialization
  startPeriodicCleanup,

  // Utilities
  sleep
};