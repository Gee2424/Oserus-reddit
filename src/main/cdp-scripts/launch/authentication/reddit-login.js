/**
 * Reddit Auto-Login Script (Native Playwright)
 *
 * Automatically logs into Reddit using stored credentials.
 * Handles both the old and new Reddit login interfaces.
 * Uses native Playwright for better locators, auto-waiting, and reliability.
 *
 * @category launch.authentication
 * @platform reddit
 * @timeout 30000
 * @requires ['cdpConnection', 'credentials']
 */

const metadata = {
  id: 'launch/authentication/reddit-login',
  name: 'Reddit Auto-Login',
  platform: 'reddit',
  category: 'launch.authentication',
  timeout: 30000,
  requires: ['cdpConnection', 'credentials'],
  nativeMode: true,  // NEW: Use native Playwright API
  version: '2.0.0',
  description: 'Reddit login with native Playwright API (better locators, auto-waiting, humanization)'
};

/**
 * Execute Reddit auto-login
 *
 * @param {Object} page - Native Playwright page object (from native mode)
 * @param {Object} context - Execution context with { accountId, credentials, platform }
 * @returns {Promise<Object>} Login result
 */
async function execute(page, context) {
  const { credentials, accountId, platform } = context;

  console.log('[Reddit Login] Starting auto-login for account:', accountId);
  console.log('[Reddit Login] Using native Playwright API');

  try {
    if (!credentials || !credentials.username || !credentials.password) {
      throw new Error('No credentials available for login');
    }

    console.log('[Reddit Login] Proceeding with login for user:', credentials.username);

    // Navigate to Reddit login page
    await page.goto('https://www.reddit.com/login/', {
      waitUntil: 'domcontentloaded'
    });

    // Check if already logged in using resilient locator
    // Native Playwright: getByTestId() is more reliable than querySelector
    const logoutButton = page.getByTestId('logout-button');
    const logoutCount = await logoutButton.count();

    if (logoutCount > 0) {
      console.log('[Reddit Login] Already logged in');
      return {
        success: true,
        alreadyLoggedIn: true,
        skipped: true,
        username: credentials.username
      };
    }

    console.log('[Reddit Login] Not logged in, proceeding with login flow...');

    // Wait for login form with auto-waiting
    // Native Playwright: locator.waitFor() handles the polling
    const usernameField = page.locator('input#login-username').first();
    await usernameField.waitFor({ state: 'visible', timeout: 15000 });

    console.log('[Reddit Login] Login form found, filling credentials...');

    // Native Playwright: page.fill() properly simulates input events
    // No need for manual dispatchEvent calls
    await page.fill('input#login-username', credentials.username);
    await page.fill('input#login-password', credentials.password);

    // Click submit button with auto-wait
    // Native Playwright: auto-waits for element to be ready
    await page.locator('button[type="submit"]').first().click();

    console.log('[Reddit Login] Login form submitted, waiting for navigation...');

    // Wait for navigation after login
    // Native Playwright: waitForURL is more reliable than loadEventFired + sleep
    await page.waitForURL(/\/(login|register|\?|$)/, { timeout: 15000 });

    // Additional wait for page to stabilize after redirect
    await sleep(2000);

    // Verify login success
    // Native Playwright: expect().toBeVisible() with timeout
    const verifyButton = page.getByTestId('logout-button');
    const verifyCount = await verifyButton.count();

    if (verifyCount === 0) {
      // Also check alternative logout button
      const altLogoutButton = page.locator('button[aria-label="Log out"]');
      const altCount = await altLogoutButton.count();

      if (altCount === 0) {
        throw new Error('Login verification failed - logout button not found');
      }
    }

    console.log('[Reddit Login] ✅ Login successful for user:', credentials.username);
    return {
      success: true,
      username: credentials.username,
      alreadyLoggedIn: false,
      verified: true
    };

  } catch (error) {
    console.error('[Reddit Login] ❌ Auto-login failed:', error.message);
    throw error;
  }
}

/**
 * Sleep utility for delays
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  metadata,
  execute
};
