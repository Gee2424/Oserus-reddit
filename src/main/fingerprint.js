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
    mobile: false,
  },
  {
    os: 'Windows', platform: 'Win32',
    osVersion: '10.0', osLabel: 'Windows 11',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chUaPlatform: '"Windows"',
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    mobile: false,
  },
  // macOS / Chrome 131
  {
    os: 'macOS', platform: 'MacIntel',
    osVersion: '10_15_7', osLabel: 'macOS 14',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chUaPlatform: '"macOS"',
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    mobile: false,
  },
];

// Android device profiles. Each is a coherent (device, GPU, screen)
// triple — operators picking 'android' get one of these, deterministic
// per account so it stays consistent across launches.
const ANDROID_PROFILES = [
  // Pixel 8 — Tensor G3 / Mali-G715
  {
    os: 'Android', platform: 'Linux armv81',
    osVersion: '14', osLabel: 'Android 14 (Pixel 8)',
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    chUaPlatform: '"Android"',
    webglVendor: 'Google Inc. (ARM)',
    webglRenderer: 'ANGLE (ARM, Mali-G715, OpenGL ES 3.2)',
    mobile: true,
    screen: { w: 412, h: 915, dpr: 2.625 },
    hwc: 8, mem: 8, touchPoints: 5,
  },
  // Samsung Galaxy S24 — Snapdragon 8 Gen 3 / Adreno 750
  {
    os: 'Android', platform: 'Linux armv81',
    osVersion: '14', osLabel: 'Android 14 (Galaxy S24)',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    chUaPlatform: '"Android"',
    webglVendor: 'Google Inc. (Qualcomm)',
    webglRenderer: 'ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)',
    mobile: true,
    screen: { w: 384, h: 854, dpr: 2.8125 },
    hwc: 8, mem: 8, touchPoints: 10,
  },
  // OnePlus 12 — Snapdragon 8 Gen 3 / Adreno 750
  {
    os: 'Android', platform: 'Linux armv81',
    osVersion: '14', osLabel: 'Android 14 (OnePlus 12)',
    ua: 'Mozilla/5.0 (Linux; Android 14; CPH2581) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    chUaPlatform: '"Android"',
    webglVendor: 'Google Inc. (Qualcomm)',
    webglRenderer: 'ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)',
    mobile: true,
    screen: { w: 412, h: 915, dpr: 3 },
    hwc: 8, mem: 12, touchPoints: 10,
  },
  // Pixel 7a — Tensor G2 / Mali-G710
  {
    os: 'Android', platform: 'Linux armv81',
    osVersion: '14', osLabel: 'Android 14 (Pixel 7a)',
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    chUaPlatform: '"Android"',
    webglVendor: 'Google Inc. (ARM)',
    webglRenderer: 'ANGLE (ARM, Mali-G710, OpenGL ES 3.2)',
    mobile: true,
    screen: { w: 412, h: 915, dpr: 2.625 },
    hwc: 8, mem: 8, touchPoints: 5,
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

// osProfile: 'desktop' | 'android' | 'auto'. 'desktop' is the legacy
// behaviour; 'android' selects from ANDROID_PROFILES so UA + screen +
// hwc + mem + GPU all agree as a real phone. 'auto' is reserved for
// future regional/IP-aware selection.
function generateFingerprint(accountId, osProfile = 'desktop') {
  const seed = `oserus-fp-v1-${accountId}-${osProfile}`;
  const rng = rngFor(seed);
  const langs = pick(LANG_PRESETS, rng('lang'));
  const tz = pick(TZ_PRESETS, rng('tz'));

  // Small noise seeds for canvas/audio so toDataURL / getChannelData differ
  // from default but stay stable across sessions of the same account.
  const canvasNoise = (rng('canvas') % 7) - 3;  // -3..+3
  const audioNoise  = ((rng('audio') % 200) - 100) / 1e7; // ~1e-5 magnitude

  if (osProfile === 'android') {
    const base = pick(ANDROID_PROFILES, rng('profile'));
    return {
      version: 1,
      osProfile: 'android',
      os: base.os,
      osLabel: base.osLabel,
      platform: base.platform,
      userAgent: base.ua,
      chUaPlatform: base.chUaPlatform,
      mobile: true,
      languages: langs,
      acceptLanguage: `${langs[0]},${langs[1]};q=0.9`,
      timezone: tz,
      screen: {
        width: base.screen.w,
        height: base.screen.h,
        availWidth: base.screen.w,
        availHeight: base.screen.h,
        devicePixelRatio: base.screen.dpr,
        colorDepth: 24,
        orientation: 'portrait-primary',
      },
      hardwareConcurrency: base.hwc,
      deviceMemory: base.mem,
      maxTouchPoints: base.touchPoints,
      webgl: { vendor: base.webglVendor, renderer: base.webglRenderer },
      // Mobile-specific extras the antidetect preload uses to plant
      // ontouchstart, navigator.maxTouchPoints, screen.orientation,
      // DeviceMotion/Orientation event interfaces, and the mobile
      // userAgentData payload.
      device: { vendor: base.os === 'Android' ? 'Google' : 'Apple', model: base.osLabel },
      connection: { effectiveType: '4g', downlink: 7.5, rtt: 100, saveData: false },
      canvasNoise,
      audioNoise,
    };
  }

  // Desktop path (unchanged shape — only osProfile field is added).
  const base = pick(PROFILES, rng('profile'));
  const screen = pick(SCREEN_PRESETS, rng('screen'));
  const hwc = pick(HW_CONCURRENCY, rng('hwc'));
  const mem = pick(DEVICE_MEMORY, rng('mem'));

  return {
    version: 1,
    osProfile: 'desktop',
    os: base.os,
    osLabel: base.osLabel,
    platform: base.platform,
    userAgent: base.ua,
    chUaPlatform: base.chUaPlatform,
    mobile: false,
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
    maxTouchPoints: 0,
    webgl: { vendor: base.webglVendor, renderer: base.webglRenderer },
    canvasNoise,
    audioNoise,
  };
}

function loadOrCreate(db, accountId) {
  // Pull os_profile so a flip Desktop ↔ Android regenerates the
  // fingerprint instead of using a stale one from the previous OS.
  const row = db.prepare(
    'SELECT fingerprint_json, os_profile FROM reddit_accounts WHERE id = ?'
  ).get(accountId);
  const targetOs = (row && row.os_profile) || 'desktop';
  if (row && row.fingerprint_json) {
    try {
      const cached = JSON.parse(row.fingerprint_json);
      if ((cached.osProfile || 'desktop') === targetOs) return cached;
    } catch {}
  }
  const fp = generateFingerprint(accountId, targetOs);
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

// Device-emulation params for webContents.enableDeviceEmulation. When
// the fingerprint is mobile, this returns the touch-enabled viewport
// so the rendered page matches the UA / screen the antidetect preload
// is reporting. Returns null for desktop (caller should skip emulation).
function getDeviceEmulationParams(fp) {
  if (!fp || !fp.mobile) return null;
  const w = fp.screen?.width || 412;
  const h = fp.screen?.height || 915;
  const dpr = fp.screen?.devicePixelRatio || 2;
  return {
    screenPosition: 'mobile',
    screenSize: { width: w, height: h },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width: w, height: h },
    deviceScaleFactor: dpr,
    scale: 1,
  };
}

module.exports = {
  generateFingerprint,
  loadOrCreate,
  summarize,
  getDeviceEmulationParams,
};
