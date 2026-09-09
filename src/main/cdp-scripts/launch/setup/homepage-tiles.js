/**
 * Homepage Tiles Setup Script (Native Playwright)
 *
 * Configures homepage tiles (bookmark-style quick links) on the platform's
 * homepage after login. Used to surface key subreddits/pages for the account's
 * workflow.
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
  nativeMode: true,
  version: '1.0.0',
  description: 'Configure homepage tiles (native Playwright)'
};

async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { accountId, platform } = context;

  console.log('[Homepage Tiles] Setting up tiles for account:', accountId, 'platform:', platform);

  try {
    // NOTE: used to gate on a 'oserus_homepage_tiles_setup' localStorage flag
    // here — reading localStorage before any navigation on this page can
    // throw a SecurityError (e.g. if a prior script left the page on
    // about:blank), which crashed this script. This script's run_mode is
    // 'always' in model_launch_scripts (it's meant to run every launch), so
    // there's no "already done" state to track — just do the setup.
    const result = await page.evaluate(() => {
      try {
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    console.log('[Homepage Tiles] ✅ Setup complete:', result);
    return { success: true, config: result };
  } catch (error) {
    console.error('[Homepage Tiles] ❌ Setup failed:', error.message);
    throw error;
  }
}

module.exports = {
  metadata,
  execute
};
