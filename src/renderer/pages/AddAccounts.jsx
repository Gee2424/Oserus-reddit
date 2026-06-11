import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Banner } from '../components/ui.jsx';
import ProxiesPanel from '../components/ProxiesPanel.jsx';

const TABS = [
  { key: 'bulk',    label: 'Bulk Paste',          hint: 'username:password per line' },
  { key: 'direct',  label: 'Direct Input',        hint: 'one account at a time' },
  { key: 'login',   label: 'Login Authentication', hint: 'sign into the platform in-app' },
  { key: 'warmup',  label: 'Warm-up Subs',         hint: 'communities for early account credibility (Reddit)' },
  { key: 'backup',  label: 'Backup Pool',          hint: 'replace banned accounts' },
  { key: 'proxies', label: 'Proxies',              hint: 'create/edit proxy pool' },
];

import { PLATFORMS } from '../lib/platforms.js';

const USER_AGENTS = [
  { v: '',                                                                                                       label: '— default (Windows / Chrome 127) —' },
  { v: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',     label: 'Windows · Chrome 127' },
  { v: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',  label: 'macOS · Safari 17' },
  { v: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',               label: 'Linux · Chrome 127' },
  { v: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', label: 'iPhone · Safari 17' },
  { v: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36', label: 'Android · Chrome 127' },
];

const STATUSES = [
  { v: 'warming', label: 'Warming' },
  { v: 'ready',   label: 'Live' },
  { v: 'paused',  label: 'Paused' },
];

export default function AddAccountsPage({ navigate, initialTab }) {
  const { token } = useAuth();
  const [tab, setTab] = useState(initialTab && TABS.some((t) => t.key === initialTab) ? initialTab : 'bulk');
  const [profiles, setProfiles] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [form, setForm] = useState({
    profileId: '', platform: 'reddit', proxyId: '', status: 'warming',
    userAgent: '',
    lines: '', username: '', password: '', email: '', emailPw: '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [last, setLast] = useState(null);

  useEffect(() => {
    window.api.profiles.list({ token }).then((r) => { if (r.ok) setProfiles(r.profiles); });
    window.api.proxies.list({ token }).then((r) => { if (r.ok) setProxies(r.proxies); });
  }, [token]);

  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 5000);
    return () => clearTimeout(t);
  }, [msg, err]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submitBulk() {
    if (!form.profileId) { setErr('Pick a class first.'); return; }
    if (!form.lines.trim()) { setErr('Paste accounts (one per line, username:password).'); return; }
    setBusy(true); setErr(null); setLast(null);
    const res = await window.api.accounts.bulkCreate({
      token,
      profileId: Number(form.profileId),
      platform: form.platform,
      proxyId: form.proxyId ? Number(form.proxyId) : null,
      status: form.status,
      userAgent: form.userAgent || null,
      lines: form.lines,
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`Added ${res.created.length} account${res.created.length === 1 ? '' : 's'}.${res.errors?.length ? ` ${res.errors.length} failed.` : ''}`);
      setLast(res);
      setForm((f) => ({ ...f, lines: '' }));
    } else setErr(res.error);
  }

  async function submitDirect() {
    if (!form.profileId) { setErr('Pick a class first.'); return; }
    if (!form.username || !form.password) { setErr('Username and password required.'); return; }
    setBusy(true); setErr(null);
    const res = await window.api.accounts.create({
      token,
      profileId: Number(form.profileId),
      platform: form.platform,
      username: form.username,
      password: form.password,
      email: form.email || null,
      emailPassword: form.emailPw || null,
      proxyId: form.proxyId ? Number(form.proxyId) : null,
      status: form.status,
      userAgent: form.userAgent || null,
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`Added u/${form.username}.`);
      setForm((f) => ({ ...f, username: '', password: '', email: '', emailPw: '' }));
    } else setErr(res.error);
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Accounts</div>
          <h1>Add Accounts</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Bulk-import, add one at a time, or open the browser to sign in directly.
          </div>
        </div>
      </div>

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Tab bar */}
        <div style={tabBar}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ ...tabBtn, ...(tab === t.key ? tabBtnActive : {}) }}>
              {t.label}
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>{t.hint}</span>
            </button>
          ))}
        </div>

        <div style={{ padding: 22 }}>
          {/* Shared: class / platform / proxy / status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>
            <div>
              <label>Class (model)</label>
              <select value={form.profileId} onChange={(e) => set('profileId', e.target.value)}>
                <option value="">— pick a class —</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label>Platform</label>
              <select value={form.platform} onChange={(e) => set('platform', e.target.value)}>
                {PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label>Proxy (recommended)</label>
              <select value={form.proxyId} onChange={(e) => set('proxyId', e.target.value)}>
                <option value="">— no proxy —</option>
                {proxies.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.kind}</option>)}
              </select>
            </div>
            <div>
              <label>Initial status</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label>User Agent (browser identity for these accounts' sessions)</label>
            <select value={form.userAgent} onChange={(e) => set('userAgent', e.target.value)}>
              {USER_AGENTS.map((u, i) => <option key={i} value={u.v}>{u.label}</option>)}
            </select>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Stored on the account for now; future builds will set it on the per-account browser session.
            </div>
          </div>

          {tab === 'bulk' && (
            <>
              <label>Accounts (one per line)</label>
              <textarea
                placeholder="username:password\nusername:password:email@x.com\nusername:password:email@x.com:emailpass"
                value={form.lines}
                onChange={(e) => set('lines', e.target.value)}
                style={{ minHeight: 200, fontFamily: 'var(--font-mono)', fontSize: 13 }}
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Format: <span className="mono">username:password</span> · optional email/email-password colon-separated · lines starting with # are skipped.
              </div>
              <button className="primary" onClick={submitBulk} disabled={busy} style={{ marginTop: 14 }}>
                {busy ? 'Adding…' : 'Add Accounts'}
              </button>

              {last && last.errors?.length > 0 && (
                <div style={{ marginTop: 14, padding: 12, background: 'rgba(180,90,90,0.08)', border: '1px solid #6e2c2c', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e2a3a3', marginBottom: 6 }}>{last.errors.length} line{last.errors.length === 1 ? '' : 's'} skipped:</div>
                  <ul style={{ fontSize: 11, color: '#c4a8a8', margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    {last.errors.slice(0, 10).map((e, i) => <li key={i}>Line {e.line}{e.username ? ` (${e.username})` : ''}: {e.error}</li>)}
                    {last.errors.length > 10 && <li>…and {last.errors.length - 10} more</li>}
                  </ul>
                </div>
              )}
            </>
          )}

          {tab === 'direct' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label>Username</label>
                  <input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="account_handle" />
                </div>
                <div>
                  <label>Password</label>
                  <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} />
                </div>
                <div>
                  <label>Email (optional)</label>
                  <input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="x@example.com" />
                </div>
                <div>
                  <label>Email password (optional)</label>
                  <input type="password" value={form.emailPw} onChange={(e) => set('emailPw', e.target.value)} />
                </div>
              </div>
              <button className="primary" onClick={submitDirect} disabled={busy} style={{ marginTop: 14 }}>
                {busy ? 'Adding…' : 'Add Account'}
              </button>
            </>
          )}

          {tab === 'login' && (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>◈</div>
              <h3 style={{ marginBottom: 6 }}>Sign in inside the in-app browser</h3>
              <div className="muted" style={{ fontSize: 13, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
                Create the empty account here first (Direct Input or Bulk), then open it in the
                in-app browser and sign into the platform normally. The browser's cookies are stored
                in that account's isolated session, so the Inbox / Autopilot / Scheduler all
                read from the live login automatically.
              </div>
              <button className="primary" onClick={() => navigate && navigate('profiles')} style={{ marginTop: 18 }}>
                Back to Models ↗
              </button>
            </div>
          )}

          {tab === 'warmup' && <WarmupSubsPanel token={token} />}

          {tab === 'backup' && <BackupPoolPanel token={token} />}

          {tab === 'proxies' && <ProxiesPanel />}
        </div>
      </div>
    </div>
  );
}

function WarmupSubsPanel({ token }) {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [vibe, setVibe] = useState('');
  const [desc, setDesc] = useState('');
  const [err, setErr] = useState(null);

  async function load() {
    const r = await window.api.subs.listWarmup({ token });
    if (r.ok) setList(r.subs || []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setErr(null);
    if (!name.trim()) { setErr('Subreddit name required.'); return; }
    const r = await window.api.subs.createWarmup({ token, name: name.trim(), vibe: vibe.trim() || null, description: desc.trim() || null });
    if (r.ok) { setName(''); setVibe(''); setDesc(''); load(); } else setErr(r.error);
  }
  async function del(id) {
    if (!confirm('Remove this warm-up subreddit?')) return;
    await window.api.subs.deleteWarmup({ token, id });
    load();
  }

  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
        The library of subreddits Grok picks from when generating warm-up posts for any account.
        Use mainstream, non-NSFW subs — these get used while accounts are still building karma.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 2fr auto', gap: 10, alignItems: 'end', marginBottom: 14 }}>
        <div>
          <label>Subreddit</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AskReddit" />
        </div>
        <div>
          <label>Vibe (optional)</label>
          <input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="curious · casual · funny…" />
        </div>
        <div>
          <label>Description (optional)</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="what people typically post here" />
        </div>
        <button className="primary" onClick={add}>+ Add</button>
      </div>
      {err && <Banner kind="err">{err}</Banner>}

      {list.length === 0 ? (
        <div className="muted" style={{ padding: 20, textAlign: 'center', fontSize: 13 }}>No warm-up subs yet. Add a few that your accounts can post in safely.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: 'var(--bg-2)' }}>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Subreddit</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Vibe</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Description</th>
              <th></th>
            </tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 14px' }}><span style={{ color: 'var(--gold)' }}>r/{s.name}</span></td>
                  <td style={{ padding: '10px 14px' }} className="muted">{s.vibe || '—'}</td>
                  <td style={{ padding: '10px 14px' }} className="muted">{s.description || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <button className="ghost" onClick={() => del(s.id)} style={{ fontSize: 11, padding: '4px 10px' }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BackupPoolPanel({ token }) {
  const [accounts, setAccounts] = useState([]);

  async function load() {
    const r = await window.api.accounts.listForUser({ token });
    if (r.ok) setAccounts(r.accounts || []);
  }
  useEffect(() => { load(); }, []);

  async function mark(id, status) {
    await window.api.accounts.bulkSetStatus({ token, accountIds: [id], status });
    load();
  }

  const operating = accounts.filter((a) => a.status === 'ready');
  const warming = accounts.filter((a) => a.status === 'warming');
  const banned = accounts.filter((a) => a.status === 'banned');

  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
        Account replenishment. Watch which accounts are burned and swap a warming/backup
        account into rotation with a single click. Marking "Live" promotes a warming
        account; marking "Banned" pulls a burned one out of rotation.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <BackupCol title={`Live · ${operating.length}`} accounts={operating} color="#7fd99a"
          actionLabel="Mark banned" onAct={(id) => mark(id, 'banned')} />
        <BackupCol title={`Backup · ${warming.length}`} accounts={warming} color="var(--gold)"
          actionLabel="Promote to Live" onAct={(id) => mark(id, 'ready')} />
        <BackupCol title={`Banned · ${banned.length}`} accounts={banned} color="#e2a3a3"
          actionLabel="Move to Backup" onAct={(id) => mark(id, 'warming')} />
      </div>
    </div>
  );
}

function BackupCol({ title, accounts, color, actionLabel, onAct }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 10, color, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
      {accounts.length === 0
        ? <div className="muted" style={{ fontSize: 12 }}>None.</div>
        : accounts.map((a) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>u/{a.username}</span>
            <button className="ghost" onClick={() => onAct(a.id)} style={{ fontSize: 10, padding: '3px 8px' }}>{actionLabel}</button>
          </div>
        ))}
    </div>
  );
}

const tabBar = { display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-1)' };
const tabBtn = { flex: 1, background: 'transparent', border: 'none', color: 'var(--text-2)', padding: '14px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1, textAlign: 'left' };
const tabBtnActive = { color: 'var(--blue-bright)', borderBottomColor: 'var(--blue-bright)' };
