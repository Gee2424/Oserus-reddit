/**
 * CDP Automation Utilities
 *
 * This module provides CDP-based automation for CloakManager profiles.
 * Intended for AI automation, login automation, and advanced control.
 *
 * Chrome DevTools Protocol (CDP) allows programmatic control of Chrome browsers:
 * - Navigation control (go to URLs, back/forward)
 * - Form filling and submission (auto-login)
 * - Content extraction (get page data)
 * - Script execution (run JavaScript in browser)
 * - Performance monitoring and debugging
 *
 * @module cdp-automation
 */

const CDP = require('chrome-remote-interface');

/**
 * Active CDP connections cache for reuse and cleanup
 * Map<profileName, { client, connections, createdAt, lastUsed }>
 */
const activeConnections = new Map();

/**
 * Connection timeout in milliseconds
 */
const CONNECTION_TIMEOUT = 15000;

/**
 * Script injection timeout
 */
const SCRIPT_TIMEOUT = 10000;

/**
 * Navigate timeout
 */
const NAVIGATION_TIMEOUT = 30000;

/**
 * Page load timeout (for dynamic content)
 */
const PAGE_LOAD_TIMEOUT = 45000;

/**
 * Connect to a CloakManager profile via CDP
 *
 * @param {string} cdpWsUrl - WebSocket URL from profile launch (e.g., "ws://127.0.0.1:54193/devtools/browser/...")
 * @returns {Promise<Object>} CDP client with access to DOM, Network, Page, Runtime APIs
 *
 * @example
 * const client = await connectToProfile(cdpWsUrl);
 * await client.Page.navigate({ url: 'https://www.reddit.com' });
 */
async function connectToProfile(cdpWsUrl) {
  try {
    console.log('[CDP] Connecting to:', cdpWsUrl);

    // Check if this is a browser-level or page-level endpoint
    const isBrowserEndpoint = cdpWsUrl.includes('/devtools/browser/');

    let client;
    if (isBrowserEndpoint) {
      console.log('[CDP] 🔍 Browser-level endpoint detected, need to find page target');

      // Connect to browser endpoint first
      const browserClient = await CDP({
        target: cdpWsUrl,
        local: true
      });

      console.log('[CDP] 🔍 Connected to browser, fetching targets...');

      // Get the first available page target
      const { targetInfos } = await browserClient.Target.getTargets();
      console.log('[CDP] 🔍 Available targets:', targetInfos?.length || 0);

      // Debug: Log target structure to understand what fields are available
      if (targetInfos && targetInfos.length > 0) {
        console.log('[CDP] 🔍 First target structure:', JSON.stringify(targetInfos[0], null, 2));
      }

      // Find a page target (type === 'page' or 'webview')
      const pageTarget = targetInfos?.find(target =>
        target.type === 'page' ||
        target.type === 'webview' ||
        target.url?.startsWith('http') ||
        target.url?.startsWith('about:blank')
      );

      if (!pageTarget) {
        console.error('[CDP] ❌ No page target found, available targets:', targetInfos);
        await browserClient.close();
        throw new Error('No page target found in browser');
      }

      console.log('[CDP] ✅ Found page target:', pageTarget.type, pageTarget.url);

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
        console.error('[CDP] ❌ Cannot construct page WebSocket URL. Target fields:', Object.keys(pageTarget));
        console.error('[CDP] ❌ Target data:', pageTarget);
        await browserClient.close();
        throw new Error('Cannot determine page WebSocket URL from target');
      }

      console.log('[CDP] 🔍 Connecting to page target:', pageWsUrl);

      // Close browser connection
      await browserClient.close();

      // Connect to the page target
      client = await CDP({
        target: pageWsUrl,
        local: true
      });

    } else {
      // Direct connection to page endpoint
      client = await CDP({
        target: cdpWsUrl,
        local: true
      });
    }

    // Enable essential domains
    await Promise.all([
      client.Page.enable(),
      client.DOM.enable(),
      client.Network.enable(),
      client.Runtime.enable(),
      client.Log.enable()
    ]);

    // REMOVED: Network.setUserAgentOverride() call
    // CloakBrowser handles user agent via seed-based fingerprinting.
    // Hardcoded UAs break fingerprint coherence and should never be set via CDP.
    // Future migration to Playwright will properly respect CloakBrowser's stealth model.

    console.log('[CDP] ✅ Connected successfully');

    // Store in active connections
    const profileName = extractProfileNameFromUrl(cdpWsUrl);
    if (profileName) {
      activeConnections.set(profileName, {
        client,
        connections: { Page: client.Page, DOM: client.DOM, Network: client.Network, Runtime: client.Runtime, Log: client.Log, Target: client.Target },
        createdAt: Date.now(),
        lastUsed: Date.now()
      });
    }

    return {
      client,
      Page: client.Page,
      DOM: client.DOM,
      Network: client.Network,
      Runtime: client.Runtime,
      Log: client.Log,
      Target: client.Target
    };
  } catch (error) {
    console.error('[CDP] ❌ Connection failed:', error.message);
    throw new Error(`CDP connection failed: ${error.message}`);
  }
}

