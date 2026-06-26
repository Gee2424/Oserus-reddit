/**
 * Homepage Tiles Setup Script
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
  version: '1.0.0',
  description: 'Configure browser homepage tiles from database'
};

/**
 * Execute homepage tiles setup
 *
 * @param {Object} connection - CDP connection object with domains
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Setup result
 */
async function execute(connection, context) {
  const { Runtime } = connection;
  const { accountId, platform } = context;

  console.log('[Homepage Tiles] Setting up tiles for account:', accountId, 'platform:', platform);

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

    // Setup script for browser
    const setupScript = `
      (() => {
        // Store tiles in localStorage for custom new tab page
        const tiles = ${JSON.stringify(tiles)};

        try {
          localStorage.setItem('oserus_homepage_tiles', JSON.stringify(tiles));
        } catch (e) {
          console.error('Failed to store tiles:', e);
        }

        // Also try to set up Chrome new tab shortcuts if available
        if (window.chrome && window.chrome.embeddedSearch) {
          try {
            // This is experimental - may not work in all CloakManager versions
            window.chrome.embeddedSearch.newTabPage = {
              getTiles: () => tiles.map(t => ({
                title: t.label || '?',
                url: t.url || 'https://www.google.com',
                favicon: generateFavicon(t.url)
              }))
            };
          } catch (e) {
            console.log('Could not set up chrome shortcuts:', e.message);
          }
        }

        return { success: true, tileCount: tiles.length };
      })()
    `;

    const result = await Runtime.evaluate({
      expression: setupScript,
      timeout: 10000
    });

    console.log('[Homepage Tiles] ✅ Tiles setup completed:', result.result.value);
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

/**
 * Generate favicon URL for a URL
 * @param {string} url - URL to generate favicon for
 * @returns {string} Favicon URL
 */
function generateFavicon(url) {
  try {
    const domain = new URL(url || '').hostname;
    return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : '';
  } catch {
    return '';
  }
}

module.exports = {
  metadata,
  execute
};