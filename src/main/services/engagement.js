// Engagement runner — drives a hidden BrowserWindow on a per-account
// session and runs platform-specific scroll / like / follow / WATCH /
// COMMENT scripts.
//
// The script paces itself with random delays and skips most posts so
// behavior doesn't read as a bot. Selectors are best-effort and may
// need touch-ups as IG / TikTok / X change their markup; that's normal
// for browser-driven automation and we surface failures via
// engagement_sessions.error.
//
// Human-like commenting:
//   The hidden window's preload (src/preload/engagement.js) exposes
//   `window.oserus.requestComment(payload)`. When the script picks a
//   video to comment on, it extracts the caption + creator + a few
//   visible top replies, awaits an AI-generated reply, then types it
//   into the platform's comment input character-by-character with
//   human-shaped delays before submitting.

const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const elog = require('electron-log');
const { getDb } = require('../db');

const PLATFORM_URL = {
  instagram: 'https://www.instagram.com/reels/',
  tiktok:    'https://www.tiktok.com/foryou',
  x:         'https://x.com/home',
  reddit:    'https://www.reddit.com/',
  redgifs:   'https://www.redgifs.com/',
};

// Per-platform DOM selectors. Grouped here so the harness body stays
// generic. Markup changes regularly on these sites — that's the cost
// of DOM-driven automation. When a platform breaks, only this table
// needs updating.
const SELECTORS = {
  instagram: {
    post:    'article, div[role="presentation"]',
    like:    'svg[aria-label="Like"]',
    follow:  'button._acan._acap._acas',
    caption: 'h1, span[dir="auto"]',
    creator: 'a[role="link"][tabindex="0"]',
    commentBtn:  'svg[aria-label="Comment"]',
    commentInput:'textarea[aria-label="Add a comment…"], textarea[aria-label^="Add a comment"]',
    commentSubmit:'div[role="button"]:not([aria-disabled="true"])', // "Post" button next to textarea
    isVideo: 'video',
  },
  tiktok: {
    post:    'div[data-e2e="recommend-list-item-container"]',
    like:    'span[data-e2e="like-icon"]',
    follow:  'button[data-e2e="follow-button"]',
    caption: 'div[data-e2e="browse-video-desc"], h1[data-e2e="browse-video-desc"]',
    creator: 'a[data-e2e="browse-username"], h3[data-e2e="browse-username"]',
    commentBtn:  'span[data-e2e="comment-icon"]',
    commentInput:'div[contenteditable="true"][data-e2e="comment-text"], div[contenteditable="true"]',
    commentSubmit:'div[data-e2e="comment-post"]',
    isVideo: 'video',
  },
  x: {
    post:    'article[data-testid="tweet"]',
    like:    'button[data-testid="like"]',
    follow:  'button[data-testid$="-follow"]',
    caption: 'div[data-testid="tweetText"]',
    creator: 'div[data-testid="User-Name"] a',
    commentBtn:  'button[data-testid="reply"]',
    commentInput:'div[data-testid="tweetTextarea_0"]',
    commentSubmit:'button[data-testid="tweetButton"]',
    isVideo: 'video, div[data-testid="videoComponent"]',
  },
  reddit: {
    post:    'shreddit-post, div[data-testid="post-container"]',
    like:    'button[aria-label="upvote"]',
    follow:  'button[aria-label="Join"]',
    caption: 'h1, h3',
    creator: 'a[href^="/user/"]',
    commentBtn:  null,  // Reddit commenting uses the API path (redditAutoComment)
    commentInput:null,
    commentSubmit:null,
    isVideo: 'video, shreddit-player',
  },
  redgifs: {
    post:    'div.PreviewVideo, div.GifPreview',
    like:    'button.btn-like, button[aria-label="like" i]',
    follow:  'button.btn-follow, button[aria-label="follow" i]',
    caption: '.tags, h1',
    creator: 'a.userName, a[href^="/users/"]',
    commentBtn:  null,
    commentInput:null,
    commentSubmit:null,
    isVideo: 'video',
  },
};

