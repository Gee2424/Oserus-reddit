// Discover adapter for non-Reddit platforms. Opens a hidden BrowserWindow on
// the chosen scraper account's session and runs a platform-specific scraping
// script. Returns the same { posts: [...] } shape the renderer's Discover
// panel already understands so the rest of the page (analyze + plan) just
// works.
//
// Each platform's selectors are best-effort; X / IG / TikTok churn their DOM
// every few weeks. When a scrape returns empty but the page clearly loaded we
// surface `stale: true` so the UI can say "layout changed" rather than "no
// matches".
//
// The hidden window inherits the account's antidetect identity automatically:
// prepareSessionForAccount() registers the fingerprint preload + proxy + UA on
// the *session* (session.setPreloads / setProxy / setUserAgent), which applies
// to every webContents on that partition. We only add device emulation here
// because that is per-webContents, not per-session.

const { BrowserWindow } = require('electron');
const { getDb } = require('../db');
const fingerprintMod = require('../fingerprint');

const PLATFORM_URL = {
  x:         (q) => `https://x.com/search?q=${encodeURIComponent(q || '')}&src=typed_query&f=top`,
  twitter:   (q) => `https://x.com/search?q=${encodeURIComponent(q || '')}&src=typed_query&f=top`,
  instagram: (q) => q.startsWith('@')
    ? `https://www.instagram.com/${encodeURIComponent(q.slice(1))}/`
    : `https://www.instagram.com/explore/tags/${encodeURIComponent(q.replace(/^#/, ''))}/`,
  tiktok:    (q) => q.startsWith('@')
    ? `https://www.tiktok.com/@${encodeURIComponent(q.slice(1))}`
    : `https://www.tiktok.com/tag/${encodeURIComponent(q.replace(/^#/, ''))}`,
};

// Per-platform DOM scrape. Each returns a flat array of { id, title, url, ... }.
// X / TikTok also carry { author, score, num_comments, created }; Instagram
// hashtag/grid pages expose NONE of that — see Phase 1-IG for a per-post pass —
// so IG rows are intentionally { id, title, url } only and the UI renders "—".
const SCRAPE_SCRIPTS = {
  x: `(() => {
    const posts = [];
    const cards = document.querySelectorAll('article[data-testid="tweet"]');
    cards.forEach((el, i) => {
      const text = el.querySelector('div[data-testid="tweetText"]')?.innerText || '';
      const author = el.querySelector('div[data-testid="User-Name"] a')?.innerText || '';
      const link = el.querySelector('a[href*="/status/"]')?.href || '';
      const id = (link.match(/status\\/(\\d+)/) || [])[1] || ('x-' + i);
      const num = (sel) => Number((el.querySelector(sel)?.innerText || '0').replace(/[^0-9.]/g, '')) || 0;
      const score = num('button[data-testid="like"] span');
      const replies = num('button[data-testid="reply"] span');
      const repost = num('button[data-testid="retweet"] span');
      const timeEl = el.querySelector('time');
      const created = timeEl ? (Math.floor(Date.parse(timeEl.getAttribute('datetime') || '') / 1000) || null) : null;
      const has_media = !!el.querySelector('div[data-testid="tweetPhoto"], video');
      if (text) posts.push({ id, title: text.slice(0, 280), author: author.replace(/^@/, ''), score, num_comments: replies, repost, created, has_media, url: link });
    });
    return posts.slice(0, 50);
  })()`,
  instagram: `(() => {
    const posts = [];
    // Hashtag / explore grid: tiles expose no likes / author / comments —
    // just the alt text and the permalink. (Phase 1-IG opens each post.)
    const tiles = document.querySelectorAll('article a[role="link"][href*="/p/"], a[role="link"][href*="/reel/"]');
    tiles.forEach((a, i) => {
      const href = a.href || '';
      const id = (href.match(/(?:p|reel)\\/([^/]+)/) || [])[1] || ('ig-' + i);
      const alt = a.querySelector('img')?.alt || '';
      if (href) posts.push({ id, title: alt.slice(0, 280), url: href });
    });
    return posts.slice(0, 50);
  })()`,
  tiktok: `(() => {
    const posts = [];
    const items = document.querySelectorAll('div[data-e2e="challenge-item"], div[data-e2e="recommend-list-item-container"]');
    items.forEach((el, i) => {
      const title = el.querySelector('div[data-e2e="challenge-item-desc"]')?.innerText
                 || el.querySelector('div[data-e2e="video-desc"]')?.innerText
                 || el.innerText.split('\\n')[0];
      const handle = el.querySelector('a[href^="/@"]')?.getAttribute('href') || '';
      const author = handle.replace(/^\\/@/, '').split(/[/?]/)[0];
      const link = el.querySelector('a[href*="/video/"]')?.href || '';
      const id = (link.match(/video\\/(\\d+)/) || [])[1] || ('tt-' + i);
      const num = (sel) => Number((el.querySelector(sel)?.innerText || '0').replace(/[^0-9.]/g, '')) || 0;
      const likes = num('strong[data-e2e="like-count"], strong[data-e2e="challenge-vvcount"]');
      const comments = num('strong[data-e2e="comment-count"]');
      if (title) posts.push({ id, title: String(title).slice(0, 280), author, score: likes, num_comments: comments, url: link });
    });
    return posts.slice(0, 50);
  })()`,
};

