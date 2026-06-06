import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Banner } from '../components/ui.jsx';
import PopOutButton from '../components/PopOutButton.jsx';

function fmt(n) { if (n == null) return '—'; if (n >= 1000000) return (n/1000000).toFixed(1)+'M'; if (n >= 1000) return (n/1000).toFixed(1)+'k'; return n.toLocaleString(); }

export default function RedGifsDashboardPage({ navigate }) {
  const { token } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyAccount, setBusyAccount] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.redgifs.listAccounts({ token });
    setLoading(false);
    if (res.ok) setAccounts(res.accounts || []); else setErr(res.error);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 5000);
    return () => clearTimeout(t);
  }, [msg, err]);

  async function refreshOne(account) {
    setBusyAccount(account.id);
    const res = await window.api.redgifs.fetchProfile({ token, username: account.username });
    setBusyAccount(null);
    if (res.ok) { setMsg(`Refreshed @${account.username}.`); load(); } else setErr(res.error);
  }

  async function refreshAll() {
    setLoading(true);
    const res = await window.api.redgifs.fetchAll({ token });
    setLoading(false);
    if (res.ok) {
      setMsg(`Refreshed ${res.refreshed} account${res.refreshed === 1 ? '' : 's'}.${res.errors?.length ? ` ${res.errors.length} failed.` : ''}`);
      if (res.errors?.length) setErr(res.errors.join(' · '));
      load();
    } else setErr(res.error);
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">RedGIFs</div>
          <h1>RedGIFs Dashboard</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Your RedGIFs accounts at a glance — followers, views, and uploaded videos. Refresh pulls live data from RedGIFs.
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <PopOutButton route="redgifs-dashboard" title="RedGIFs" />
          <button className="primary" onClick={refreshAll} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh All'}</button>
        </div>
      </div>

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

      {accounts.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>▮</div>
          <h3 style={{ marginBottom: 6 }}>No RedGIFs accounts yet</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Add a RedGIFs account under Add Accounts to see it here.</div>
          {navigate && <button className="primary" onClick={() => navigate('add-accounts')}>+ Add Accounts</button>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {accounts.map((a) => <AccountCard key={a.id} a={a} busy={busyAccount === a.id} onRefresh={() => refreshOne(a)} />)}
        </div>
      )}
    </div>
  );
}

function AccountCard({ a, busy, onRefresh }) {
  const p = a.profile || {};
  const initial = (p.display_name || a.username || '?').charAt(0).toUpperCase();
  return (
    <div style={card}>
      {/* top action row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <button onClick={onRefresh} disabled={busy} title="Refresh from RedGIFs" style={iconBtnGreen}>
          {busy ? '…' : '↻'}
        </button>
        <a href={p.url || `https://www.redgifs.com/users/${a.username}`} target="_blank" rel="noreferrer" style={{ ...iconBtn, color: '#e2a3a3', borderColor: 'rgba(180,90,90,0.4)' }} title="Open on RedGIFs">↗</a>
      </div>

      {/* avatar + name */}
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          {p.avatar_url
            ? <img src={p.avatar_url} alt={a.username} style={avatarImg} onError={(e) => { e.target.style.display = 'none'; }} />
            : <div style={avatarPlaceholder}>{initial}</div>}
          {p.verified
            ? <span style={verifiedBadge}>✓</span>
            : null}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 8, color: 'var(--text-0)' }}>{a.username}</div>
        {p.bio && (
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.4, maxHeight: 36, overflow: 'hidden' }}>
            {p.bio.slice(0, 90)}{p.bio.length > 90 ? '…' : ''}
          </div>
        )}
      </div>

      {/* stats row */}
      <div style={statsRow}>
        <Stat icon="👥" value={fmt(p.followers)} title="Followers" />
        <Stat icon="◉" value={fmt(p.views)}     title="Views" />
        <Stat icon="▷" value={fmt(p.videos)}    title="Videos" />
      </div>

      {/* assigned class */}
      {a.profile_name && (
        <div style={classRow}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Assigned Class:</span>
          <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 600 }}>{a.profile_name}</span>
        </div>
      )}

      {/* footer links */}
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <a href={p.url || `https://www.redgifs.com/users/${a.username}`} target="_blank" rel="noreferrer" style={footerLink}>↗ RedGIFs Profile</a>
        {a.notes && a.notes.startsWith('http') && (
          <a href={a.notes} target="_blank" rel="noreferrer" style={{ ...footerLink, color: 'var(--green-bright)' }}>🔗 Bio Link</a>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, value, title }) {
  return (
    <div style={{
      flex: 1, background: '#1a1a1c', border: '1px solid var(--border)', borderRadius: 8,
      padding: '8px 6px', textAlign: 'center', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 6,
    }} title={title}>
      <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{icon}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-1)' }}>{value}</span>
    </div>
  );
}

const card = {
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 14,
  boxShadow: '0 4px 18px -8px rgba(0,0,0,0.6)',
};
const iconBtn = {
  display: 'inline-grid', placeItems: 'center', width: 26, height: 26,
  background: 'transparent', border: '1px solid var(--border-strong)',
  borderRadius: 6, cursor: 'pointer', fontSize: 12, textDecoration: 'none',
};
const iconBtnGreen = { ...iconBtn, color: 'var(--green-bright)', borderColor: 'rgba(79,138,100,0.4)' };
const avatarImg = {
  width: 78, height: 78, borderRadius: '50%', objectFit: 'cover',
  border: '2px solid var(--border-strong)',
};
const avatarPlaceholder = {
  width: 78, height: 78, borderRadius: '50%', display: 'grid', placeItems: 'center',
  background: 'linear-gradient(135deg, var(--green), var(--gold))', color: '#fff',
  fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700,
};
const verifiedBadge = {
  position: 'absolute', bottom: -2, right: -2,
  background: 'var(--blue-bright)', color: '#fff',
  width: 20, height: 20, borderRadius: '50%',
  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
  border: '2px solid var(--bg-elev)',
};
const statsRow = { display: 'flex', gap: 6, marginBottom: 10 };
const classRow = {
  background: 'var(--bg-1)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 10px',
  display: 'flex', alignItems: 'center', gap: 8,
};
const footerLink = {
  fontSize: 12, color: 'var(--blue-bright)', textDecoration: 'none',
  display: 'flex', alignItems: 'center', gap: 4,
};
