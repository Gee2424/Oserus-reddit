// Per-account fingerprint. Deterministic — seeded by the account ID so
// the same model always presents the same identity across launches —
// but persisted to the row on first generation so future code changes
// don't shift existing identities.
//
// Coverage matches what antidetect browsers (AdsPower, Multilogin,
// Dolphin Anty) expose: UA + Sec-CH-UA platform, languages, timezone,
// screen / window metrics, hardwareConcurrency / deviceMemory, WebGL
// vendor + renderer, canvas / audio noise seeds. Each session also
// gets a WebRTC handling switch applied at app launch.

const crypto = require('crypto');

const PROFILES = [
  // Windows 11 / Chrome 131
  {
    os: 'Windows', platform: 'Win32',
    osVersion: '10.0', osLabel: 'Windows 11',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chUaPlatform: '"Windows"',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    os: 'Windows', platform: 'Win32',
    osVersion: '10.0', osLabel: 'Windows 11',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chUaPlatform: '"Windows"',
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  // macOS / Chrome 131
  {
    os: 'macOS', platform: 'MacIntel',
    osVersion: '10_15_7', osLabel: 'macOS 14',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chUaPlatform: '"macOS"',
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
  },
];

const SCREEN_PRESETS = [
  { w: 1920, h: 1080, dpr: 1 },
  { w: 2560, h: 1440, dpr: 1 },
  { w: 1536, h: 864,  dpr: 1.25 },
  { w: 1440, h: 900,  dpr: 2 }, // mac-ish
];

const LANG_PRESETS = [
  ['en-US', 'en'],
  ['en-GB', 'en'],
  ['en-CA', 'en'],
  ['en-AU', 'en'],
];

const TZ_PRESETS = [
  // Match the language presets above (US/UK/CA/AU bias).
  'America/Los_Angeles',
  'America/New_York',
  'America/Chicago',
  'Europe/London',
  'America/Toronto',
  'Australia/Sydney',
];

const HW_CONCURRENCY = [4, 6, 8, 12, 16];
const DEVICE_MEMORY  = [4, 8, 16];

function rngFor(seed) {
  // Stable 32-bit hash → deterministic stream of 32-bit ints. Different
  // streams for different "fields" so the same accountId picking the
  // same row from each table doesn't collapse to all-zeros.
  let counter = 0;
  return (label) => {
    counter += 1;
    const h = crypto.createHash('sha256').update(`${seed}:${label}:${counter}`).digest();
    return h.readUInt32BE(0);
  };
}
function pick(arr, n) { return arr[n % arr.length]; }

function generateFingerprint(accountId) {
  const seed = `oserus-fp-v1-${accountId}`;
  const rng = rngFor(seed);

  const base = pick(PROFILES, rng('profile'));
  const screen = pick(SCREEN_PRESETS, rng('screen'));
  const langs = pick(LANG_PRESETS, rng('lang'));
  const tz = pick(TZ_PRESETS, rng('tz'));
  const hwc = pick(HW_CONCURRENCY, rng('hwc'));
  const mem = pick(DEVICE_MEMORY, rng('mem'));

  // Small noise seeds for canvas/audio so toDataURL / getChannelData differ
  // from default but stay stable across sessions of the same account.
  const canvasNoise = (rng('canvas') % 7) - 3;  // -3..+3
  const audioNoise  = ((rng('audio') % 200) - 100) / 1e7; // ~1e-5 magnitude

  return {
    version: 1,
    os: base.os,
    osLabel: base.osLabel,
    platform: base.platform,
    userAgent: base.ua,
    chUaPlatform: base.chUaPlatform,
    languages: langs,
    acceptLanguage: `${langs[0]},${langs[1]};q=0.9`,
    timezone: tz,
    screen: {
      width: screen.w,
      height: screen.h,
      availWidth: screen.w,
      availHeight: screen.h - 40,
      devicePixelRatio: screen.dpr,
      colorDepth: 24,
    },
    hardwareConcurrency: hwc,
    deviceMemory: mem,
    webgl: { vendor: base.webglVendor, renderer: base.webglRenderer },
    canvasNoise,
    audioNoise,
  };
}

function loadOrCreate(db, accountId) {
  const row = db.prepare('SELECT fingerprint_json FROM reddit_accounts WHERE id = ?').get(accountId);
  if (row && row.fingerprint_json) {
    try { return JSON.parse(row.fingerprint_json); } catch {}
  }
  const fp = generateFingerprint(accountId);
  try {
    db.prepare('UPDATE reddit_accounts SET fingerprint_json = ? WHERE id = ?')
      .run(JSON.stringify(fp), accountId);
  } catch {}
  return fp;
}

function summarize(fp) {
  if (!fp) return null;
  return {
    os: fp.osLabel,
    screen: `${fp.screen.width}×${fp.screen.height}`,
    language: fp.languages[0],
    timezone: fp.timezone,
    cores: fp.hardwareConcurrency,
    memory: `${fp.deviceMemory}GB`,
  };
}

module.exports = { generateFingerprint, loadOrCreate, summarize };
