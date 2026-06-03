import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { PLATFORM_MAP, platformColor, platformShort } from '../lib/platforms.js';

// Autofill script — same logic the per-account BrowserWindow uses in the
// main process, copied here so the launcher's <webview> tabs get the same
// behaviour. Retries on a 250ms tick + MutationObserver for 10 seconds, so
// async / React-controlled login forms still get filled.
// Login-page autofill. Pierces open shadow roots (Reddit faceplate inputs
// live inside shadow DOM), has per-platform selectors for Reddit/X/IG/TikTok/
// RedGIFs, retries on a 250ms tick for 10s and on DOM mutations, sets values
// through the prototype setter so React/Lit accept the input event.
function autofillJs(username, password) {
  const u = JSON.stringify(username);
  const p = JSON.stringify(password);
  return `
    (() => {
      if (window.__oserusAutofillActive) return;
      window.__oserusAutofillActive = true;
      const u = ${u}; const p = ${p};
      function deepQueryAll(root, sel) {
        const out = [];
        const walk = (node) => {
          if (!node) return;
          if (node.querySelectorAll) { try { out.push(...node.querySelectorAll(sel)); } catch {} }
          if (node.shadowRoot) walk(node.shadowRoot);
          const kids = node.children || [];
          for (let i = 0; i < kids.length; i++) walk(kids[i]);
        };
        walk(root);
        return out;
      }
      function deepFind(sel) {
        const all = deepQueryAll(document.documentElement, sel);
        return all.find((el) => el.offsetParent !== null && !el.disabled && !el.readOnly) || null;
      }
      function setVal(el, v) {
        if (!el || el.value === v) return false;
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, v); else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        return true;
      }

      const host = location.hostname;
      const isReddit    = /(^|\\.)reddit\\.com$/.test(host);
      const isX         = /(^|\\.)(x|twitter)\\.com$/.test(host);
      const isInstagram = /(^|\\.)instagram\\.com$/.test(host);
      const isTikTok    = /(^|\\.)tiktok\\.com$/.test(host);
      const isRedGifs   = /(^|\\.)redgifs\\.com$/.test(host);

      const userSel = [
        isReddit && 'input#login-username',
        isReddit && 'input[name="username"]',
        isX && 'input[autocomplete="username"]',
        isX && 'input[name="text"]',
        isX && 'input[data-testid="ocfEnterTextTextInput"]',
        isInstagram && 'input[name="username"]',
        isInstagram && 'input[aria-label*="username" i]',
        isTikTok && 'input[name="username"]',
        isTikTok && 'input[type="text"][placeholder*="mail" i]',
        isTikTok && 'input[type="text"][placeholder*="sername" i]',
        isRedGifs && 'input[name="login"]',
        'input[autocomplete="username"]','input[name="username"]','input[name="email"]',
        'input[type="email"]','input[autocomplete="email"]','input[name="loginfmt"]',
        'input[id*="login" i][type="text"]','input[placeholder*="sername" i]','input[placeholder*="mail" i]',
      ].filter(Boolean);
      const passSel = [
        isReddit && 'input#login-password',
        isReddit && 'input[name="password"]',
        isX && 'input[autocomplete="current-password"]',
        isX && 'input[name="password"]',
        isInstagram && 'input[name="password"]',
        isInstagram && 'input[aria-label*="password" i]',
        'input[autocomplete="current-password"]','input[name="password"]',
        'input[type="password"]','input[placeholder*="assword" i]',
      ].filter(Boolean);

      const filled = { user: false, pass: false };
      const findFirst = (list) => { for (const s of list) { const el = deepFind(s); if (el) return el; } return null; };
      const tryFill = () => {
        const uEl = findFirst(userSel);
        const pEl = findFirst(passSel);
        if (uEl && !filled.user) { if (setVal(uEl, u)) filled.user = true; }
        if (pEl && !filled.pass) { if (setVal(pEl, p)) filled.pass = true; }
        return filled.user && filled.pass;
      };
      if (tryFill()) return;
      const start = Date.now();
      const t = setInterval(() => { if (tryFill() || Date.now() - start > 10000) clearInterval(t); }, 250);
      try {
        const mo = new MutationObserver(() => { tryFill(); });
        mo.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => mo.disconnect(), 10000);
      } catch {}
    })();
  `;
}

