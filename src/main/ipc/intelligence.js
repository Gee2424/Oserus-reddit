// Reddit Intelligence — subreddit scraper.
//
// Uses a chosen logged-in account's session to pull public subreddit data
// (subscribers, posting requirements, rules) via Reddit's JSON endpoints.
// Results cache in a table so the Scheduler/Autopilot can later read karma
// requirements per subreddit. Read-only against Reddit; no posting.

const { userFromToken } = require('./auth');
const { getDb } = require('../db');
const { partitionFor, request } = require('../services/redditSession');

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS subreddit_intel (
      name TEXT PRIMARY KEY,
      subscribers INTEGER,
      over18 INTEGER,
      submission_type TEXT,
      min_account_age_days INTEGER,
      min_post_karma INTEGER,
      min_comment_karma INTEGER,
      rules_json TEXT,
      description TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      fetched_by_user_id INTEGER
    );
  `);
}

// Normalize a Reddit listing into compact rows for the scraper tables/export.
function normalizePost(c) {
  const d = c.data || {};
  return {
    id: d.id,
    fullname: d.name,
    subreddit: d.subreddit,
    author: d.author,
    title: d.title,
    score: d.score,
    upvote_ratio: d.upvote_ratio,
    num_comments: d.num_comments,
    created: d.created_utc,
    over_18: d.over_18 ? 1 : 0,
    is_video: d.is_video ? 1 : 0,
    domain: d.domain,
    url: d.url,
    permalink: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
    link_flair_text: d.link_flair_text,
    selftext_snip: (d.selftext || '').slice(0, 200),
  };
}

// Reddit exposes karma/age gates inconsistently; pull what's available from
// about.json + about/rules.json and the post-requirements endpoint.
async function fetchOne(partition, name) {
  const clean = String(name).replace(/^\/?r\//i, '').trim();
  if (!clean) return null;
  const about = await request(partition, `https://www.reddit.com/r/${clean}/about.json?raw_json=1`);
  const d = about?.data || {};
  let rules = [];
  try {
    const r = await request(partition, `https://www.reddit.com/r/${clean}/about/rules.json?raw_json=1`);
    rules = (r?.rules || []).map((x) => ({ short: x.short_name, desc: x.description }));
  } catch { /* some subs hide rules */ }

  // Post requirements endpoint (karma/age gates), best-effort.
  let minAge = null, minPost = null, minComment = null;
  try {
    const req = await request(partition, `https://oauth.reddit.com/api/v1/${clean}/post_requirements.json`);
    if (req) {
      minAge = req.account_age_min != null ? Math.round(req.account_age_min / 86400) : null;
      minPost = req.post_karma_min ?? null;
      minComment = req.comment_karma_min ?? null;
    }
  } catch { /* requires oauth scope; fine to skip */ }

  return {
    name: clean,
    subscribers: d.subscribers ?? null,
    over18: d.over18 ? 1 : 0,
    submission_type: d.submission_type || null,
    min_account_age_days: minAge,
    min_post_karma: minPost,
    min_comment_karma: minComment,
    rules_json: JSON.stringify(rules),
    description: d.public_description || d.title || null,
  };
}