/**
 * Extract profile name from CDP WebSocket URL
 * @param {string} cdpWsUrl - WebSocket URL
 * @returns {string|null} Profile name or null
 */
function extractProfileNameFromUrl(cdpWsUrl) {
  try {
    const url = new URL(cdpWsUrl);
    // WebSocket URL format: ws://host:port/devtools/browser/...
    // Profile name is usually the browser name or can be extracted from the path
    const pathParts = url.pathname.split('/');
    return pathParts[pathParts.length - 1] || null;
  } catch {
    return null;
  }
}

/**
 * Safely close a CDP connection
 *
 * @param {string} profileName - Profile name whose connection to close
 * @returns {Promise<boolean>} true if connection was closed
 */
async function closeConnection(profileName) {
  try {
    const connection = activeConnections.get(profileName);
    if (connection && connection.client) {
      await connection.client.close();
      activeConnections.delete(profileName);
      console.log('[CDP] Connection closed for profile:', profileName);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[CDP] Error closing connection:', error.message);
    return false;
  }
}

/**
 * Get active connection for a profile
 *
 * @param {string} profileName - Profile name
 * @returns {Object|null} Connection object or null
 */
function getActiveConnection(profileName) {
  const connection = activeConnections.get(profileName);
  if (connection) {
    connection.lastUsed = Date.now();
    return connection;
  }
  return null;
}

/**
 * Navigate to a specific URL
 *
 * @param {Object} connection - CDP connection from connectToProfile()
 * @param {string} url - Target URL
 * @returns {Promise<string>} Final URL after redirects
 *
 * @example
 * await navigateToUrl(connection, 'https://www.reddit.com/r/javascript');
 */
async function navigateToUrl(connection, url) {
  try {
    const { Page } = connection;

    console.log('[CDP] Navigating to:', url);

    await Page.navigate({ url });
    await Page.loadEventFired();

    // Get final URL after any redirects
    const result = await connection.Runtime.evaluate({
      expression: 'window.location.href'
    });

    const finalUrl = result.result.value;
    console.log('[CDP] Navigation complete, final URL:', finalUrl);

    return finalUrl;
  } catch (error) {
    console.error('[CDP] Navigation failed:', error.message);
    throw new Error(`Navigation failed: ${error.message}`);
  }
}

/**
 * Extract page data (title, URL, content, etc.)
 *
 * @param {Object} connection - CDP connection
 * @returns {Promise<Object>} Page data including title, URL, text content
 *
 * @example
 * const pageData = await extractPageData(connection);
 * console.log(pageData.title, pageData.url);
 */
async function extractPageData(connection) {
  try {
    const { Runtime } = connection;

    const script = `
      (() => {
        return {
          title: document.title,
          url: window.location.href,
          text: document.body ? document.body.innerText : '',
          html: document.body ? document.body.innerHTML.substring(0, 10000) : '',
          timestamp: Date.now()
        };
      })()
    `;

    const result = await Runtime.evaluate({
      expression: script,
      timeout: SCRIPT_TIMEOUT
    });

    console.log('[CDP] Page data extracted:', result.result.value.title);
    return result.result.value;
  } catch (error) {
    console.error('[CDP] Page data extraction failed:', error.message);
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

/**
 * Execute JavaScript in browser context
 *
 * @param {Object} connection - CDP connection
 * @param {string} script - JavaScript code to execute
 * @param {Object} options - Execution options
 * @returns {Promise<any>} Script execution result
 *
 * @example
 * const result = await executeScript(connection, 'document.querySelectorAll(".post").length');
 */
async function executeScript(connection, script, options = {}) {
  try {
    const { Runtime } = connection;

    const result = await Runtime.evaluate({
      expression: script,
      awaitPromise: true,
      timeout: options.timeout || SCRIPT_TIMEOUT,
      returnByValue: options.returnByValue !== false
    });

    console.log('[CDP] Script executed successfully');
    return result.result.value;
  } catch (error) {
    console.error('[CDP] Script execution failed:', error.message);
    throw new Error(`Script execution failed: ${error.message}`);
  }
}

/**
 * Take a screenshot of the current page
 *
 * @param {Object} connection - CDP connection
 * @param {Object} options - Screenshot options
 * @returns {Promise<Buffer>} Screenshot image data
 *
 * @example
 * const screenshot = await takeScreenshot(connection);
 * require('fs').writeFileSync('screenshot.png', screenshot);
 */
async function takeScreenshot(connection, options = {}) {
  try {
    const { Page } = connection;

    const screenshotOptions = {
      format: options.format || 'png',
      quality: options.quality || 80,
      clip: options.clip ? {
        x: 0, y: 0, width: options.clip.width, height: options.clip.height, scale: 1
      } : undefined,
      fromSurface: true
    };

    const result = await Page.captureScreenshot(screenshotOptions);
    const buffer = Buffer.from(result.data, 'base64');

    console.log('[CDP] Screenshot captured, size:', buffer.length);
    return buffer;
  } catch (error) {
    console.error('[CDP] Screenshot failed:', error.message);
    throw new Error(`Screenshot failed: ${error.message}`);
  }
}

/**
 * Wait for element to appear on page
 *
 * @param {Object} connection - CDP connection
 * @param {string} selector - CSS selector
 * @param {number} timeout - Maximum wait time in ms
 * @returns {Promise<boolean>} true if element found
 */
async function waitForElement(connection, selector, timeout = 10000) {
  const startTime = Date.now();
  const { Runtime } = connection;

  while (Date.now() - startTime < timeout) {
    const result = await Runtime.evaluate({
      expression: `document.querySelector('${selector}') !== null`,
      timeout: 2000
    });

    if (result.result.value) {
      return true;
    }

    await sleep(100);
  }

  return false;
}

/**
 * Click element via CDP
 *
 * @param {Object} connection - CDP connection
 * @param {string} selector - CSS selector
 * @returns {Promise<boolean>} true if click successful
 */
async function clickElement(connection, selector) {
  const { Runtime } = connection;

  const script = `
    (() => {
      const element = document.querySelector('${selector}');
      if (element) {
        element.click();
        return true;
      }
      return false;
    })()
  `;

  const result = await Runtime.evaluate({
    expression: script,
    timeout: SCRIPT_TIMEOUT
  });

  return result.result.value;
}

/**
 * Fill form field via CDP
 *
 * @param {Object} connection - CDP connection
 * @param {string} selector - CSS selector
 * @param {string} value - Value to fill
 * @returns {Promise<boolean>} true if fill successful
 */
async function fillField(connection, selector, value) {
  const { Runtime } = connection;

  const script = `
    (() => {
      const element = document.querySelector('${selector}');
      if (element) {
        element.value = '${value}';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `;

  const result = await Runtime.evaluate({
    expression: script,
    timeout: SCRIPT_TIMEOUT
  });

  return result.result.value;
}

/**
 * Scroll page to load more content
 *
 * @param {Object} connection - CDP connection
 * @param {number} scrollCount - Number of times to scroll
 * @returns {Promise<void>}
 */
async function scrollToLoadContent(connection, scrollCount = 5) {
  const { Runtime } = connection;

  for (let i = 0; i < scrollCount; i++) {
    await Runtime.evaluate({
      expression: `window.scrollBy(0, 900)`,
      timeout: 5000
    });
    await sleep(600);
  }

  console.log('[CDP] Scrolled', scrollCount, 'times to load content');
}

/**
 * Check if current page shows successful login
 *
 * @param {Object} connection - CDP connection
 * @param {string} platform - Platform name
 * @returns {Promise<boolean>} true if logged in
 */
async function checkLoginStatus(connection, platform) {
  try {
    const { Runtime } = connection;

    const checkScripts = {
      reddit: `document.querySelector('[data-testid="logout-button"], button[aria-label="Log out"]') !== null`,
      x: `document.querySelector('[data-testid="logout"], [aria-label="Logout"]') !== null`,
      instagram: `document.querySelector('nav a[href="/accounts/logout/"], button[aria-label="Logout"]') !== null`
    };

    const script = checkScripts[platform];
    if (!script) {
      return false;
    }

    const result = await Runtime.evaluate({
      expression: script,
      timeout: 5000
    });

    return result.result.value === true;
  } catch (error) {
    console.error('[CDP] Login status check failed:', error.message);
    return false;
  }
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
 * Clean up all active connections (call during shutdown)
 * @returns {Promise<void>}
 */
async function cleanupAllConnections() {
  console.log('[CDP] Cleaning up all connections');
  const promises = [];

  for (const [profileName] of activeConnections.keys()) {
    promises.push(closeConnection(profileName));
  }

  await Promise.all(promises);
  console.log('[CDP] All connections cleaned up');
}

module.exports = {
  // Core connection functions
  connectToProfile,
  closeConnection,
  getActiveConnection,
  cleanupAllConnections,

  // Navigation and page interaction
  navigateToUrl,
  waitForElement,
  clickElement,
  fillField,

  // Data extraction
  extractPageData,
  executeScript,

  // Page utilities
  scrollToLoadContent,
  checkLoginStatus,

  // Debugging and monitoring
  takeScreenshot,
  sleep,

  // Connection tracking
  activeConnections
};