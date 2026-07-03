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
 * @param {Object} nativeConnection - Native Playwright objects { page, context, browser }
 * @param {Object} context - Execution context with { accountId, credentials, platform }
 * @returns {Promise<Object>} Login result
 */
async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { credentials, accountId, platform } = context;

  console.log('[Reddit Login] Starting auto-login for account:', accountId);
  console.log('[Reddit Login] Using native Playwright API');

  // CRITICAL: Add random delay at start to stagger simultaneous launches
  // This prevents multiple profiles from hitting Reddit at exactly the same time
  const initialDelay = 2000 + Math.random() * 3000; // 2-5 seconds random
  console.log(`[Reddit Login] ⏱️ Initial ${(initialDelay/1000).toFixed(1)}s delay to avoid rate limiting...`);
  await new Promise(resolve => setTimeout(resolve, initialDelay));

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
    // Try multiple selector strategies for shadow DOM compatibility
    const usernameField = page.locator('input[name="username"]').first();
    await usernameField.waitFor({ state: 'visible', timeout: 20000 });

    const passwordField = page.locator('input[name="password"]').first();
    await passwordField.waitFor({ state: 'visible', timeout: 5000 });

    console.log('[Reddit Login] Login form found, filling credentials...');

    // Fill username with human-like typing
    await usernameField.click();
    await usernameField.fill(credentials.username);
    await sleep(500 + Math.random() * 500); // Human-like pause

    // Fill password with human-like typing
    await passwordField.click();
    await passwordField.fill(credentials.password);
    await sleep(500 + Math.random() * 500); // Human-like pause

    // Find and click login button
    // Reddit uses multiple button selectors depending on login flow
    const loginButton = page.locator('button.login').or(
      page.locator('button[type="submit"]')
    ).or(
      page.locator('button:has-text("Log In")')
    ).first();

    // Wait for button to be enabled (Reddit enables it after form validation)
    console.log('[Reddit Login] Waiting for login button to be enabled...');
    await loginButton.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for disabled attribute to be removed
    await page.waitForFunction((button) => {
      return !button.disabled;
    }, loginButton, { timeout: 10000 }).catch(() => {
      console.log('[Reddit Login] Button still disabled, attempting click anyway...');
    });

    await loginButton.click();

    console.log('[Reddit Login] Login form submitted, waiting for navigation...');

    // Wait for navigation or 2FA page
    // Reddit may show 2FA, redirect to home, or show onboarding
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      console.log('[Reddit Login] Network idle timeout, continuing...');
    });

    // Check if we're on 2FA page
    const otpPage = page.locator('input[name="appOtp"], input[name="backupOtp"]');
    const otpCount = await otpPage.count();

    if (otpCount > 0) {
      console.log('[Reddit Login] ⚠️ 2FA required but not supported - awaiting manual intervention');
      return {
        success: false,
        requires2FA: true,
        username: credentials.username,
        message: '2FA code required'
      };
    }

    // Wait for potential redirect
    await sleep(3000);

    // Check if we're still on login page (indicates failure)
    const stillOnLogin = page.url().includes('/login');
    if (stillOnLogin) {
      // Check for error messages
      const errorBanner = page.locator('[role="alert"], .error, [class*="error"]').first();
      const errorVisible = await errorBanner.isVisible().catch(() => false);

      if (errorVisible) {
        const errorText = await errorBanner.textContent();
        throw new Error(`Login failed: ${errorText || 'Unknown error'}`);
      }

      throw new Error('Login failed - still on login page after submission');
    }

    // Verify login success by checking for logged-in indicators
    // Try multiple selectors for different Reddit UI states
    const verifyButton = page.getByTestId('logout-button');
    const verifyCount = await verifyButton.count();

    if (verifyCount === 0) {
      // Also check alternative logout indicators
      const altLogoutButton = page.locator('button[aria-label="Log out"], button:has-text("Log out"), [id*="logout"]');
      const altCount = await altLogoutButton.count();

      if (altCount === 0) {
        // Check if we're on home page (logged in)
        const onHomePage = page.url().match(/reddit\.com\/?(\?.*)?$/) ||
                          page.url().includes('/hot') ||
                          page.url().includes('/popular');

        if (onHomePage) {
          console.log('[Reddit Login] ✅ Login successful (redirected to home)');
          return {
            success: true,
            username: credentials.username,
            alreadyLoggedIn: false,
            verified: true
          };
        }

        throw new Error('Login verification failed - no logout indicators found');
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
