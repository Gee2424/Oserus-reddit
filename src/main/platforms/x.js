// X (Twitter) adapter — text + image-URL tweets via browser automation.
//
// X has no public posting API for cookied sessions. We drive the compose UI
// in a hidden BrowserWindow on the account's session: fill the tweet text,
// hit Post, wait for the success transition (URL changes or the dialog
// closes). Image posts where the caller supplies a hosted URL are appended
// to the text — X will unfurl as a card. Native media upload (file dialog)
// stays out of scope here; that needs a different pipeline.
//
// Selectors are best-effort and X churns them; failures bubble up cleanly
// instead of silently false-positive.

const { BrowserWindow } = require('electron');
const { getDb } = require('../db');

async function submitPost({ accountId, title, body, kind, url }) {
  const db = getDb();
  const acct = db.prepare(
    'SELECT id, username, partition_key FROM reddit_accounts WHERE id = ?'
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };

  // The composed text. X enforces 280 chars; we trim if needed but warn.
  let text = (title || '').trim();
  if (body && body.trim()) text += (text ? '\n\n' : '') + body.trim();
  if ((kind === 'link' || kind === 'image') && url) text += (text ? '\n' : '') + url.trim();
  if (!text) return { ok: false, error: 'Empty tweet text' };
  if (text.length > 280) text = text.slice(0, 277) + '…';

  try {
    const { prepareSessionForAccount } = require('../services/sessionPrep');
    await prepareSessionForAccount(accountId);
  } catch {}

  const partition = `persist:${acct.partition_key}`;
  // Match the account's fingerprint device class — mobile-fingerprinted
  // accounts get a phone window + device emulation so UA + viewport agree.
  const fingerprintMod = require('../fingerprint');
  const fp = fingerprintMod.loadOrCreate(db, accountId);
  const isMobile = !!(fp && fp.mobile);
  const winW = isMobile ? (fp.screen?.width || 412)  : 1200;
  const winH = isMobile ? (fp.screen?.height || 915) : 820;

  const win = new BrowserWindow({
    width: winW, height: winH,
    show: false,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false },
  });
  try {
    const emu = fingerprintMod.getDeviceEmulationParams(fp);
    if (emu) win.webContents.enableDeviceEmulation(emu);
  } catch {}

  let result = { ok: false, error: 'Unknown failure' };
  try {
    // Mobile accounts hit x.com (which serves the mobile composer to
    // mobile UAs) instead of the desktop compose page that 404s on
    // mobile UAs in some cases. x.com root opens the post composer on
    // both, so just go there universally now.
    await win.loadURL(isMobile ? 'https://x.com/' : 'https://x.com/compose/post');
    // Let the SPA hydrate the composer.
    await new Promise((r) => setTimeout(r, 5000));

    // Type the text into the composer. X uses a contenteditable div, so we
    // dispatch input events the React tree actually listens to (beforeinput
    // + keydown/up wouldn't be enough for the controlled state).
    const typeScript = `(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let composer = null;
      for (let i = 0; i < 20; i++) {
        composer = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (composer) break;
        await wait(300);
      }
      if (!composer) return { ok: false, error: 'composer not found' };
      composer.focus();
      // Use execCommand for X's draftjs-based composer; it's still the only
      // path that produces the right input events on contenteditables.
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      await wait(400);
      // Click Post.
      const postBtn = document.querySelector('[data-testid="tweetButton"]')
                  || document.querySelector('[data-testid="tweetButtonInline"]');
      if (!postBtn) return { ok: false, error: 'post button not found' };
      if (postBtn.getAttribute('aria-disabled') === 'true') return { ok: false, error: 'post button disabled' };
      postBtn.click();
      // Wait for the dialog to close / URL to change.
      const startUrl = location.href;
      for (let i = 0; i < 40; i++) {
        await wait(250);
        const stillThere = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
        if (!stillThere || location.href !== startUrl) return { ok: true };
      }
      return { ok: false, error: 'no confirmation after click' };
    })()`;
    result = await win.webContents.executeJavaScript(typeScript);
  } catch (e) {
    result = { ok: false, error: e.message };
  } finally {
    try { win.destroy(); } catch {}
  }

  if (!result || !result.ok) return { ok: false, error: result?.error || 'submit failed' };
  return { ok: true, id: null }; // X doesn't give us the tweet id from this path
}

// AI-generate a tweet for autopilot. The coordinator's runForAccount
// calls this before submitPost. We just return text in `title` — x.js's
// own submitPost coalesces title + body into the tweet content.
async function generateContent({ account, target }) {
  const { generateText } = require('../services/platformGen');
  const r = await generateText({
    accountId: account.id,
    platform: 'x',
    kind: 'post',
    targetName: target?.name || null,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    target: target?.name || null,
    title: r.text,
    body: '',
    kind: 'self',
    url: null,
  };
}

module.exports = {
  id: 'x',
  configured: true,
  capabilities: { post: true, comment: true, engagement: true, dm: false },
  submitPost,
  generateContent,
};