// Model launcher — opens as a popout BrowserWindow with a tab strip across
// the top and one <webview> per linked account inside the same window.
// Cookies / UA / proxy are wired by the main process (prepareSessionForAccount
// is called before this page mounts), so every webview lands logged in.
export default function ModelLauncher({ modelId }) {
  const { token } = useAuth();
  const [profile, setProfile] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [urls, setUrls] = useState({});           // accountId → current URL
  // Tabs only get mounted once the user has visited them. Saves the cost of
  // spinning up a Chromium process per account on first paint.
  const [visited, setVisited] = useState({});
  const webviewRefs = useRef({});
  const credsCache = useRef({}); // accountId → { username, password }

  useEffect(() => {
    if (!modelId) return;
    (async () => {
      const list = await window.api.accounts.listForProfile({ token, profileId: Number(modelId) });
      if (list.ok) {
        const accs = (list.accounts || []).filter((a) => a.status !== 'banned');
        setAccounts(accs);
        if (accs.length) { setActiveId(accs[0].id); setVisited({ [accs[0].id]: true }); }
        // initial URLs per account = platform home page
        const map = {};
        for (const a of accs) {
          const home = PLATFORM_MAP[a.platform || 'reddit']?.home || 'about:blank';
          map[a.id] = home;
        }
        setUrls(map);
        // Prefetch credentials in parallel so dom-ready autofill is instant.
        for (const a of accs) {
          window.api.accounts.getCredentials({ token, accountId: a.id })
            .then((r) => { if (r.ok && r.username && r.password) credsCache.current[a.id] = { username: r.username, password: r.password }; })
            .catch(() => {});
        }
      }
      const profiles = await window.api.profiles.list({ token });
      if (profiles.ok) {
        const p = (profiles.profiles || []).find((x) => x.id === Number(modelId));
        if (p) setProfile(p);
      }
    })();
  }, [modelId, token]);

  // Attach a dom-ready hook to every webview tab so it autofills credentials
  // the first time the login form appears on that tab. Runs after navigation
  // too so OAuth bounces don't lose autofill.
  useEffect(() => {
    for (const a of accounts) {
      const wv = webviewRefs.current[a.id];
      if (!wv || wv.__oserusAttached) continue;
      wv.__oserusAttached = true;
      const inject = () => {
        const c = credsCache.current[a.id];
        if (!c) return;
        try { wv.executeJavaScript(`window.__oserusAutofillActive = false; ${autofillJs(c.username, c.password)}`); } catch {}
      };
      wv.addEventListener('dom-ready', inject);
      wv.addEventListener('did-navigate', inject);
      wv.addEventListener('did-navigate-in-page', inject);
    }
  }, [accounts]);

  // Track navigations in each webview so the address bar reflects the
  // currently visible tab.
  useEffect(() => {
    if (!activeId) return;
    const wv = webviewRefs.current[activeId];
    if (!wv) return;
    const onNav = (e) => {
      const url = e?.url || wv.getURL?.() || '';
      setUrls((m) => ({ ...m, [activeId]: url }));
    };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    return () => {
      try { wv.removeEventListener('did-navigate', onNav); } catch {}
      try { wv.removeEventListener('did-navigate-in-page', onNav); } catch {}
    };
  }, [activeId]);

  // Lag mitigation. Every tab is mounted so switching is instant, but
  // inactive tabs are silenced + their <video>/<audio> elements paused so
  // background tabs don't slam the CPU with playback. Plus a one-shot dom-
  // ready hook installs a visibility listener so paused media stays paused
  // when the user comes back unless they explicitly hit play.
  useEffect(() => {
    for (const a of accounts) {
      const wv = webviewRefs.current[a.id];
      if (!wv) continue;
      const isActive = a.id === activeId;
      try { wv.setAudioMuted?.(!isActive); } catch {}
      if (!isActive) {
        try {
          wv.executeJavaScript?.(`(() => {
            try {
              document.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch {} });
            } catch {}
          })();`).catch(() => {});
        } catch {}
      }
    }
  }, [activeId, accounts]);

  const active = accounts.find((a) => a.id === activeId);

  if (!modelId) {
    return <div style={{ padding: 40, color: '#aaa' }}>No model id supplied.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0b', color: '#d7dadc' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #1f1f21',
        display: 'flex', alignItems: 'center', gap: 12, background: '#0f0f10',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{profile ? profile.name : 'Loading…'}</div>
        <div style={{ color: '#818384', fontSize: 11 }}>· {accounts.length} account{accounts.length === 1 ? '' : 's'}</div>
        <div style={{ flex: 1 }} />
        {active && (
          <div className="mono dim" style={{ fontSize: 11, maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {urls[active.id]}
          </div>
        )}
      </div>

      {/* Tab strip */}
      <div style={{
        display: 'flex', gap: 4, padding: '6px 10px',
        background: '#0c0c0d', borderBottom: '1px solid #1f1f21',
        overflowX: 'auto', flexWrap: 'nowrap',
      }}>
        {accounts.length === 0 ? (
          <div style={{ padding: '10px', color: '#818384', fontSize: 12 }}>No accounts on this model yet.</div>
        ) : accounts.map((a) => {
          const isActive = a.id === activeId;
          const color = platformColor(a.platform);
          return (
            <button
              key={a.id}
              onClick={() => { setActiveId(a.id); setVisited((v) => v[a.id] ? v : { ...v, [a.id]: true }); }}
              title={`${a.platform || 'reddit'} · ${a.username}`}
              style={{
                background: isActive ? '#1c1c1e' : '#15151700',
                border: `1px solid ${isActive ? color : 'transparent'}`,
                borderRadius: 8,
                padding: '6px 12px',
                color: isActive ? '#fff' : '#9a9b9d',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>{platformShort(a.platform)}</span>
              <span>{a.username}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        {active && (
          <>
            <button className="ghost" onClick={() => webviewRefs.current[active.id]?.goBack()} style={ctrlBtn}>←</button>
            <button className="ghost" onClick={() => webviewRefs.current[active.id]?.goForward()} style={ctrlBtn}>→</button>
            <button className="ghost" onClick={() => webviewRefs.current[active.id]?.reload()} style={ctrlBtn}>↻</button>
          </>
        )}
      </div>

      {/* Webview surface — every tab mounts AND loads its real URL on first
          paint so everything's ready when the user switches. Lag mitigation
          handled out-of-band:
            - audio: muted on inactive tabs (no background sound)
            - video: paused on inactive tabs via injected JS
            - rendering: Electron's background throttling kicks in on hidden
              webContents automatically; we hint it with the display:none
              style which Electron treats as a backgrounded frame.
          */}
      <div style={{ flex: 1, position: 'relative' }}>
        {accounts.map((a) => (
          <webview
            key={a.id}
            ref={(el) => { if (el) webviewRefs.current[a.id] = el; }}
            partition={`persist:${a.partition_key}`}
            src={urls[a.id] || PLATFORM_MAP[a.platform || 'reddit']?.home || 'about:blank'}
            style={{
              position: 'absolute', inset: 0,
              display: a.id === activeId ? 'flex' : 'none',
              border: 'none', background: '#0a0a0b',
            }}
            allowpopups="true"
          />
        ))}
      </div>
    </div>
  );
}

const ctrlBtn = { fontSize: 12, padding: '4px 10px' };
