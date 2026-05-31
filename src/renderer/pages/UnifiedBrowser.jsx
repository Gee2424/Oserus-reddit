import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';

// Unified Browser — single page that browses every platform (Reddit, RedGIFs,
// X, Instagram, TikTok) using the per-account persist:<partition> session.
// Each open tab carries its own (platform, accountId, partitionKey, url) so
// you can have a Reddit account in one tab next to a TikTok account in
// another, all on the same screen.

const PLATFORMS = [
  { v: 'reddit',    label: 'Reddit',    color: '#ff4500', home: 'https://www.reddit.com/' },
  { v: 'redgifs',   label: 'RedGIFs',   color: '#ff2e74', home: 'https://www.redgifs.com/' },
  { v: 'x',         label: 'X',         color: '#1d9bf0', home: 'https://x.com/home' },
  { v: 'instagram', label: 'Instagram', color: '#e1306c', home: 'https://www.instagram.com/' },
  { v: 'tiktok',    label: 'TikTok',    color: '#25f4ee', home: 'https://www.tiktok.com/foryou' },
];
const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((p) => [p.v, p]));

let tabIdSeed = 1;
function newTabId() { return tabIdSeed++; }

export default function UnifiedBrowser({ navigate, defaultPlatform }) {
  const { token } = useAuth();
  const [allAccounts, setAllAccounts] = useState([]);
  const [platform, setPlatform] = useState(defaultPlatform && PLATFORM_MAP[defaultPlatform] ? defaultPlatform : 'reddit');
  const [tabs, setTabs] = useState([]);   // { id, platform, accountId, partitionKey, username, url }
  const [activeTabId, setActiveTabId] = useState(null);
  const [inputUrl, setInputUrl] = useState('');
  const webviewRefs = useRef({});

  useEffect(() => {
    window.api.accounts.listForUser({ token }).then((r) => {
      if (r.ok) setAllAccounts(r.accounts || []);
    });
  }, [token]);

  const accountsForPlatform = useMemo(
    () => allAccounts.filter((a) => (a.platform || 'reddit') === platform),
    [allAccounts, platform]
  );
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) || null,
    [tabs, activeTabId]
  );

  async function openAccount(account) {
    // Reuse an existing tab for the same account if there is one — otherwise
    // call session:prepareForAccount (UA + proxy) and spin up a new tab.
    const existing = tabs.find((t) => t.accountId === account.id);
    if (existing) {
      setActiveTabId(existing.id);
      setInputUrl(existing.url);
      return;
    }
    const prep = await window.api.session.prepareForAccount({ accountId: account.id });
    if (!prep.ok) return;
    const home = PLATFORM_MAP[account.platform || 'reddit']?.home || 'about:blank';
    const t = {
      id: newTabId(),
      platform: account.platform || 'reddit',
      accountId: account.id,
      partitionKey: prep.partitionKey,
      username: account.username,
      url: home,
    };
    setTabs((p) => [...p, t]);
    setActiveTabId(t.id);
    setInputUrl(t.url);
  }

  function closeTab(id) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId) {
        const fallback = next[next.length - 1] || null;
        setActiveTabId(fallback ? fallback.id : null);
        setInputUrl(fallback ? fallback.url : '');
      }
      return next;
    });
  }

  function go() {
    if (!activeTab) return;
    let u = inputUrl.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    const wv = webviewRefs.current[activeTabId];
    if (wv) wv.loadURL(u);
    setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, url: u } : t));
  }

  useEffect(() => {
    const wv = webviewRefs.current[activeTabId];
    if (!wv) return;
    const onNav = (e) => {
      const url = e?.url || wv.getURL?.() || '';
      setInputUrl(url);
      setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, url } : t));
    };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    return () => {
      try { wv.removeEventListener('did-navigate', onNav); } catch {}
      try { wv.removeEventListener('did-navigate-in-page', onNav); } catch {}
    };
  }, [activeTabId, tabs.length]);

  function popoutCurrent() {
    if (!activeTab) return;
    window.api.windows.openAccountBrowser({ accountId: activeTab.accountId, url: activeTab.url });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 30px)', minHeight: 0 }}>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Browser</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            One window. Every account. Every platform. Each tab keeps its own
            cookies via its dedicated session partition.
          </div>
        </div>
      </div>

      {/* Platform pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {PLATFORMS.map((p) => {
          const active = platform === p.v;
          return (
            <button
              key={p.v}
              onClick={() => setPlatform(p.v)}
              style={{
                background: active ? p.color : 'var(--bg-1)',
                color: active ? '#fff' : 'var(--text-1)',
                border: `1px solid ${active ? p.color : 'var(--border)'}`,
                borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color }} />
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Account chips for current platform */}
      <div className="card" style={{ padding: 10, marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span className="dim" style={{ fontSize: 11, marginRight: 4 }}>Open as:</span>
        {accountsForPlatform.length === 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>
            No {PLATFORM_MAP[platform].label} accounts yet.
            {navigate && <button className="ghost" onClick={() => navigate('add-accounts')} style={{ marginLeft: 8, fontSize: 11, padding: '3px 10px' }}>+ Add</button>}
          </span>
        ) : accountsForPlatform.map((a) => {
          const open = tabs.some((t) => t.accountId === a.id);
          return (
            <button
              key={a.id}
              onClick={() => openAccount(a)}
              title={`Open ${a.username} in a new tab`}
              style={{
                background: open ? 'var(--bg-2)' : 'var(--bg-1)',
                border: `1px solid ${open ? PLATFORM_MAP[platform].color : 'var(--border)'}`,
                borderRadius: 999, padding: '4px 10px',
                fontSize: 11, color: 'var(--text-1)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: PLATFORM_MAP[platform].color }} />
              {a.username}
              {a.status === 'banned' && <span style={{ fontSize: 9, color: '#e2a3a3' }}>banned</span>}
            </button>
          );
        })}
        {accountsForPlatform.length > 1 && (
          <button
            className="ghost"
            onClick={async () => {
              for (const a of accountsForPlatform) {
                if (!tabs.some((t) => t.accountId === a.id)) await openAccount(a);
              }
            }}
            style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 12px' }}
          >▶ Open all {accountsForPlatform.length}</button>
        )}
      </div>

      {/* Tab bar */}
      {tabs.length > 0 && (
        <>
          <div style={styles.tabBar}>
            {tabs.map((t) => (
              <div
                key={t.id}
                onClick={() => { setActiveTabId(t.id); setInputUrl(t.url); }}
                style={{ ...styles.tab, ...(activeTabId === t.id ? styles.tabActive : {}) }}
                title={`${t.platform} · ${t.username}\n${t.url}`}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: PLATFORM_MAP[t.platform]?.color || '#888', flexShrink: 0 }} />
                <span style={styles.tabTitle}>{t.username}</span>
                <span onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} style={styles.tabClose}>×</span>
              </div>
            ))}
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
            <button className="ghost" onClick={popoutCurrent} title="Pop this tab out into its own window">⧉ Pop out</button>
          </div>
        </>
      )}

      {/* Webview surface */}
      <div style={{ flex: 1, position: 'relative', background: '#0a0a0b', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border)', minHeight: 320 }}>
        {tabs.length === 0 ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
            <div>
              <div style={{ fontSize: 40, marginBottom: 8 }}>{PLATFORM_MAP[platform].label.charAt(0)}</div>
              <div style={{ fontSize: 14 }}>Pick a {PLATFORM_MAP[platform].label} account above to start browsing.</div>
            </div>
          </div>
        ) : tabs.map((t) => (
          <webview
            key={t.id}
            ref={(el) => { if (el) webviewRefs.current[t.id] = el; }}
            partition={`persist:${t.partitionKey}`}
            src={t.url}
            style={{
              position: 'absolute', inset: 0,
              display: activeTabId === t.id ? 'flex' : 'none',
              border: 'none', background: '#0a0a0b',
            }}
            allowpopups="true"
          />
        ))}
      </div>
    </div>
  );
}

const styles = {
  tabBar: {
    display: 'flex', gap: 4, background: 'var(--bg-2)',
    borderRadius: '8px 8px 0 0', padding: 4, borderBottom: '1px solid var(--border)',
    overflowX: 'auto', flexWrap: 'nowrap',
  },
  tab: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', background: 'var(--bg-1)',
    border: '1px solid transparent', borderRadius: 6,
    fontSize: 12, color: 'var(--text-2)', cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  tabActive: {
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)', color: 'var(--text-0)',
    fontWeight: 600,
  },
  tabTitle: { maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' },
  tabClose: { opacity: 0.6, fontSize: 14, padding: '0 2px' },
  controls: {
    display: 'flex', gap: 6, padding: '8px 10px',
    background: 'var(--bg-2)', borderBottom: '1px solid var(--border)',
    alignItems: 'center',
  },
};
