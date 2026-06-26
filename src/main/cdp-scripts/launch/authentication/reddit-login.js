/**
 * Reddit Auto-Login Script
 *
 * Automatically logs into Reddit using stored credentials.
 * Handles both the old and new Reddit login interfaces.
 * Supports proxy-based geo detection and device emulation.
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
  version: '1.0.0',
  description: 'Automatically logs into Reddit using stored credentials from the database'
};

/**
 * Execute Reddit auto-login
 *
 * @param {Object} connection - CDP connection object with domains
 * @param {Object} context - Execution context with { accountId, credentials, platform }
 * @returns {Promise<Object>} Login result
 */
async function execute(connection, context) {
  const { Page, Runtime } = connection;
  const { credentials, accountId, platform } = context;

  console.log('[Reddit Login] Starting auto-login for account:', accountId);

  try {
    if (!credentials || !credentials.username || !credentials.password) {
      throw new Error('No credentials available for login');
    }

    console.log('[Reddit Login] Proceeding with login for user:', credentials.username);

    // Navigate to Reddit first
    await Page.navigate({ url: 'https://www.reddit.com/login/' });
    await Page.loadEventFired();

    // Wait for page to settle (Reddit SPA hydration)
    await sleep(2000);

    // Now check if already logged in
    const loginCheck = `
      (() => {
        // Check for logout button which indicates logged-in state
        const logoutBtn = document.querySelector('[data-testid="logout-button"]') ||
                         document.querySelector('button[aria-label="Log out"]');
        return { alreadyLoggedIn: !!logoutBtn, canProceed: !logoutBtn };
      })()
    `;

    const checkResult = await Runtime.evaluate({ expression: loginCheck, timeout: 5000 });
    const checkData = checkResult.result.value;

    if (checkData.alreadyLoggedIn) {
      console.log('[Reddit Login] Already logged in');
      return { success: true, alreadyLoggedIn: true, skipped: true };
    }

    // Wait for page to settle (Reddit SPA hydration)
    await sleep(2000);

    // Wait for login form elements
    const waitForForm = `
      (() => {
        const userField = document.querySelector('input#login-username, input[name="username"]');
        const passField = document.querySelector('input#login-password, input[name="password"]');
        const submitBtn = document.querySelector('button[type="submit"]');

        return {
          found: !!(userField && passField),
          userField: !!userField,
          passField: !!passField,
          submitBtn: !!submitBtn
        };
      })()
    `;

    const formResult = await Runtime.evaluate({ expression: waitForForm, timeout: 15000 });

    if (!formResult.result.value.found) {
      throw new Error('Login form not found or page not loaded properly');
    }

    console.log('[Reddit Login] Login form found, filling credentials...');

    // Fill in credentials and submit
    const fillAndSubmit = `
      (() => {
        const userField = document.querySelector('input#login-username, input[name="username"]');
        const passField = document.querySelector('input#login-password, input[name="password"]');
        const submitBtn = document.querySelector('button[type="submit"]');

        if (!userField || !passField) {
          return { success: false, error: 'Form fields not found' };
        }

        // Set username
        userField.value = '${credentials.username}';
        userField.dispatchEvent(new Event('input', { bubbles: true }));
        userField.dispatchEvent(new Event('change', { bubbles: true }));

        // Set password
        passField.value = '${credentials.password}';
        passField.dispatchEvent(new Event('input', { bubbles: true }));
        passField.dispatchEvent(new Event('change', { bubbles: true }));

        // Click submit button
        if (submitBtn) {
          submitBtn.click();
        }

        return { success: true, submitted: true };
      })()
    `;

    const submitResult = await Runtime.evaluate({ expression: fillAndSubmit, timeout: 10000 });
    const submitData = submitResult.result.value;

    if (!submitData.success) {
      throw new Error(submitData.error || 'Failed to submit login form');
    }

    console.log('[Reddit Login] Login form submitted, waiting for redirect...');

    // Wait for navigation after login
    await Page.loadEventFired();
    await sleep(3000);

    // Verify login success by checking for logout button
    const verifyResult = await Runtime.evaluate({ expression: loginCheck, timeout: 5000 });
    const verifyData = verifyResult.result.value;

    if (!verifyData.alreadyLoggedIn) {
      throw new Error('Login verification failed - may have been redirected to an error page');
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