function register(ipcMain) {
  ipcMain.handle('intel:list', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const rows = getDb().prepare('SELECT * FROM subreddit_intel ORDER BY name COLLATE NOCASE').all();
      return { ok: true, subs: rows.map((r) => ({ ...r, rules: safeParse(r.rules_json) })) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('intel:fetch', async (_e, { token, accountId, subreddits }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!accountId) throw new Error('Pick a scraper account');
      const acct = partitionFor(accountId);
      if (!acct) throw new Error('Account not found');
      ensureTable();
      const names = String(subreddits || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      if (!names.length) throw new Error('Enter at least one subreddit');

      const upsert = getDb().prepare(
        `INSERT INTO subreddit_intel
           (name, subscribers, over18, submission_type, min_account_age_days, min_post_karma, min_comment_karma, rules_json, description, fetched_at, fetched_by_user_id)
         VALUES (@name,@subscribers,@over18,@submission_type,@min_account_age_days,@min_post_karma,@min_comment_karma,@rules_json,@description,datetime('now'),@uid)
         ON CONFLICT(name) DO UPDATE SET
           subscribers=excluded.subscribers, over18=excluded.over18, submission_type=excluded.submission_type,
           min_account_age_days=excluded.min_account_age_days, min_post_karma=excluded.min_post_karma,
           min_comment_karma=excluded.min_comment_karma, rules_json=excluded.rules_json,
           description=excluded.description, fetched_at=datetime('now'), fetched_by_user_id=excluded.uid`
      );

      const results = []; const errors = [];
      for (const n of names) {
        try {
          const data = await fetchOne(acct.partition, n);
          if (data) { upsert.run({ ...data, uid: user.id }); results.push(data.name); }
        } catch (e) {
          errors.push(`r/${n}: ${e.message === 'NOT_LOGGED_IN' ? 'scraper account not logged in' : e.message}`);
        }
      }
      return { ok: true, fetched: results.length, results, errors };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('intel:delete', (_e, { token, name }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      getDb().prepare('DELETE FROM subreddit_intel WHERE name = ?').run(name);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // -------- Scraper --------
  // Subreddit listing (Hot/Top/Rising/New). Uses the chosen account's
  // logged-in session so private subs we follow still work; otherwise it's
  // public data. limit: 25 default, max 100.
  ipcMain.handle('intel:scrapePosts', async (_e, { token, accountId, subreddit, sort, t, limit, query }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = partitionFor(accountId);
      if (!acct) throw new Error('Pick a scraper account');
      const sub = String(subreddit || '').replace(/^\/?r\//i, '').trim();
      if (!sub) throw new Error('Subreddit required');
      const sortKey = ['hot', 'top', 'rising', 'new'].includes(sort) ? sort : 'hot';
      const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
      const tWindow = ['hour', 'day', 'week', 'month', 'year', 'all'].includes(t) ? t : 'day';
      const q = String(query || '').trim();
      let url;
      if (q) {
        // Reddit's per-sub search — works for keywords, hashtags (#tag), song
        // titles, dance terms etc. restrict_sr keeps results in this sub.
        const searchSort = sortKey === 'hot' ? 'relevance' : sortKey;
        url = `https://www.reddit.com/r/${sub}/search.json?raw_json=1&restrict_sr=1`
          + `&q=${encodeURIComponent(q)}&sort=${searchSort}&t=${tWindow}&limit=${lim}`;
      } else if (sortKey === 'top') {
        url = `https://www.reddit.com/r/${sub}/top.json?raw_json=1&limit=${lim}&t=${tWindow}`;
      } else {
        url = `https://www.reddit.com/r/${sub}/${sortKey}.json?raw_json=1&limit=${lim}`;
      }
      const data = await request(acct.partition, url);
      const posts = (data?.data?.children || []).map(normalizePost);
      return { ok: true, posts };
    } catch (err) {
      if (err.message === 'NOT_LOGGED_IN') return { ok: false, error: 'Scraper account is not logged in.' };
      return { ok: false, error: err.message };
    }
  });

  // User profile + recent submissions.
  ipcMain.handle('intel:scrapeUser', async (_e, { token, accountId, username }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = partitionFor(accountId);
      if (!acct) throw new Error('Pick a scraper account');
      const u = String(username || '').replace(/^u\//i, '').replace(/^@/, '').trim();
      if (!u) throw new Error('Username required');
      const [about, posts] = await Promise.all([
        request(acct.partition, `https://www.reddit.com/user/${u}/about.json?raw_json=1`),
        request(acct.partition, `https://www.reddit.com/user/${u}/submitted.json?raw_json=1&limit=25`),
      ]);
      const d = about?.data || {};
      return {
        ok: true,
        user: {
          username: d.name,
          icon_url: (d.icon_img || '').split('?')[0],
          created: d.created_utc,
          link_karma: d.link_karma,
          comment_karma: d.comment_karma,
          total_karma: d.total_karma,
          is_gold: d.is_gold ? 1 : 0,
          verified: d.verified ? 1 : 0,
          has_verified_email: d.has_verified_email ? 1 : 0,
          subreddit_description: d?.subreddit?.public_description || null,
        },
        recentPosts: (posts?.data?.children || []).map(normalizePost),
      };
    } catch (err) {
      if (err.message === 'NOT_LOGGED_IN') return { ok: false, error: 'Scraper account is not logged in.' };
      return { ok: false, error: err.message };
    }
  });

  // Moderator list for a subreddit.
  ipcMain.handle('intel:scrapeMods', async (_e, { token, accountId, subreddit }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = partitionFor(accountId);
      if (!acct) throw new Error('Pick a scraper account');
      const sub = String(subreddit || '').replace(/^\/?r\//i, '').trim();
      if (!sub) throw new Error('Subreddit required');
      const data = await request(acct.partition, `https://www.reddit.com/r/${sub}/about/moderators.json?raw_json=1`);
      const mods = (data?.data?.children || []).map((c) => ({
        name: c.name,
        added: c.date,
        permissions: c.mod_permissions || [],
      }));
      return { ok: true, mods };
    } catch (err) {
      if (err.message === 'NOT_LOGGED_IN') return { ok: false, error: 'Scraper account is not logged in.' };
      return { ok: false, error: err.message };
    }
  });

  // Content Planning — pass selected research findings + a model profile,
  // get back a Grok-synthesized 1-page content plan. Saves the plan into
  // the docs table tied to the profile so it's reviewable later.
  ipcMain.handle('intel:synthesizePlan', async (_e, { token, profileId, findings, save = true }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!Array.isArray(findings) || !findings.length) throw new Error('No findings selected');
      const { callGrok, getSetting } = require('../services/postgen');
      const { decryptSecret } = require('../db');
      const enc = getSetting('grok_api_key');
      const apiKey = enc ? decryptSecret(enc) : null;
      if (!apiKey) throw new Error('Grok API key not configured — set it in Configuration first');
      let profile = null;
      if (profileId) {
        try { profile = getDb().prepare('SELECT * FROM model_profiles WHERE id = ?').get(profileId); } catch {}
      }
      const system = [
        'You are a content strategist for adult creators on Reddit.',
        'Given the listed real Reddit posts that performed well, produce a one-week content plan.',
        'Plan must contain: themes to lean into, exact title formulas (3-5 examples), recommended subreddits + posting windows, and 3 caption variations.',
        'Be concrete. No marketing fluff.',
      ].join(' ');
      const userMsg = [
        profile ? `Model: ${profile.name}${profile.brand_voice ? ` · brand voice: ${profile.brand_voice}` : ''}.` : '',
        `Selected findings (top performing posts):`,
        ...findings.map((f, i) => `${i + 1}. [r/${f.subreddit || '?'}] ${f.title || ''} · ${f.ups || 0} ups · ${f.num_comments || 0} comments`),
      ].filter(Boolean).join('\n');
      const text = await callGrok(apiKey, system, userMsg, { maxTokens: 1200 });
      if (save && profileId) {
        try {
          getDb().prepare(
            "INSERT INTO docs (profile_id, title, body, created_by_user_id) VALUES (?,?,?,?)"
          ).run(profileId, `Content plan · ${new Date().toISOString().slice(0,10)}`, text, user.id);
        } catch {}
      }
      return { ok: true, plan: text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Link flairs offered by a subreddit (best-effort; some require mod auth).
  ipcMain.handle('intel:scrapeFlairs', async (_e, { token, accountId, subreddit }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = partitionFor(accountId);
      if (!acct) throw new Error('Pick a scraper account');
      const sub = String(subreddit || '').replace(/^\/?r\//i, '').trim();
      if (!sub) throw new Error('Subreddit required');
      const data = await request(acct.partition, `https://www.reddit.com/r/${sub}/api/link_flair_v2.json?raw_json=1`);
      const flairs = Array.isArray(data) ? data.map((f) => ({
        id: f.id, text: f.text, type: f.type, mod_only: f.mod_only,
        text_editable: f.text_editable, background_color: f.background_color, text_color: f.text_color,
      })) : [];
      return { ok: true, flairs };
    } catch (err) {
      if (err.message === 'NOT_LOGGED_IN') return { ok: false, error: 'Scraper account is not logged in.' };
      return { ok: false, error: err.message };
    }
  });

  // Aggregate research insights from a posts sample: top words in titles,
  // best-performing posting hour, averages. Pure analysis, no extra fetch.
  ipcMain.handle('intel:analyze', (_e, { token, posts }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!Array.isArray(posts) || !posts.length) throw new Error('No posts to analyze');
      const STOP = new Set(['the','a','an','of','to','for','in','and','or','but','on','at','with','is','are','was','were','be','my','your','his','her','their','this','that','it','its','as','if','by','from','about','i','you','we','they','am','me','us','what','when','how','why','who','do','does','did','no','not','so','than','then','just','really','some','more','any','can','could','would','should','will','have','has','had']);
      const counts = new Map();
      const hours = new Array(24).fill(0);
      const hoursN = new Array(24).fill(0);
      let totalScore = 0, totalComments = 0;
      for (const p of posts) {
        const words = String(p.title || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/);
        for (const w of words) if (w.length >= 3 && !STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
        if (p.created) {
          const h = new Date(p.created * 1000).getUTCHours();
          hours[h] += Number(p.score) || 0;
          hoursN[h]++;
        }
        totalScore += Number(p.score) || 0;
        totalComments += Number(p.num_comments) || 0;
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([word, n]) => ({ word, n }));
      const avgScore = posts.length ? Math.round(totalScore / posts.length) : 0;
      const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
      const hourAvg = hours.map((s, i) => ({ hour: i, avg: hoursN[i] ? Math.round(s / hoursN[i]) : 0 }));
      const bestHourUTC = hourAvg.reduce((b, x) => (x.avg > b.avg ? x : b), { hour: 0, avg: 0 });
      return {
        ok: true,
        sample: posts.length,
        avgScore, avgComments,
        topWords: top,
        bestHourUTC,
        hourly: hourAvg,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

function safeParse(s) { try { return JSON.parse(s) || []; } catch { return []; } }

module.exports = register;
