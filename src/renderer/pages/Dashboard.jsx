import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Avatar, Tag, StatusPill, StatTile } from '../components/ui.jsx';
import PopOutButton from '../components/PopOutButton.jsx';
import { platformColor, platformShort } from '../lib/platforms.js';
import { useInboxLive } from '../lib/inboxLive.jsx';

function fmt(n) { return n == null ? '—' : n.toLocaleString(); }
function ageFromIso(s) {
  if (!s) return '—';
  try {
    const t = new Date(s.replace(' ', 'T') + 'Z').getTime();
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days < 1) return '<1d';
    if (days < 365) return `${days}d`;
    return `${Math.floor(days / 365)}y${days % 365 ? ` ${days % 365}d` : ''}`;
  } catch { return '—'; }
}

// Composite account-health score 0-100. Inputs: status, proxy test result,
// karma totals, account age. Returned tier drives the colored pill in the row.
function accountHealth(a) {
  if (a.status === 'banned') return { score: 0, tier: 'bad', label: 'Banned', reasons: ['Account banned'] };
  let score = 100;
  const reasons = [];
  if (a.proxy_test_ok === 0) { score -= 35; reasons.push('Proxy failing'); }
  else if (!a.proxy_label) { score -= 10; reasons.push('No proxy'); }
  if (a.status === 'warming') { score -= 10; reasons.push('Warming'); }
  const totalK = (a.post_karma || 0) + (a.comment_karma || 0);
  if (totalK < 50) { score -= 20; reasons.push('Low karma'); }
  else if (totalK < 250) { score -= 8; reasons.push('Building karma'); }
  if (a.created_at) {
    try {
      const days = Math.floor((Date.now() - new Date(a.created_at.replace(' ', 'T') + 'Z').getTime()) / 86400000);
      if (days < 30) { score -= 12; reasons.push('New account'); }
    } catch {}
  }
  score = Math.max(0, Math.min(100, score));
  const tier = score >= 75 ? 'good' : score >= 45 ? 'warn' : 'bad';
  const label = tier === 'good' ? 'Healthy' : tier === 'warn' ? 'At Risk' : 'Critical';
  return { score, tier, label, reasons };
}

