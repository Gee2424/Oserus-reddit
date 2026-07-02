/**
 * Initial Navigation Script (Native Playwright)
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
  nativeMode: true,  // NEW: Use native Playwright API
  version: '2.0.0',
  description: 'Navigate to platform home page after login (native Playwright)'
};

/**
 * Execute initial navigation to platform home
 *
 * @param {Object} nativeConnection - Native Playwright objects { page, context, browser }
 * @param {Object} context - Execution context with { platform, accountId, profileName }
 * @returns {Promise<Object>} Navigation result
 */
async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { platform, profileName } = context;

  console.log('[Initial Navigation] Starting for platform:', platform);
  console.log('[Initial Navigation] Using native Playwright API');

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

    // Native Playwright: single call with auto-waiting
    // No manual sleep needed - Playwright waits automatically
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });

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
