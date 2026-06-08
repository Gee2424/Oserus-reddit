import React, { useEffect, useRef, useState, useMemo } from 'react';
import logoUrl from '../assets/logo.png';

// Chrome UI for an Oserus Browser window. Frameless host — the tab
// strip IS the title bar (drag region). Layout below the tab strip:
// omnibox row (back/forward/reload + URL + actions), then bookmarks
// bar (one-click quick-launch). Tab content is rendered by native
// WebContentsView children of the host BrowserWindow (see browser.js).
//
// CHROME_HEIGHT and SIDEBAR_WIDTH must stay in sync with browser.js.

const TAB_STRIP_HEIGHT  = 36;
const CHROME_ROW_HEIGHT = 40;
const BOOKMARKS_HEIGHT  = 32;
const CHROME_HEIGHT     = TAB_STRIP_HEIGHT + CHROME_ROW_HEIGHT + BOOKMARKS_HEIGHT; // 108
const FIND_BAR_HEIGHT   = 36;
const SIDEBAR_WIDTH     = 340;

// We render our own min/max/close in the chrome, so no native button
// reservation needed. Small pad keeps active tab from kissing the edge.
const NATIVE_BUTTONS_W  = 144;

// Quick-launch bookmarks — same set as AdsPower's default bar.
// Favicons fetched from Google's S2 service so we don't ship any assets.
const BOOKMARKS = [
  { label: 'Google',    url: 'https://www.google.com',    domain: 'google.com'    },
  { label: 'Reddit',    url: 'https://www.reddit.com',    domain: 'reddit.com'    },
  { label: 'X',         url: 'https://x.com',             domain: 'x.com'         },
  { label: 'Instagram', url: 'https://www.instagram.com', domain: 'instagram.com' },
  { label: 'TikTok',    url: 'https://www.tiktok.com',    domain: 'tiktok.com'    },
  { label: 'Facebook',  url: 'https://www.facebook.com',  domain: 'facebook.com'  },
  { label: 'YouTube',   url: 'https://www.youtube.com',   domain: 'youtube.com'   },
  { label: 'Discord',   url: 'https://discord.com',       domain: 'discord.com'   },
  { label: 'Amazon',    url: 'https://www.amazon.com',    domain: 'amazon.com'    },
  { label: 'PayPal',    url: 'https://www.paypal.com',    domain: 'paypal.com'    },
  { label: 'LinkedIn',  url: 'https://www.linkedin.com',  domain: 'linkedin.com'  },
  { label: 'OnlyFans',  url: 'https://onlyfans.com',      domain: 'onlyfans.com'  },
];

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
    // Guard the bridge — if preload failed to expose oserusBrowser, the
    // chrome should still render statically rather than crash silently.
    const api = window.oserusBrowser;
    if (!api) {
      // eslint-disable-next-line no-console
      console.error('[oserus-chrome] window.oserusBrowser missing — preload did not load');
      return;
    }
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
    api.onState(onState);
    api.onFindResult(onFindResult);
    api.onFocusOmnibox(onFocusOmni);
    api.onFocusFind(onFocusFind);
    api.tabsReady();
    return () => {
      api.offState(onState);
      api.offFindResult(onFindResult);
      api.offFocusOmnibox(onFocusOmni);
      api.offFocusFind(onFocusFind);
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
  function goBookmark(url, e) {
    if (e && (e.ctrlKey || e.metaKey || e.button === 1)) {
      window.oserusBrowser.newTab(url);
    } else {
      window.oserusBrowser.navigate(url);
    }
  }

  return (
    <div className="oserus-chrome" style={page}>
      {/* TAB STRIP — frameless title bar. Drag region covers the bar
          background; tabs and buttons opt out via no-drag. */}
      <div style={tabStrip}>
        <div style={brandMark} title="Oserus Browser">
          <img src={logoUrl} alt="Oserus" style={brandLogo} draggable={false} />
        </div>
        <div style={tabsScroll}>
          {tabs.map((t) => {
            const isActive = t.id === activeId;
            return (
              <div
                key={t.id}
                onClick={() => window.oserusBrowser.switchTab(t.id)}
                // Middle-click closes the tab (Chrome / Firefox standard).
                // mousedown preventDefault stops the browser's autoscroll
                // cursor from showing on middle-click.
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.oserusBrowser.closeTab(t.id);
                  }
                }}
                style={{ ...tabStyle, ...(isActive ? tabActive : {}) }}
                title={t.url || t.title}
              >
                {t.loading
                  ? <span style={spinner} />
                  : t.favicon
                    ? <img src={t.favicon} alt="" width={14} height={14} style={favicon} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    : <span style={faviconDot} />}
                <span style={tabTitle}>{t.title || t.url || 'New Tab'}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); window.oserusBrowser.closeTab(t.id); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={closeBtn}
                  title="Close tab"
                >×</button>
              </div>
            );
          })}
          <button onClick={() => window.oserusBrowser.newTab()} style={addBtn} title="New tab (Ctrl+T)">+</button>
        </div>
        {/* Spacer fills the rest of the title bar with drag region. */}
        <div style={tabStripDragFill} />
        {/* Custom window controls — frameless window has no native ones. */}
        <div style={windowCtrls}>
          <button style={ctrlBtn} title="Minimize" onClick={() => window.oserusBrowser.windowMinimize()}>—</button>
          <button style={ctrlBtn} title="Maximize" onClick={() => window.oserusBrowser.windowMaximize()}>▢</button>
          <button data-ob-close="1" style={ctrlClose} title="Close" onClick={() => window.oserusBrowser.windowClose()}>×</button>
        </div>
      </div>

      {/* CHROME ROW — back/forward/reload, omnibox, actions */}
      <div style={chromeRow}>
        <button style={navBtn} disabled={!active?.canBack}    onClick={() => window.oserusBrowser.back()}    title="Back">‹</button>
        <button style={navBtn} disabled={!active?.canForward} onClick={() => window.oserusBrowser.forward()} title="Forward">›</button>
        <button style={navBtn} onClick={() => window.oserusBrowser.reload()} title="Reload (Ctrl+R)">↻</button>
        <button style={navBtn} onClick={() => window.oserusBrowser.navigate('https://www.google.com')} title="Home">⌂</button>
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

      {/* BOOKMARKS BAR — quick-launch site icons */}
      <div style={bookmarksBar}>
        {BOOKMARKS.map((b) => (
          <button
            key={b.domain}
            onClick={(e) => goBookmark(b.url, e)}
            onAuxClick={(e) => { if (e.button === 1) goBookmark(b.url, e); }}
            style={bookmarkBtn}
            title={`${b.label} — ${b.url}`}
          >
            <img
              src={`https://www.google.com/s2/favicons?domain=${b.domain}&sz=32`}
              alt=""
              width={16}
              height={16}
              style={{ borderRadius: 2, flexShrink: 0 }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <span style={bookmarkLabel}>{b.label}</span>
          </button>
        ))}
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
      {sidebarOpen && (
        <ContentSidebar
          accountPlatform={winInfo.platform}
          chromeTop={CHROME_HEIGHT + (findOpen ? FIND_BAR_HEIGHT : 0)}
        />
      )}
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

// Oserus brand palette — mirrors the management app's :root tokens in
// global.css exactly, so the browser window reads as the same product
// rather than a sibling app. If you retint the management app, retint
// here too (or refactor both to consume the same CSS vars).
const BRAND = {
  bg0:          '#07090a', // var(--bg-0)
  bg1:          '#0c100f', // var(--bg-1)
  bg2:          '#121815', // var(--bg-2)
  bg3:          '#1a221d', // var(--bg-3)
  bgElev:       '#0e1311', // var(--bg-elev)
  border:       '#1c241f', // var(--border)
  borderStrong: '#2a342b', // var(--border-strong)
  bg4:          '#2a342b', // alias for legacy refs
  text0:        '#e6e3d2', // var(--text-0)
  text1:        '#bdbaa6', // var(--text-1)
  text2:        '#8a8a7d', // var(--text-2)
  text3:        '#5a5b54', // var(--text-3)
  green:        '#3d6b4f', // var(--green)
  greenBright:  '#4f8a64', // var(--green-bright)
  gold:         '#d4a64a', // var(--gold)
  goldBright:   '#e8c068', // var(--gold-bright)
  goldOrange:   '#e89146', // var(--gold-orange)
  blue:         '#3a6f8c', // var(--blue)
  blueBright:   '#6aa6c4', // var(--blue-bright)  — everyday accent
  danger:       '#b3473a', // var(--danger)
};
const BRAND_GRADIENT = `linear-gradient(135deg, ${BRAND.green} 0%, ${BRAND.greenBright} 30%, ${BRAND.gold} 70%, ${BRAND.goldOrange} 100%)`;
const BRAND_GRADIENT_H = `linear-gradient(90deg, ${BRAND.green} 0%, ${BRAND.greenBright} 28%, ${BRAND.gold} 72%, ${BRAND.goldOrange} 100%)`;

const page = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100vh',
  background: BRAND.bg0, overflow: 'hidden', color: BRAND.text0,
  fontFamily: "'Inter Tight', system-ui, sans-serif",
};

