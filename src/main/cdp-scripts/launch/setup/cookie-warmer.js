/**
 * Cookie Warmer Script (Native Playwright)
 *
 * Visits popular sites to build a natural cookie profile and browser
 * fingerprint history. This reduces CAPTCHA triggers on first use by
 * establishing a realistic browsing pattern.
 *
 * Runs once per profile — cookies persist in the CloakManager profile store.
 *
 * @category launch.setup
 * @platform all
 * @timeout 60000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'launch/setup/cookie-warmer',
  name: 'Cookie Warmer',
  platform: 'all',
  category: 'launch.setup',
  timeout: 60000,
  requires: ['cdpConnection'],
  nativeMode: true,
  version: '1.0.0',
  description: 'Visits popular sites to build natural cookie profile and avoid CAPTCHA'
};

/**
 * Execute cookie warmer
 *
 * @param {Object} nativeConnection - Native Playwright objects { page, context, browser }
 * @param {Object} context - Execution context with { accountId, platform }
 * @returns {Promise<Object>} Warm-up result
 */
async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { accountId } = context;

  console.log('[Cookie Warmer] Starting cookie warm-up for account:', accountId);

  try {
    // NOTE: used to check a 'oserus_cookie_warmer_complete' localStorage flag
    // here via page.goto('about:blank') + page.evaluate(). Chromium throws
    // SecurityError reading localStorage on about:blank's opaque origin —
    // that crashed this script AND stranded the page on about:blank for
    // every script that ran after it (they inherit whatever page this one
    // leaves behind). This script's run_mode is 'once' in
    // model_launch_scripts, so the orchestrator (script-executor.js,
    // checking cdp_script_executions) already skips re-running it — no
    // in-script "already done" check is needed.
    const sites = [
      { name: 'Google',     url: 'https://www.google.com' },
      { name: 'YouTube',    url: 'https://www.youtube.com' },
      { name: 'Amazon',     url: 'https://www.amazon.com' },
      { name: 'Wikipedia',  url: 'https://www.wikipedia.org' },
      { name: 'GitHub',     url: 'https://www.github.com' },
      { name: 'Bing',       url: 'https://www.bing.com' },
      { name: 'eBay',       url: 'https://www.ebay.com' },
      { name: 'DuckDuckGo', url: 'https://www.duckduckgo.com' },
      { name: 'Twitch',     url: 'https://www.twitch.tv' },
    ];

    const visited = [];
    const failed = [];

    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      try {
        console.log(`[Cookie Warmer] ${i + 1}/${sites.length}: Visiting ${site.name}...`);

        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        await sleep(800 + Math.random() * 1200);

        await page.evaluate(() => {
          window.scrollBy(0, 300 + Math.random() * 400);
        });

        await sleep(1500 + Math.random() * 2000);

        visited.push(site.name);
        console.log(`[Cookie Warmer] ✅ ${site.name} visited`);
      } catch (e) {
        console.error(`[Cookie Warmer] ❌ ${site.name} failed:`, e.message);
        failed.push({ name: site.name, url: site.url, error: e.message });
      }
    }

    console.log(`[Cookie Warmer] ✅ Complete: ${visited.length}/${sites.length} sites visited`);

    return {
      success: true,
      visited: visited.length,
      total: sites.length,
      failed: failed.length > 0 ? failed : undefined,
    };
  } catch (error) {
    console.error('[Cookie Warmer] ❌ Failed:', error.message);
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
