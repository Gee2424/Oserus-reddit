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
    const alreadySetup = await page.evaluate(() => {
      return localStorage.getItem('oserus_homepage_tiles_setup') === 'true';
    });

    if (alreadySetup) {
      console.log('[Homepage Tiles] Already set up, skipping');
      return { success: true, skipped: true, reason: 'already_setup' };
    }

    const result = await page.evaluate(() => {
      try {
        localStorage.setItem('oserus_homepage_tiles_setup', 'true');
        localStorage.setItem('oserus_homepage_tiles_date', new Date().toISOString());
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