function pickRandom(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

// The in-page harness. Same body for every platform; SELECTORS table
// supplies platform-specific element bindings. Returns
// {posts_seen, likes, follows, comments, errors}.
function buildScript(platform, opts) {
  const cfg = JSON.stringify(opts);
  const sel = SELECTORS[platform] || SELECTORS.instagram;
  const selJSON = JSON.stringify(sel);

  return `(async () => {
    const cfg = ${cfg};
    const sel = ${selJSON};
    const stats = { posts_seen: 0, likes: 0, follows: 0, comments: 0, errors: [] };
    const start = Date.now();
    const endBy = start + cfg.sessionSeconds * 1000;
    const seen = new WeakSet();
    const followSet = new Set((cfg.followList || []).map((s) => String(s).replace(/^@/, '').toLowerCase()));

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rnd   = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const roll  = (pct) => Math.random() * 100 < pct;

    // Soft scroll — multiple small increments, not one jump. Anti-bot
    // heuristics flag instant scrollTop changes.
    async function softScroll(px) {
      const steps = rnd(3, 8);
      const each = Math.floor(px / steps);
      for (let i = 0; i < steps; i++) {
        window.scrollBy({ top: each, left: 0, behavior: 'auto' });
        await sleep(rnd(80, 220));
      }
    }

    // Set an input's value or contenteditable text in a way that
    // React/Vue listeners actually pick up. Without this the page may
    // submit an empty comment because its internal state never got
    // the value we set.
    function setReactValue(el, value) {
      if (!el) return false;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
      } else {
        // contenteditable
        el.focus();
        el.textContent = value;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // Type one character at a time with humane jitter so the input
    // looks typed rather than pasted. Caps total typing to ~6s to
    // keep the session moving.
    async function humanType(el, text) {
      if (!el || !text) return false;
      el.focus();
      const chars = text.split('');
      const budget = Math.min(6000, Math.max(800, chars.length * rnd(40, 90)));
      const perChar = Math.max(8, Math.floor(budget / chars.length));
      let current = '';
      for (const c of chars) {
        current += c;
        setReactValue(el, current);
        await sleep(perChar + rnd(-12, 28));
      }
      // Final input event to make sure listeners commit the value.
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    }

    function visibleText(el) {
      try { return (el?.innerText || el?.textContent || '').trim().replace(/\\s+/g, ' '); }
      catch { return ''; }
    }

    function findIn(scope, selector) {
      if (!selector) return null;
      try { return scope.querySelector(selector); } catch { return null; }
    }

    async function maybeComment(p) {
      if (!cfg.commentRatePct || cfg.commentRatePct <= 0) return;
      if (!roll(cfg.commentRatePct)) return;
      if (!sel.commentBtn || !sel.commentInput) return;
      const isVid = sel.isVideo ? !!p.querySelector(sel.isVideo) : true;
      if (cfg.commentVideosOnly && !isVid) return;

      const caption = visibleText(findIn(p, sel.caption)).slice(0, 600);
      const creator = (visibleText(findIn(p, sel.creator)) || '').replace(/^@/, '').split(/\\s+/)[0];

      // Bridge to main process for an AI comment. Returns null on any
      // failure — we just skip silently in that case.
      let reply = null;
      try {
        reply = await window.oserus?.requestComment?.({
          platform: ${JSON.stringify(platform)},
          caption, creator,
          topReplies: [],
        });
      } catch (e) { stats.errors.push('ai:' + e.message); return; }
      if (!reply || typeof reply !== 'string' || reply.length < 4) return;

      // Open the comment surface (a button or icon under each post).
      const cbtn = findIn(p, sel.commentBtn);
      if (cbtn) {
        try { (cbtn.closest('button, [role="button"], a') || cbtn).click(); }
        catch (e) { stats.errors.push('comment-open:' + e.message); return; }
        await sleep(rnd(700, 1400));
      }
      // After opening, the input may be inside an overlay attached to
      // <body> rather than the post element — search both.
      const input = document.querySelector(sel.commentInput) || findIn(p, sel.commentInput);
      if (!input) { stats.errors.push('comment-input-missing'); return; }

      const ok = await humanType(input, reply);
      if (!ok) return;
      await sleep(rnd(400, 1000));

      // Submit. Some platforms enable the post button only AFTER text
      // is committed — try once, wait, try again.
      let submit = document.querySelector(sel.commentSubmit) || findIn(p, sel.commentSubmit);
      if (!submit) {
        await sleep(800);
        submit = document.querySelector(sel.commentSubmit);
      }
      if (submit && !submit.matches('[aria-disabled="true"], [disabled]')) {
        try { submit.click(); stats.comments++; }
        catch (e) { stats.errors.push('comment-submit:' + e.message); }
      } else {
        // No submit button visible — try pressing Enter as a fallback.
        try {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          stats.comments++;
        } catch (e) { stats.errors.push('comment-enter:' + e.message); }
      }
      await sleep(rnd(900, 2000));
      // Close any overlay we opened by pressing Escape — keeps the
      // feed scrollable for the rest of the session.
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); } catch {}
    }

    try {
      while (Date.now() < endBy) {
        const posts = Array.from(document.querySelectorAll(sel.post));
        for (const p of posts) {
          if (seen.has(p)) continue;
          seen.add(p);
          stats.posts_seen++;

          // Watch videos longer than text posts. The watch length
          // distribution matters — pure scroll-past behavior is a tell.
          const watchMs = roll(cfg.watchFullRatePct) ? rnd(4500, 11000) : rnd(700, 2200);
          await sleep(watchMs);

          // Like a slice of posts.
          if (roll(cfg.likeRatePct)) {
            const likeBtn = p.querySelector(sel.like);
            if (likeBtn) {
              try {
                (likeBtn.closest('button, [role="button"], a') || likeBtn).click();
                stats.likes++;
                await sleep(rnd(400, 1200));
              } catch (e) { stats.errors.push('like:' + e.message); }
            }
          }

          // Follow a slice of accounts; honor optional follow-list filter.
          if (roll(cfg.followRatePct)) {
            const followBtn = p.querySelector(sel.follow);
            if (followBtn && !/following/i.test(followBtn.textContent || '')) {
              const handle = (p.querySelector('a[href^="/"]')?.getAttribute('href') || '')
                .replace(/^\\//, '').split('/')[0].toLowerCase();
              const allowed = followSet.size === 0 || followSet.has(handle);
              if (allowed) {
                try {
                  followBtn.click();
                  stats.follows++;
                  await sleep(rnd(800, 1800));
                } catch (e) { stats.errors.push('follow:' + e.message); }
              }
            }
          }

          // Comment on selected videos (rate-gated; gated by AI bridge).
          await maybeComment(p);

          if (Date.now() >= endBy) break;
        }
        await softScroll(rnd(600, 1400));
        await sleep(rnd(400, 1300));
      }
    } catch (e) {
      stats.errors.push('loop:' + e.message);
    }
    return stats;
  })()`;
}

// ---------------------------------------------------------------- IPC bridge
// Registered once on first runSession call. The hidden engagement
// window's preload invokes `engagement:requestComment` which lands
// here, calls the autopilot AI, and returns the generated comment.
let bridgeRegistered = false;
function registerBridge() {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
  ipcMain.handle('engagement:requestComment', async (_e, payload = {}) => {
    try {
      const { callAutopilotAI } = require('./postgen');
      const { platform, caption, creator, topReplies } = payload;
      if (!caption && !creator) return { ok: false, error: 'no context' };
      const system = `You are a real person scrolling ${platform || 'social media'} videos and leaving casual reactions. Write ONE short reply to the video below (1 sentence, occasionally 2). Sound like a real viewer: react to a specific detail in the caption — don't be generic. Avoid hashtags, no emojis spam (zero or one max), no "great video" / "love this content" filler. Never promotional, never about another platform. Output ONLY the reply text, nothing else.`;
      const userMsg = [
        creator ? `Creator: @${creator}` : null,
        caption ? `Caption: ${caption}` : '(no caption)',
        Array.isArray(topReplies) && topReplies.length
          ? `Visible top replies (for tone — do not mimic verbatim):\n${topReplies.slice(0, 4).map((r) => `- ${r}`).join('\n')}`
          : null,
        '\nWrite your one-line reaction now.',
      ].filter(Boolean).join('\n');
      const raw = await Promise.race([
        callAutopilotAI(system, userMsg, { maxTokens: 120 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ai timeout')), 12000)),
      ]);
      const text = String(raw || '').trim()
        .replace(/^["'`]\s*|\s*["'`]$/g, '')
        .replace(/^reply[:\s]+/i, '');
      if (text.length < 4 || text.length > 280) return { ok: false, error: 'rejected' };
      return { ok: true, comment: text };
    } catch (e) {
      return { ok: false, error: e?.message || 'ai error' };
    }
  });
}

// ------------------------------------------------- one session for one account
async function runSession(accountId, { dryRun = false } = {}) {
  registerBridge();
  const db = getDb();
  const acct = db.prepare(
    `SELECT id, username, partition_key, platform FROM reddit_accounts WHERE id = ?`
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };
  const proto = db.prepare(`SELECT * FROM engagement_protocols WHERE account_id = ?`).get(accountId);
  if (!proto) return { ok: false, error: 'No engagement protocol configured' };

  const url = PLATFORM_URL[acct.platform] || PLATFORM_URL.instagram;
  const minMin = Math.max(1, proto.session_minutes_min || 6);
  const maxMin = Math.max(minMin, proto.session_minutes_max || 14);
  const sessionSeconds = pickRandom(minMin, maxMin) * 60;

  let followList = [];
  let hashtags = [];
  try { followList = JSON.parse(proto.follow_list_json || '[]'); } catch {}
  try { hashtags = JSON.parse(proto.hashtags_json || '[]'); } catch {}

  // Re-prepare the partitioned session (cookies / proxy / UA / antidetect)
  // so the engagement window lands logged in.
  try {
    const main = require('../index');
    if (main.prepareSessionForAccount) await main.prepareSessionForAccount(accountId);
  } catch {}

  const partition = `persist:${acct.partition_key}`;
  let landingUrl = url;
  if (hashtags.length && (acct.platform === 'tiktok' || acct.platform === 'instagram')) {
    const tag = String(hashtags[Math.floor(Math.random() * hashtags.length)]).replace(/^#/, '');
    landingUrl = acct.platform === 'tiktok'
      ? `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`
      : `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
  }

  const sessionRow = db.prepare(
    `INSERT INTO engagement_sessions (account_id, platform) VALUES (?, ?)`
  ).run(acct.id, acct.platform);
  const sessionId = sessionRow.lastInsertRowid;

  const win = new BrowserWindow({
    width: 1180, height: 820,
    show: false,
    webPreferences: {
      partition,
      preload: path.join(__dirname, '../../preload/engagement.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startedAt = Date.now();
  let stats = { posts_seen: 0, likes: 0, follows: 0, comments: 0, errors: [] };
  let err = null;
  try {
    await win.loadURL(landingUrl);
    await new Promise((r) => setTimeout(r, 4000));
    if (dryRun) {
      stats = { posts_seen: 0, likes: 0, follows: 0, comments: 0, errors: ['dry-run, no actions'] };
    } else {
      const script = buildScript(acct.platform, {
        sessionSeconds,
        likeRatePct:     Math.max(0, Math.min(100, proto.like_rate_pct ?? 18)),
        followRatePct:   Math.max(0, Math.min(100, proto.follow_rate_pct ?? 4)),
        watchFullRatePct:Math.max(0, Math.min(100, proto.watch_full_rate_pct ?? 25)),
        commentRatePct:  Math.max(0, Math.min(100, proto.comment_rate_pct ?? 0)),
        commentVideosOnly:(proto.comment_videos_only ?? 1) ? true : false,
        followList,
      });
      stats = await win.webContents.executeJavaScript(script);
    }
  } catch (e) {
    err = e.message;
    elog.warn('[engagement] session failed', { accountId, platform: acct.platform, error: err });
  } finally {
    try { win.destroy(); } catch {}
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  db.prepare(
    `UPDATE engagement_sessions
        SET ended_at = datetime('now'),
            seconds = ?, posts_seen = ?, likes = ?, follows = ?, comments = ?, error = ?
      WHERE id = ?`
  ).run(
    seconds, stats.posts_seen, stats.likes, stats.follows, stats.comments || 0,
    err || (stats.errors?.length ? stats.errors.join(' · ') : null),
    sessionId
  );
  db.prepare(`UPDATE engagement_protocols SET last_run_at = datetime('now') WHERE account_id = ?`).run(accountId);

  return { ok: !err, error: err, sessionId, stats, seconds };
}

// Coordinator tick — pick at most one enabled protocol whose last_run_at
// is stale enough to be due. Spreads sessions across the day instead of
// slamming them all at once.
async function engagementTick() {
  const db = getDb();
  let rows;
  try {
    rows = db.prepare(
      `SELECT account_id, sessions_per_day, last_run_at
         FROM engagement_protocols
        WHERE enabled = 1`
    ).all();
  } catch { return; }
  if (!rows.length) return;

  const nowMs = Date.now();
  const dueRows = rows.filter((r) => {
    const perDay = Math.max(1, r.sessions_per_day || 3);
    const spacingMs = (24 * 60 * 60 * 1000) / perDay;
    if (!r.last_run_at) return true;
    const lastMs = new Date(r.last_run_at.replace(' ', 'T') + 'Z').getTime();
    return (nowMs - lastMs) >= spacingMs * (0.85 + Math.random() * 0.3);
  });
  if (!dueRows.length) return;

  const pick = dueRows[Math.floor(Math.random() * dueRows.length)];
  try { await runSession(pick.account_id, { dryRun: false }); } catch {}
}

module.exports = { runSession, engagementTick };
