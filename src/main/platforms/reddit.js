// Reddit platform adapter.
//
// Posts through the account's logged-in Electron session partition — the
// same mechanism the Inbox uses (net.request with useSessionCookies +
// the session's modhash). No OAuth, no scraping: cookies authenticate us
// as that account exactly like the browser tab does.

const { net } = require('electron');
const { getDb } = require('../db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

function partitionFor(accountId) {
  const row = getDb()
    .prepare("SELECT partition_key, username FROM reddit_accounts WHERE id = ? AND platform = 'reddit'")
    .get(accountId);
  return row ? { partition: `persist:${row.partition_key}`, username: row.username } : null;
}

function request(partition, url, { method = 'GET', form, modhash } = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method, url, partition, useSessionCookies: true });
    req.setHeader('User-Agent', UA);
    if (modhash) req.setHeader('X-Modhash', modhash);
    if (form) req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) { reject(new Error('NOT_LOGGED_IN')); return; }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('NOT_LOGGED_IN')); }
      });
    });
    req.on('error', (e) => reject(e));
    if (form) req.write(form);
    req.end();
  });
}

async function modhashFor(partition) {
  try {
    const me = await request(partition, 'https://www.reddit.com/api/me.json?raw_json=1');
    return me?.data?.modhash || me?.modhash || null;
  } catch {
    return null;
  }
}

const reddit = {
  id: 'reddit',
  configured: true,

  // kind: 'self' (text) | 'link' | 'image'(treated as link to media url)
  async submitPost({ accountId, subreddit, title, body, kind = 'self', url }) {
    try {
      const acct = partitionFor(accountId);
      if (!acct) return { ok: false, error: 'Reddit account not found' };
      if (!subreddit || !title) return { ok: false, error: 'Subreddit and title are required' };
      const modhash = await modhashFor(acct.partition);
      if (!modhash) return { ok: false, notLoggedIn: true, error: 'Account not logged into Reddit' };

      const sr = String(subreddit).replace(/^\/?r\//i, '').trim();
      const isLink = kind === 'link' || kind === 'image';
      const params = {
        api_type: 'json',
        sr,
        title: String(title).slice(0, 300),
        kind: isLink ? 'link' : 'self',
        uh: modhash,
        resubmit: 'true',
        sendreplies: 'true',
      };
      if (isLink) params.url = url || '';
      else params.text = body || '';

      const data = await request(acct.partition, 'https://www.reddit.com/api/submit', {
        method: 'POST',
        modhash,
        form: new URLSearchParams(params).toString(),
      });
      const errs = data?.json?.errors || [];
      if (errs.length) return { ok: false, error: errs.map((e) => e[1] || e[0]).join('; ') };
      const out = data?.json?.data || {};
      return { ok: true, id: out.id || out.name || null, url: out.url || null };
    } catch (err) {
      if (err.message === 'NOT_LOGGED_IN') return { ok: false, notLoggedIn: true, error: 'Account not logged into Reddit' };
      return { ok: false, error: err.message };
    }
  },
};

module.exports = reddit;
