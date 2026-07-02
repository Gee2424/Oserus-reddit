/**
 * Homepage Tiles Setup Script (Native Playwright)
 *
 * Configures browser homepage tiles with custom quick-access sites.
 * Injects tile configuration into browser's new tab page via localStorage.
 *
 * @category launch.setup
 * @platform all
 * @timeout 10000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'launch/setup/homepage-tiles',
  name: 'Homepage Tiles Setup',
  platform: 'all',
  category: 'launch.setup',
  timeout: 10000,
  requires: ['cdpConnection'],
  nativeMode: true,  // NEW: Use native Playwright API
  version: '2.0.0',
  description: 'Configure browser homepage tiles from database (native Playwright)'
};

/**
 * Execute homepage tiles setup
 *
 * @param {Object} page - Native Playwright page object (from native mode)
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Setup result
 */
async function execute(page, context) {
  const { accountId, platform } = context;

  console.log('[Homepage Tiles] Setting up tiles for account:', accountId, 'platform:', platform);
  console.log('[Homepage Tiles] Using native Playwright API');

  try {
    // Get tiles from database
    const { getDb } = require('../../../../db');
    let tiles = [];
    try {
      const { listTiles } = require('../../../../ipc/homepage');
      tiles = listTiles();
    } catch (e) {
      console.log('[Homepage Tiles] Using default tiles');
      tiles = require('../../../../ipc/homepage').DEFAULTS;
    }

    if (!tiles || !tiles.length) {
      console.log('[Homepage Tiles] No tiles configured, skipping');
      return { success: true, skipped: true, tileCount: 0 };
    }

    console.log('[Homepage Tiles] Found', tiles.length, 'tiles to configure');

    // Native Playwright: Pass tiles as parameter instead of string interpolation
    const result = await page.evaluate((tilesData) => {
      try {
        // Store tiles in localStorage for custom new tab page
        localStorage.setItem('oserus_homepage_tiles', JSON.stringify(tilesData));

        // Helper function to generate favicon URL
        const generateFavicon = (url) => {
          try {
            const domain = new URL(url || '').hostname;
            return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : '';
          } catch {
            return '';
          }
        };

        // Also try to set up Chrome new tab shortcuts if available
        if (window.chrome && window.chrome.embeddedSearch) {
          try {
            window.chrome.embeddedSearch.newTabPage = {
              getTiles: () => tilesData.map(t => ({
                title: t.label || '?',
                url: t.url || 'https://www.google.com',
                favicon: generateFavicon(t.url)
              }))
            };
          } catch (e) {
            console.log('Could not set up chrome shortcuts:', e.message);
          }
        }

        return { success: true, tileCount: tilesData.length };
      } catch (e) {
        console.error('Failed to store tiles:', e);
        return { success: false, error: e.message };
      }
    }, tiles);

    console.log('[Homepage Tiles] ✅ Tiles setup completed:', result);
    return {
      success: true,
      tileCount: tiles.length,
      skipped: false
    };

  } catch (error) {
    console.error('[Homepage Tiles] ❌ Setup failed:', error.message);
    throw error;
  }
}

module.exports = {
  metadata,
  execute
};