const tabStrip = {
  display: 'flex', alignItems: 'flex-end',
  height: TAB_STRIP_HEIGHT,
  paddingLeft: 6, paddingRight: 0,
  background: BRAND.bg1,
  borderBottom: '1px solid rgba(0,0,0,0.4)',
  WebkitAppRegion: 'drag',
  flexShrink: 0,
};
const brandMark = {
  display: 'flex', alignItems: 'center',
  padding: '0 14px 0 8px', height: TAB_STRIP_HEIGHT,
  flexShrink: 0,
};
const brandLogo = {
  height: 22, width: 'auto', objectFit: 'contain',
  filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
  pointerEvents: 'none', userSelect: 'none',
};
const tabsScroll = {
  display: 'flex', alignItems: 'flex-end', gap: 2,
  flex: '0 1 auto', minWidth: 0,
  overflowX: 'auto', overflowY: 'hidden',
  WebkitAppRegion: 'no-drag',
  scrollbarWidth: 'none',
};
const tabStripDragFill = { flex: 1, alignSelf: 'stretch' }; // stays drag

const windowCtrls = {
  display: 'flex', alignItems: 'stretch',
  height: TAB_STRIP_HEIGHT, flexShrink: 0,
  WebkitAppRegion: 'no-drag',
};
const ctrlBtn = {
  width: 46, height: TAB_STRIP_HEIGHT, lineHeight: 1,
  background: 'transparent', color: BRAND.text1, fontSize: 14,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const ctrlClose = {
  width: 46, height: TAB_STRIP_HEIGHT, lineHeight: 1,
  background: 'transparent', color: BRAND.text1, fontSize: 18,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const tabStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  height: 30, padding: '0 10px 0 10px',
  minWidth: 140, maxWidth: 240,
  background: BRAND.bg2,
  borderRadius: '8px 8px 0 0',
  fontSize: 12, color: BRAND.text2,
  flexShrink: 0,
  WebkitAppRegion: 'no-drag',
  position: 'relative',
  cursor: 'pointer',
};
const tabActive = {
  background: BRAND.bg3,
  color: BRAND.text0,
  // Top-edge gradient stripe announces the active tab in brand colors.
  boxShadow: `inset 0 2px 0 0 ${BRAND.gold}, inset 0 0 0 1px rgba(212,166,74,0.12)`,
};
const tabTitle = {
  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const favicon = { borderRadius: 2, flexShrink: 0 };
const faviconDot = {
  width: 8, height: 8, borderRadius: 2,
  background: 'rgba(255,255,255,0.14)', flexShrink: 0,
};
const closeBtn = {
  width: 22, height: 22, borderRadius: 4, marginLeft: 4,
  background: 'transparent',
  color: BRAND.text2, fontSize: 16, lineHeight: 1, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  WebkitAppRegion: 'no-drag',
  flexShrink: 0,
};
const addBtn = {
  width: 30, height: 28, marginLeft: 4, marginBottom: 1,
  background: 'transparent',
  color: BRAND.text2, fontSize: 18, lineHeight: 1,
  borderRadius: 6,
  flexShrink: 0,
  WebkitAppRegion: 'no-drag',
};
const spinner = {
  width: 8, height: 8, borderRadius: '50%',
  background: BRAND.gold, flexShrink: 0,
};

const chromeRow = {
  display: 'flex', alignItems: 'center', gap: 6,
  height: CHROME_ROW_HEIGHT, padding: '0 12px',
  background: BRAND.bg3,
  borderBottom: '1px solid rgba(0,0,0,0.35)',
  flexShrink: 0,
};
const navBtn = {
  width: 30, height: 30, borderRadius: 6,
  background: 'transparent',
  color: BRAND.text0, fontSize: 16, lineHeight: 1,
  flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const navBtnActive = {
  background: BRAND.gold, color: BRAND.bg0,
};
const omniInput = {
  width: '100%', height: 30, padding: '0 14px', borderRadius: 15,
  background: BRAND.bg1,
  border: '1px solid rgba(255,255,255,0.06)',
  color: BRAND.text0, fontSize: 13,
};

// Bookmarks bar — Chrome-style row of small site chips. Tinted with
// a faint brand gradient on the top edge to anchor it under the chrome row.
const bookmarksBar = {
  display: 'flex', alignItems: 'center', gap: 2,
  height: BOOKMARKS_HEIGHT, padding: '0 8px',
  background: BRAND.bg2,
  borderTop: `1px solid ${BRAND.bg4}`,
  borderBottom: '1px solid rgba(0,0,0,0.45)',
  overflowX: 'auto', overflowY: 'hidden',
  scrollbarWidth: 'none',
  flexShrink: 0,
};
const bookmarkBtn = {
  display: 'flex', alignItems: 'center', gap: 6,
  height: 24, padding: '0 8px',
  background: 'transparent', borderRadius: 4,
  color: BRAND.text1, fontSize: 12,
  flexShrink: 0,
};
const bookmarkLabel = { whiteSpace: 'nowrap' };

const pickerPanel = {
  position: 'absolute', top: 34, right: 0,
  width: 260, maxHeight: 320, overflowY: 'auto',
  background: BRAND.bg2, border: `1px solid ${BRAND.bg4}`,
  borderRadius: 8, padding: 4, zIndex: 50,
  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
};
const pickerHead = { padding: '6px 8px', fontSize: 11, color: BRAND.text3, textTransform: 'uppercase', letterSpacing: 0.5 };
const pickerEmpty = { padding: '8px', fontSize: 12, color: BRAND.text3 };
const pickerItem = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  padding: '6px 8px', background: 'transparent',
  color: BRAND.text1, borderRadius: 4, fontSize: 12, textAlign: 'left',
};
const pickerItemActive = { background: 'rgba(212,166,74,0.08)', cursor: 'default' };
const pickerPlat = { fontSize: 10, color: BRAND.text3, textTransform: 'uppercase', minWidth: 60 };
const pickerUser = { flex: 1, color: BRAND.text0 };
const pickerDot  = { color: BRAND.gold, fontSize: 8 };

const findBar = {
  display: 'flex', alignItems: 'center', gap: 8,
  height: FIND_BAR_HEIGHT, padding: '0 10px',
  background: BRAND.bg2, borderBottom: '1px solid rgba(0,0,0,0.4)',
  flexShrink: 0,
};
const findInput = {
  flex: 1, height: 26, padding: '0 12px', borderRadius: 13,
  background: BRAND.bg1, border: '1px solid rgba(255,255,255,0.06)',
  color: BRAND.text0, fontSize: 12, outline: 'none',
};
const findCount = { fontSize: 11, color: BRAND.text3, minWidth: 36, textAlign: 'right' };
const findBtn = {
  width: 24, height: 24, borderRadius: 4, background: 'transparent',
  border: `1px solid ${BRAND.bg4}`, color: BRAND.text1,
  fontSize: 12, lineHeight: 1,
};

const sidebar = {
  position: 'fixed', right: 0, bottom: 0, width: SIDEBAR_WIDTH,
  background: BRAND.bg1,
  // Brand gradient as a 1px left edge — anchors the sidebar visually.
  borderLeft: `2px solid transparent`,
  borderImage: `${BRAND_GRADIENT} 1`,
  display: 'flex', flexDirection: 'column',
};
const sideHead = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderBottom: `1px solid ${BRAND.bg4}`,
};
const sideRefresh = {
  width: 22, height: 22, borderRadius: 4, background: 'transparent',
  border: `1px solid ${BRAND.bg4}`, color: BRAND.text1, fontSize: 12,
};
const platRow = {
  display: 'flex', gap: 4, padding: '6px 8px',
  borderBottom: `1px solid ${BRAND.bg4}`, overflowX: 'auto',
};
const platBtn = {
  padding: '4px 10px', borderRadius: 12,
  background: 'transparent', border: `1px solid ${BRAND.bg4}`,
  color: BRAND.text2, fontSize: 11,
  textTransform: 'capitalize', flexShrink: 0,
};
const platBtnActive = {
  background: BRAND.gold, color: BRAND.bg0, borderColor: BRAND.gold,
};
const sideBody = { flex: 1, overflowY: 'auto', padding: 10 };
const empty = { padding: 20, color: BRAND.text3, fontSize: 12, textAlign: 'center' };
const weekHead = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
  color: BRAND.text3, padding: '4px 2px 8px', position: 'sticky', top: 0,
  background: BRAND.bg1,
};
const card = {
  background: BRAND.bg2, border: `1px solid ${BRAND.bg4}`,
  borderRadius: 6, padding: 8, marginBottom: 6,
};
const cardTop = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 10 };
const cardTag = (source) => ({
  padding: '1px 6px', borderRadius: 3, fontSize: 9, textTransform: 'uppercase',
  background: source === 'scheduled' ? 'rgba(79,138,100,0.20)' : 'rgba(255,255,255,0.06)',
  color: source === 'scheduled' ? BRAND.greenBright : BRAND.text2,
});
const cardSub = { color: BRAND.text1, fontSize: 11 };
const cardStatus = (s) => ({
  padding: '1px 6px', borderRadius: 3, fontSize: 9, textTransform: 'uppercase',
  background: s === 'posted' ? 'rgba(79,138,100,0.20)'
    : s === 'failed' ? 'rgba(179,71,58,0.20)'
    : 'rgba(255,255,255,0.06)',
  color: s === 'posted' ? BRAND.greenBright : s === 'failed' ? '#d97462' : BRAND.text2,
  marginLeft: 'auto',
});
const cardTitle = { fontSize: 12, color: BRAND.text0, marginBottom: 2 };
const cardBody  = { fontSize: 11, color: BRAND.text1, marginBottom: 2 };
const cardUrl   = { fontSize: 10, color: BRAND.text3, wordBreak: 'break-all', marginBottom: 2 };
const cardWhen  = { fontSize: 10, color: BRAND.text3 };
