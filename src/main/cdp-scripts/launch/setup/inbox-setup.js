/**
 * Inbox Setup Script (Native Playwright)
 *
 * Opens the platform's inbox/messages interface as a second tab.
 * Pre-loads the messaging interface so it's ready when user opens it.
 *
 * @category launch.setup
 * @platform reddit, x, instagram, tiktok
 * @timeout 10000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'launch/setup/inbox-setup',
  name: 'Inbox Setup',
  platform: 'reddit', // Will extend to other platforms
  category: 'launch.setup',
  timeout: 10000,
  requires: ['cdpConnection'],
  nativeMode: true,  // NEW: Use native Playwright API
  version: '2.0.0',
  description: 'Open and preload inbox interface for messaging (native Playwright)'
};

/**
 * Execute inbox setup
 *
 * @param {Object} nativeConnection - Native Playwright objects { page, context, browser }
 * @param {Object} context - Execution context with { platform, accountId }
 * @returns {Promise<Object>} Setup result
 */
async function execute(nativeConnection, context) {
  const { page, context: browserContext } = nativeConnection;  // Rename to avoid shadowing
  const { platform, accountId } = context;

  console.log('[Inbox Setup] Setting up inbox for platform:', platform);
  console.log('[Inbox Setup] Using native Playwright API');

  try {
    // Platform inbox URLs
    const inboxUrls = {
      reddit: 'https://www.reddit.com/message/inbox/',
      x: 'https://x.com/messages',
      instagram: 'https://www.instagram.com/direct/inbox/',
      tiktok: 'https://www.tiktok.com/messages'
    };

    const inboxUrl = inboxUrls[platform];
    if (!inboxUrl) {
      console.log('[Inbox Setup] No inbox URL for platform:', platform, ', skipping');
      return { success: true, skipped: true, message: 'No inbox for this platform' };
    }

    console.log('[Inbox Setup] Opening inbox:', inboxUrl);

    // Native Playwright: Create new page in browser context
    // This shares cookies/auth with the existing page
    const inboxPage = await browserContext.newPage();
    await inboxPage.goto(inboxUrl, { waitUntil: 'domcontentloaded' });

    // Give inbox time to load messages (reduced from 3000ms since auto-waiting)
    await sleep(2000);

    console.log('[Inbox Setup] ✅ Inbox opened and preloaded for:', platform);
    return {
      success: true,
      url: inboxUrl,
      platform,
      createdTab: true
    };

  } catch (error) {
    console.error('[Inbox Setup] ❌ Inbox setup failed:', error.message);
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
