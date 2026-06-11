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

// iOS device profiles. Operators routing through jailbroken iPhones
// (Crane multi-instance, AirProxy, Mobile Proxies LLC, etc.) pick
// 'ios' so the browser presents Mobile Safari end-to-end. Note:
// our render engine is Blink not WebKit — pixel-level canvas
// fingerprints can still expose that — but every JS-surface check
// agrees, which is enough for browserscan and most anti-bot stacks.
const IOS_PROFILES = [
  // iPhone 15 — Safari 17.5
  {
    os: 'iOS', platform: 'iPhone',
    osVersion: '17_5', osLabel: 'iOS 17.5 (iPhone 15)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chUaPlatform: '"iOS"',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple GPU',
    mobile: true,
    screen: { w: 393, h: 852, dpr: 3 },
    hwc: 6, mem: 6, touchPoints: 5,
    vendor: 'Apple Computer, Inc.',
    safari: true,
  },
  // iPhone 15 Pro — Safari 17.5, larger screen, A17 Pro
  {
    os: 'iOS', platform: 'iPhone',
    osVersion: '17_5', osLabel: 'iOS 17.5 (iPhone 15 Pro)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chUaPlatform: '"iOS"',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple GPU',
    mobile: true,
    screen: { w: 402, h: 874, dpr: 3 },
    hwc: 6, mem: 8, touchPoints: 5,
    vendor: 'Apple Computer, Inc.',
    safari: true,
  },
  // iPhone 15 Pro Max
  {
    os: 'iOS', platform: 'iPhone',
    osVersion: '17_5', osLabel: 'iOS 17.5 (iPhone 15 Pro Max)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chUaPlatform: '"iOS"',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple GPU',
    mobile: true,
    screen: { w: 430, h: 932, dpr: 3 },
    hwc: 6, mem: 8, touchPoints: 5,
    vendor: 'Apple Computer, Inc.',
    safari: true,
  },
  // iPhone 14 — A15, still extremely common via mobile-proxy farms
  {
    os: 'iOS', platform: 'iPhone',
    osVersion: '17_5', osLabel: 'iOS 17.5 (iPhone 14)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    chUaPlatform: '"iOS"',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple GPU',
    mobile: true,
    screen: { w: 390, h: 844, dpr: 3 },
    hwc: 6, mem: 6, touchPoints: 5,
    vendor: 'Apple Computer, Inc.',
    safari: true,
  },
];

const PROFILES = [
  // Windows 11 / Chrome 131
  {
    os: 'Windows', platform: 'Win32',
    osVersion: '10.0', osLabel: 'Windows 11',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    chUaPlatform: '"Windows"',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    mobile: false,
  },
  {
    os: 'Windows', platform: 'Win32',
    osVersion: '10.0', osLabel: 'Windows 11',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    chUaPlatform: '"Windows"',
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    mobile: false,
  },
  // macOS / Chrome 131
  {
    os: 'macOS', platform: 'MacIntel',
    osVersion: '10_15_7', osLabel: 'macOS 14',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
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
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
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
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
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
    ua: 'Mozilla/5.0 (Linux; Android 14; CPH2581) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
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
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
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
      device: { vendor: base.os === 'Android' ? 'Google' : 'Apple', model: base.osLabel },
      connection: { effectiveType: '4g', downlink: 7.5, rtt: 100, saveData: false },
      canvasNoise,
      audioNoise,
    };
  }

  if (osProfile === 'ios') {
    const base = pick(IOS_PROFILES, rng('profile'));
    return {
      version: 1,
      osProfile: 'ios',
      os: base.os,
      osLabel: base.osLabel,
      platform: base.platform,
      userAgent: base.ua,
      chUaPlatform: base.chUaPlatform,
      mobile: true,
      safari: true, // signals the preload to delete userAgentData + chrome.runtime
      vendor: base.vendor,
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
      // Mobile Safari doesn't expose deviceMemory — preload deletes it.
      deviceMemory: undefined,
      maxTouchPoints: base.touchPoints,
      webgl: { vendor: base.webglVendor, renderer: base.webglRenderer },
      device: { vendor: 'Apple', model: base.osLabel },
      // Safari doesn't expose navigator.connection — preload deletes it.
      connection: null,
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

// Country code (ISO-2) → primary BCP-47 language tag the locals would
// have set as their primary in Chrome. Falls back to en-US for the
// long tail so an unknown country never produces a worse-than-random
// guess. List is biased toward the markets operators run accounts in.
const COUNTRY_LANG = {
  US: 'en-US', CA: 'en-CA', GB: 'en-GB', AU: 'en-AU', NZ: 'en-NZ', IE: 'en-IE',
  IN: 'en-IN', ZA: 'en-ZA', SG: 'en-SG', PH: 'en-PH',
  DE: 'de-DE', AT: 'de-AT', CH: 'de-CH',
  FR: 'fr-FR', BE: 'fr-BE', LU: 'fr-LU',
  ES: 'es-ES', MX: 'es-MX', AR: 'es-AR', CL: 'es-CL', CO: 'es-CO',
  IT: 'it-IT',
  PT: 'pt-PT', BR: 'pt-BR',
  NL: 'nl-NL',
  PL: 'pl-PL',
  SE: 'sv-SE', NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI',
  JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK',
  RU: 'ru-RU', UA: 'uk-UA', TR: 'tr-TR',
  ID: 'id-ID', TH: 'th-TH', VN: 'vi-VN', MY: 'ms-MY',
};

function languagesForCountry(cc) {
  const primary = COUNTRY_LANG[String(cc || '').toUpperCase()] || 'en-US';
  const stem = primary.split('-')[0];
  // Chrome always sends [primary, stem] for non-English locales and
  // [primary, 'en'] for English locales — match that pattern.
  if (stem === 'en') return [primary, 'en'];
  return [primary, stem, 'en'];
}

// Compute the timezone offset in minutes (the value Date.getTimezoneOffset
// returns — negative for east of UTC) for an IANA timezone at the current
// instant. Works for any tz; lets us drop the hand-maintained OFFSETS table.
function tzOffsetMinutes(tz) {
  try {
    const now = new Date();
    const utcMs = Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()
    );
    // Format 'now' as wall-clock in target tz, then parse back as if
    // it were UTC. Difference is the offset.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
    const localUtcMs = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    );
    return Math.round((utcMs - localUtcMs) / 60000);
  } catch { return 0; }
}

