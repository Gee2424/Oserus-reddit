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
  // webdriver flag — most antibot stacks check this first. Override on
  // both the instance and the prototype, and also delete the property
  // descriptor so an "in navigator" probe combined with a value read
  // can't catch us out via a truthy check on the getter's existence.
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get() { return false; }, configurable: true, enumerable: true,
    });
  } catch {}
  try { delete navigator.__proto__.webdriver; } catch {}

  // Selenium / Playwright / Puppeteer chromedriver leaves a handful of
  // injected globals: cdc_*, $cdc_*, $chrome_asyncScriptInfo,
  // __webdriver_*, __selenium_*, __nightmare. Strip them; they're a
  // pure tell with no legitimate use on a real browser.
  try {
    for (const k of Object.keys(window)) {
      if (/^(cdc_|\\$cdc_|\\$chrome_asyncScriptInfo|__webdriver_|__selenium_|__nightmare)/.test(k)) {
        try { delete window[k]; } catch {}
      }
    }
    for (const k of Object.keys(document)) {
      if (/^\\$cdc_/.test(k)) { try { delete document[k]; } catch {} }
    }
  } catch {}

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
  //
  // Version MUST match Electron's underlying Chromium. Electron 32 ships
  // Chromium 128; declaring 131 here lets browserscan flag a UA mismatch
  // because feature-detection probes find Chrome-128-era APIs behind a
  // Chrome-131 banner. Keep these literals in sync with the UA strings
  // in fingerprint.js.
  if (!FP.safari) try {
    const brands = [
      { brand: 'Chromium', version: '128' },
      { brand: 'Google Chrome', version: '128' },
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
          if (k === 'uaFullVersion') return [k, '128.0.0.0'];
          if (k === 'fullVersionList') return [k, brands.map((b) => ({ brand: b.brand, version: '128.0.0.0' }))];
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
    // Offset is precomputed in main when the fingerprint is loaded so we
    // can support any IANA timezone the proxy geo returns, not a hand-
    // maintained shortlist. Falls back to 0 (UTC) if main forgot to set it.
    const off = (typeof FP.timezoneOffset === 'number') ? FP.timezoneOffset : 0;
    const origGTO = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function () { return off; };
    // toString / toLocaleString fall back to a label patch.
    const origTS = Date.prototype.toString;
    Date.prototype.toString = function () {
      try { return origTS.call(this); } catch { return ''; }
    };
  } catch {}

  // --- WebGL vendor / renderer (UNMASKED_VENDOR_WEBGL = 0x9245) ----------
  //
  // Only override the WEBGL_debug_renderer_info extension parameters —
  // those are what fingerprinters read for GPU identity. The plain
  // VENDOR (0x1F00) and RENDERER (0x1F01) params on a real Chromium
  // return masked strings ("WebKit" / "WebKit WebGL"), and returning
  // anything else for them is a bigger tell than the spoof solves.
  try {
    const UNMASKED_VENDOR = 0x9245;
    const UNMASKED_RENDERER = 0x9246;
    function patchGL(proto) {
      const orig = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === UNMASKED_VENDOR)   return FP.webgl.vendor;
        if (p === UNMASKED_RENDERER) return FP.webgl.renderer;
        return orig.call(this, p);
      };
    }
    if (typeof WebGLRenderingContext !== 'undefined') patchGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchGL(WebGL2RenderingContext.prototype);
  } catch {}

  // --- Canvas noise (deterministic per-pixel jitter) ----------------------
  //
  // Browserscan's tampering probe calls getImageData/toDataURL twice and
  // diffs the output. The old implementation nudged by a fixed loop
  // stride, which IS stable across two calls on the same canvas — but
  // only by accident, because nothing keyed the nudge to the underlying
  // pixel. If a single byte ever changed (animated canvas, font subpixel
  // drift), the resulting output diverged in an obviously-non-random
  // way, which is itself a tell.
  //
  // Make the jitter a deterministic function of (pixel index, pixel
  // value, account-seeded canvasNoise). Repeated reads of the same
  // canvas return byte-for-byte identical data; reads of different
  // canvases produce a stable per-canvas fingerprint distinct from the
  // engine default.
  try {
    const SEED = (FP.canvasNoise | 0) || 0;
    function jitter(arr) {
      // xorshift on (i ^ value ^ SEED) keeps the result both small and
      // deterministic. Touches ~1 in 1000 pixels — enough to change the
      // hash, too few to break legitimate UI rendering.
      for (let i = 0; i < arr.length; i += 4) {
        const h = (i * 2654435761) ^ (arr[i] * 40503) ^ SEED;
        if ((h & 0x3ff) !== 0) continue; // ~0.1% of pixels
        const delta = ((h >>> 10) & 0x3) - 1; // -1, 0, 1, 2
        arr[i]   = (arr[i]   + delta) & 0xff;
        arr[i+1] = (arr[i+1] + delta) & 0xff;
        arr[i+2] = (arr[i+2] + delta) & 0xff;
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

  // --- AudioContext noise (deterministic) ---------------------------------
  //
  // Same trick as canvas: the original samples + a deterministic delta
  // keyed by index and seed. Two reads of the same buffer return
  // identical bytes, so the tampering-probe diff is empty.
  try {
    const EPS = +FP.audioNoise || 0;
    const SEED = ((FP.canvasNoise | 0) >>> 0) || 1;
    const origGCD = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function (...args) {
      const data = origGCD.apply(this, args);
      for (let i = 0; i < data.length; i += 521) {
        const h = ((i * 2246822519) ^ SEED) >>> 0;
        data[i] = data[i] + EPS * (((h & 0xff) / 255) - 0.5);
      }
      return data;
    };
  } catch {}

  // --- navigator.plugins / mimeTypes -------------------------------------
  //
  // On real Chromium-on-desktop, navigator.plugins lists the bundled PDF
  // viewer entries (5 plugins, 2 mime types). On Electron, the list is
  // usually empty or short — a strong "headless / automation" signal.
  // Don't fabricate plugins for mobile profiles (real mobile Chrome
  // ships an empty list, so adding any would be the tell).
  if (!FP.mobile && !FP.safari) try {
    const mkMime = (type, suffixes, desc) => Object.freeze({
      type, suffixes, description: desc, enabledPlugin: null,
    });
    const pdfMime = mkMime('application/pdf', 'pdf', 'Portable Document Format');
    const xPdfMime = mkMime('text/pdf', 'pdf', 'Portable Document Format');
    const mkPlugin = (name, filename, desc) => {
      const p = { name, filename, description: desc, length: 2,
        0: pdfMime, 1: xPdfMime,
        item(i) { return i === 0 ? pdfMime : i === 1 ? xPdfMime : null; },
        namedItem(n) { return n === 'application/pdf' ? pdfMime : n === 'text/pdf' ? xPdfMime : null; },
      };
      Object.freeze(p);
      return p;
    };
    const plugins = [
      mkPlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      mkPlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      mkPlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      mkPlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      mkPlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
    ];
    const pluginsArr = Object.assign(plugins.slice(), {
      length: plugins.length,
      item(i) { return plugins[i] || null; },
      namedItem(n) { return plugins.find((p) => p.name === n) || null; },
      refresh() {},
      [Symbol.iterator]() { let i = 0; return { next: () => i < plugins.length
        ? { value: plugins[i++], done: false } : { value: undefined, done: true } }; },
    });
    Object.defineProperty(Navigator.prototype, 'plugins', { get() { return pluginsArr; }, configurable: true });

    const mimes = [pdfMime, xPdfMime];
    const mimesArr = Object.assign(mimes.slice(), {
      length: mimes.length,
      item(i) { return mimes[i] || null; },
      namedItem(n) { return mimes.find((m) => m.type === n) || null; },
    });
    Object.defineProperty(Navigator.prototype, 'mimeTypes', { get() { return mimesArr; }, configurable: true });
  } catch {}

  // --- WebRTC IP-leak guard (RTCPeerConnection) --------------------------
  //
  // Even with the disable_non_proxied_udp policy, Chromium still emits
  // 'host' candidates revealing the local network (192.168.x, 10.x).
  // BrowserScan's "Proxy: Yes" check correlates STUN candidates with
  // the public IP and flags any mismatch. Strip every candidate that
  // doesn't match the page's observable public IP (which IS the proxy
  // when the bridge is active, so what survives is consistent).
  //
  // Filtering at the JS layer is belt-and-suspenders: we drop
  //   • host candidates (192.168/10/172.16-31/169.254)
  //   • srflx candidates whose related IP is private
  //   • all candidates if the page never explicitly requested ICE
  //     gathering (so trackers can't quietly probe).
  try {
    const PRIVATE_RE = /^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.|169\\.254\\.|fc|fd|::1|fe80)/i;
    function isPrivateCandidate(c) {
      if (!c || typeof c !== 'string') return false;
      // Lines look like:
      //   candidate:842163049 1 udp 1677729535 192.168.1.5 50000 typ host ...
      const m = /candidate:\\S+ \\d+ \\S+ \\d+ (\\S+) \\d+ typ (\\S+)/.exec(c);
      if (!m) return false;
      const [, ip, typ] = m;
      if (typ === 'host' && PRIVATE_RE.test(ip)) return true;
      if (typ === 'srflx' && PRIVATE_RE.test(ip)) return true;
      return false;
    }
    const RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (RTC) {
      const origAdd = RTC.prototype.addIceCandidate;
      RTC.prototype.addIceCandidate = function (cand, ...rest) {
        try {
          const c = cand && (cand.candidate != null ? cand.candidate : cand);
          if (isPrivateCandidate(c)) {
            return Promise.resolve(); // silently drop
          }
        } catch {}
        return origAdd.apply(this, [cand, ...rest]);
      };
      // Same trick on the local-candidate emission side: rewrite the
      // 'icecandidate' event so subscribers only see public candidates.
      const origSetEventListener = RTC.prototype.addEventListener;
      RTC.prototype.addEventListener = function (type, listener, ...rest) {
        if (type === 'icecandidate' && typeof listener === 'function') {
          const wrapped = function (ev) {
            if (ev && ev.candidate && isPrivateCandidate(ev.candidate.candidate)) return;
            return listener.call(this, ev);
          };
          return origSetEventListener.call(this, type, wrapped, ...rest);
        }
        return origSetEventListener.call(this, type, listener, ...rest);
      };
      // onicecandidate property too — sites use both forms.
      try {
        const desc = Object.getOwnPropertyDescriptor(RTC.prototype, 'onicecandidate');
        if (desc && desc.set) {
          Object.defineProperty(RTC.prototype, 'onicecandidate', {
            configurable: true,
            get: desc.get,
            set(fn) {
              if (typeof fn !== 'function') return desc.set.call(this, fn);
              const wrapped = function (ev) {
                if (ev && ev.candidate && isPrivateCandidate(ev.candidate.candidate)) return;
                return fn.call(this, ev);
              };
              return desc.set.call(this, wrapped);
            },
          });
        }
      } catch {}
    }
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
