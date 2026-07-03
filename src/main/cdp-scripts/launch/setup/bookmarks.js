/**
 * Bookmarks Setup Script (Native Playwright)
 *
 * Creates browser bookmarks for the main social media platforms.
 * Runs only on first launch.
 *
 * @category launch.setup
 * @platform all
 * @timeout 10000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'launch/setup/bookmarks',
  name: 'Bookmarks Setup',
  platform: 'all',
  category: 'launch.setup',
  timeout: 10000,
  requires: ['cdpConnection'],
  nativeMode: true,
  version: '1.0.0',
  description: 'Create bookmarks for social media platforms (first launch only)'
};

/**
 * Execute bookmarks setup
 *
 * @param {Object} nativeConnection - Native Playwright objects { page, context, browser }
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Setup result
 */
async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { accountId, platform } = context;

  console.log('[Bookmarks Setup] Setting up bookmarks for account:', accountId);
  console.log('[Bookmarks Setup] Using native Playwright API');

  try {
    // Check if already set up (first launch tracking)
    const alreadySetup = await page.evaluate(() => {
      return localStorage.getItem('oserus_bookmarks_setup_complete') === 'true';
    });

    if (alreadySetup) {
      console.log('[Bookmarks Setup] Already set up, skipping');
      return { success: true, skipped: true, reason: 'already_setup' };
    }

    console.log('[Bookmarks Setup] First launch detected, creating bookmarks...');

    // Main social media platforms to bookmark
    const bookmarks = [
      { title: 'Reddit', url: 'https://www.reddit.com' },
      { title: 'X (Twitter)', url: 'https://x.com' },
      { title: 'Instagram', url: 'https://www.instagram.com' },
      { title: 'TikTok', url: 'https://www.tiktok.com' }
    ];

    // Native Playwright: Create bookmarks via Chrome DevTools Protocol
    const result = await page.evaluate((bookmarksData) => {
      try {
        // Store bookmarks in localStorage for custom bookmark manager
        localStorage.setItem('oserus_bookmarks', JSON.stringify(bookmarksData));

        // Mark setup as complete
        localStorage.setItem('oserus_bookmarks_setup_complete', 'true');
        localStorage.setItem('oserus_bookmarks_setup_date', new Date().toISOString());

        // Try to use Chrome's bookmarks API if available
        if (window.chrome && window.chrome.bookmarks) {
          bookmarksData.forEach(bookmark => {
            try {
              window.chrome.bookmarks.create({
                title: bookmark.title,
                url: bookmark.url,
                parentId: '1' // Bookmarks bar
              });
            } catch (e) {
              console.log('Could not create bookmark via API:', e.message);
            }
          });
        }

        return {
          success: true,
          bookmarkCount: bookmarksData.length,
          bookmarks: bookmarksData.map(b => ({ title: b.title, url: b.url }))
        };
      } catch (e) {
        console.error('Failed to create bookmarks:', e);
        return { success: false, error: e.message };
      }
    }, bookmarks);

    console.log('[Bookmarks Setup] ✅ Bookmarks created:', result);
    return {
      success: true,
      firstLaunch: true,
      bookmarkCount: result.bookmarkCount,
      bookmarks: result.bookmarks
    };

  } catch (error) {
    console.error('[Bookmarks Setup] ❌ Setup failed:', error.message);
    throw error;
  }
}

module.exports = {
  metadata,
  execute
};