// Overlay the cached proxy geo (timezone + country → language) onto a
// fingerprint. Identity-shaping fields (UA, screen, hwc, WebGL) stay
// stable across launches; only the fields the IP geolocates against
// (timezone, language, languages, acceptLanguage, offset) flip when
// the operator's proxy moves to a new region.
function applyGeoOverlay(fp, geoTimezone, geoCountry) {
  if (!geoTimezone && !geoCountry) return fp;
  const tz = geoTimezone || fp.timezone;
  const langs = geoCountry ? languagesForCountry(geoCountry) : fp.languages;
  return {
    ...fp,
    timezone: tz,
    timezoneOffset: tzOffsetMinutes(tz),
    languages: langs,
    acceptLanguage: langs.length >= 2 ? `${langs[0]},${langs[1]};q=0.9` : `${langs[0]}`,
    geoCountry: geoCountry || fp.geoCountry || null,
  };
}

// Stored fingerprint schema version. Bump whenever the UA strings
// or UA-CH brands in this file change so existing accounts get a
// fresh regeneration on next prep, instead of replaying a stale
// blob with the old Chrome version (the cause of "UserAgent is
// different" / "Different browser version" on BrowserScan when a
// build that updated the UA shipped over an existing install).
const FP_VERSION = 2;

function loadOrCreate(db, accountId) {
  // Pull os_profile + cached geo so a flip Desktop ↔ Android regenerates
  // the fingerprint and an updated proxy geo overlays the timezone +
  // language onto the existing identity.
  const row = db.prepare(
    'SELECT fingerprint_json, os_profile, geo_timezone, geo_country FROM reddit_accounts WHERE id = ?'
  ).get(accountId);
  const targetOs = (row && row.os_profile) || 'desktop';
  let base = null;
  if (row && row.fingerprint_json) {
    try {
      const cached = JSON.parse(row.fingerprint_json);
      const sameOs = (cached.osProfile || 'desktop') === targetOs;
      const sameVer = (cached.version || 0) === FP_VERSION;
      if (sameOs && sameVer) base = cached;
    } catch {}
  }
  if (!base) {
    base = generateFingerprint(accountId, targetOs);
    base.version = FP_VERSION;
    try {
      db.prepare('UPDATE reddit_accounts SET fingerprint_json = ? WHERE id = ?')
        .run(JSON.stringify(base), accountId);
    } catch {}
  }
  // Always compute offset for whatever timezone we end up with, including
  // a no-geo fallback so the preload never has to guess.
  return applyGeoOverlay(base, row?.geo_timezone, row?.geo_country);
}

// Force a fresh load on next prepareSessionForAccount by NUL-ing out the
// cached JSON — the next loadOrCreate call regenerates with the new geo.
// Used by the in-browser proxy check after persisting a new timezone.
function invalidateFingerprintForGeo(db, accountId) {
  // Don't null fingerprint_json — keep the stable identity. Just bump
  // a cache key. The overlay is computed fresh on every loadOrCreate
  // anyway, so the next session pickup naturally uses the new geo.
  return; // no-op — overlay always recomputes
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
  invalidateFingerprintForGeo,
  applyGeoOverlay,
  languagesForCountry,
  tzOffsetMinutes,
};
