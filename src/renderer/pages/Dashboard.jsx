import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';

const STATUS_META = {
  ready:   { label: 'LIVE',    fg: '#7fd99a', bg: 'rgba(79,138,100,0.18)' },
  warming: { label: 'WARMING', fg: 'var(--gold)', bg: 'rgba(212,166,74,0.15)' },
  paused:  { label: 'PAUSED',  fg: 'var(--text-2)', bg: 'rgba(255,255,255,0.05)' },
  banned:  { label: 'BANNED',  fg: '#e2a3a3', bg: 'rgba(180,90,90,0.18)' },
};

function fmt(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}
function avatarHue(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export default function DashboardPage({ navigate }) {
  const { token, user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(() => new Set());

  async function load() {
    setLoading(true);
    const [a, sum] = await Promise.all([
      window.api.accounts.listForUser({ token }),
      window.api.analytics.summary({ token }).catch(() => ({ ok: false })),
    ]);
    const base = a.ok ? a.accounts : [];
    const karma = {};
    if (sum.ok && sum.accounts) for (const s of sum.accounts) karma[s.id] = s;
    setAccounts(base.map((x) => ({ ...x, ...(karma[x.id] || {}) })));
    setLoading(false);
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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 30, marginBottom: 2 }}>Dashboard</h1>
        <div className="muted" style={{ fontSize: 14 }}>{greeting}, {user.display_name || user.username}.</div>
      </div>

      <div style={statRow}>
        <BigStat label="Total Accounts" value={totals.total} tone="blue" />
        <BigStat label="Live Accounts" value={totals.live} tone="green" />
        <BigStat label="Banned Accounts" value={totals.banned} tone="red" />
      </div>

      <div style={actionBar}>
        <button className="ghost" onClick={toggleAll}>{selected.size === filtered.length && filtered.length ? 'Deselect' : 'Select All'}</button>
        <button className="ghost" onClick={() => navigate('profiles')}>Manage Classes</button>
        <button className="ghost" onClick={() => navigate('reddit-api', { tab: 'reddit' })}>+ Add Accounts</button>
        <button className="ghost" onClick={load}>Refresh Data</button>
        <button className="ghost" onClick={() => navigate('operations')}>Send to Operations</button>
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

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={{ ...th, width: 36 }}><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} /></th>
                <th style={th}>Account</th>
                <th style={th}>NSFW</th>
                <th style={{ ...th, textAlign: 'right' }}>Post Karma</th>
                <th style={{ ...th, textAlign: 'right' }}>Comment Karma</th>
                <th style={th}>Proxy</th>
                <th style={th}>Status</th>
                <th style={th}>Class</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>No accounts.</td></tr>
              ) : filtered.map((a) => {
                const meta = STATUS_META[a.status] || STATUS_META.paused;
                const sel = selected.has(a.id);
                const nsfw = a.status === 'ready';
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--border)', background: sel ? 'rgba(212,166,74,0.06)' : 'transparent' }}>
                    <td style={td}><input type="checkbox" checked={sel} onChange={() => toggle(a.id)} /></td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ ...avatar, background: `hsl(${avatarHue(a.username)},45%,38%)` }}>
                          {(a.username || '?')[0].toUpperCase()}
                        </div>
                        <div style={{ fontWeight: 500 }}>{a.username}</div>
                      </div>
                    </td>
                    <td style={td}>
                      <span style={{ ...tag, ...(nsfw
                        ? { color: '#d9a3d9', borderColor: '#7a4a7a', background: 'rgba(150,90,150,0.12)' }
                        : { color: 'var(--green-bright)', borderColor: 'var(--green)', background: 'var(--green-soft)' }) }}>
                        {nsfw ? 'NSFW' : 'SFW'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{fmt(a.post_karma)}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{fmt(a.comment_karma)}</td>
                    <td style={td}>
                      {a.proxy_label
                        ? <span className="mono" style={{ fontSize: 12 }}>{a.proxy_label}</span>
                        : <span style={{ ...tag, color: 'var(--gold)', borderColor: 'var(--gold)', background: 'var(--gold-soft)' }}>NO PROXY</span>}
                    </td>
                    <td style={td}>
                      <span style={{ ...statusPill, color: meta.fg, background: meta.bg }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.fg, display: 'inline-block' }} />
                        {meta.label}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ ...tag, color: 'var(--gold-bright)', borderColor: 'var(--border-strong)', background: 'var(--bg-2)' }}>
                        {a.profile_name || '—'}
                      </span>
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

function BigStat({ label, value, tone }) {
  const tones = {
    blue:  { border: '#2c4a6e', glow: 'rgba(60,110,180,0.12)', fg: '#7fa8e0' },
    green: { border: 'var(--green)', glow: 'var(--green-soft)', fg: 'var(--green-bright)' },
    red:   { border: '#6e2c2c', glow: 'rgba(180,70,70,0.12)', fg: '#e2a3a3' },
  }[tone];
  return (
    <div style={{ flex: 1, border: `1px solid ${tones.border}`, background: `linear-gradient(135deg, ${tones.glow}, transparent)`, borderRadius: 'var(--radius-lg)', padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 600, color: tones.fg, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const statRow = { display: 'flex', gap: 14, marginBottom: 18 };
const actionBar = { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' };
const th = { textAlign: 'left', padding: '11px 14px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)' };
const td = { padding: '10px 14px', verticalAlign: 'middle' };
const avatar = { width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 };
const tag = { display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, border: '1px solid', letterSpacing: '0.03em' };
const statusPill = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, letterSpacing: '0.05em' };
