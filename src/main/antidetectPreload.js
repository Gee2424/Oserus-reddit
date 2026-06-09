// Antidetect preload generator. The preload script must run BEFORE any
// page script touches navigator / screen / WebGL / etc., otherwise the
// page can race us and read the un-patched values. Electron's
// `session.setPreloads` guarantees that — Chromium injects them at the
// very start of every frame, including iframes.
//
// We can't ship a static preload file because it needs to embed the
// per-account fingerprint values. So at session-prepare time we write a
// generated file under userData/antidetect/<partition>.js and register
// it on the session. Replaced (not appended) on every prepare so
// regenerated fingerprints take effect on the next navigation.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function preloadsDir() {
  const dir = path.join(app.getPath('userData'), 'antidetect');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function buildSource(fp) {
  // The session preload runs in an isolated world when contextIsolation
  // is true — patches to Navigator.prototype from there are invisible
  // to the page. So we generate the patch code as a string and append
  // it as a <script> element on the document, which executes
  // synchronously in the MAIN world before any subsequent page script.
  const patch = mainWorldPatch(fp);
  return `// Auto-generated antidetect preload for Oserus Browser.
(() => {
  if (window.__oserusAntidetectInjected) return;
  window.__oserusAntidetectInjected = true;
  const CODE = ${JSON.stringify(patch)};
  function inject() {
    try {
      const s = document.createElement('script');
      s.textContent = CODE;
      (document.head || document.documentElement || document).appendChild(s);
      s.remove();
      return true;
    } catch { return false; }
  }
  if (inject()) return;
  // documentElement not ready yet — re-attempt on the first DOM mutation.
  try {
    const mo = new MutationObserver(() => {
      if (inject()) mo.disconnect();
    });
    mo.observe(document, { childList: true, subtree: true });
  } catch {}
})();
`;
}

