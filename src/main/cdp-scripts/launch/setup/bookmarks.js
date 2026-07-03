/**
 * Bookmarks Setup Script (Native Playwright)
 *
 * Creates browser bookmarks for the main social media platforms using Ctrl+D simulation.
 * Runs only on first launch.
 *
 * @category launch.setup
 * @platform all
 * @timeout 30000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'launch/setup/bookmarks',
  name: 'Bookmarks Setup',
  platform: 'all',
  category: 'launch.setup',
  timeout: 30000,  // Increased to 30s for 4 page loads
  requires: ['cdpConnection'],
  nativeMode: true,
  version: '2.0.0',
  description: 'Create bookmarks using Ctrl+D simulation (Method A - works immediately)'
};

/**
 * Execute bookmarks setup using Ctrl+D simulation
 *
 * @param {Object} nativeConnection - Native Playwright objects { page, context, browser }
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Setup result
 */
async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { accountId, platform } = context;

  console.log('[Bookmarks Setup] Setting up bookmarks for account:', accountId);
  console.log('[Bookmarks Setup] Using Ctrl+D simulation method');

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

    let createdCount = 0;
    const failed = [];

    // Create bookmarks using Ctrl+D simulation
    for (const bm of bookmarks) {
      try {
        console.log(`[Bookmarks Setup] Bookmarking: ${bm.title} - ${bm.url}`);

        // Navigate to the page
        await page.goto(bm.url, { waitUntil: 'domcontentloaded', timeout: 10000 });

        // Bring page to front
        await page.bringToFront();

        // Wait a moment for page to stabilize
        await page.waitForTimeout(500);

        // Press Ctrl+D to bookmark (Cmd+D on macOS would be 'Meta+D')
        await page.keyboard.press('Control+D');

        // Wait for bookmark bubble/dialog to appear
        await page.waitForTimeout(800);

        // Dismiss the "bookmark added" bubble or dialog
        await page.keyboard.press('Escape');

        // Wait for dismissal to complete
        await page.waitForTimeout(300);

        createdCount++;
        console.log(`[Bookmarks Setup] ✅ Bookmarked: ${bm.title}`);

      } catch (error) {
        console.error(`[Bookmarks Setup] ❌ Failed to bookmark ${bm.title}:`, error.message);
        failed.push({ title: bm.title, url: bm.url, error: error.message });
      }
    }

    // Mark setup as complete (even if some failed)
    await page.evaluate(() => {
      localStorage.setItem('oserus_bookmarks_setup_complete', 'true');
      localStorage.setItem('oserus_bookmarks_setup_date', new Date().toISOString());
      localStorage.setItem('oserus_bookmarks_count', createdCount.toString());
    });

    console.log(`[Bookmarks Setup] ✅ Setup complete: ${createdCount}/${bookmarks.length} bookmarks created`);

    return {
      success: true,
      firstLaunch: true,
      bookmarkCount: createdCount,
      total: bookmarks.length,
      failed: failed,
      skipped: false
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
