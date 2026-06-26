/**
 * Reddit Navigation Test Script
 *
 * Tests CDP navigation to Reddit homepage without login.
 * This helps verify if navigation issues are Reddit-specific or general CDP problems.
 *
 * @category test
 * @platform reddit
 * @timeout 15000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'test/reddit-navigation-test',
  name: 'Reddit Navigation Test',
  platform: 'reddit',
  category: 'test',
  timeout: 15000,
  requires: ['cdpConnection'],
  version: '1.0.0',
  description: 'Test CDP navigation to Reddit homepage'
};

/**
 * Execute Reddit navigation test
 *
 * @param {Object} connection - CDP connection object with domains
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Navigation test result
 */
async function execute(connection, context) {
  const { Page, Runtime } = connection;
  const { accountId, platform } = context;

  console.log('[Reddit Navigation Test] Testing Reddit navigation for account:', accountId);

  try {
    // Navigate to Reddit homepage
    const redditUrl = 'https://www.reddit.com/';
    console.log('[Reddit Navigation Test] Navigating to Reddit:', redditUrl);

    await Page.navigate({ url: redditUrl });

    // Wait for page load
    console.log('[Reddit Navigation Test] Waiting for Reddit to load...');
    await Page.loadEventFired();

    // Give Reddit time to render (it's a heavy SPA)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get current URL
    const urlResult = await Runtime.evaluate({
      expression: 'window.location.href',
      timeout: 5000
    });

    const currentUrl = urlResult.result.value;
    console.log('[Reddit Navigation Test] ✅ Current URL:', currentUrl);

    // Get page title
    const titleResult = await Runtime.evaluate({
      expression: 'document.title',
      timeout: 5000
    });

    const pageTitle = titleResult.result.value;
    console.log('[Reddit Navigation Test] ✅ Page title:', pageTitle);

    // Check if Reddit loaded successfully
    const redditLoaded = currentUrl.includes('reddit.com');

    // Additional check - see if we can find any Reddit elements
    const elementCheck = await Runtime.evaluate({
      expression: 'document.querySelector("#header") || document.querySelector("[data-testid=\'subreddit-header\']) ? true : false',
      timeout: 5000
    });

    console.log('[Reddit Navigation Test] Reddit elements found:', elementCheck.result.value);

    const success = redditLoaded;

    if (success) {
      console.log('[Reddit Navigation Test] ✅ Reddit navigation test PASSED');
    } else {
      console.log('[Reddit Navigation Test] ❌ Reddit navigation test FAILED');
    }

    return {
      success,
      currentUrl,
      pageTitle,
      redditElementsFound: elementCheck.result.value,
      message: success ? 'Reddit navigation successful' : 'Reddit navigation failed'
    };

  } catch (error) {
    console.error('[Reddit Navigation Test] ❌ Reddit navigation test failed:', error.message);
    return {
      success: false,
      error: error.message,
      message: 'Reddit navigation test failed'
    };
  }
}

module.exports = {
  metadata,
  execute
};