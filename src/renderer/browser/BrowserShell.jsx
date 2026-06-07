import React, { useEffect, useRef, useState, useMemo } from 'react';

// Chrome UI for an Oserus Browser window. Renders chrome bar (top),
// optional find bar (under chrome), and optional Content List sidebar
// (right). The actual web content is rendered by native WebContentsView
// children of the host BrowserWindow — see src/main/browser.js. We
// never embed a <webview>.
//
// Top chrome height must match CHROME_HEIGHT (78) in browser.js.
// Find bar height must match FIND_BAR_HEIGHT (36).
// Sidebar width must match SIDEBAR_WIDTH (340).

const CHROME_HEIGHT = 78;
const FIND_BAR_HEIGHT = 36;
const SIDEBAR_WIDTH = 340;

const PLATFORMS = ['reddit', 'x', 'instagram', 'tiktok', 'redgifs'];

export default function BrowserShell() {
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [omni, setOmni] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findResult, setFindResult] = useState({ active: 0, total: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [siblings, setSiblings] = useState([]);
  const [winInfo, setWinInfo] = useState({ accountId: null, platform: null });
  const omniRef = useRef(null);
  const findRef = useRef(null);

  const active = tabs.find((t) => t.id === activeId) || null;

  useEffect(() => {
    const onState = (s) => {
      setTabs(s.tabs || []);
      setActiveId(s.activeId ?? null);
      setSidebarOpen(!!s.sidebarOpen);
      setFindOpen(!!s.findOpen);
      setWinInfo({ accountId: s.accountId, platform: s.platform });
      const a = (s.tabs || []).find((t) => t.id === s.activeId);
      if (a && document.activeElement !== omniRef.current) setOmni(a.url || '');
    };
    const onFindResult = (r) => setFindResult(r || { active: 0, total: 0 });
    const onFocusOmni = () => { omniRef.current?.focus(); omniRef.current?.select(); };
    const onFocusFind = () => { findRef.current?.focus(); findRef.current?.select(); };
    window.oserusBrowser.onState(onState);
    window.oserusBrowser.onFindResult(onFindResult);
    window.oserusBrowser.onFocusOmnibox(onFocusOmni);
    window.oserusBrowser.onFocusFind(onFocusFind);
    window.oserusBrowser.tabsReady();
    return () => {
      window.oserusBrowser.offState(onState);
      window.oserusBrowser.offFindResult(onFindResult);
      window.oserusBrowser.offFocusOmnibox(onFocusOmni);
      window.oserusBrowser.offFocusFind(onFocusFind);
    };
  }, []);

  useEffect(() => {
    if (active && document.activeElement !== omniRef.current) setOmni(active.url || '');
  }, [active?.url]);

  function submitOmni(e) {
    e.preventDefault();
    window.oserusBrowser.navigate(omni);
    omniRef.current?.blur();
  }

  function submitFind(e) {
    e.preventDefault();
    window.oserusBrowser.find(findText, { forward: true, next: true });
  }

  async function openPicker() {
    setPickerOpen((v) => !v);
    if (!pickerOpen) {
      try {
        const r = await window.oserusBrowser.siblings();
        if (r?.ok) setSiblings(r.accounts || []);
      } catch {}
    }
  }

  return (
    <div style={page}>
      {/* TOP CHROME — tab strip + omnibox row */}
      <div style={topChrome}>
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
                {t.loading
                  ? <span style={spinner} />
                  : t.favicon
                    ? <img src={t.favicon} alt="" width={14} height={14} style={favicon} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    : <span style={faviconDot} />}
                <span style={tabTitle}>{t.title || t.url}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); window.oserusBrowser.closeTab(t.id); }}
                  style={closeBtn}
                  title="Close tab"
                >×</button>
              </div>
            );
          })}
          <button onClick={() => window.oserusBrowser.newTab()} style={addBtn} title="New tab (Ctrl+T)">+</button>
        </div>

        <div style={chromeRow}>
          <button style={navBtn} disabled={!active?.canBack}    onClick={() => window.oserusBrowser.back()}    title="Back">‹</button>
          <button style={navBtn} disabled={!active?.canForward} onClick={() => window.oserusBrowser.forward()} title="Forward">›</button>
          <button style={navBtn} onClick={() => window.oserusBrowser.reload()} title="Reload (Ctrl+R)">↻</button>
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

          {/* Profile picker */}
          <div style={{ position: 'relative' }}>
            <button style={navBtn} onClick={openPicker} title="Switch profile">⎘</button>
            {pickerOpen && (
              <div style={pickerPanel} onMouseLeave={() => setPickerOpen(false)}>
                <div style={pickerHead}>Switch account on this profile</div>
                {siblings.length === 0 && <div style={pickerEmpty}>No sibling accounts</div>}
                {siblings.map((a) => {
                  const isActive = a.id === winInfo.accountId;
                  return (
                    <button
                      key={a.id}
                      disabled={isActive}
                      onClick={() => { setPickerOpen(false); window.oserusBrowser.switchAccount(a.id); }}
                      style={{ ...pickerItem, ...(isActive ? pickerItemActive : {}) }}
                    >
                      <span style={pickerPlat}>{a.platform}</span>
                      <span style={pickerUser}>{a.username}</span>
                      {isActive && <span style={pickerDot}>●</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button style={navBtn} onClick={() => window.oserusBrowser.findOpen()} title="Find in page (Ctrl+F)">⌕</button>
          <button
            style={{ ...navBtn, ...(sidebarOpen ? navBtnActive : {}) }}
            onClick={() => window.oserusBrowser.setSidebar(!sidebarOpen)}
            title="Content list"
          >☰</button>
        </div>
      </div>

      {/* FIND BAR */}
      {findOpen && (
        <div style={findBar}>
          <form onSubmit={submitFind} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <input
              ref={findRef}
              value={findText}
              onChange={(e) => { setFindText(e.target.value); window.oserusBrowser.find(e.target.value); }}
              placeholder="Find in page"
              spellCheck={false}
              style={findInput}
            />
            <span style={findCount}>
              {findResult.total ? `${findResult.active}/${findResult.total}` : (findText ? '0/0' : '')}
            </span>
            <button type="button" style={findBtn} onClick={() => window.oserusBrowser.find(findText, { forward: false, next: true })}>‹</button>
            <button type="submit" style={findBtn}>›</button>
            <button type="button" style={findBtn} onClick={() => { setFindText(''); window.oserusBrowser.findClose(); }}>×</button>
          </form>
        </div>
      )}

      {/* SIDEBAR (Content List) */}
      {sidebarOpen && <ContentSidebar accountPlatform={winInfo.platform} chromeTop={CHROME_HEIGHT + (findOpen ? FIND_BAR_HEIGHT : 0)} />}
    </div>
  );
}

// ---------------------------------------------------------- Content Sidebar

function ContentSidebar({ accountPlatform, chromeTop }) {
  const [platform, setPlatform] = useState(accountPlatform || 'reddit');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setPlatform(accountPlatform || 'reddit'); }, [accountPlatform]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await window.oserusBrowser.contentList(platform);
      if (r?.ok) setItems(r.items || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [platform]);

  const grouped = useMemo(() => {
    const out = new Map();
    for (const it of items) {
      const d = it.scheduled_for || it.created_at || '';
      const week = weekKey(d);
      if (!out.has(week)) out.set(week, []);
      out.get(week).push(it);
    }
    return Array.from(out.entries());
  }, [items]);

  return (
    <div style={{ ...sidebar, top: chromeTop }}>
      <div style={sideHead}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>Content List</span>
        <button style={sideRefresh} onClick={refresh} title="Refresh">↻</button>
      </div>
      <div style={platRow}>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            style={{ ...platBtn, ...(p === platform ? platBtnActive : {}) }}
          >{p}</button>
        ))}
      </div>
      <div style={sideBody}>
        {loading && <div style={empty}>Loading…</div>}
        {!loading && grouped.length === 0 && <div style={empty}>No content uploaded for this account.</div>}
        {grouped.map(([week, list]) => (
          <div key={week} style={{ marginBottom: 14 }}>
            <div style={weekHead}>{week}</div>
            {list.map((it) => (
              <div key={`${it.source}-${it.id}`} style={card}>
                <div style={cardTop}>
                  <span style={cardTag(it.source)}>{it.source}</span>
                  {it.subreddit && <span style={cardSub}>r/{it.subreddit}</span>}
                  {it.status && <span style={cardStatus(it.status)}>{it.status}</span>}
                </div>
                <div style={cardTitle}>{it.title || '(no title)'}</div>
                {it.body && <div style={cardBody}>{it.body.slice(0, 140)}{it.body.length > 140 ? '…' : ''}</div>}
                {it.url && <div style={cardUrl}>{it.url}</div>}
                <div style={cardWhen}>{fmtWhen(it.scheduled_for || it.created_at)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- utilities

function weekKey(iso) {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Undated';
  const day = d.getUTCDay();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7)));
  return `Week of ${monday.toISOString().slice(0, 10)}`;
}
function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// ------------------------------------------------------------------- styles

const page = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100vh',
  background: 'transparent', overflow: 'hidden', pointerEvents: 'none',
};
const topChrome = {
  display: 'flex', flexDirection: 'column',
  height: CHROME_HEIGHT, background: 'var(--bg-1)',
  pointerEvents: 'auto',
};
const tabStrip = {
  display: 'flex', alignItems: 'flex-end', gap: 2,
  height: 32, padding: '4px 6px 0',
  background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
  overflowX: 'auto', overflowY: 'hidden',
};
const tabStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  height: 26, padding: '0 10px', minWidth: 120, maxWidth: 220,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border)', borderBottom: 'none',
  borderRadius: '6px 6px 0 0',
  cursor: 'pointer', fontSize: 12, color: 'var(--text-2)',
  flexShrink: 0,
};
const tabActive = {
  background: 'var(--bg-0)', color: 'var(--text-0)',
  borderColor: 'var(--border-strong)',
};
const tabTitle = {
  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const favicon = { borderRadius: 2, flexShrink: 0 };
const faviconDot = {
  width: 8, height: 8, borderRadius: 2,
  background: 'rgba(255,255,255,0.12)', flexShrink: 0,
};
const closeBtn = {
  width: 16, height: 16, borderRadius: 3,
  background: 'transparent', border: 'none',
  color: 'var(--text-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
};
const addBtn = {
  width: 26, height: 24, borderRadius: 4, marginBottom: 1,
  background: 'transparent', border: '1px dashed var(--border)',
  color: 'var(--text-2)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
  flexShrink: 0,
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
  color: 'var(--text-1)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
  flexShrink: 0,
};
const navBtnActive = {
  background: 'var(--gold)', color: '#0d0c0a', borderColor: 'var(--gold)',
};
const omniInput = {
  width: '100%', height: 28, padding: '0 12px', borderRadius: 14,
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  color: 'var(--text-0)', fontFamily: 'var(--font-mono)', fontSize: 12,
  outline: 'none',
};

const pickerPanel = {
  position: 'absolute', top: 32, right: 0,
  width: 260, maxHeight: 320, overflowY: 'auto',
  background: 'var(--bg-0)', border: '1px solid var(--border-strong)',
  borderRadius: 8, padding: 4, zIndex: 50,
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
};
const pickerHead = { padding: '6px 8px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 };
const pickerEmpty = { padding: '8px', fontSize: 12, color: 'var(--text-3)' };
const pickerItem = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  padding: '6px 8px', background: 'transparent', border: 'none',
  color: 'var(--text-1)', cursor: 'pointer', borderRadius: 4, fontSize: 12,
  textAlign: 'left',
};
const pickerItemActive = { background: 'rgba(255,255,255,0.04)', cursor: 'default' };
const pickerPlat = { fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', minWidth: 60 };
const pickerUser = { flex: 1, color: 'var(--text-0)' };
const pickerDot  = { color: 'var(--gold)', fontSize: 8 };

const findBar = {
  display: 'flex', alignItems: 'center', gap: 8,
  height: FIND_BAR_HEIGHT, padding: '0 10px',
  background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)',
  pointerEvents: 'auto',
};
const findInput = {
  flex: 1, height: 24, padding: '0 10px', borderRadius: 12,
  background: 'var(--bg-0)', border: '1px solid var(--border)',
  color: 'var(--text-0)', fontSize: 12, outline: 'none',
};
const findCount = { fontSize: 11, color: 'var(--text-3)', minWidth: 36, textAlign: 'right' };
const findBtn = {
  width: 22, height: 22, borderRadius: 4, background: 'transparent',
  border: '1px solid var(--border)', color: 'var(--text-1)',
  cursor: 'pointer', fontSize: 12, lineHeight: 1,
};

const sidebar = {
  position: 'fixed', right: 0, bottom: 0, width: SIDEBAR_WIDTH,
  background: 'var(--bg-1)', borderLeft: '1px solid var(--border)',
  display: 'flex', flexDirection: 'column',
  pointerEvents: 'auto',
};
const sideHead = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderBottom: '1px solid var(--border)',
};
const sideRefresh = {
  width: 22, height: 22, borderRadius: 4, background: 'transparent',
  border: '1px solid var(--border)', color: 'var(--text-1)',
  cursor: 'pointer', fontSize: 12,
};
const platRow = {
  display: 'flex', gap: 4, padding: '6px 8px',
  borderBottom: '1px solid var(--border)', overflowX: 'auto',
};
const platBtn = {
  padding: '4px 10px', borderRadius: 12,
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text-2)', cursor: 'pointer', fontSize: 11,
  textTransform: 'capitalize', flexShrink: 0,
};
const platBtnActive = { background: 'var(--gold)', color: '#0d0c0a', borderColor: 'var(--gold)' };
const sideBody = { flex: 1, overflowY: 'auto', padding: 10 };
const empty = { padding: 20, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' };
const weekHead = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
  color: 'var(--text-3)', padding: '4px 2px 8px', position: 'sticky', top: 0,
  background: 'var(--bg-1)',
};
const card = {
  background: 'var(--bg-0)', border: '1px solid var(--border)',
  borderRadius: 6, padding: 8, marginBottom: 6,
};
const cardTop = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 10 };
const cardTag = (source) => ({
  padding: '1px 6px', borderRadius: 3, fontSize: 9, textTransform: 'uppercase',
  background: source === 'scheduled' ? 'rgba(122,154,90,0.18)' : 'rgba(255,255,255,0.06)',
  color: source === 'scheduled' ? '#9bbf6f' : 'var(--text-2)',
});
const cardSub = { color: 'var(--text-2)', fontSize: 11 };
const cardStatus = (s) => ({
  padding: '1px 6px', borderRadius: 3, fontSize: 9, textTransform: 'uppercase',
  background: s === 'posted' ? 'rgba(122,154,90,0.18)'
    : s === 'failed' ? 'rgba(179,71,58,0.18)'
    : 'rgba(255,255,255,0.06)',
  color: s === 'posted' ? '#9bbf6f' : s === 'failed' ? '#d97462' : 'var(--text-2)',
  marginLeft: 'auto',
});
const cardTitle = { fontSize: 12, color: 'var(--text-0)', marginBottom: 2 };
const cardBody  = { fontSize: 11, color: 'var(--text-2)', marginBottom: 2 };
const cardUrl   = { fontSize: 10, color: 'var(--text-3)', wordBreak: 'break-all', marginBottom: 2 };
const cardWhen  = { fontSize: 10, color: 'var(--text-3)' };
