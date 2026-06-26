/**
 * Inbox Setup Script
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
  version: '1.0.0',
  description: 'Open and preload inbox interface for messaging'
};

/**
 * Execute inbox setup
 *
 * @param {Object} connection - CDP connection object with domains
 * @param {Object} context - Execution context with { platform, accountId }
 * @returns {Promise<Object>} Setup result
 */
async function execute(connection, context) {
  const { Page, Target } = connection;
  const { platform, accountId } = context;

  console.log('[Inbox Setup] Setting up inbox for platform:', platform);

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

    // Create new tab for inbox
    const targetId = await Target.createTarget({
      url: inboxUrl
    });

    // Wait for page to load
    await Page.loadEventFired();

    // Give inbox time to load messages
    await sleep(3000);

    console.log('[Inbox Setup] ✅ Inbox opened and preloaded for:', platform);
    return {
      success: true,
      url: inboxUrl,
      platform,
      targetId
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