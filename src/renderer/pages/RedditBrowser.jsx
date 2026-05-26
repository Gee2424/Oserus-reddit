import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import AccountSwitcher from '../components/AccountSwitcher.jsx';
import ComposerPanel from '../components/ComposerPanel.jsx';
import IdeasPanel from '../components/IdeasPanel.jsx';
import RedGifsPanel from '../components/RedGifsPanel.jsx';

let tabIdSeq = 1;
function makeTab(url) {
  return { id: tabIdSeq++, url: url || 'https://www.reddit.com/', currentUrl: url || 'https://www.reddit.com/' };
}

// A URL is a "submit page" if it matches Reddit's post creation routes.
// Examples: /submit, /r/<sub>/submit, new.reddit.com/submit
function isSubmitPage(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!/reddit\.com$/i.test(u.hostname.replace(/^.*?\./, '')) && !/reddit\.com$/i.test(u.hostname)) return false;
    return /\/submit(\/|$|\?)/.test(u.pathname) || /\/post\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

export default function RedditBrowser() {
  const { token } = useAuth();
  const { forPlatform } = useActiveAccount();
  const { active } = forPlatform('reddit');

  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [inputUrl, setInputUrl] = useState('');
  const [creds, setCreds] = useState(null);
  const [showCredsHelper, setShowCredsHelper] = useState(false);
  const webviewRefs = useRef({});
  const lastAccountRef = useRef(null);

  // Side panel state: which floating button is open
  const [openPanel, setOpenPanel] = useState(null); // 'compose' | 'ideas' | 'redgifs' | null

  // Open Reddit home in a tab when switching accounts
  useEffect(() => {
    if (!active) { setTabs([]); setActiveTabId(null); lastAccountRef.current = null; return; }
    if (lastAccountRef.current === active.id) return;
    lastAccountRef.current = active.id;
    const t = makeTab('https://www.reddit.com/');
    setTabs([t]);
    setActiveTabId(t.id);
    setInputUrl(t.url);
  }, [active?.id]);

  // Listen for URL changes inside each webview so we know if the current tab is on a submit page
  useEffect(() => {
    const wv = webviewRefs.current[activeTabId];
    if (!wv) return;
    const onNav = (e) => {
      const url = e?.url || wv.getURL?.() || '';
      setInputUrl(url);
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, currentUrl: url } : t));
    };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    return () => {
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
    };
  }, [activeTabId]);

  // Load credentials whenever active account changes
  useEffect(() => {
    setCreds(null);
    setShowCredsHelper(false);
    if (!active) return;
    let cancelled = false;
    (async () => {
      const res = await window.api.accounts.getCredentials({ token, accountId: active.id });
      if (!cancelled && res.ok && (res.password || res.username)) {
        setCreds(res);
        setShowCredsHelper(true);
      }
    })();
    return () => { cancelled = true; };
  }, [active?.id, token]);

  function newTab() {
    const t = makeTab('https://www.reddit.com/');
    setTabs(prev => [...prev, t]);
    setActiveTabId(t.id);
    setInputUrl(t.url);
  }

  function closeTab(id) {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const fresh = makeTab('https://www.reddit.com/');
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (id === activeTabId) {
        const idx = prev.findIndex(t => t.id === id);
        setActiveTabId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  }

  function go(target) {
    let u = target || inputUrl;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    setInputUrl(u);
    const wv = webviewRefs.current[activeTabId];
    if (wv) wv.src = u;
  }

  function copy(text) { navigator.clipboard.writeText(text); }

  const currentTab = tabs.find(t => t.id === activeTabId);
  const onSubmitPage = currentTab && isSubmitPage(currentTab.currentUrl);

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <span style={styles.brandBlock}>
          <span style={styles.brandIcon}>🔴</span>
          <h2 style={{ margin: 0, fontSize: 20 }}>Reddit</h2>
        </span>
        <AccountSwitcher platform="reddit" />
      </div>

      {!active ? (
        <div className="empty-state" style={{ margin: 24 }}>
          <h2 style={{ marginBottom: 8 }}>No Reddit account selected</h2>
          <div>Pick one from the switcher above, or click ▶ on a Reddit account under a model.</div>
        </div>
      ) : (
        <>
          <div style={styles.tabBar}>
            {tabs.map(t => (
              <div
                key={t.id}
                onClick={() => { setActiveTabId(t.id); setInputUrl(t.url); }}
                style={{ ...styles.tab, ...(activeTabId === t.id ? styles.tabActive : {}) }}
              >
                <span style={styles.tabTitle}>Reddit</span>
                {tabs.length > 1 && (
                  <span onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} style={styles.tabClose}>×</span>
                )}
              </div>
            ))}
            <button className="ghost" onClick={newTab} style={styles.newTabBtn}>+</button>
          </div>

          <div style={styles.controls}>
            <button className="ghost" onClick={() => webviewRefs.current[activeTabId]?.goBack()}>←</button>
            <button className="ghost" onClick={() => webviewRefs.current[activeTabId]?.goForward()}>→</button>
            <button className="ghost" onClick={() => webviewRefs.current[activeTabId]?.reload()}>↻</button>
            <input
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              style={{ flex: 1 }}
              spellCheck={false}
            />
            {creds && (
              <button className="ghost" onClick={() => setShowCredsHelper(v => !v)} title="Saved credentials" style={{ padding: '6px 10px' }}>🔑</button>
            )}
          </div>

          {showCredsHelper && creds && (
            <div style={styles.credsBar}>
              <div style={{ fontSize: 12, fontWeight: 500, marginRight: 8 }}>Saved credentials:</div>
              <div style={styles.credChip}>
                <span className="mono dim" style={{ fontSize: 11 }}>user</span>
                <span className="mono" style={{ fontSize: 12 }}>{creds.username}</span>
                <button className="ghost" onClick={() => copy(creds.username)} style={{ padding: '2px 6px', fontSize: 11 }}>copy</button>
              </div>
              {creds.password && (
                <div style={styles.credChip}>
                  <span className="mono dim" style={{ fontSize: 11 }}>pass</span>
                  <span className="mono" style={{ fontSize: 12 }}>{'•'.repeat(Math.min(creds.password.length, 12))}</span>
                  <button className="ghost" onClick={() => copy(creds.password)} style={{ padding: '2px 6px', fontSize: 11 }}>copy</button>
                </div>
              )}
              <div style={{ flex: 1 }} />
              <button className="ghost" onClick={() => setShowCredsHelper(false)} style={{ fontSize: 11 }}>hide</button>
            </div>
          )}

          <div style={styles.viewportContainer}>
            {tabs.map(t => (
              <webview
                key={`${active.partition_key}-${t.id}`}
                ref={el => { if (el) webviewRefs.current[t.id] = el; }}
                src={t.url}
                partition={`persist:${active.partition_key}`}
                style={{ ...styles.webview, display: t.id === activeTabId ? 'flex' : 'none' }}
                allowpopups="true"
              />
            ))}

            {/* Floating action buttons - only on submit pages.
                Positioned bottom-LEFT so they don't overlap Reddit's own Post button. */}
            {onSubmitPage && !openPanel && (
              <div style={styles.fabStack}>
                <button onClick={() => setOpenPanel('compose')} style={styles.fab} title="Open Composer">
                  <span style={styles.fabIcon}>✍️</span>
                  <span style={styles.fabLabel}>Compose</span>
                </button>
                <button onClick={() => setOpenPanel('ideas')} style={styles.fab} title="Open Ideas">
                  <span style={styles.fabIcon}>💡</span>
                  <span style={styles.fabLabel}>Ideas</span>
                </button>
                <button onClick={() => setOpenPanel('redgifs')} style={styles.fab} title="Open RedGifs">
                  <span style={styles.fabIcon}>🟠</span>
                  <span style={styles.fabLabel}>RedGifs</span>
                </button>
              </div>
            )}

            {/* Side panel */}
            {openPanel && (
              <div style={styles.sidePanel}>
                <div style={styles.sidePanelHeader}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>
                    {openPanel === 'compose' && 'Composer'}
                    {openPanel === 'ideas' && 'Post Ideas'}
                    {openPanel === 'redgifs' && 'RedGifs'}
                  </h3>
                  <button onClick={() => setOpenPanel(null)} style={styles.sidePanelClose}>×</button>
                </div>
                <div style={styles.sidePanelBody}>
                  {openPanel === 'compose' && <ComposerPanel account={active} />}
                  {openPanel === 'ideas' && <IdeasPanel account={active} />}
                  {openPanel === 'redgifs' && <RedGifsPanel />}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', margin: -24 },
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 18px',
    background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
  },
  brandBlock: { display: 'flex', alignItems: 'center', gap: 8 },
  brandIcon: { fontSize: 20 },
  tabBar: {
    display: 'flex', alignItems: 'flex-end', gap: 2,
    padding: '6px 10px 0', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
  },
  tab: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 8px',
    fontSize: 12, color: 'var(--text-2)', background: 'transparent',
    borderTop: '1px solid transparent', borderLeft: '1px solid transparent', borderRight: '1px solid transparent',
    borderTopLeftRadius: 4, borderTopRightRadius: 4, cursor: 'pointer',
    maxWidth: 200, minWidth: 100,
  },
  tabActive: {
    background: 'var(--bg-0)', color: 'var(--text-0)',
    borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)',
  },
  tabTitle: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tabClose: { color: 'var(--text-3)', fontSize: 14, padding: '0 4px' },
  newTabBtn: { padding: '4px 10px', fontSize: 14 },
  controls: {
    display: 'flex', gap: 6, alignItems: 'center',
    padding: '10px 14px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
  },
  credsBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 14px', background: 'var(--accent-soft)', borderBottom: '1px solid var(--border)',
  },
  credChip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '3px 8px', background: 'var(--bg-1)', borderRadius: 4, border: '1px solid var(--border)',
  },
  viewportContainer: { flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' },
  webview: { flex: 1, width: '100%', background: 'white' },

  // Floating action buttons - bottom-LEFT so they don't sit over Reddit's Post button (bottom-right).
  fabStack: {
    position: 'absolute', bottom: 24, left: 24,
    display: 'flex', flexDirection: 'column', gap: 10,
    zIndex: 20,
  },
  fab: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 16px',
    background: 'var(--accent)', color: '#1a0d08', border: '1px solid var(--accent)',
    borderRadius: 999, fontWeight: 600, fontSize: 13,
    boxShadow: '0 4px 14px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1) inset',
    cursor: 'pointer',
  },
  fabIcon: { fontSize: 16 },
  fabLabel: { fontFamily: 'var(--font-body)' },

  sidePanel: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: '55%', minWidth: 480, maxWidth: 760,
    background: 'var(--bg-0)', borderLeft: '1px solid var(--border)',
    boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
    display: 'flex', flexDirection: 'column',
    zIndex: 30,
  },
  sidePanelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 18px',
    background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
  },
  sidePanelClose: {
    width: 28, height: 28, padding: 0, fontSize: 18, lineHeight: 1,
    background: 'transparent', border: 'none', color: 'var(--text-2)',
  },
  sidePanelBody: {
    flex: 1, overflow: 'auto', padding: 20,
  },
};