function mainWorldPatch(fp) {
  return `(() => {
  if (window.__oserusAntidetect) return;
  Object.defineProperty(window, '__oserusAntidetect', { value: true, configurable: false });
  const FP = ${JSON.stringify(fp)};

  function defineGetter(target, prop, value) {
    try {
      Object.defineProperty(target, prop, {
        get() { return value; },
        configurable: false,
        enumerable: true,
      });
    } catch {}
  }

  // --- navigator ----------------------------------------------------------
  try { defineGetter(Navigator.prototype, 'userAgent', FP.userAgent); } catch {}
  try { defineGetter(Navigator.prototype, 'appVersion', FP.userAgent.replace(/^Mozilla\\//, '')); } catch {}
  try { defineGetter(Navigator.prototype, 'platform', FP.platform); } catch {}
  try { defineGetter(Navigator.prototype, 'language', FP.languages[0]); } catch {}
  try { defineGetter(Navigator.prototype, 'languages', Object.freeze(FP.languages.slice())); } catch {}
  try { defineGetter(Navigator.prototype, 'hardwareConcurrency', FP.hardwareConcurrency); } catch {}
  try { defineGetter(Navigator.prototype, 'maxTouchPoints', FP.maxTouchPoints || 0); } catch {}
  // Vendor differs by engine: Apple's Safari reports 'Apple Computer, Inc.'
  // and exposing 'Google Inc.' here is the easiest way to leak a Chromium
  // identity through a Safari UA. Use FP.vendor when the profile sets it.
  try { defineGetter(Navigator.prototype, 'vendor', FP.vendor || 'Google Inc.'); } catch {}
  // deviceMemory: Chromium exposes; Safari doesn't. Delete the getter
  // entirely when impersonating Safari so a probe returns undefined.
  try {
    if (FP.safari) {
      try { delete Navigator.prototype.deviceMemory; } catch {}
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get(){ return undefined; }, configurable: true });
    } else if (typeof FP.deviceMemory === 'number') {
      defineGetter(Navigator.prototype, 'deviceMemory', FP.deviceMemory);
    }
  } catch {}
  // webdriver flag — most antibot stacks check this first.
  try { defineGetter(Navigator.prototype, 'webdriver', false); } catch {}

  // --- Safari-mode: remove Chromium-only surface --------------------------
  // Mobile Safari doesn't ship navigator.userAgentData (UA-CH), the
  // chrome.* runtime, or navigator.connection. Leaving them visible
  // while the UA says Safari is the #1 way to expose Chromium underneath.
  if (FP.safari) {
    try { delete window.chrome; } catch {}
    try { Object.defineProperty(window, 'chrome', { get(){ return undefined; }, configurable: true }); } catch {}
    try { delete Navigator.prototype.userAgentData; } catch {}
    try { Object.defineProperty(Navigator.prototype, 'userAgentData', { get(){ return undefined; }, configurable: true }); } catch {}
    try { Object.defineProperty(Navigator.prototype, 'connection', { get(){ return undefined; }, configurable: true }); } catch {}
  }

  // --- Mobile-specific surface (only when fingerprint is Android) --------
  if (FP.mobile) {
    // Touch event interfaces — sites detect mobile by checking 'ontouchstart'
    // in window. Define stubs so feature detection passes.
    try {
      ['ontouchstart','ontouchmove','ontouchend','ontouchcancel'].forEach((k) => {
        if (!(k in window)) Object.defineProperty(window, k, { value: null, configurable: true });
      });
    } catch {}
    // TouchEvent / Touch / TouchList classes — Chromium ships these on
    // desktop too but sites sniff for window.TouchEvent existence.
    try { if (typeof window.TouchEvent === 'undefined') window.TouchEvent = function TouchEvent(){}; } catch {}
    try { if (typeof window.Touch === 'undefined') window.Touch = function Touch(){}; } catch {}
    try { if (typeof window.TouchList === 'undefined') window.TouchList = function TouchList(){}; } catch {}
    // DeviceMotion / Orientation — defining the constructors satisfies
    // mobile-feature checks even though no real motion events fire.
    try { if (typeof window.DeviceMotionEvent === 'undefined') window.DeviceMotionEvent = function DeviceMotionEvent(){}; } catch {}
    try { if (typeof window.DeviceOrientationEvent === 'undefined') window.DeviceOrientationEvent = function DeviceOrientationEvent(){}; } catch {}
    // window.orientation (legacy mobile API still used by sniffers).
    try { defineGetter(window, 'orientation', 0); } catch {}
    // navigator.connection — Android Chrome presents this. Safari does NOT.
    // Only plant when we're impersonating a Chromium-on-mobile profile.
    if (!FP.safari) {
      try {
        const conn = FP.connection || { effectiveType: '4g', downlink: 7.5, rtt: 100, saveData: false };
        Object.defineProperty(Navigator.prototype, 'connection', {
          get() { return Object.assign({ type: 'cellular' }, conn); },
          configurable: false,
        });
      } catch {}
    }
  }

  // --- Sec-CH-UA via userAgentData (Chromium-only) ------------------------
  // Skip entirely when impersonating Safari — userAgentData was just
  // deleted above; redefining it here would re-leak Chromium.
  if (!FP.safari) try {
    const brands = [
      { brand: 'Chromium', version: '131' },
      { brand: 'Google Chrome', version: '131' },
      { brand: 'Not_A Brand', version: '24' },
    ];
    // High-entropy fields fork by mobile vs desktop so an anti-bot
    // calling getHighEntropyValues sees the same identity our UA does.
    const mobile = !!FP.mobile;
    const arch     = mobile ? 'arm'  : 'x86';
    const bitness  = mobile ? '64'   : '64';
    const platVer  = mobile ? '14.0.0' : '15.0.0';
    const model    = mobile ? (FP.osLabel || '').replace(/^Android \\d+ \\(|\\)$/g, '') : '';
    const platName = mobile ? 'Android' : FP.os;
    const uaData = {
      brands,
      mobile,
      platform: platName,
      getHighEntropyValues(keys) {
        return Promise.resolve(Object.fromEntries(keys.map((k) => {
          if (k === 'platform') return [k, platName];
          if (k === 'platformVersion') return [k, platVer];
          if (k === 'architecture') return [k, arch];
          if (k === 'bitness') return [k, bitness];
          if (k === 'model') return [k, model];
          if (k === 'mobile') return [k, mobile];
          if (k === 'uaFullVersion') return [k, '131.0.0.0'];
          if (k === 'fullVersionList') return [k, brands.map((b) => ({ brand: b.brand, version: '131.0.0.0' }))];
          return [k, ''];
        })));
      },
      toJSON() { return { brands, mobile, platform: platName }; },
    };
    defineGetter(Navigator.prototype, 'userAgentData', uaData);
  } catch {}

  // --- screen / window metrics -------------------------------------------
  try {
    defineGetter(Screen.prototype, 'width', FP.screen.width);
    defineGetter(Screen.prototype, 'height', FP.screen.height);
    defineGetter(Screen.prototype, 'availWidth', FP.screen.availWidth);
    defineGetter(Screen.prototype, 'availHeight', FP.screen.availHeight);
    defineGetter(Screen.prototype, 'colorDepth', FP.screen.colorDepth);
    defineGetter(Screen.prototype, 'pixelDepth', FP.screen.colorDepth);
  } catch {}
  try { defineGetter(window, 'devicePixelRatio', FP.screen.devicePixelRatio); } catch {}
  // screen.orientation — mobile sites lock to portrait-primary, which
  // anti-bot stacks use as a mobile vs desktop signal.
  try {
    if (FP.mobile && FP.screen.orientation) {
      const orientObj = { type: FP.screen.orientation, angle: 0,
        onchange: null,
        addEventListener: () => {}, removeEventListener: () => {},
      };
      Object.defineProperty(Screen.prototype, 'orientation', {
        get() { return orientObj; }, configurable: false,
      });
    }
  } catch {}

  // --- timezone -----------------------------------------------------------
  try {
    const origResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      const r = origResolved.call(this);
      r.timeZone = FP.timezone;
      return r;
    };
    // Date.prototype.getTimezoneOffset → use a fixed offset matched to FP.timezone.
    // Best-effort table; falls back to 0 (UTC) if unknown.
    const OFFSETS = {
      'America/Los_Angeles': 480, 'America/New_York': 300, 'America/Chicago': 360,
      'America/Toronto': 300, 'Europe/London': 0, 'Australia/Sydney': -600,
    };
    const off = OFFSETS[FP.timezone] ?? 0;
    const origGTO = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function () { return off; };
    // toString / toLocaleString fall back to a label patch.
    const origTS = Date.prototype.toString;
    Date.prototype.toString = function () {
      try { return origTS.call(this); } catch { return ''; }
    };
  } catch {}

  // --- WebGL vendor / renderer (UNMASKED_VENDOR_WEBGL = 0x9245) ----------
  try {
    const UNMASKED_VENDOR = 0x9245;
    const UNMASKED_RENDERER = 0x9246;
    function patchGL(proto) {
      const orig = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === UNMASKED_VENDOR)   return FP.webgl.vendor;
        if (p === UNMASKED_RENDERER) return FP.webgl.renderer;
        if (p === 0x1F00 /* VENDOR */)   return FP.webgl.vendor;
        if (p === 0x1F01 /* RENDERER */) return FP.webgl.renderer;
        return orig.call(this, p);
      };
    }
    if (typeof WebGLRenderingContext !== 'undefined') patchGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchGL(WebGL2RenderingContext.prototype);
  } catch {}

  // --- Canvas noise (tiny per-pixel jitter on read paths) ----------------
  try {
    const noise = FP.canvasNoise | 0;
    function jitter(arr) {
      // Only nudge a few pixels — too much breaks legitimate UI.
      for (let i = 0; i < arr.length; i += 4 * 997) {
        arr[i]   = (arr[i]   + noise) & 0xff;
        arr[i+1] = (arr[i+1] + noise) & 0xff;
        arr[i+2] = (arr[i+2] + noise) & 0xff;
      }
    }
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      try {
        const ctx = this.getContext('2d');
        if (ctx) {
          const img = ctx.getImageData(0, 0, this.width, this.height);
          jitter(img.data);
          ctx.putImageData(img, 0, 0);
        }
      } catch {}
      return origToDataURL.apply(this, args);
    };
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const img = origGetImageData.apply(this, args);
      jitter(img.data);
      return img;
    };
  } catch {}

  // --- AudioContext noise -------------------------------------------------
  try {
    const eps = +FP.audioNoise || 0;
    const origGCD = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function (...args) {
      const data = origGCD.apply(this, args);
      // Apply a barely-perceptible nudge so AudioContext fingerprints differ
      // from the engine default but the audio still plays correctly.
      for (let i = 0; i < data.length; i += 521) data[i] = data[i] + eps;
      return data;
    };
  } catch {}

  // --- Permissions API quirk -------------------------------------------
  // Chromium returns 'denied' for notifications when notifications.permission
  // is 'default' — that mismatch is a common bot tell. Align them.
  try {
    const origQuery = navigator.permissions && navigator.permissions.query;
    if (origQuery) {
      navigator.permissions.query = function (params) {
        if (params && params.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return origQuery.call(navigator.permissions, params);
      };
    }
  } catch {}
})();
`;
}

function writePreloadFor(partitionKey, fp) {
  const dir = preloadsDir();
  const file = path.join(dir, `${safe(partitionKey)}.js`);
  fs.writeFileSync(file, buildSource(fp), 'utf8');
  return file;
}

function safe(s) {
  return String(s || 'default').replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

module.exports = { writePreloadFor };