export default function DashboardPage({ navigate }) {
  const { token, user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  // Model rows act as dropdowns — click toggles expansion. Default expanded so
  // first-time use isn't empty. Persist per-session in localStorage.
  const [collapsedModels, setCollapsedModels] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dash_collapsed_models') || '[]')); }
    catch { return new Set(); }
  });
  function toggleModel(pid) {
    setCollapsedModels((s) => {
      const next = new Set(s);
      next.has(pid) ? next.delete(pid) : next.add(pid);
      try { localStorage.setItem('dash_collapsed_models', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  const [templates, setTemplates] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [showProxyModal, setShowProxyModal] = useState(false);

  async function load() {
    setLoading(true);
    const [a, sum, tpl, px] = await Promise.all([
      window.api.accounts.listForUser({ token }),
      window.api.analytics.summary({ token }).catch(() => ({ ok: false })),
      window.api.templates.list({ token }).catch(() => ({ ok: false })),
      window.api.proxies.list({ token }).catch(() => ({ ok: false })),
    ]);
    const base = a.ok ? a.accounts : [];
    const karma = {};
    if (sum.ok && sum.accounts) for (const s of sum.accounts) karma[s.id] = s;
    setAccounts(base.map((x) => ({ ...x, ...(karma[x.id] || {}) })));
    setTemplates(tpl.ok ? (tpl.templates || []) : []);
    setProxies(px.ok ? (px.proxies || []) : []);
    setLoading(false);
  }

  async function applyProxy(proxyId) {
    const res = await window.api.accounts.bulkSetProxy({ token, accountIds: [...selected], proxyId });
    if (res.ok) { setShowProxyModal(false); load(); }
  }

  // Account → list of templates that include it (for the Pro Schedule column).
  const templatesByAccount = useMemo(() => {
    const m = new Map();
    for (const t of templates) for (const aid of t.accountIds || []) {
      if (!m.has(aid)) m.set(aid, []);
      m.get(aid).push(t);
    }
    return m;
  }, [templates]);

  async function toggleStarred() {
    if (selected.size === 0) return;
    // If any selected isn't starred, star all; otherwise unstar all.
    const sel = accounts.filter((a) => selected.has(a.id));
    const anyUnstarred = sel.some((a) => !a.starred);
    const res = await window.api.accounts.setStarred({ token, accountIds: [...selected], starred: anyUnstarred });
    if (res.ok) load();
  }
  useEffect(() => { load(); }, []);

  const reddit = accounts.filter((a) => (a.platform || 'reddit') === 'reddit');
  const totals = useMemo(() => ({
    total: reddit.length,
    live: reddit.filter((a) => a.status === 'ready').length,
    warming: reddit.filter((a) => a.status === 'warming').length,
    banned: reddit.filter((a) => a.status === 'banned').length,
  }), [reddit]);

  const classes = useMemo(() => {
    const m = new Map();
    for (const a of reddit) if (a.profile_id) m.set(a.profile_id, a.profile_name || `Class ${a.profile_id}`);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [reddit]);

  // Models row — one row per profile_id. Holds counts AND the underlying
  // account list so the ▶ play button can open every account at once and the
  // row can show the username chips inline.
  const models = useMemo(() => {
    const m = new Map();
    for (const a of accounts) {
      const pid = a.profile_id;
      if (!pid) continue;
      if (!m.has(pid)) m.set(pid, {
        id: pid, name: a.profile_name || `Model ${pid}`,
        total: 0, live: 0, banned: 0, proxyBad: 0,
        mainEmail: a.profile_main_email || null,
        accountsList: [],
      });
      const row = m.get(pid);
      row.total += 1;
      row.accountsList.push(a);
      if (a.status === 'ready') row.live += 1;
      if (a.status === 'banned') row.banned += 1;
      if (a.proxy_test_ok === 0) row.proxyBad += 1;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [accounts]);

  function openAllForModel(model) {
    // Browser page now hosts the tabbed launcher inline, so ▶ on a model row
    // just routes there with this model selected — no popout window.
    navigate('browser', { modelId: model.id });
  }

  const filtered = useMemo(() => {
    let r = reddit;
    if (statusFilter !== 'all') r = r.filter((a) => a.status === statusFilter);
    if (classFilter !== 'all') r = r.filter((a) => String(a.profile_id) === String(classFilter));
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((a) => `${a.username} ${a.profile_name} ${a.proxy_label || ''}`.toLowerCase().includes(q));
    return r;
  }, [reddit, statusFilter, classFilter, search]);

  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  async function bulkSetStatus(status) {
    if (selected.size === 0) return;
    setStatusMenuOpen(false);
    const res = await window.api.accounts.bulkSetStatus({ token, accountIds: [...selected], status });
    if (res.ok) load();
  }
  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} account${selected.size === 1 ? '' : 's'}? This cannot be undone — sessions and scheduled posts will also be removed.`)) return;
    const res = await window.api.accounts.bulkDelete({ token, accountIds: [...selected] });
    if (res.ok) { setSelected(new Set()); load(); }
  }

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((s) => s.size === filtered.length ? new Set() : new Set(filtered.map((a) => a.id)));
  }

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 30, marginBottom: 2 }}>Dashboard</h1>
          <div className="muted" style={{ fontSize: 14 }}>{greeting}, {user.display_name || user.username}.</div>
        </div>
        <div style={{ marginLeft: 'auto' }}><PopOutButton route="dashboard" title="Dashboard" /></div>
      </div>

      <div style={statRow}>
        <StatTile label="Total Accounts"  value={totals.total}   tone="blue" />
        <StatTile label="Live Accounts"   value={totals.live}    tone="green" />
        <StatTile label="Banned Accounts" value={totals.banned}  tone="red" />
      </div>

      <DashboardBlocks token={token} accounts={reddit} navigate={navigate} />

      <div style={actionBar}>
        <button className="ghost" onClick={toggleAll}>{selected.size === filtered.length && filtered.length ? 'Deselect' : 'Select All'}</button>
        <button className="ghost" onClick={() => navigate('profiles')}>Model Profiles</button>
        <button className="ghost" onClick={() => navigate('add-accounts')}>+ Add Accounts</button>
        <button className="ghost" onClick={load}>Refresh Data</button>
        <button className="ghost" onClick={() => navigate('operations')}>Send to Operations</button>
        <button
          className="ghost"
          onClick={() => selected.size > 0 ? setShowProxyModal(true) : navigate('operations')}
          title={selected.size > 0 ? `Change proxy on ${selected.size} selected` : 'Manage proxies'}
        >Change Proxy{selected.size > 0 ? ` · ${selected.size}` : ''}</button>
        <button className="ghost" onClick={async () => {
          const r = await window.api.proxies.testAll({ token });
          if (r.ok) { load(); }
        }}>Test Proxies</button>
        <button
          onClick={toggleStarred}
          disabled={selected.size === 0}
          style={{
            background: selected.size > 0 ? 'linear-gradient(135deg, var(--gold), var(--gold-orange))' : 'transparent',
            color: selected.size > 0 ? '#1a1a14' : 'var(--text-3)',
            border: '1px solid var(--gold)', borderRadius: 'var(--radius)',
            padding: '8px 14px', fontSize: 13, fontWeight: 600,
            cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
          }}
        >★ Star User</button>
        <button className="ghost" onClick={() => navigate('scheduler-pro')}>Scheduler</button>
        <div style={{ position: 'relative' }}>
          <button
            className="ghost"
            disabled={selected.size === 0}
            onClick={() => setStatusMenuOpen((v) => !v)}
            title={selected.size === 0 ? 'Select accounts first' : `Mark ${selected.size} selected as…`}
          >Set Status{selected.size > 0 ? ` · ${selected.size}` : ''} ▾</button>
          {statusMenuOpen && (
            <div
              onMouseLeave={() => setStatusMenuOpen(false)}
              style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                background: 'var(--bg-elev)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', minWidth: 160, zIndex: 50,
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)', padding: 4,
              }}
            >
              {[
                { v: 'ready',   l: 'Mark as Live',   fg: '#7fd99a' },
                { v: 'warming', l: 'Mark as Warming', fg: 'var(--gold)' },
                { v: 'paused',  l: 'Mark as Paused', fg: 'var(--text-2)' },
                { v: 'banned',  l: 'Mark as Banned', fg: '#e2a3a3' },
              ].map((s) => (
                <button
                  key={s.v}
                  onClick={() => bulkSetStatus(s.v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    background: 'transparent', border: 'none', padding: '8px 12px',
                    color: s.fg, fontSize: 13, cursor: 'pointer', textAlign: 'left',
                    borderRadius: 4,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.fg }} />
                  {s.l}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={bulkDelete}
          disabled={selected.size === 0}
          style={{
            background: selected.size > 0 ? 'rgba(180,90,90,0.15)' : 'transparent',
            color: selected.size > 0 ? '#e2a3a3' : 'var(--text-3)',
            border: '1px solid ' + (selected.size > 0 ? 'var(--danger)' : 'var(--border-strong)'),
            borderRadius: 'var(--radius)', padding: '8px 14px', fontSize: 13, fontWeight: 600,
            cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
          }}
        >Delete Accounts{selected.size > 0 ? ` · ${selected.size}` : ''}</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} style={{ width: 150 }}>
            <option value="all">All classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 130 }}>
            <option value="all">All status</option>
            <option value="ready">Live</option>
            <option value="warming">Warming</option>
            <option value="paused">Paused</option>
            <option value="banned">Banned</option>
          </select>
          <input placeholder="Search by name or class…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
        </div>
      </div>

      {showProxyModal && (
        <Modal onClose={() => setShowProxyModal(false)} title={`Change proxy on ${selected.size} account${selected.size === 1 ? '' : 's'}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => applyProxy(null)}
              style={{ textAlign: 'left', padding: '10px 14px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--gold)' }}
            >
              ✕ Remove proxy (set to NO PROXY)
            </button>
            {proxies.length === 0 && (
              <div className="muted" style={{ fontSize: 12, padding: '10px 0' }}>No proxies configured. Add some under Operations → Proxies.</div>
            )}
            {proxies.map((p) => (
              <button
                key={p.id}
                onClick={() => applyProxy(p.id)}
                style={{ textAlign: 'left', padding: '10px 14px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: p.last_test_ok === 1 ? '#7fd99a' : p.last_test_ok === 0 ? '#e2a3a3' : 'var(--text-3)',
                }} />
                <span style={{ flex: 1 }}>{p.label}</span>
                <span className="mono dim" style={{ fontSize: 11 }}>{p.kind} · {p.host}:{p.port}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={{ ...th, width: 36 }}><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} /></th>
                <th style={{ ...th, width: 44 }}></th>
                <th style={th}>Model</th>
                <th style={{ ...th, textAlign: 'right' }}>Age</th>
                <th style={th}>NSFW</th>
                <th style={{ ...th, textAlign: 'right' }}>Post Karma</th>
                <th style={{ ...th, textAlign: 'right' }}>Comment Karma</th>
                <th style={th}>Proxy</th>
                <th style={th}>Status</th>
                <th style={th}>Health</th>
                <th style={th}>Web</th>
                <th style={th}>Pro Schedule</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} style={{ ...td, textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={12} style={{ ...td, textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>No accounts.</td></tr>
              ) : (() => {
                // Group filtered accounts by model so each model gets a header
                // row inside the table — replaces the duplicate model card
                // block that used to live below the table.
                const renderAccountRow = (a) => {
                  const sel = selected.has(a.id);
                  const nsfw = a.status === 'ready';
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--border)', background: sel ? 'rgba(212,166,74,0.06)' : 'transparent' }}>
                    <td style={td}><input type="checkbox" checked={sel} onChange={() => toggle(a.id)} /></td>
                    <td style={td}>
                      <button
                        onClick={() => window.api.windows.openAccountBrowser({ accountId: a.id })}
                        title={`Launch ${a.username} in its own pre-logged-in browser`}
                        style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--green), var(--gold))',
                          color: '#1a1a14', border: '1px solid var(--gold)',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          display: 'grid', placeItems: 'center',
                          boxShadow: '0 1px 4px rgba(127,217,154,0.3)',
                          padding: 0,
                        }}
                      >▶</button>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ position: 'relative' }}>
                          <Avatar name={a.username} size={30} />
                          {a.starred ? (
                            <span style={{
                              position: 'absolute', top: -4, right: -4,
                              background: 'var(--gold)', color: '#1a1a14', borderRadius: '50%',
                              width: 14, height: 14, display: 'grid', placeItems: 'center',
                              fontSize: 9, fontWeight: 800, border: '1.5px solid var(--bg-0)',
                            }}>★</span>
                          ) : null}
                        </div>
                        <div style={{ fontWeight: 500 }}>
                          <div>{a.profile_name || 'Unassigned'}</div>
                          <div className="mono dim" style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>{a.username}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono dim">{ageFromIso(a.created_at)}</td>
                    <td style={td}>
                      <Tag tone={nsfw ? 'pink' : 'green'}>{nsfw ? 'NSFW' : 'SFW'}</Tag>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{fmt(a.post_karma)}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{fmt(a.comment_karma)}</td>
                    <td style={td}>
                      {!a.proxy_label
                        ? <Tag tone="gold">NO PROXY</Tag>
                        : a.proxy_test_ok === 0
                          ? <span title={a.proxy_test_error || 'Last test failed'} style={{
                              display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '3px 9px',
                              borderRadius: 999, letterSpacing: '0.05em',
                              color: '#fff',
                              background: 'linear-gradient(90deg, #3a6f8c, #6a4fc4)',
                              border: '1px solid rgba(106,79,196,0.5)',
                              boxShadow: '0 0 10px -4px rgba(106,79,196,0.5)',
                            }}>PROXY ISSUE</span>
                          : <span className="mono" style={{ fontSize: 12 }}>{a.proxy_label}</span>}
                    </td>
                    <td style={td}><StatusPill status={a.status} /></td>
                    <td style={td}>
                      {(() => {
                        const h = accountHealth(a);
                        const colors = h.tier === 'good'
                          ? { bg: 'rgba(127,217,154,0.14)', bd: 'rgba(127,217,154,0.45)', fg: '#7fd99a' }
                          : h.tier === 'warn'
                          ? { bg: 'rgba(212,166,74,0.14)', bd: 'rgba(212,166,74,0.45)', fg: '#d4a64a' }
                          : { bg: 'rgba(226,163,163,0.14)', bd: 'rgba(226,163,163,0.45)', fg: '#e2a3a3' };
                        return (
                          <span title={h.reasons.length ? h.reasons.join(' · ') : `Score ${h.score}`} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            fontSize: 10, fontWeight: 700, padding: '3px 9px',
                            borderRadius: 999, letterSpacing: '0.05em', textTransform: 'uppercase',
                            background: colors.bg, border: `1px solid ${colors.bd}`, color: colors.fg,
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.fg }} />
                            {h.label} {h.score}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => window.api.windows.openAccountBrowser({ accountId: a.id })}
                        title={`Open ${a.username} in a pre-logged-in browser window`}
                        style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: '#ff4500', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer', padding: 0 }}
                      >R</button>
                    </td>
                    <td style={td}>
                      {(() => {
                        const ts = templatesByAccount.get(a.id) || [];
                        if (!ts.length) return <Tag tone="neutral">No Schedule</Tag>;
                        const running = ts.find((t) => t.status === 'running');
                        return running
                          ? <Tag tone="green">● {running.name}</Tag>
                          : <Tag tone="blue">{ts[0].name}{ts.length > 1 ? ` +${ts.length - 1}` : ''}</Tag>;
                      })()}
                    </td>
                  </tr>
                  );
                };
                const byModel = new Map();
                for (const a of filtered) {
                  const pid = a.profile_id;
                  if (!byModel.has(pid)) byModel.set(pid, []);
                  byModel.get(pid).push(a);
                }
                const out = [];
                for (const [pid, accts] of byModel.entries()) {
                  const m = models.find((mm) => mm.id === pid) || {
                    id: pid, name: accts[0]?.profile_name || 'Unknown', accountsList: accts,
                    live: accts.filter((x) => x.status !== 'banned').length,
                    total: accts.length, banned: accts.filter((x) => x.status === 'banned').length,
                    mainEmail: accts.find((x) => x.email)?.email || null,
                  };
                  const byPlatform = new Map();
                  for (const x of m.accountsList) {
                    const p = x.platform || 'reddit';
                    if (!byPlatform.has(p)) byPlatform.set(p, []);
                    byPlatform.get(p).push(x);
                  }
                  const isCollapsed = collapsedModels.has(pid);
                  out.push(
                    <tr key={`model-${pid}`} style={{ background: 'rgba(212,166,74,0.05)', borderTop: '2px solid var(--gold)' }}>
                      <td colSpan={12} style={{ ...td, padding: '10px 14px', cursor: 'pointer' }} onClick={() => toggleModel(pid)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{
                            width: 16, display: 'inline-grid', placeItems: 'center',
                            color: 'var(--gold)', fontSize: 12, transition: 'transform 0.15s',
                            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                          }}>▾</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); openAllForModel(m); }}
                            title={`Launch all ${m.total} account${m.total === 1 ? '' : 's'} in one tabbed window`}
                            style={{
                              width: 32, height: 32, borderRadius: '50%',
                              background: 'linear-gradient(135deg, var(--green), var(--gold))',
                              color: '#1a1a14', border: '1px solid var(--gold)',
                              fontSize: 13, fontWeight: 700, cursor: 'pointer',
                              display: 'grid', placeItems: 'center',
                              boxShadow: '0 2px 8px rgba(127,217,154,0.3)', flexShrink: 0, padding: 0,
                            }}
                          >▶</button>
                          <Avatar name={m.name} size={32} />
                          <div onClick={(e) => { e.stopPropagation(); navigate('model', { modelId: m.id }); }} style={{ cursor: 'pointer', minWidth: 140 }} title={`Open ${m.name} profile`}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</div>
                            <div style={{ fontSize: 10, color: '#9aa0a6', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
                              <span style={{ color: '#7fd99a' }}>{m.live} live</span>
                              <span style={{ margin: '0 5px', opacity: 0.4 }}>·</span>
                              <span>{m.total} acct{m.total === 1 ? '' : 's'}</span>
                              {m.banned > 0 && (<><span style={{ margin: '0 5px', opacity: 0.4 }}>·</span><span style={{ color: '#e2a3a3' }}>{m.banned} banned</span></>)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {[...byPlatform.entries()].map(([p, list]) => (
                              <button key={p} onClick={(e) => { e.stopPropagation(); openAllForModel(m); }} title={`${list.length} ${p} account${list.length === 1 ? '' : 's'}`} style={{ ...platformLogoPill, background: platformColor(p) }}>
                                <span style={{ fontWeight: 800, fontSize: 11, color: '#fff' }}>{platformShort(p)}</span>
                                {list.length > 1 && <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', opacity: 0.9 }}>×{list.length}</span>}
                              </button>
                            ))}
                          </div>
                          <div style={{ marginLeft: 'auto', fontSize: 12, color: m.mainEmail ? 'var(--text-2)' : 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                            {m.mainEmail || <span className="dim" style={{ fontStyle: 'italic' }}>set main email on Model Profile</span>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                  if (!isCollapsed) for (const a of accts) out.push(renderAccountRow(a));
                }
                return out;
              })()}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// Four-block operational dashboard: Alerts · Due Today · Karma Leaderboard ·
// Action Feed. Lives between the stat tiles and the actions row. Each block
// pulls from an existing IPC, no new backend work needed.
function DashboardBlocks({ token, accounts, navigate }) {
  const [events, setEvents] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [karma, setKarma] = useState([]);
  const [trending, setTrending] = useState([]);
  const inboxLive = useInboxLive();

  useEffect(() => {
    let active = true;
    (async () => {
      const [e, s, k, t] = await Promise.all([
        window.api.protocols?.events?.({ token, limit: 12 }).catch(() => ({ ok: false })) || { ok: false },
        window.api.scheduled?.list?.({ token, status: 'pending' }).catch(() => ({ ok: false })) || { ok: false },
        window.api.analytics?.summary?.({ token }).catch(() => ({ ok: false })) || { ok: false },
        window.api.intel?.listTopics?.({ token, limit: 10 }).catch(() => ({ ok: false })) || { ok: false },
      ]);
      if (!active) return;
      if (e.ok) setEvents(e.events || []);
      if (s.ok) setScheduled(s.posts || []);
      if (k.ok) setKarma(k.accounts || []);
      if (t.ok) setTrending(t.topics || []);
    })();
    return () => { active = false; };
  }, [token]);

  // ALERTS — accounts needing a human now
  const alerts = [];
  for (const a of accounts) {
    if (a.status === 'banned') alerts.push({ severity: 'high', text: `u/${a.username} is BANNED`, accountId: a.id });
    else if (a.proxy_test_ok === 0) alerts.push({ severity: 'high', text: `u/${a.username} proxy failing`, accountId: a.id });
    else if (a.status !== 'paused' && !a.proxy_label) alerts.push({ severity: 'med', text: `u/${a.username} has no proxy`, accountId: a.id });
  }
  // No activity in 72h: needs event timestamps from events feed.
  const recentActiveIds = new Set(events.filter((e) => e.account_id).map((e) => e.account_id));
  for (const a of accounts) {
    if (a.status === 'banned' || a.status === 'paused') continue;
    if (!recentActiveIds.has(a.id) && events.length > 5) {
      // Only flag if we have enough event history to compare against.
      // alerts.push({ severity: 'low', text: `u/${a.username} idle (no recent autopilot activity)`, accountId: a.id });
    }
  }

  // DUE TODAY — scheduled posts firing in next 24h
  const nowMs = Date.now();
  const dueSoon = scheduled
    .filter((p) => p.scheduled_for)
    .filter((p) => {
      const t = new Date(p.scheduled_for.replace(' ', 'T')).getTime();
      return t >= nowMs && t < nowMs + 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
    .slice(0, 8);

  // KARMA LEADERBOARD — sort accounts by combined karma desc
  const leaders = [...karma]
    .filter((a) => (a.post_karma || 0) + (a.comment_karma || 0) > 0)
    .sort((a, b) => ((b.post_karma || 0) + (b.comment_karma || 0)) - ((a.post_karma || 0) + (a.comment_karma || 0)))
    .slice(0, 6);

  // DM PREVIEWS — newest unread across every reddit account, pulled from the
  // inbox-live provider so they update without the user being on the inbox
  // page.
  const newestUnread = (() => {
    const all = [];
    for (const a of accounts) {
      const msgs = inboxLive.byAccount?.[a.id]?.messages || [];
      for (const m of msgs) if (m.isNew) all.push({ ...m, accountUsername: a.username });
    }
    return all.sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 3);
  })();
  const totalUnread = Object.values(inboxLive.unreadByAccount || {}).reduce((s, n) => s + (n || 0), 0);

  // PROXY HEALTH — alive vs dead vs untested across all reddit accounts.
  const proxyHealth = (() => {
    let alive = 0, dead = 0, untested = 0, noProxy = 0;
    for (const a of accounts) {
      if (!a.proxy_label) { noProxy++; continue; }
      if (a.proxy_test_ok === 1) alive++;
      else if (a.proxy_test_ok === 0) dead++;
      else untested++;
    }
    return { alive, dead, untested, noProxy };
  })();

  // EMPTY SCHEDULE ALERT — accounts with no pending posts in the next 3 days.
  const emptySchedule = (() => {
    const threshold = nowMs + 3 * 24 * 60 * 60 * 1000;
    const withScheduled = new Set();
    for (const p of scheduled) {
      if (!p.scheduled_for) continue;
      const t = new Date(p.scheduled_for.replace(' ', 'T')).getTime();
      if (t < threshold) withScheduled.add(p.account_id);
    }
    return accounts.filter((a) => a.status !== 'banned' && a.status !== 'paused' && !withScheduled.has(a.id));
  })();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 18 }}>
      {/* Alerts */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Alerts</h3>
          <span className="muted" style={{ fontSize: 11 }}>{alerts.length} need attention</span>
        </div>
        {alerts.length === 0
          ? <div className="muted" style={{ fontSize: 12 }}>Everything's healthy ✓</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
              {alerts.slice(0, 10).map((al, i) => (
                <div key={i} style={{
                  fontSize: 12, padding: '5px 10px', borderRadius: 6,
                  background: al.severity === 'high' ? 'rgba(226,163,163,0.08)' : 'rgba(212,166,74,0.08)',
                  borderLeft: `3px solid ${al.severity === 'high' ? '#e2a3a3' : '#d4a64a'}`,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ flex: 1 }}>{al.text}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Due Today */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Due in next 24h</h3>
          <span className="muted" style={{ fontSize: 11 }}>{dueSoon.length} scheduled</span>
          <button className="ghost" onClick={() => navigate('automation')} style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 9px' }}>Open Scheduler</button>
        </div>
        {dueSoon.length === 0
          ? <div className="muted" style={{ fontSize: 12 }}>Nothing scheduled in the next day.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
              {dueSoon.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, padding: '5px 8px', borderBottom: '1px dashed var(--border)' }}>
                  <span className="mono dim" style={{ fontSize: 11 }}>{p.scheduled_for?.slice(5, 16)}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>r/{p.subreddit} — {p.title}</span>
                  <span className="dim" style={{ fontSize: 11 }}>u/{p.account_username}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Karma Leaderboard */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Karma leaderboard</h3>
          <span className="muted" style={{ fontSize: 11 }}>top accounts by total karma</span>
        </div>
        {leaders.length === 0
          ? <div className="muted" style={{ fontSize: 12 }}>No karma data yet.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {leaders.map((a, i) => {
                const total = (a.post_karma || 0) + (a.comment_karma || 0);
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '5px 8px', borderBottom: '1px dashed var(--border)' }}>
                    <span className="mono dim" style={{ width: 18 }}>{i + 1}.</span>
                    <span style={{ flex: 1 }}>u/{a.username}</span>
                    <span className="mono">{total.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Action Feed */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Live action feed</h3>
          <span className="muted" style={{ fontSize: 11 }}>last {events.length}</span>
        </div>
        {events.length === 0
          ? <div className="muted" style={{ fontSize: 12 }}>No autopilot activity yet.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
              {events.slice(0, 10).map((e) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, padding: '4px 8px', borderBottom: '1px dashed var(--border)' }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: e.status === 'posted' ? 'rgba(127,217,154,0.14)' : e.status === 'failed' ? 'rgba(226,163,163,0.14)' : 'rgba(255,255,255,0.06)',
                    color: e.status === 'posted' ? '#7fd99a' : e.status === 'failed' ? '#e2a3a3' : 'var(--text-3)',
                  }}>{e.status}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.subreddit ? `r/${e.subreddit} · ` : ''}{e.title || e.error || '—'}
                  </span>
                  <span className="dim" style={{ fontSize: 10 }}>u/{e.account_username || e.account_id}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* DM Previews */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Unread DMs</h3>
          <span className="muted" style={{ fontSize: 11 }}>{totalUnread} total</span>
          <button className="ghost" onClick={() => navigate('inbox')} style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 9px' }}>Open Inbox</button>
        </div>
        {newestUnread.length === 0
          ? <div className="muted" style={{ fontSize: 12 }}>No unread DMs.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {newestUnread.map((m) => (
                <div key={`${m.accountUsername}-${m.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', borderRadius: 6, background: 'rgba(127,217,154,0.06)' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{m.author}</span>
                    <span className="dim" style={{ fontSize: 10 }}>→ u/{m.accountUsername}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.body || m.subject || '—'}</div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Proxy Health */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Proxy health</h3>
          <button className="ghost" onClick={() => navigate('add-accounts', { tab: 'proxies' })} style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 9px' }}>Manage</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 8 }}>
          <ProxyTile label="Alive" value={proxyHealth.alive} tone="#7fd99a" />
          <ProxyTile label="Dead" value={proxyHealth.dead} tone="#e2a3a3" />
          <ProxyTile label="Untested" value={proxyHealth.untested} tone="#d4a64a" />
          <ProxyTile label="None" value={proxyHealth.noProxy} tone="#9aa0a6" />
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            className="ghost"
            style={{ width: '100%', fontSize: 12 }}
            onClick={async () => { try { await window.api.proxies.testAll({ token }); } catch {} }}
          >↻ Test all proxies</button>
        </div>
      </div>

      {/* Empty Schedule Alert */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Empty schedule (3d)</h3>
          <span className="muted" style={{ fontSize: 11 }}>{emptySchedule.length} accounts</span>
        </div>
        {emptySchedule.length === 0
          ? <div className="muted" style={{ fontSize: 12 }}>Every active account has content queued ✓</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
              {emptySchedule.slice(0, 10).map((a) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', borderBottom: '1px dashed var(--border)' }}>
                  <span style={{ flex: 1 }}>u/{a.username}</span>
                  <span className="dim" style={{ fontSize: 10 }}>{a.profile_name || ''}</span>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Trending Topics */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Trending in your subs</h3>
          <span className="muted" style={{ fontSize: 11 }}>{trending.length} candidates</span>
        </div>
        {trending.length === 0
          ? <div className="muted" style={{ fontSize: 12 }}>Topic discovery hasn't run yet — autopilot pulls these every 4h.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
              {trending.slice(0, 8).map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, padding: '4px 8px', borderBottom: '1px dashed var(--border)' }}>
                  <span className="mono dim" style={{ fontSize: 10 }}>r/{t.subreddit}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  {t.score != null && <span className="dim" style={{ fontSize: 10 }}>{t.score}↑</span>}
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Quick actions</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            className="ghost"
            style={{ fontSize: 12, justifyContent: 'flex-start' }}
            onClick={async () => { try { const r = await window.api.autopilot?.runNow?.({ token, dryRun: false }); if (!r?.ok) alert(r?.error || 'Autopilot run failed'); } catch {} }}
          >▶ Run autopilot pass now</button>
          <button
            className="ghost"
            style={{ fontSize: 12, justifyContent: 'flex-start' }}
            onClick={async () => { try { await window.api.proxies.testAll({ token }); } catch {} }}
          >↻ Test all proxies</button>
          <button
            className="ghost"
            style={{ fontSize: 12, justifyContent: 'flex-start' }}
            onClick={async () => {
              for (const a of accounts) {
                try { await window.api.session?.prepareForAccount?.({ accountId: a.id }); } catch {}
              }
            }}
          >↻ Refresh all DM inboxes</button>
          <button
            className="ghost"
            style={{ fontSize: 12, justifyContent: 'flex-start' }}
            onClick={() => navigate('automation', { section: 'scheduler' })}
          >◷ Open Scheduler</button>
        </div>
      </div>
    </div>
  );
}

function ProxyTile({ label, value, tone }) {
  return (
    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: tone, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'grid', placeItems: 'center', zIndex: 200,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 460, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
        background: 'var(--bg-elev)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: '0 24px 60px -10px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, flex: 1 }}>{title}</h3>
          <button className="ghost" onClick={onClose} style={{ fontSize: 12, padding: '4px 10px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const statRow = { display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 };
const modelList = { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 };
const modelRowCard = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 14px',
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
};
const playBtn = {
  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
  background: 'linear-gradient(135deg, var(--green), var(--gold))',
  color: '#1a1a14', border: '1px solid var(--gold)',
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
  display: 'grid', placeItems: 'center',
  boxShadow: '0 2px 8px rgba(127,217,154,0.3)',
};
const acctChip = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: 'var(--bg-1)', border: '1px solid var(--border)',
  borderRadius: 999, padding: '3px 9px',
  fontSize: 11, color: 'var(--text-2)', cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
};
const platformDot = { width: 6, height: 6, borderRadius: '50%' };
const platformLogoPill = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  width: 30, height: 22, justifyContent: 'center',
  borderRadius: 6, border: 'none', cursor: 'pointer',
  padding: '0 6px',
  transition: 'transform 0.12s ease, filter 0.12s ease',
};
const actionBar = { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' };
const th = { textAlign: 'left', padding: '11px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)' };
const td = { padding: '10px 14px', verticalAlign: 'middle' };
