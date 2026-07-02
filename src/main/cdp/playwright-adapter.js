/**
 * Playwright CDP Adapter
 *
 * Provides CDP-compatible API over Playwright for incremental migration.
 * This adapter allows existing CDP scripts to work with minimal changes
 * while the codebase migrates from chrome-remote-interface to Playwright.
 *
 * CRITICAL: This adapter is temporary scaffolding. High-value scripts
 * (auth, setup) should be migrated to native Playwright API to get
 * the actual benefits: better locators, auto-waiting, humanization.
 *
 * @module cdp/playwright-adapter
 */

const { chromium } = require('playwright');

/**
 * Main adapter class that provides CDP-compatible interface over Playwright
 */
class PlaywrightCDPAdapter {
  /**
   * @param {Object} browser - Playwright browser instance
   * @param {Object} context - Playwright browser context
   * @param {Object} page - Playwright page instance
   */
  constructor(browser, context, page) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.client = browser; // For backwards compatibility with CDP code

    // Create CDP-like domain objects (backward compatibility)
    this.Page = new PageAdapter(page);
    this.Runtime = new RuntimeAdapter(page);
    this.DOM = new DOMAdapter(page);
    this.Network = new NetworkAdapter(page);
    this.Log = new LogAdapter(page);
    this.Target = new TargetAdapter(browser, context);

    // NEW: Expose native Playwright objects for native-mode scripts
    this.native = {
      browser: browser,
      context: context,
      page: page
    };
  }

  /**
   * Close the adapter connection
   * NOTE: Based on empirical testing, browser.close() may clear contexts.
   * Safer approach: just drop references and let GC handle cleanup.
   */
  async close() {
    // Just drop references instead of calling browser.close()
    // Let the connection idle and let GC handle cleanup
    this.browser = null;
    this.context = null;
    this.page = null;
    this.native = null;
  }
}

/**
 * Page domain adapter
 * Handles navigation, loading events, and screenshots
 */
class PageAdapter {
  constructor(page) {
    this.page = page;
  }

  /**
   * Enable Page domain (no-op in Playwright)
   */
  async enable() {
    // No-op in Playwright, domains are auto-enabled
  }

  /**
   * Navigate to URL
   * @param {Object} params - Navigation parameters
   * @param {string} params.url - Target URL
   */
  async navigate({ url }) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  /**
   * Wait for page load event
   */
  async loadEventFired() {
    await this.page.waitForLoadState('load');
  }

  /**
   * Capture screenshot
   * @param {Object} options - Screenshot options
   * @param {string} options.format - Image format ('png' or 'jpeg')
   * @param {number} options.quality - Image quality (JPEG only)
   * @returns {Promise<Object>} Screenshot data with base64-encoded image
   */
  async captureScreenshot(options = {}) {
    const format = options.format || 'png';
    const buffer = await this.page.screenshot({
      type: format,
      // CRITICAL FIX: quality only works for JPEG, not PNG
      quality: format === 'jpeg' ? options.quality : undefined
    });
    return { data: buffer.toString('base64') };
  }
}

/**
 * Runtime domain adapter
 * Handles JavaScript execution in page context
 */
class RuntimeAdapter {
  constructor(page) {
    this.page = page;
  }

  /**
   * Enable Runtime domain (no-op in Playwright)
   */
  async enable() {
    // No-op in Playwright
  }

  /**
   * Evaluate JavaScript expression in page context
   * CRITICAL FIX: Don't use new Function() - that runs in Node context.
   * Playwright directly handles string expressions and sends them to page.
   *
   * @param {Object} params - Evaluation parameters
   * @param {string} params.expression - JavaScript expression to evaluate
   * @param {number} params.timeout - Timeout in milliseconds
   * @returns {Promise<Object>} Evaluation result with CDP-compatible format
   */
  async evaluate({ expression, timeout = 10000 }) {
    try {
      // CRITICAL FIX: Playwright directly handles string expressions
      // Don't use new Function() which would run in Node context
      const evalPromise = this.page.evaluate(expression);

      // Add timeout wrapper since page.evaluate() doesn't have timeout option
      const result = await Promise.race([
        evalPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Runtime.evaluate timeout')), timeout)
        )
      ]);

      // Return CDP-compatible format
      return { result: { value: result } };
    } catch (error) {
      // CDP throws on script errors, Playwright returns/rejects
      throw error;
    }
  }
}

/**
 * DOM domain adapter
 * Handles DOM queries and manipulation (basic implementation)
 */
class DOMAdapter {
  constructor(page) {
    this.page = page;
  }

  /**
   * Enable DOM domain (no-op in Playwright)
   */
  async enable() {
    // No-op in Playwright
  }

  /**
   * Get document root (simplified)
   * @returns {Promise<Object>} Document node
   */
  async getDocument() {
    const result = await this.page.evaluate(() => {
      return {
        nodeId: 1,
        backendNodeId: 1,
        nodeName: 'document',
        nodeType: 9, // DOCUMENT_NODE
        localName: null,
        nodeValue: null
      };
    });
    return { root: result };
  }
}

/**
 * Network domain adapter
 * Handles network monitoring and interception (basic implementation)
 */
class NetworkAdapter {
  constructor(page) {
    this.page = page;
  }

  /**
   * Enable Network domain (no-op in Playwright)
   */
  async enable() {
    // No-op in Playwright
  }

  /**
   * Set user agent override
   * @param {Object} params - User agent parameters
   * @param {string} params.userAgent - User agent string
   */
  async setUserAgentOverride({ userAgent }) {
    await this.page.setExtraHTTPHeaders({ 'User-Agent': userAgent });
  }
}

/**
 * Log domain adapter
 * Handles console log entries
 */
class LogAdapter {
  constructor(page) {
    this.page = page;
  }

  /**
   * Enable Log domain
   */
  async enable() {
    // No-op in Playwright
  }
}

/**
 * Target domain adapter
 * Handles target (tab/window) management
 */
class TargetAdapter {
  /**
   * @param {Object} browser - Playwright browser instance
   * @param {Object} context - Playwright browser context
   */
  constructor(browser, context) {
    this.browser = browser;
    this.context = context;
  }

  /**
   * Get all targets (pages/contexts)
   * @returns {Promise<Object>} Target information
   */
  async getTargets() {
    try {
      // CRITICAL FIX: browser.contexts() is a method, not a property
      const contexts = this.browser.contexts();

      // Collect all pages from all contexts
      const targetInfos = [];
      for (const context of contexts) {
        // CRITICAL FIX: context.pages() is a method, not a property
        const pages = context.pages();
        for (const page of pages) {
          targetInfos.push({
            type: 'page',
            url: page.url(),
            targetId: `target-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: page.title ? await page.title() : ''
          });
        }
      }

      return { targetInfos };
    } catch (error) {
      console.error('[TargetAdapter] Failed to get targets:', error.message);
      return { targetInfos: [] };
    }
  }

  /**
   * Create a new target (open new tab)
   * @param {Object} params - Target creation parameters
   * @param {string} params.url - URL to open in new tab
   * @returns {Promise<Object>} New target information
   */
  async createTarget({ url }) {
    try {
      const newPage = await this.context.newPage();
      await newPage.goto(url);

      return {
        targetId: `target-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'page',
        url: url
      };
    } catch (error) {
      console.error('[TargetAdapter] Failed to create target:', error.message);
      throw error;
    }
  }
}

module.exports = {
  PlaywrightCDPAdapter,
  PageAdapter,
  RuntimeAdapter,
  DOMAdapter,
  NetworkAdapter,
  LogAdapter,
  TargetAdapter
};
