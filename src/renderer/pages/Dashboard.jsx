import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Avatar, Tag, StatusPill, StatTile } from '../components/ui.jsx';
import PopOutButton from '../components/PopOutButton.jsx';

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

export default function DashboardPage({ navigate }) {
  const { token, user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(() => new Set());

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

  const filtered = useMemo(() => {
    let r = reddit;
    if (statusFilter !== 'all') r = r.filter((a) => a.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((a) => `${a.username} ${a.profile_name} ${a.proxy_label || ''}`.toLowerCase().includes(q));
    return r;
  }, [reddit, statusFilter, search]);

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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
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
                <th style={th}>Account</th>
                <th style={{ ...th, textAlign: 'right' }}>Age</th>
                <th style={th}>NSFW</th>
                <th style={{ ...th, textAlign: 'right' }}>Post Karma</th>
                <th style={{ ...th, textAlign: 'right' }}>Comment Karma</th>
                <th style={th}>Proxy</th>
                <th style={th}>Status</th>
                <th style={th}>Web</th>
                <th style={th}>Class</th>
                <th style={th}>Pro Schedule</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>No accounts.</td></tr>
              ) : filtered.map((a) => {
                const sel = selected.has(a.id);
                const nsfw = a.status === 'ready';
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--border)', background: sel ? 'rgba(212,166,74,0.06)' : 'transparent' }}>
                    <td style={td}><input type="checkbox" checked={sel} onChange={() => toggle(a.id)} /></td>
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
                        <div style={{ fontWeight: 500 }}>{a.username}</div>
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
                      <span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: '#ff4500', color: '#fff', fontWeight: 700, fontSize: 12 }} title={`u/${a.username}`}>R</span>
                    </td>
                    <td style={td}><Tag tone="neutral">{a.profile_name || '—'}</Tag></td>
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
              })}
            </tbody>
          </table>
        </div>
      </div>
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

const statRow = { display: 'flex', gap: 14, marginBottom: 18 };
const actionBar = { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' };
const th = { textAlign: 'left', padding: '11px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)' };
const td = { padding: '10px 14px', verticalAlign: 'middle' };
