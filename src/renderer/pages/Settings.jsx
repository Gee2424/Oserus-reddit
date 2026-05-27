import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
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
    if (!confirm('Remove the saved Anthropic API key? AI features will stop working until you add a new one.')) return;
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

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Your Account</h1>
        </div>
      </div>

      {isAdmin && (
        <div className="card" style={{ marginBottom: 22, borderColor: hasApiKey ? 'var(--ok)' : 'var(--border)' }}>
          <h3 style={{ marginBottom: 6 }}>Anthropic API key {hasApiKey && <span className="mono" style={{ fontSize: 11, color: 'var(--ok)', marginLeft: 8 }}>✓ configured</span>}</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Used by the AI composer to generate post ideas. Get a key at console.anthropic.com → API Keys. Stored encrypted on disk using your OS keychain.
          </div>
          {apiKeyMsg && (
            <div className={apiKeyMsg.kind === 'err' ? 'error-banner' : ''} style={apiKeyMsg.kind === 'ok' ? styles.ok : {}}>
              {apiKeyMsg.text}
            </div>
          )}
          <form onSubmit={saveApiKey} style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder={hasApiKey ? '••••••••••••••••  (paste a new key to replace)' : 'sk-ant-…'}
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
