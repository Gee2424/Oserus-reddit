// RedGIFs dashboard IPC.
//
// Lists the app's RedGIFs accounts and fetches each account's public
// profile (followers / views / videos / avatar / bio) via the RedGIFs
// v2 API. A short-lived temporary token is fetched once and cached in
// settings; the per-user fetch uses it as a Bearer.
//
// Caches results in a redgifs_profiles table keyed by username so the
// dashboard renders instantly on next open and a Refresh button forces
// a re-fetch.

const { net } = require('electron');
const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { log } = require('./activity');
const { getSetting, setSetting } = require('../services/settings');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const API = 'https://api.redgifs.com/v2';

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS redgifs_profiles (
      username TEXT PRIMARY KEY,
      display_name TEXT,
      avatar_url TEXT,
      bio TEXT,
      followers INTEGER,
      following INTEGER,
      views INTEGER,
      videos INTEGER,
      verified INTEGER,
      url TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// Fetch JSON over Electron's net so we honor system proxy and don't get
// blocked by CORS (this runs in main).
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url });
    req.setHeader('User-Agent', UA);
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)); return; }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Bad JSON from RedGifs')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getRedgifsToken() {
  const cached = getSetting('redgifs_token');
  const expiry = Number(getSetting('redgifs_token_exp') || 0);
  if (cached && Date.now() < expiry) return cached;
  const data = await fetchJson(`${API}/auth/temporary`);
  const tok = data.token;
  if (!tok) throw new Error('RedGifs did not return a token');
  setSetting('redgifs_token', tok);
  // Tokens are documented as valid ~24h; refresh after 20h to be safe.
  setSetting('redgifs_token_exp', String(Date.now() + 20 * 3600 * 1000));
  return tok;
}

async function fetchProfile(username) {
  const u = String(username).replace(/^@/, '').trim();
  if (!u) throw new Error('Username required');
  const token = await getRedgifsToken();
  const data = await fetchJson(`${API}/users/${encodeURIComponent(u.toLowerCase())}`, {
    Authorization: `Bearer ${token}`,
  });
  // RedGifs sometimes wraps in {user: {...}}, sometimes the raw object.
  const p = data.user || data;
  return {
    username: (p.username || u).toLowerCase(),
    display_name: p.name || null,
    avatar_url: p.profileImageUrl || null,
    bio: p.description || null,
    followers: Number(p.followers || 0),
    following: Number(p.following || 0),
    views: Number(p.views || 0),
    videos: Number(p.gifs || p.publishedGifs || 0),
    verified: p.verified ? 1 : 0,
    url: p.url || `https://www.redgifs.com/users/${u.toLowerCase()}`,
  };
}

function register(ipcMain) {
  ipcMain.handle('redgifs:listAccounts', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const accts = getDb().prepare(
        `SELECT a.id, a.username, a.status, a.notes, a.profile_id, p.name AS profile_name, p.avatar_color AS profile_color
         FROM reddit_accounts a
         LEFT JOIN model_profiles p ON p.id = a.profile_id
         WHERE a.platform = 'redgifs'
         ORDER BY p.name, a.username`
      ).all();
      // Attach cached profile data by username.
      const profiles = new Map(getDb().prepare('SELECT * FROM redgifs_profiles').all().map((r) => [r.username, r]));
      return {
        ok: true,
        accounts: accts.map((a) => {
          const p = profiles.get((a.username || '').toLowerCase()) || null;
          return { ...a, profile: p };
        }),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('redgifs:fetchProfile', async (_e, { token, username }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const p = await fetchProfile(username);
      getDb().prepare(
        `INSERT INTO redgifs_profiles
           (username, display_name, avatar_url, bio, followers, following, views, videos, verified, url, fetched_at)
         VALUES (@username,@display_name,@avatar_url,@bio,@followers,@following,@views,@videos,@verified,@url, datetime('now'))
         ON CONFLICT(username) DO UPDATE SET
           display_name=excluded.display_name, avatar_url=excluded.avatar_url, bio=excluded.bio,
           followers=excluded.followers, following=excluded.following, views=excluded.views,
           videos=excluded.videos, verified=excluded.verified, url=excluded.url,
           fetched_at=datetime('now')`
      ).run(p);
      log(user, 'redgifs.refresh', 'redgifs', null, p.username);
      return { ok: true, profile: p };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('redgifs:fetchAll', async (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const usernames = getDb()
        .prepare("SELECT DISTINCT username FROM reddit_accounts WHERE platform = 'redgifs'")
        .all().map((r) => r.username);
      const errors = []; let ok = 0;
      for (const u of usernames) {
        try { await fetchProfile(u).then((p) => {
          getDb().prepare(
            `INSERT INTO redgifs_profiles
               (username, display_name, avatar_url, bio, followers, following, views, videos, verified, url, fetched_at)
             VALUES (@username,@display_name,@avatar_url,@bio,@followers,@following,@views,@videos,@verified,@url, datetime('now'))
             ON CONFLICT(username) DO UPDATE SET
               display_name=excluded.display_name, avatar_url=excluded.avatar_url, bio=excluded.bio,
               followers=excluded.followers, following=excluded.following, views=excluded.views,
               videos=excluded.videos, verified=excluded.verified, url=excluded.url,
               fetched_at=datetime('now')`
          ).run(p);
          ok++;
        }); }
        catch (e) { errors.push(`${u}: ${e.message}`); }
      }
      return { ok: true, refreshed: ok, errors };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
