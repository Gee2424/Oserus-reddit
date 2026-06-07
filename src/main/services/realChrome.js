const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { spawn } = require('child_process');
const elog = require('electron-log');
const { getKv, setKv } = require('../db');

const KV_KEY = 'cloud.chrome.path';

function detectChromePath() {
  if (process.platform !== 'win32') return null;
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  candidates.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

function getStoredChromePath() {
  try {
    const stored = getKv(KV_KEY);
    if (stored) return stored;
  } catch {}
  return detectChromePath();
}

function setChromePath(p) {
  setKv(KV_KEY, p || null);
}

function sanitizeSegment(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) || 'default';
}

function launchForAccount({ accountId, accountUsername, profileSlug, proxyUrl, startUrl } = {}) {
  try {
    const chromePath = getStoredChromePath();
    if (!chromePath) {
      return { ok: false, error: 'Chrome not detected. Set the path in Configuration → Browser.' };
    }
    const base = path.join(app.getPath('userData'), 'oserus-chrome', sanitizeSegment(profileSlug), sanitizeSegment(accountUsername || `acct-${accountId || 'x'}`));
    try { fs.mkdirSync(base, { recursive: true }); } catch {}

    const args = [
      `--user-data-dir=${base}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (proxyUrl) args.push(`--proxy-server=${proxyUrl}`);
    args.push(startUrl || 'https://www.reddit.com');

    elog.info('[realChrome] launching', { chromePath, base, proxyUrl: !!proxyUrl });
    const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
    child.on('error', (e) => elog.warn('[realChrome] spawn error:', e?.message));
    const pid = child.pid;
    child.unref();
    return { ok: true, pid };
  } catch (e) {
    elog.error('[realChrome] launch failed:', e?.message);
    return { ok: false, error: e?.message || 'Launch failed' };
  }
}

module.exports = { detectChromePath, getStoredChromePath, setChromePath, launchForAccount };
