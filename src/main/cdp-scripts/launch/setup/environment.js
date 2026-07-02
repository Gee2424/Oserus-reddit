/**
 * Environment Setup Script (Native Playwright)
 *
 * Configures browser environment settings like zoom level,
 * language preferences, and timezone based on proxy geo.
 *
 * @category launch.setup
 * @platform all
 * @timeout 8000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'launch/setup/environment',
  name: 'Environment Setup',
  platform: 'all',
  category: 'launch.setup',
  timeout: 8000,
  requires: ['cdpConnection'],
  nativeMode: true,  // NEW: Use native Playwright API
  version: '2.0.0',
  description: 'Configure browser environment settings (native Playwright)'
};

/**
 * Execute environment setup
 *
 * @param {Object} page - Native Playwright page object (from native mode)
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Setup result
 */
async function execute(page, context) {
  const { accountId, platform } = context;

  console.log('[Environment Setup] Configuring environment for account:', accountId);
  console.log('[Environment Setup] Using native Playwright API');

  try {
    // Get account geo preferences from database
    const { getDb } = require('../../../../db');
    const account = getDb().prepare(`
      SELECT geo_timezone, geo_country
      FROM reddit_accounts
      WHERE id = ?
    `).get(accountId);

    // Native Playwright: cleaner evaluate syntax
    // Pass data as parameters instead of string interpolation
    const result = await page.evaluate((timezone, countryCode) => {
      try {
        // Set browser zoom to default (100%)
        document.body.style.zoom = '1.0';

        // Get language from country code if available
        const language = countryCode ? getLanguageForCountry(countryCode) : null;

        return {
          success: true,
          zoom: '1.0',
          timezone: timezone || 'auto',
          language: language || 'auto'
        };
      } catch (e) {
        console.log('Could not set environment:', e.message);
        return {
          success: false,
          error: e.message
        };
      }
    }, account?.geo_timezone || null, account?.geo_country || null);

    console.log('[Environment Setup] ✅ Environment configured:', result);
    return {
      success: true,
      config: result
    };

  } catch (error) {
    console.error('[Environment Setup] ❌ Setup failed:', error.message);
    throw error;
  }
}

/**
 * Get language code from country code
 * @param {string} countryCode - ISO country code
 * @returns {string|null} Language code
 */
function getLanguageForCountry(countryCode) {
  const languageMap = {
    'US': 'en-US',
    'GB': 'en-GB',
    'CA': 'en-CA',
    'AU': 'en-AU',
    'DE': 'de-DE',
    'FR': 'fr-FR',
    'ES': 'es-ES',
    'IT': 'it-IT',
    'BR': 'pt-BR',
    'IN': 'hi-IN',
    'JP': 'ja-JP',
    'KR': 'ko-KR'
  };

  return languageMap[countryCode?.toUpperCase()] || null;
}

module.exports = {
  metadata,
  execute
};
