// Model Hub — the unified per-model command center.
//
// One page per model, surfacing every account across every platform that
// belongs to it. Quick-switch buttons rescope Inbox / Scheduler / Reddit
// browser to one of this model's accounts without making the user hunt for
// it in a sidebar. Reddit + RedGIFs are wired today; X / Instagram / TikTok
// are placeholders for the adapter pattern.

import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import { Banner, Avatar, Tag, StatusPill } from '../components/ui.jsx';
import PopOutButton from '../components/PopOutButton.jsx';

const PLATFORMS = [
  { key: 'reddit',    label: 'Reddit',    icon: 'R', color: '#ff4500', supported: true },
  { key: 'redgifs',   label: 'RedGIFs',   icon: 'G', color: '#d63d3d', supported: true },
  { key: 'x',         label: 'X',         icon: '𝕏', color: '#fff',    supported: false },
  { key: 'instagram', label: 'Instagram', icon: '◉', color: '#e2497d', supported: false },
  { key: 'tiktok',    label: 'TikTok',    icon: '♪', color: '#69c9d0', supported: false },
];

function ageFromIso(s) {
  if (!s) return '—';
  try {
    const t = new Date(s.replace(' ', 'T') + 'Z').getTime();
    const d = Math.floor((Date.now() - t) / 86400000);
    if (d < 1) return '<1d';
    if (d < 365) return `${d}d`;
    return `${Math.floor(d / 365)}y${d % 365 ? ` ${d % 365}d` : ''}`;
  } catch { return '—'; }
}

