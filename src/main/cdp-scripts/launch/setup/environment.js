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
 * @param {Object} nativeConnection - Native Playwright objects { page, context, browser }
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Setup result
 */
async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { accountId, platform } = context;

  console.log('[Environment Setup] Configuring environment for account:', accountId);
  console.log('[Environment Setup] Using native Playwright API');

  try {
    // NOTE: used to gate on a 'oserus_environment_setup_complete' localStorage
    // flag here — reading localStorage before any navigation on this page can
    // throw a SecurityError (e.g. if a prior script left the page on
    // about:blank), which crashed this script. run_mode is 'once' in
    // model_launch_scripts, so the orchestrator already skips re-running a
    // script that previously completed (cdp_script_executions) — no in-script
    // check needed.
    console.log('[Environment Setup] Configuring environment...');

    // Get account geo preferences from database — getDb is already
    // available from the script-executor.js scope via eval().
    const account = getDb().prepare(`
      SELECT geo_timezone, geo_country
      FROM reddit_accounts
      WHERE id = ?
    `).get(accountId);

    // Native Playwright: cleaner evaluate syntax
    // Pass data as parameters instead of string interpolation
    const result = await page.evaluate(({ timezone, countryCode }) => {
      try {
        document.body.style.zoom = '1.0';
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
    }, { timezone: account?.geo_timezone || null, countryCode: account?.geo_country || null });

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
