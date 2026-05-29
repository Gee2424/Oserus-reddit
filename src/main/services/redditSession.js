// Shared Reddit session helper. The "talk to Reddit as a logged-in account
// through its persist:<partition> session" logic was duplicated in
// ipc/inbox.js and platforms/reddit.js — consolidated here.

const { net } = require('electron');
const { getDb } = require('../db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

function partitionFor(accountId) {
  const row = getDb()
    .prepare("SELECT partition_key, username FROM reddit_accounts WHERE id = ? AND platform = 'reddit'")
    .get(accountId);
  return row ? { partition: `persist:${row.partition_key}`, username: row.username } : null;
}

// GET/POST through the account's session. Resolves parsed JSON, or rejects
// with NOT_LOGGED_IN when Reddit bounces us to a login page (403/HTML).
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

module.exports = { UA, partitionFor, request, modhashFor };