export default function ModelHubPage({ modelId, navigate }) {
  const { token } = useAuth();
  const { setActiveFor } = useActiveAccount();
  const [profile, setProfile] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [redgifsData, setRedgifsData] = useState({});
  const [activePlatform, setActivePlatform] = useState('reddit');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [p, a, rg] = await Promise.all([
        window.api.profiles.list({ token }),
        window.api.accounts.listForUser({ token }),
        window.api.redgifs.listAccounts({ token }).catch(() => ({ ok: false })),
      ]);
      if (p.ok) {
        const found = (p.profiles || []).find((x) => String(x.id) === String(modelId));
        setProfile(found || null);
        if (!found) setErr('Model not found.');
      }
      if (a.ok) setAccounts((a.accounts || []).filter((x) => String(x.profile_id) === String(modelId)));
      if (rg.ok) {
        const m = {};
        for (const acc of rg.accounts) if (acc.profile) m[acc.id] = acc.profile;
        setRedgifsData(m);
      }
      setLoading(false);
    }
    load();
  }, [token, modelId]);

  const counts = useMemo(() => {
    const c = {};
    for (const p of PLATFORMS) c[p.key] = accounts.filter((a) => (a.platform || 'reddit') === p.key).length;
    return c;
  }, [accounts]);

  const platformAccounts = accounts.filter((a) => (a.platform || 'reddit') === activePlatform);
  const totals = useMemo(() => ({
    live: accounts.filter((a) => a.status === 'ready').length,
    warming: accounts.filter((a) => a.status === 'warming').length,
    banned: accounts.filter((a) => a.status === 'banned').length,
  }), [accounts]);

  function openAccount(a) {
    window.api.windows.openAccountBrowser({ accountId: a.id });
  }
  async function openAllAccounts() {
    for (const a of accounts) {
      await window.api.windows.openAccountBrowser({ accountId: a.id });
    }
  }
  function openInbox(a) {
    setActiveFor('reddit', a.id);
    navigate('inbox');
  }
  function openScheduler(a) {
    setActiveFor((a.platform || 'reddit'), a.id);
    navigate('scheduler-pro');
  }

  if (loading) return <div className="empty-state" style={{ padding: 40 }}>Loading…</div>;
  if (err) return <Banner kind="err">{err}</Banner>;
  if (!profile) return <Banner kind="err">Model not found.</Banner>;

  return (
    <div>
      {/* Hub header */}
      <div className="card" style={{ padding: 20, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: profile.avatar_color || 'linear-gradient(135deg, var(--green), var(--gold))',
          color: '#fff', fontWeight: 800, fontSize: 26, fontFamily: 'var(--font-display)',
        }}>{(profile.name || '?').charAt(0).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ color: 'var(--gold)' }}>Model Hub</div>
          <h1 style={{ marginBottom: 2 }}>{profile.name}</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {accounts.length} account{accounts.length === 1 ? '' : 's'} across {Object.values(counts).filter((c) => c > 0).length} platform{Object.values(counts).filter((c) => c > 0).length === 1 ? '' : 's'}
            {profile.niche ? ` · ${profile.niche}` : ''}
            {profile.assigned_to_name ? ` · assigned to ${profile.assigned_to_name}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <PopOutButton route={`model-${modelId}`} title={`Model Hub · ${profile.name}`} />
          <button className="ghost" onClick={() => navigate('profiles')}>All Models</button>
          <button className="ghost" onClick={() => navigate('scheduler-pro')}>Open Scheduler</button>
          {accounts.length > 0 && (
            <button className="primary" onClick={openAllAccounts} title="Open every linked account in its own browser window, pre-logged-in">
              ⧉ Open all {accounts.length} account{accounts.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <MiniStat label="Live"    value={totals.live}    tone="green" />
        <MiniStat label="Warming" value={totals.warming} tone="gold" />
        <MiniStat label="Banned"  value={totals.banned}  tone="red" />
      </div>

      {/* Platform tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {PLATFORMS.map((p) => {
          const isActive = activePlatform === p.key;
          return (
            <button
              key={p.key}
              onClick={() => p.supported && setActivePlatform(p.key)}
              disabled={!p.supported}
              style={{
                background: isActive ? 'linear-gradient(135deg, rgba(212,166,74,0.18), rgba(58,111,140,0.08))' : 'var(--bg-elev)',
                border: '1px solid ' + (isActive ? 'var(--gold)' : 'var(--border)'),
                borderRadius: 'var(--radius-lg)', padding: '10px 14px',
                color: isActive ? 'var(--gold-bright)' : 'var(--text-1)',
                fontWeight: 600, fontSize: 13, cursor: p.supported ? 'pointer' : 'not-allowed',
                opacity: p.supported ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ color: p.color }}>{p.icon}</span>
              {p.label}
              <Tag tone={counts[p.key] > 0 ? 'gold' : 'neutral'}>{counts[p.key]}</Tag>
              {!p.supported && <span style={{ fontSize: 10, opacity: 0.7 }}>soon</span>}
            </button>
          );
        })}
      </div>

      {/* Account cards for active platform */}
      {platformAccounts.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 13 }}>
            No {PLATFORMS.find((x) => x.key === activePlatform).label} accounts for this model yet.
          </div>
          <button className="primary" onClick={() => navigate('add-accounts')} style={{ marginTop: 12 }}>+ Add Accounts</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {platformAccounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              redgifs={redgifsData[a.id]}
              onOpen={() => openAccount(a)}
              onInbox={() => openInbox(a)}
              onSchedule={() => openScheduler(a)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const fg = ({ green: '#7fd99a', gold: 'var(--gold-bright)', red: '#e2a3a3' })[tone] || 'var(--text-0)';
  return (
    <div style={{
      flex: 1, border: '1px solid var(--border)', background: 'var(--bg-elev)',
      borderRadius: 'var(--radius-lg)', padding: '12px 16px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, color: fg, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function AccountCard({ account, redgifs, onOpen, onInbox, onSchedule }) {
  const isRedgifs = account.platform === 'redgifs';
  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: 14, boxShadow: '0 4px 18px -8px rgba(0,0,0,0.6)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {isRedgifs && redgifs?.avatar_url
          ? <img src={redgifs.avatar_url} alt={account.username} style={{ width: 40, height: 40, borderRadius: '50%' }} />
          : <Avatar name={account.username} size={40} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {account.starred ? '★ ' : ''}{account.username}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            <StatusPill status={account.status} />
            {account.proxy_label
              ? account.proxy_test_ok === 0
                ? <Tag tone="blue">PROXY ISSUE</Tag>
                : <Tag tone="neutral">{account.proxy_label}</Tag>
              : <Tag tone="gold">NO PROXY</Tag>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-2)', padding: '8px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        {isRedgifs && redgifs ? (
          <>
            <span>{redgifs.followers ?? '—'} followers</span>
            <span>{redgifs.views ?? '—'} views</span>
            <span>{redgifs.videos ?? '—'} videos</span>
          </>
        ) : (
          <>
            <span>Age {ageFromIso(account.created_at)}</span>
            <span>Karma {(account.post_karma ?? 0) + (account.comment_karma ?? 0)}</span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
        <button className="primary" onClick={onOpen} style={{ flex: 1, fontSize: 12 }}>Open</button>
        {!isRedgifs && <button className="ghost" onClick={onInbox} title="Inbox" style={{ fontSize: 12 }}>✉</button>}
        <button className="ghost" onClick={onSchedule} title="Scheduler" style={{ fontSize: 12 }}>◷</button>
      </div>
    </div>
  );
}