const SCROLL_SCRIPT = `(async () => {
  for (let i = 0; i < 6; i++) { window.scrollBy(0, 900); await new Promise(r => setTimeout(r, 600)); }
})()`;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label || 'timeout')), ms)),
  ]);
}

// One load→settle→scroll→scrape pass in its own hidden window.
// Returns { posts, bodyLen, err }.
async function runAttempt({ url, script, partition, winW, winH, fp, settleMs }) {
  const win = new BrowserWindow({
    width: winW, height: winH,
    show: false,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false },
  });
  try {
    const emu = fingerprintMod.getDeviceEmulationParams(fp);
    if (emu) win.webContents.enableDeviceEmulation(emu);
  } catch {}

  let posts = [];
  let bodyLen = 0;
  let err = null;
  try {
    try {
      await withTimeout(win.loadURL(url), 20000, 'load timeout');
    } catch (e) {
      // ERR_ABORTED (-3) just means a client-side redirect fired mid-load —
      // the page usually still renders. Anything else is a real failure.
      if (!/ERR_ABORTED|-3\b/.test(e.message || '')) throw e;
    }
    await new Promise((r) => setTimeout(r, settleMs));
    try { await win.webContents.executeJavaScript(SCROLL_SCRIPT); } catch {}
    posts = await win.webContents.executeJavaScript(script);
    if (!Array.isArray(posts)) posts = [];
    if (!posts.length) {
      try {
        bodyLen = Number(await win.webContents.executeJavaScript('document.body.innerText.length')) || 0;
      } catch {}
    }
  } catch (e) {
    err = e.message;
  } finally {
    try { win.destroy(); } catch {}
  }
  return { posts, bodyLen, err };
}

async function scrape({ accountId, platform, keyword }) {
  const db = getDb();
  const acct = db.prepare(
    `SELECT id, partition_key, platform FROM reddit_accounts WHERE id = ?`
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };

  const urlFor = PLATFORM_URL[platform];
  const script = SCRAPE_SCRIPTS[platform];
  if (!urlFor || !script) return { ok: false, error: `Discover adapter for ${platform} not configured` };

  try {
    const { prepareSessionForAccount } = require('./sessionPrep');
    await prepareSessionForAccount(accountId);
  } catch {}

  const partition = `persist:${acct.partition_key}`;
  const url = urlFor(keyword || '');

  // Match the viewport to the fingerprint so a mobile UA isn't paired with a
  // desktop-sized window (a clean bot tell) — same pattern as engagement.js.
  const fp = fingerprintMod.loadOrCreate(db, accountId);
  const isMobile = !!(fp && fp.mobile);
  const winW = isMobile ? (fp.screen?.width || 412) : 1180;
  const winH = isMobile ? (fp.screen?.height || 915) : 820;

  const base = { url, script, partition, winW, winH, fp };

  // Attempt 1 (normal settle). Retry once with a longer settle if it came back
  // empty without an outright error — the SPA often just hadn't hydrated.
  let r = await runAttempt({ ...base, settleMs: 4500 });
  if (r.err) return { ok: false, error: r.err };
  if (r.posts.length) return { ok: true, posts: r.posts, attempts: 1 };

  const r2 = await runAttempt({ ...base, settleMs: 7000 });
  if (r2.err) return { ok: false, error: r2.err };
  if (r2.posts.length) return { ok: true, posts: r2.posts, attempts: 2 };

  // Loaded fine (real page body) but zero results across two tries → the
  // selectors are probably stale, not "the keyword had no matches".
  const bodyLen = Math.max(r.bodyLen, r2.bodyLen);
  if (bodyLen > 2000) {
    return {
      ok: false,
      stale: true,
      error: `${platform} loaded but no results were found — its page layout may have changed. Try again, or report it so the selectors can be updated.`,
    };
  }
  return { ok: true, posts: [], attempts: 2 };
}

module.exports = { scrape };
