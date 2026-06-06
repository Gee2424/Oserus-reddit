import React, { useEffect, useRef, useState } from 'react';

// Chrome UI for an Oserus Browser window. Renders ONLY the chrome bar
// (tab strip + omnibox + back / forward / reload). The actual web
// content is rendered by native WebContentsView children of the host
// BrowserWindow — see src/main/browser.js. We never embed a webview.
//
// Height must match CHROME_HEIGHT in src/main/browser.js (78 px).

export default function BrowserShell() {
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [omni, setOmni] = useState('');
  const omniRef = useRef(null);

  const active = tabs.find((t) => t.id === activeId) || null;

  // Subscribe to tab-state pushes from main. The chrome is a pure view:
  // we never compute state locally beyond the omnibox draft text.
  useEffect(() => {
    const handler = (state) => {
      setTabs(state.tabs || []);
      setActiveId(state.activeId ?? null);
      const a = (state.tabs || []).find((t) => t.id === state.activeId);
      if (a && document.activeElement !== omniRef.current) setOmni(a.url || '');
    };
    window.oserusBrowser.onState(handler);
    window.oserusBrowser.tabsReady();
    return () => window.oserusBrowser.offState(handler);
  }, []);

  // When the active tab url changes (via did-navigate from main), sync
  // the omnibox unless the user is mid-typing.
  useEffect(() => {
    if (active && document.activeElement !== omniRef.current) setOmni(active.url || '');
  }, [active?.url]);

  function submitOmni(e) {
    e.preventDefault();
    window.oserusBrowser.navigate(omni);
    omniRef.current?.blur();
  }

  return (
    <div style={page}>
      <div style={tabStrip}>
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          return (
            <div
              key={t.id}
              onClick={() => window.oserusBrowser.switchTab(t.id)}
              style={{ ...tabStyle, ...(isActive ? tabActive : {}) }}
              title={t.url}
            >
              {t.loading && <span style={spinner} />}
              <span style={tabTitle}>{t.title || t.url}</span>
              <button
                onClick={(e) => { e.stopPropagation(); window.oserusBrowser.closeTab(t.id); }}
                style={closeBtn}
                title="Close tab"
              >×</button>
            </div>
          );
        })}
        <button onClick={() => window.oserusBrowser.newTab()} style={addBtn} title="New tab">+</button>
      </div>

      <div style={chromeRow}>
        <button
          style={navBtn}
          disabled={!active?.canBack}
          onClick={() => window.oserusBrowser.back()}
          title="Back"
        >‹</button>
        <button
          style={navBtn}
          disabled={!active?.canForward}
          onClick={() => window.oserusBrowser.forward()}
          title="Forward"
        >›</button>
        <button
          style={navBtn}
          onClick={() => window.oserusBrowser.reload()}
          title="Reload"
        >↻</button>
        <form onSubmit={submitOmni} style={{ flex: 1, display: 'flex' }}>
          <input
            ref={omniRef}
            value={omni}
            onChange={(e) => setOmni(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Search Google or type a URL"
            spellCheck={false}
            style={omniInput}
          />
        </form>
      </div>
    </div>
  );
}

// Height total = 32 (tab strip) + 1 (sep) + 44 (chrome row) + 1 (sep) = 78.
// Keep in sync with CHROME_HEIGHT in src/main/browser.js.
const page = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100vh',
  background: 'var(--bg-1)', overflow: 'hidden',
};
const tabStrip = {
  display: 'flex', alignItems: 'flex-end', gap: 2,
  height: 32, padding: '4px 6px 0',
  background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
};
const tabStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  height: 26, padding: '0 10px', minWidth: 120, maxWidth: 220,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border)', borderBottom: 'none',
  borderRadius: '6px 6px 0 0',
  cursor: 'pointer', fontSize: 12, color: 'var(--text-2)',
};
const tabActive = {
  background: 'var(--bg-0)', color: 'var(--text-0)',
  borderColor: 'var(--border-strong)',
};
const tabTitle = {
  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const closeBtn = {
  width: 16, height: 16, borderRadius: 3,
  background: 'transparent', border: 'none',
  color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
  padding: 0,
};
const addBtn = {
  width: 26, height: 24, borderRadius: 4, marginBottom: 1,
  background: 'transparent', border: '1px dashed var(--border)',
  color: 'var(--text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
};
const spinner = {
  width: 8, height: 8, borderRadius: '50%',
  background: 'var(--gold)', flexShrink: 0,
};
const chromeRow = {
  display: 'flex', alignItems: 'center', gap: 6,
  height: 44, padding: '0 10px',
  background: 'var(--bg-0)', borderBottom: '1px solid var(--border)',
};
const navBtn = {
  width: 28, height: 28, borderRadius: 6,
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text-1)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
};
const omniInput = {
  width: '100%', height: 28, padding: '0 12px', borderRadius: 14,
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  color: 'var(--text-0)', fontFamily: 'var(--font-mono)', fontSize: 12,
  outline: 'none',
};
