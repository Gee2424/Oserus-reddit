/**
 * Basic CDP Connection Test Script
 *
 * Simple test to verify CDP connection is working before running complex scripts.
 * This script just connects to CDP and gets the current page URL.
 *
 * @category test
 * @platform all
 * @timeout 5000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'test/basic-connection-test',
  name: 'Basic CDP Connection Test',
  platform: 'all',
  category: 'test',
  timeout: 5000,
  requires: ['cdpConnection'],
  version: '1.0.0',
  description: 'Test CDP connection and get current page URL'
};

/**
 * Execute basic CDP connection test
 *
 * @param {Object} connection - CDP connection object with domains
 * @param {Object} context - Execution context with { accountId, profileName }
 * @returns {Promise<Object>} Test result
 */
async function execute(connection, context) {
  const { Runtime, Page } = connection;
  const { accountId, profileName } = context;

  console.log('[CDP Test] Testing connection for account:', accountId, 'profile:', profileName);

  try {
    // Get current page URL
    const urlResult = await Runtime.evaluate({
      expression: 'window.location.href',
      timeout: 5000
    });

    const currentUrl = urlResult.result.value;
    console.log('[CDP Test] ✅ Current page URL:', currentUrl);

    // Get page title
    const titleResult = await Runtime.evaluate({
      expression: 'document.title',
      timeout: 5000
    });

    const pageTitle = titleResult.result.value;
    console.log('[CDP Test] ✅ Page title:', pageTitle);

    return {
      success: true,
      currentUrl,
      pageTitle,
      profileName,
      accountId,
      message: 'CDP connection working perfectly'
    };

  } catch (error) {
    console.error('[CDP Test] ❌ Connection test failed:', error.message);
    return {
      success: false,
      error: error.message,
      message: 'CDP connection test failed'
    };
  }
}

module.exports = {
  metadata,
  execute
};