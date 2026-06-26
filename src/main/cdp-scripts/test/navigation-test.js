/**
 * Navigation Test Script
 *
 * Tests CDP navigation functionality by navigating to a URL and verifying the page load.
 *
 * @category test
 * @platform all
 * @timeout 10000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'test/navigation-test',
  name: 'Navigation Test',
  platform: 'all',
  category: 'test',
  timeout: 10000,
  requires: ['cdpConnection'],
  version: '1.0.0',
  description: 'Test CDP navigation by visiting example.com'
};

/**
 * Execute navigation test
 *
 * @param {Object} connection - CDP connection object with domains
 * @param {Object} context - Execution context with { accountId, profileName }
 * @returns {Promise<Object>} Navigation test result
 */
async function execute(connection, context) {
  const { Page, Runtime } = connection;
  const { accountId, profileName } = context;

  console.log('[Navigation Test] Starting navigation test for account:', accountId);

  try {
    // Navigate to example.com
    const testUrl = 'https://example.com';
    console.log('[Navigation Test] Navigating to:', testUrl);

    await Page.navigate({ url: testUrl });

    // Wait for page load
    console.log('[Navigation Test] Waiting for page load...');
    await Page.loadEventFired();

    // Give page time to render
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get current URL to verify navigation worked
    const urlResult = await Runtime.evaluate({
      expression: 'window.location.href',
      timeout: 5000
    });

    const currentUrl = urlResult.result.value;
    console.log('[Navigation Test] ✅ Current URL after navigation:', currentUrl);

    // Get page title
    const titleResult = await Runtime.evaluate({
      expression: 'document.title',
      timeout: 5000
    });

    const pageTitle = titleResult.result.value;
    console.log('[Navigation Test] ✅ Page title:', pageTitle);

    // Check if we're on the right page
    const success = currentUrl.includes('example.com') && pageTitle.includes('Example');

    if (success) {
      console.log('[Navigation Test] ✅ Navigation test PASSED');
    } else {
      console.log('[Navigation Test] ❌ Navigation test FAILED - not on expected page');
    }

    return {
      success,
      currentUrl,
      pageTitle,
      testUrl,
      expectedTitle: 'Example Domain',
      message: success ? 'Navigation test passed' : 'Navigation test failed'
    };

  } catch (error) {
    console.error('[Navigation Test] ❌ Navigation test failed:', error.message);
    return {
      success: false,
      error: error.message,
      message: 'Navigation test failed'
    };
  }
}

module.exports = {
  metadata,
  execute
};