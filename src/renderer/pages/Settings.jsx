import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { Tag } from '../components/ui.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';

export default function SettingsPage() {
  const { token, user } = useAuth();
  const can = useCan();
  const { accounts, refresh } = useActiveAccount();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);

  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyMsg, setApiKeyMsg] = useState(null);

  const [voteKey, setVoteKey] = useState('');
  const [hasVoteKey, setHasVoteKey] = useState(false);
  const [voteKeyMsg, setVoteKeyMsg] = useState(null);

  const isAdmin = can('ai.admin');

  useEffect(() => {
    window.api.ai.hasApiKey({ token }).then(r => setHasApiKey(!!(r.ok && r.hasKey)));
    window.api.votes.hasApiKey({ token }).then(r => setHasVoteKey(!!(r.ok && r.hasKey)));
  }, [token]);

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 6) { setPwMsg({ kind: 'err', text: 'Password must be at least 6 characters' }); return; }
    if (pw.next !== pw.confirm) { setPwMsg({ kind: 'err', text: "Passwords don't match" }); return; }
    const res = await window.api.auth.changePassword({ token, currentPassword: pw.current, newPassword: pw.next });
    if (!res.ok) { setPwMsg({ kind: 'err', text: res.error }); return; }
    setPwMsg({ kind: 'ok', text: 'Password changed.' });
    setPw({ current: '', next: '', confirm: '' });
  }

  async function saveApiKey(e) {
    e.preventDefault();
    setApiKeyMsg(null);
    if (!apiKey.trim()) { setApiKeyMsg({ kind: 'err', text: 'Paste a key first' }); return; }
    const res = await window.api.ai.setApiKey({ token, apiKey: apiKey.trim() });
    if (!res.ok) { setApiKeyMsg({ kind: 'err', text: res.error }); return; }
    setApiKey('');
    setHasApiKey(true);
    setApiKeyMsg({ kind: 'ok', text: 'API key saved and encrypted.' });
  }

  async function clearApiKey() {
    if (!confirm('Remove the saved Grok API key? AI features will stop working until you add a new one.')) return;
    await window.api.ai.setApiKey({ token, apiKey: null });
    setHasApiKey(false);
    setApiKeyMsg({ kind: 'ok', text: 'API key removed.' });
  }

  async function saveVoteKey(e) {
    e.preventDefault();
    setVoteKeyMsg(null);
    if (!voteKey.trim()) { setVoteKeyMsg({ kind: 'err', text: 'Paste a key first' }); return; }
    const res = await window.api.votes.setApiKey({ token, apiKey: voteKey.trim() });
    if (!res.ok) { setVoteKeyMsg({ kind: 'err', text: res.error }); return; }
    setVoteKey('');
    setHasVoteKey(true);
    setVoteKeyMsg({ kind: 'ok', text: 'API key saved and encrypted.' });
  }

  async function clearVoteKey() {
    if (!confirm('Remove the saved upvote.biz API key? The Votes page will stop working until you add a new one.')) return;
    await window.api.votes.setApiKey({ token, apiKey: null });
    setHasVoteKey(false);
    setVoteKeyMsg({ kind: 'ok', text: 'API key removed.' });
  }

  async function clearSession(partitionKey) {
    if (!confirm("Log out this account's session? You'll need to log in again next time.")) return;
    await window.api.session.clear(partitionKey);
    refresh();
  }

  const [cfgTab, setCfgTab] = useState('settings');

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Configuration</div>
          <h1>Configuration</h1>
        </div>
      </div>

      {/* Configuration sub-tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {[
          { k: 'settings',   l: 'Settings & API Keys' },
          { k: 'scheduling', l: 'Post Scheduling Configuration' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setCfgTab(t.k)}
            style={{
              background: 'transparent', border: 'none', borderBottom: '2px solid ' + (cfgTab === t.k ? 'var(--gold)' : 'transparent'),
              color: cfgTab === t.k ? 'var(--gold-bright)' : 'var(--text-2)',
              padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginBottom: -1,
            }}
          >{t.l}</button>
        ))}
      </div>

      {cfgTab === 'scheduling' && <SchedulingConfig token={token} />}
      {cfgTab === 'settings' && <>

      {isAdmin && (
        <div className="card" style={{ marginBottom: 22, borderColor: hasApiKey ? 'var(--ok)' : 'var(--border)' }}>
          <h3 style={{ marginBottom: 6 }}>Grok API key {hasApiKey && <span className="mono" style={{ fontSize: 11, color: 'var(--ok)', marginLeft: 8 }}>✓ configured</span>}</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Used by the AI composer, scheduler, and autopilot to generate post titles. Get a key at console.x.ai → API Keys. Stored encrypted on disk using your OS keychain.
          </div>
          {apiKeyMsg && (
            <div className={apiKeyMsg.kind === 'err' ? 'error-banner' : ''} style={apiKeyMsg.kind === 'ok' ? styles.ok : {}}>
              {apiKeyMsg.text}
            </div>
          )}
          <form onSubmit={saveApiKey} style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder={hasApiKey ? '••••••••••••••••  (paste a new key to replace)' : 'xai-…'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ flex: 1 }}
              autoComplete="off"
            />
            <button type="submit" className="primary">Save</button>
            {hasApiKey && <button type="button" className="danger" onClick={clearApiKey}>Remove</button>}
          </form>
        </div>
      )}

      {isAdmin && (
        <div className="card" style={{ marginBottom: 22, borderColor: hasVoteKey ? 'var(--ok)' : 'var(--border)' }}>
          <h3 style={{ marginBottom: 6 }}>upvote.biz API key {hasVoteKey && <span className="mono" style={{ fontSize: 11, color: 'var(--ok)', marginLeft: 8 }}>✓ configured</span>}</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Used by the Votes page to query balance, services, and place orders. Stored encrypted on disk using your OS keychain.
          </div>
          {voteKeyMsg && (
            <div className={voteKeyMsg.kind === 'err' ? 'error-banner' : ''} style={voteKeyMsg.kind === 'ok' ? styles.ok : {}}>
              {voteKeyMsg.text}
            </div>
          )}
          <form onSubmit={saveVoteKey} style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder={hasVoteKey ? '••••••••••••••••  (paste a new key to replace)' : 'upvote.biz API key'}
              value={voteKey}
              onChange={(e) => setVoteKey(e.target.value)}
              style={{ flex: 1 }}
              autoComplete="off"
            />
            <button type="submit" className="primary">Save</button>
            {hasVoteKey && <button type="button" className="danger" onClick={clearVoteKey}>Remove</button>}
          </form>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <form onSubmit={changePassword} className="card">
          <h3 style={{ marginBottom: 14 }}>Change password</h3>
          {pwMsg && (
            <div className={pwMsg.kind === 'err' ? 'error-banner' : ''} style={pwMsg.kind === 'ok' ? styles.ok : {}}>{pwMsg.text}</div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label>Current password</label>
            <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>New password</label>
            <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label>Confirm new password</label>
            <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <button type="submit" className="primary">Update password</button>
        </form>

        <div className="card">
          <h3 style={{ marginBottom: 6 }}>Account sessions</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Each linked account uses its own isolated browser session. Clearing one logs it out without affecting others.
          </div>
          {accounts.length === 0 ? (
            <div className="empty-state" style={{ padding: 22 }}>No accounts yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {accounts.map((a) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>
                      <span className="mono dim" style={{ fontSize: 10, marginRight: 6, padding: '1px 5px', background: 'var(--bg-2)', borderRadius: 3, textTransform: 'uppercase' }}>{a.platform || 'reddit'}</span>
                      <span className="mono dim">{a.platform === 'redgifs' ? '@' : 'u/'}</span>{a.username}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{a.profile_name}</div>
                  </div>
                  <button className="ghost" onClick={() => clearSession(a.partition_key)}>Clear</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </>}
    </div>
  );
}

/* --- Post Scheduling Configuration tab --- */
function SchedulingConfig({ token }) {
  const [profiles, setProfiles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [openId, setOpenId] = useState(null);

  async function load() {
    const [p, t, a] = await Promise.all([
      window.api.profiles.list({ token }),
      window.api.templates.list({ token }).catch(() => ({ ok: false })),
      window.api.accounts.listForUser({ token }),
    ]);
    if (p.ok) setProfiles(p.profiles || []);
    if (t.ok) setTemplates(t.templates || []);
    if (a.ok) setAccounts(a.accounts || []);
  }
  useEffect(() => { load(); }, []);

  // Map account.id → profile.id for grouping templates by class.
  const profileOfAccount = React.useMemo(() => {
    const m = new Map();
    for (const a of accounts) m.set(a.id, a.profile_id);
    return m;
  }, [accounts]);

  // Group templates by the profile of their first account (templates carry
  // accountIds, not profile_id directly; this is a sensible roll-up).
  const byProfile = React.useMemo(() => {
    const g = new Map();
    for (const t of templates) {
      const accId = (t.accountIds || [])[0];
      const pid = profileOfAccount.get(accId) || 0;
      if (!g.has(pid)) g.set(pid, []);
      g.get(pid).push(t);
    }
    return g;
  }, [templates, profileOfAccount]);

  async function del(id) {
    if (!confirm('Delete this schedule template?')) return;
    const r = await window.api.templates.delete({ token, id });
    if (r.ok) load();
  }

  return (
    <div>
      <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>Post Scheduling Configuration</h3>
        <div className="muted" style={{ fontSize: 12 }}>
          Schedule templates grouped by class (model). Templates are created and started under <strong>Scheduler Pro → Run</strong>.
        </div>
      </div>

      {profiles.length === 0 ? (
        <div className="empty-state">No model profiles yet.</div>
      ) : profiles.map((p) => {
        const tps = byProfile.get(p.id) || [];
        const open = openId === p.id;
        return (
          <div key={p.id} className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
            <button
              onClick={() => setOpenId(open ? null : p.id)}
              style={{
                width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              }}
            >
              <span style={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: p.avatar_color || 'var(--green-bright)', color: '#fff', fontWeight: 700 }}>
                {(p.name || '?').charAt(0).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-0)' }}>{p.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{tps.length} schedule{tps.length === 1 ? '' : 's'}</div>
              </div>
              <span style={{ color: 'var(--text-3)', fontSize: 18 }}>{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <div style={{ padding: '0 18px 14px 18px' }}>
                {tps.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12, padding: 10 }}>No schedules for this class yet.</div>
                ) : tps.map((t) => {
                  const subs = t.subreddits || [];
                  const shown = subs.slice(0, 3);
                  const more = subs.length - shown.length;
                  return (
                    <div key={t.id} style={{
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
                      padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10,
                      background: 'var(--bg-1)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600 }}>{t.name}</span>
                          <span className="muted" style={{ fontSize: 11 }}>({subs.length} subreddit{subs.length === 1 ? '' : 's'})</span>
                          {t.status === 'running' && <Tag tone="green">● running</Tag>}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {shown.map((s) => <Tag key={s} tone="blue">r/{s}</Tag>)}
                          {more > 0 && <Tag tone="neutral">+{more} more</Tag>}
                        </div>
                      </div>
                      <button className="ghost" onClick={() => del(t.id)} style={{ fontSize: 11, padding: '4px 10px' }}>Delete</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  ok: {
    background: 'rgba(122,154,90,0.12)',
    border: '1px solid var(--ok)',
    color: '#bdd5a3',
    padding: '10px 14px',
    borderRadius: 4,
    marginBottom: 12,
  },
};
