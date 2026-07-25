/**
 * X (Twitter) Compose Script (Native Playwright)
 *
 * Compose and post a tweet via the CloakManager browser using DOM automation.
 *
 * @category tasks
 * @platform x
 * @timeout 45000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'tasks/x/compose',
  name: 'X Compose Tweet',
  platform: 'x',
  category: 'tasks',
  timeout: 45000,
  requires: ['cdpConnection'],
  nativeMode: true,
  version: '1.0.0',
  description: 'Compose and post a tweet via X web interface in CloakManager browser'
};

async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { text, accountId } = context;

  console.log('[X Compose] Starting tweet composition for account:', accountId);

  const randomDelay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

  try {
    if (!text) {
      throw new Error('Tweet text is required');
    }

    await randomDelay(500, 1500);

    await page.goto('https://x.com/compose/post', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    await randomDelay(2000, 4000);

    let posted = false;

    try {
      const draftEditor = page.locator('[data-testid="tweetTextarea_0"]').or(
        page.locator('[contenteditable="true"][role="textbox"]')
      ).first();

      await draftEditor.waitFor({ state: 'visible', timeout: 10000 });
      await draftEditor.click();
      await randomDelay(300, 800);
      await draftEditor.fill(text);
      await randomDelay(500, 1500);
    } catch {
      const composer = page.locator('[contenteditable="true"]').first();
      await composer.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await composer.click();
      await randomDelay(200, 500);
      await composer.type(text, { delay: 15 });
      await randomDelay(500, 1500);
    }

    const postButton = page.locator('[data-testid="tweetButton"]').or(
      page.locator('[data-testid="tweetButtonInline"]')
    ).or(
      page.locator('button[role="button"]:has-text("Post")')
    ).first();

    await postButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

    const isEnabled = await postButton.isEnabled().catch(() => false);
    if (!isEnabled) {
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('[data-testid="tweetButton"]') ||
                     document.querySelector('[data-testid="tweetButtonInline"]');
          return btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
        },
        { timeout: 10000 }
      ).catch(() => {});
    }

    await postButton.click();
    console.log('[X Compose] Post button clicked, waiting...');

    await randomDelay(3000, 5000);

    try {
      await page.waitForFunction(
        () => {
          return window.location.pathname !== '/compose/post' ||
                 !document.querySelector('[data-testid="tweetTextarea_0"]');
        },
        { timeout: 15000 }
      );
      posted = true;
    } catch {
      const stillOnCompose = page.url().includes('/compose/post');
      posted = !stillOnCompose;
    }

    if (posted) {
      console.log('[X Compose] Tweet posted successfully');
      return {
        success: true,
        text: text,
        posted: true
      };
    }

    const errorEl = page.locator('[data-testid="toast"] div, [role="alert"]').first();
    const errorVisible = await errorEl.isVisible().catch(() => false);
    if (errorVisible) {
      const errorText = await errorEl.textContent().catch(() => null);
      if (errorText) {
        if (errorText.includes('already been sent') || errorText.includes('duplicate')) {
          return { success: true, text, posted: true, duplicate: true };
        }
        throw new Error('X: ' + errorText.trim());
      }
    }

    throw new Error('Tweet could not be verified - still on compose page');

  } catch (error) {
    console.error('[X Compose] Tweet failed:', error.message);
    throw error;
  }
}

module.exports = {
  metadata,
  execute
};
