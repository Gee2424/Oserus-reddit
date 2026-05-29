import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';

export default function IntelligencePage() {
  const { token } = useAuth();
  const { forPlatform } = useActiveAccount();
  const { accounts } = forPlatform('reddit');

  const [accountId, setAccountId] = useState('');
  const [subs, setSubs] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    const res = await window.api.intel.list({ token });
    if (res.ok) setRows(res.subs || []);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 5000);
    return () => clearTimeout(t);
  }, [msg, err]);

  async function run() {
    if (!accountId) { setErr('Pick a scraper account first.'); return; }
    if (!subs.trim()) { setErr('Enter at least one subreddit.'); return; }
    setBusy(true); setErr(null);
    await window.api.session.prepareForAccount({ accountId: Number(accountId) });
    const res = await window.api.intel.fetch({ token, accountId: Number(accountId), subreddits: subs });
    setBusy(false);
    if (res.ok) {
      setMsg(`Fetched ${res.fetched} subreddit(s).${res.errors?.length ? ` ${res.errors.length} failed.` : ''}`);
      if (res.errors?.length) setErr(res.errors.join(' · '));
      load();
    } else setErr(res.error);
  }

  async function del(name) {
    await window.api.intel.delete({ token, name });
    load();
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Research</div>
          <h1>Reddit Intelligence</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Scrape subreddit requirements (subscribers, karma/age gates, rules) using a logged-in account.
          </div>
        </div>
      </div>

      <div style={{ background: 'rgba(60,110,180,0.10)', border: '1px solid #2c4a6e', borderRadius: 'var(--radius-lg)', padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#9fc0ea' }}>
        ⓘ Beta: karma/age gates depend on what each subreddit exposes — some hide them, so those columns may be blank.
      </div>

      {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}
      {msg && <div style={okBanner}>{msg}</div>}

      <div className="card" style={{ marginBottom: 22, padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
          <div>
            <label>Scraper account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— select an account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>u/{a.username} · {a.profile_name}</option>)}
            </select>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              The logged-in account used to fetch the data.
            </div>
          </div>
          <div>
            <label>Subreddits (one per line)</label>
            <textarea
              value={subs}
              onChange={(e) => setSubs(e.target.value)}
              placeholder={'gonewild\nnsfw\nRealGirls'}
              style={{ minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 13 }}
            />
          </div>
        </div>
        <button className="primary" onClick={run} disabled={busy} style={{ marginTop: 14, width: '100%' }}>
          {busy ? 'Fetching…' : 'Start Intelligence Fetch'}
        </button>
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)' }}>
                  <th style={th}>Subreddit</th>
                  <th style={{ ...th, textAlign: 'right' }}>Subscribers</th>
                  <th style={th}>NSFW</th>
                  <th style={th}>Type</th>
                  <th style={{ ...th, textAlign: 'right' }}>Min age</th>
                  <th style={{ ...th, textAlign: 'right' }}>Min post k</th>
                  <th style={{ ...th, textAlign: 'right' }}>Min cmt k</th>
                  <th style={th}>Rules</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={td}><span style={{ color: 'var(--gold)' }}>r/{r.name}</span></td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{r.subscribers != null ? r.subscribers.toLocaleString() : '—'}</td>
                    <td style={td}>{r.over18 ? <span style={{ color: '#d9a3d9' }}>NSFW</span> : <span className="dim">SFW</span>}</td>
                    <td style={td} className="mono" >{r.submission_type || 'any'}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_account_age_days ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_post_karma ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_comment_karma ?? '—'}</td>
                    <td style={td}>{r.rules?.length ? <span className="dim">{r.rules.length} rule{r.rules.length > 1 ? 's' : ''}</span> : <span className="dim">—</span>}</td>
                    <td style={{ ...td, textAlign: 'right' }}><button className="ghost" onClick={() => del(r.name)} style={{ fontSize: 11, padding: '3px 8px' }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const okBanner = { background: 'rgba(122,154,90,0.12)', border: '1px solid var(--ok)', color: '#bdd5a3', padding: '10px 14px', borderRadius: 4, marginBottom: 12 };
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)' };
const td = { padding: '9px 12px', verticalAlign: 'middle' };
