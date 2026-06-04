import React, { useEffect, useRef, useState } from 'react';
import SubredditRail from './SubredditRail.jsx';

// Profile-locked, multi-tab browsing shell. Tab strip + back/forward/
// reload + omnibox + N <webview> elements (hidden when inactive so each
// tab keeps its own back/forward stack). Every webview shares the
// window's session partition — set by the main process at creation time
// — so cookies and storage stay scoped to the account.
//
// Autofill: on the first navigation of each tab we inject the same
// autofill script the standalone single-account browser uses, so the
// session truly opens "pre-logged-in".
//
// Browsing-only inside profile sessions: no oserus:// management routes
// are reachable here (per the v0.62 cutover).

const HOME = 'https://www.google.com/';

let _nextTabId = 1;
const newTab = (url = HOME) => ({
  id: _nextTabId++, url, title: url, loading: false,
  canBack: false, canForward: false, autofillDone: false,
});

export default function BrowserShell({ accountId }) {
  const [tabs, setTabs] = useState(() => [newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [omniValue, setOmniValue] = useState(HOME);
  const webviewRefs = useRef({}); // id -> HTMLWebViewElement
  const autofillScriptRef = useRef(null);

  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  // Fetch the autofill script once per session. Empty string when no
  // creds are stored — in that case we just skip the inject step.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.oserusBrowser.session.autofillScript({ accountId });
        if (!cancelled) autofillScriptRef.current = res?.script || '';
      } catch {
        if (!cancelled) autofillScriptRef.current = '';
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  // Attach webview event listeners whenever a new tab is mounted.
  useEffect(() => {
    const cleanups = [];
    for (const t of tabs) {
      const wv = webviewRefs.current[t.id];
      if (!wv || wv.__oserusWired) continue;
      wv.__oserusWired = true;

      const updateNav = () => {
        setTabs((cur) => cur.map((x) => x.id === t.id ? {
          ...x,
          url: wv.getURL(),
          title: wv.getTitle() || wv.getURL(),
          canBack: wv.canGoBack(),
          canForward: wv.canGoForward(),
        } : x));
        if (t.id === activeIdRef.current) setOmniValue(wv.getURL());
      };

      const onStart  = () => setTabs((cur) => cur.map((x) => x.id === t.id ? { ...x, loading: true } : x));
      const onStop   = () => {
        setTabs((cur) => cur.map((x) => x.id === t.id ? { ...x, loading: false } : x));
        // Inject autofill on every finished load — the script self-guards
        // with window.__oserusAutofillActive so re-injection is a no-op.
        const js = autofillScriptRef.current;
        if (js) { try { wv.executeJavaScript(js); } catch {} }
      };
      const onTitle  = (e) => setTabs((cur) => cur.map((x) => x.id === t.id ? { ...x, title: e.title } : x));
      const onNewWin = (e) => {
        // Renderer-side window.open / target=_blank → open as a new tab
        // in this window instead of letting Chromium spawn a real popup.
        e.preventDefault?.();
        const url = e.url || HOME;
        setTabs((cur) => [...cur, newTab(url)]);
      };

      wv.addEventListener('did-navigate', updateNav);
      wv.addEventListener('did-navigate-in-page', updateNav);
      wv.addEventListener('did-start-loading', onStart);
      wv.addEventListener('did-stop-loading', onStop);
      wv.addEventListener('page-title-updated', onTitle);
      wv.addEventListener('new-window', onNewWin);

      cleanups.push(() => {
        wv.removeEventListener('did-navigate', updateNav);
        wv.removeEventListener('did-navigate-in-page', updateNav);
        wv.removeEventListener('did-start-loading', onStart);
        wv.removeEventListener('did-stop-loading', onStop);
        wv.removeEventListener('page-title-updated', onTitle);
        wv.removeEventListener('new-window', onNewWin);
      });
    }
    return () => cleanups.forEach((fn) => fn());
  }, [tabs]);

  // Keep latest activeId in a ref so the webview event handlers above
  // (set up once per tab) can read the current value without restating.
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
    const wv = webviewRefs.current[activeId];
    if (wv) {
      try { setOmniValue(wv.getURL() || active.url); } catch { setOmniValue(active.url); }
    }
  }, [activeId, active.url]);

  function go(raw) {
    const wv = webviewRefs.current[activeId];
    if (!wv) return;
    const target = normalizeUrl(raw);
    wv.loadURL(target);
  }

  function onSubmit(e) {
    e.preventDefault();
    go(omniValue);
  }

  function addTab() {
    const t = newTab();
    setTabs((cur) => [...cur, t]);
    setActiveId(t.id);
  }

  function closeTab(id) {
    setTabs((cur) => {
      const next = cur.filter((x) => x.id !== id);
      if (next.length === 0) {
        const fresh = newTab();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
    delete webviewRefs.current[id];
  }

  async function backToPicker() {
    await window.oserusBrowser.session.backToPicker();
  }

  return (
    <div style={page}>
      <div style={tabStrip}>
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            style={{ ...tab, ...(t.id === activeId ? tabActive : {}) }}
            title={t.url}
          >
            {t.loading && <span style={spinner} />}
            <span style={tabTitle}>{t.title || t.url}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              style={tabClose}
              title="Close tab"
            >×</button>
          </div>
        ))}
        <button onClick={addTab} style={addBtn} title="New tab">+</button>
        <div style={{ flex: 1 }} />
        <button style={pickerBtn} onClick={backToPicker} title="Close this session and choose another profile">
          Switch Profile
        </button>
      </div>

      <div style={chrome}>
        <button style={navBtn} disabled={!active.canBack} onClick={() => webviewRefs.current[activeId]?.goBack()} title="Back">‹</button>
        <button style={navBtn} disabled={!active.canForward} onClick={() => webviewRefs.current[activeId]?.goForward()} title="Forward">›</button>
        <button style={navBtn} onClick={() => webviewRefs.current[activeId]?.reload()} title="Reload">↻</button>
        <form onSubmit={onSubmit} style={{ flex: 1, display: 'flex' }}>
          <input
            style={omni}
            value={omniValue}
            onChange={(e) => setOmniValue(e.target.value)}
            placeholder="Search Google or type a URL"
            spellCheck={false}
            onFocus={(e) => e.target.select()}
          />
        </form>
      </div>

      <div style={loadingBar(active.loading)} />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <SubredditRail
          accountId={accountId}
          onOpen={(name, intent) => {
            const url = intent === 'submit'
              ? `https://www.reddit.com/r/${name}/submit`
              : `https://www.reddit.com/r/${name}/`;
            const t = newTab(url);
            setTabs((cur) => [...cur, t]);
            setActiveId(t.id);
          }}
        />
        <div style={{ flex: 1, position: 'relative' }}>
          {tabs.map((t) => (
            <webview
              key={t.id}
              ref={(el) => { if (el) webviewRefs.current[t.id] = el; }}
              src={t.url}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                border: 'none',
                visibility: t.id === activeId ? 'visible' : 'hidden',
              }}
              allowpopups="true"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(s)) return s;
  const looksLikeDomain = /^[^\s/]+\.[^\s/]+/.test(s) && !s.includes(' ');
  if (looksLikeDomain) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

const page = { display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-0)' };
const tabStrip = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '6px 8px 0', background: 'var(--bg-1)',
  borderBottom: '1px solid var(--border)',
};
const tab = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', minWidth: 120, maxWidth: 220,
  background: 'var(--bg-elev)', borderRadius: '6px 6px 0 0',
  border: '1px solid var(--border)', borderBottom: 'none',
  cursor: 'pointer', fontSize: 12, color: 'var(--text-2)',
  marginBottom: -1,
};
const tabActive = {
  background: 'var(--bg-0)', color: 'var(--text-0)',
  borderColor: 'var(--border-strong)',
};
const tabTitle = {
  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const tabClose = {
  width: 16, height: 16, borderRadius: 3,
  background: 'transparent', border: 'none',
  color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
  padding: 0,
};
const addBtn = {
  width: 26, height: 26, borderRadius: 4,
  background: 'transparent', border: '1px dashed var(--border)',
  color: 'var(--text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
  marginBottom: 1,
};
const spinner = {
  width: 8, height: 8, borderRadius: '50%',
  background: 'var(--gold)', flexShrink: 0,
  animation: 'pulse 1s ease-in-out infinite',
};
const chrome = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 10px', background: 'var(--bg-1)',
  borderBottom: '1px solid var(--border)',
};
const navBtn = {
  width: 28, height: 28, borderRadius: 6,
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text-1)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
};
const omni = {
  width: '100%', padding: '6px 12px', borderRadius: 6,
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  color: 'var(--text-0)', fontFamily: 'var(--font-mono)', fontSize: 12,
  outline: 'none',
};
const pickerBtn = {
  padding: '5px 10px', borderRadius: 6,
  background: 'transparent', border: '1px solid var(--gold)',
  color: 'var(--gold)', cursor: 'pointer', fontSize: 11, fontWeight: 600,
  whiteSpace: 'nowrap', marginBottom: 2,
};
const loadingBar = (active) => ({
  height: 2, background: active ? 'var(--gold)' : 'transparent',
  transition: 'background 120ms',
});
