/**
 * Environment Setup Script
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
  version: '1.0.0',
  description: 'Configure browser environment settings'
};

/**
 * Execute environment setup
 *
 * @param {Object} connection - CDP connection object with domains
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Setup result
 */
async function execute(connection, context) {
  const { Runtime, Page } = connection;
  const { accountId, platform } = context;

  console.log('[Environment Setup] Configuring environment for account:', accountId);

  try {
    // Get account geo preferences from database
    const { getDb } = require('../../../../db');
    const account = getDb().prepare(`
      SELECT geo_timezone, geo_country
      FROM reddit_accounts
      WHERE id = ?
    `).get(accountId);

    const setupScript = `
      (() => {
        // Set browser zoom to default (100%)
        try {
          document.body.style.zoom = '1.0';
        } catch (e) {
          console.log('Could not set zoom:', e.message);
        }

        // Set language preference if geo data available
        const timezone = ${account?.geo_timezone ? `'${account.geo_timezone}'` : null};
        const language = ${account?.geo_country ? getLanguageForCountry('${account.geo_country}') : null};

        return {
          success: true,
          zoom: '1.0',
          timezone: timezone || 'auto',
          language: language || 'auto'
        };
      })()
    `;

    const result = await Runtime.evaluate({
      expression: setupScript,
      timeout: 8000
    });

    console.log('[Environment Setup] ✅ Environment configured:', result.result.value);
    return {
      success: true,
      config: result.result.value
    };

  } catch (error) {
    console.error('[Environment Setup] ❌ Setup failed:', error.message);
    throw error;
  }
}

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