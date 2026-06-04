import React, { useEffect, useRef, useState } from 'react';

// Profile-locked browsing shell. Omnibox + back/forward/reload + a single
// <webview> tab bound to the window's session partition (set by the main
// process at creation time). Profile sessions are browsing-only — no
// oserus:// management routes reachable here (per the v0.62 cutover).
//
// Multi-tab support is the obvious next step but intentionally out of
// scope for the scaffold. Today: one tab, focused on the model's session.

export default function BrowserShell({ accountId }) {
  const webviewRef = useRef(null);
  const [url, setUrl] = useState('about:blank');
  const [omniValue, setOmniValue] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onNav = (e) => {
      const u = e.url || wv.getURL();
      setUrl(u);
      setOmniValue(u);
      setCanGoBack(wv.canGoBack());
      setCanGoForward(wv.canGoForward());
    };
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);

    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    return () => {
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
    };
  }, []);

  function go(raw) {
    const wv = webviewRef.current;
    if (!wv) return;
    const target = normalizeUrl(raw);
    wv.loadURL(target);
  }

  function onSubmit(e) {
    e.preventDefault();
    go(omniValue);
  }

  async function backToPicker() {
    await window.oserusBrowser.session.backToPicker();
  }

  return (
    <div style={page}>
      <div style={chrome}>
        <button style={navBtn} disabled={!canGoBack} onClick={() => webviewRef.current?.goBack()} title="Back">‹</button>
        <button style={navBtn} disabled={!canGoForward} onClick={() => webviewRef.current?.goForward()} title="Forward">›</button>
        <button style={navBtn} onClick={() => webviewRef.current?.reload()} title="Reload">↻</button>
        <form onSubmit={onSubmit} style={{ flex: 1, display: 'flex' }}>
          <input
            style={omni}
            value={omniValue}
            onChange={(e) => setOmniValue(e.target.value)}
            placeholder="Search or type a URL"
            spellCheck={false}
          />
        </form>
        <button style={pickerBtn} onClick={backToPicker} title="Close this session and choose another profile">Switch Profile</button>
      </div>
      <div style={loadingBar(loading)} />
      <webview
        ref={webviewRef}
        src="about:blank"
        style={{ flex: 1, width: '100%', border: 'none' }}
        allowpopups="true"
      />
    </div>
  );
}

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(s)) return s;
  // Treat as a search if it doesn't look like a domain.
  const looksLikeDomain = /^[^\s/]+\.[^\s/]+/.test(s) && !s.includes(' ');
  if (looksLikeDomain) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

const page = { display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-0)' };
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
  padding: '6px 12px', borderRadius: 6,
  background: 'transparent', border: '1px solid var(--gold)',
  color: 'var(--gold)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
  whiteSpace: 'nowrap',
};
const loadingBar = (active) => ({
  height: 2, background: active ? 'var(--gold)' : 'transparent',
  transition: 'background 120ms',
});
