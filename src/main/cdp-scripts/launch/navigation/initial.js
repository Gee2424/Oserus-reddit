/**
 * Initial Navigation Script
 *
 * Navigates to the platform's home page after successful login.
 * Handles platform-specific URL routing and waits for page load.
 *
 * @category launch.navigation
 * @platform all
 * @timeout 15000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'launch/navigation/initial',
  name: 'Initial Navigation',
  platform: 'all',
  category: 'launch.navigation',
  timeout: 15000,
  requires: ['cdpConnection'],
  version: '1.0.0',
  description: 'Navigate to platform home page after login'
};

/**
 * Execute initial navigation to platform home
 *
 * @param {Object} connection - CDP connection object with domains
 * @param {Object} context - Execution context with { platform, accountId, profileName }
 * @returns {Promise<Object>} Navigation result
 */
async function execute(connection, context) {
  const { Page } = connection;
  const { platform, profileName } = context;

  console.log('[Initial Navigation] Starting for platform:', platform);

  try {
    // Platform home pages
    const homePages = {
      reddit: 'https://www.reddit.com/',
      x: 'https://x.com/home',
      instagram: 'https://www.instagram.com/',
      tiktok: 'https://www.tiktok.com/foryou',
      redgifs: 'https://www.redgifs.com/'
    };

    const homeUrl = homePages[platform] || homePages.reddit;

    console.log('[Initial Navigation] Navigating to:', homeUrl);

    // Navigate to home page
    await Page.navigate({ url: homeUrl });
    await Page.loadEventFired();

    // Wait for page to settle
    await sleep(2000);

    console.log('[Initial Navigation] ✅ Navigation complete for:', platform);
    return {
      success: true,
      url: homeUrl,
      platform
    };

  } catch (error) {
    console.error('[Initial Navigation] ❌ Navigation failed:', error.message);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  metadata,
  execute
};