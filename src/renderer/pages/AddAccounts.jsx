import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

const TABS = [
  { key: 'bulk',   label: 'Bulk Paste',          hint: 'username:password per line' },
  { key: 'direct', label: 'Direct Input',        hint: 'one account at a time' },
  { key: 'login',  label: 'Login Authentication', hint: 'sign into Reddit in-app' },
];

const PLATFORMS = [
  { v: 'reddit',  label: 'Reddit' },
  { v: 'redgifs', label: 'RedGIFs' },
];

const STATUSES = [
  { v: 'warming', label: 'Warming' },
  { v: 'ready',   label: 'Live' },
  { v: 'paused',  label: 'Paused' },
];

export default function AddAccountsPage({ navigate }) {
  const { token } = useAuth();
  const [tab, setTab] = useState('bulk');
  const [profiles, setProfiles] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [form, setForm] = useState({
    profileId: '', platform: 'reddit', proxyId: '', status: 'warming',
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

      {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}
      {msg && <div style={okBanner}>{msg}</div>}

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
                  <input value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="reddit_handle" />
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
                in-app browser and sign into Reddit normally. The browser's cookies are stored
                in that account's isolated session, so the Inbox / Autopilot / Scheduler all
                read from the live login automatically.
              </div>
              <button className="primary" onClick={() => navigate && navigate('reddit')} style={{ marginTop: 18 }}>
                Open Reddit browser ↗
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const okBanner = { background: 'rgba(122,154,90,0.12)', border: '1px solid var(--ok)', color: '#bdd5a3', padding: '10px 14px', borderRadius: 4, marginBottom: 12 };
const tabBar = { display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-1)' };
const tabBtn = { flex: 1, background: 'transparent', border: 'none', color: 'var(--text-2)', padding: '14px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: -1, textAlign: 'left' };
const tabBtnActive = { color: 'var(--blue-bright)', borderBottomColor: 'var(--blue-bright)' };
