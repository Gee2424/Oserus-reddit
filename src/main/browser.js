// Oserus Browser window manager.
//
// Single-instance: at most one browser window exists at a time. Switching
// profiles closes the current window and opens a new one bound to the
// new profile's account partition. The renderer entry is `browser.html`,
// loaded with `?account=<id>` once a profile is picked, or no query
// param for the picker state.
//
// Soft-cut (v0.62): launched on demand from the existing management app.
// In v0.63 this becomes the only window the app opens.

const { BrowserWindow } = require('electron');
const path = require('path');
const elog = require('electron-log');
const { getDb } = require('./db');

let browserWin = null;
let prepareSessionForAccount = null;
let isDev = false;
// Operator token captured at launch from Management. The picker calls
// `oserus-browser:listProfiles` without a token argument — the main
// process uses this cached token so the browser window doesn't need a
// second sign-in flow.
let operatorToken = null;

function init({ dev, prepareSession }) {
  isDev = !!dev;
  prepareSessionForAccount = prepareSession;
}

function setOperatorToken(token) {
  operatorToken = token || null;
}

function getOperatorToken() {
  return operatorToken;
}

function devUrl(query = '') {
  return `http://localhost:5173/browser.html${query}`;
}

function prodFile() {
  return path.join(__dirname, '../../dist/browser.html');
}

function loadInto(win, query) {
  if (isDev) {
    win.loadURL(devUrl(query)).catch((e) => elog.warn('[browser] loadURL', e?.message));
  } else {
    const opts = query ? { search: query } : {};
    win.loadFile(prodFile(), opts)
      .catch((e) => elog.warn('[browser] loadFile', e?.message));
  }
}

async function openPicker() {
  // Close any existing window first — picker resets state.
  if (browserWin && !browserWin.isDestroyed()) {
    browserWin.close();
    browserWin = null;
  }
  browserWin = createBaseWindow({ partition: null, title: 'Oserus Browser' });
  loadInto(browserWin, '');
  return { ok: true };
}

async function openForAccount(accountId) {
  if (!accountId) return { ok: false, error: 'accountId required' };
  if (!prepareSessionForAccount) return { ok: false, error: 'browser module not initialized' };

  const prep = await prepareSessionForAccount(accountId);
  if (!prep.ok) return prep;

  if (browserWin && !browserWin.isDestroyed()) {
    browserWin.close();
    browserWin = null;
  }

  const db = getDb();
  const acct = db.prepare(
    `SELECT a.username, a.platform, p.name AS profile_name
     FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id
     WHERE a.id = ?`
  ).get(accountId);
  const title = acct
    ? `Oserus · ${acct.profile_name} · ${acct.platform}/${acct.username}`
    : 'Oserus Browser';

  browserWin = createBaseWindow({ partition: `persist:${prep.partitionKey}`, title });
  loadInto(browserWin, `?account=${encodeURIComponent(accountId)}`);
  return { ok: true };
}

function createBaseWindow({ partition, title }) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0d0c0a',
    title,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/browser.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // Picker window uses the default partition (no profile bound);
      // profile windows pass the per-account persist partition so cookies
      // and storage are isolated per account.
      ...(partition ? { partition } : {}),
    },
  });
  win.on('closed', () => {
    if (browserWin === win) browserWin = null;
  });
  return win;
}

function closeBrowser() {
  if (browserWin && !browserWin.isDestroyed()) browserWin.close();
  browserWin = null;
  return { ok: true };
}

module.exports = { init, openPicker, openForAccount, closeBrowser, setOperatorToken, getOperatorToken };
