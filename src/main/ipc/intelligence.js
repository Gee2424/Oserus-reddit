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
}

function safeParse(s) { try { return JSON.parse(s) || []; } catch { return []; } }

module.exports = register;
