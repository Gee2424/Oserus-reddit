import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';

const STATUS_OPTIONS = [
  { v: 'warming', label: 'Warming up' },
  { v: 'ready', label: 'Ready' },
  { v: 'paused', label: 'Paused' },
  { v: 'banned', label: 'Banned' },
];

const STATUS_COLORS = { warming: '#d4a55a', ready: '#7a9a5a', paused: '#968b78', banned: '#b3473a' };

const PLATFORMS = [
  { v: 'reddit', label: 'Reddit', icon: '🔴', usernamePrefix: 'u/' },
  { v: 'redgifs', label: 'RedGifs', icon: '🟠', usernamePrefix: '@' },
];

export default function ModelDetailPage({ modelId, navigate }) {
  const { token, user } = useAuth();
  const { refresh: refreshActive, startAccount } = useActiveAccount();
  const [model, setModel] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [promoSubs, setPromoSubs] = useState([]);
  const [newPromoSub, setNewPromoSub] = useState('');
  const [promoSubError, setPromoSubError] = useState(null);
  const [showAddPlatform, setShowAddPlatform] = useState(null); // 'reddit' or 'redgifs'
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const canManage = user.role === 'admin' || user.role === 'manager';

  function blankForm() {
    return {
      username: '', password: '', email: '', emailPassword: '',
      status: 'warming', proxy_id: '', notes: '',
    };
  }

  async function load() {
    setLoading(true);
    const [profilesRes, accountsRes, proxiesRes, promoRes] = await Promise.all([
      window.api.profiles.list({ token }),
      window.api.accounts.listForProfile({ token, profileId: Number(modelId) }),
      window.api.proxies.list({ token }),
      window.api.subs.listPromo({ token, profileId: Number(modelId) }),
    ]);
    if (profilesRes.ok) {
      const found = profilesRes.profiles.find(p => p.id === Number(modelId));
      setModel(found || null);
    }
    if (accountsRes.ok) setAccounts(accountsRes.accounts);
    if (proxiesRes.ok) setProxies(proxiesRes.proxies);
    if (promoRes.ok) setPromoSubs(promoRes.subs);
    setLoading(false);
  }

  async function addPromoSub(e) {
    e.preventDefault();
    setPromoSubError(null);
    if (!newPromoSub.trim()) return;
    const res = await window.api.subs.createPromo({
      token, profileId: Number(modelId), name: newPromoSub.trim(),
    });
    if (!res.ok) { setPromoSubError(res.error); return; }
    setNewPromoSub('');
    load();
  }

  async function delPromoSub(id) {
    await window.api.subs.deletePromo({ token, id });
    load();
  }

  useEffect(() => { load(); }, [modelId]);

  function startAddFor(platform) {
    setEditing(null);
    setForm(blankForm());
    setShowAddPlatform(platform);
    setError(null);
  }

  function startEdit(account) {
    setEditing(account);
    setForm({
      username: account.username,
      password: '',
      email: account.email || '',
      emailPassword: '',
      status: account.status,
      proxy_id: account.proxy_id || '',
      notes: account.notes || '',
    });
    setShowAddPlatform(account.platform);
  }

  function cancel() {
    setShowAddPlatform(null);
    setEditing(null);
    setForm(blankForm());
    setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.username) { setError('Username required'); return; }
    let res;
    if (editing) {
      const updates = {
        status: form.status,
        proxy_id: form.proxy_id ? Number(form.proxy_id) : null,
        notes: form.notes,
        email: form.email || null,
      };
      if (form.password) updates.password = form.password;
      if (form.emailPassword) updates.emailPassword = form.emailPassword;
      res = await window.api.accounts.update({ token, accountId: editing.id, updates });
    } else {
      res = await window.api.accounts.create({
        token,
        profileId: Number(modelId),
        platform: showAddPlatform,
        username: form.username.trim().replace(/^[u@]\//, '').replace(/^@/, ''),
        password: form.password || null,
        email: form.email || null,
        emailPassword: form.emailPassword || null,
        status: form.status,
        proxyId: form.proxy_id ? Number(form.proxy_id) : null,
        notes: form.notes,
      });
    }
    if (!res.ok) { setError(res.error); return; }
    cancel();
    await load();
    await refreshActive();
  }

  async function quickStatus(accountId, status) {
    await window.api.accounts.update({ token, accountId, updates: { status } });
    await load();
    await refreshActive();
  }

  async function del(accountId) {
    if (!confirm('Delete this account record? The actual account on the platform is untouched.')) return;
    await window.api.accounts.delete({ token, accountId });
    await load();
    await refreshActive();
  }

  async function start(accountId) {
    await startAccount(accountId);
    navigate('reddit');
  }

  if (loading) {
    return <div className="empty-state">Loading…</div>;
  }
  if (!model) {
    return (
      <div className="empty-state">
        <h2 style={{ marginBottom: 8 }}>Model not found</h2>
        <button className="primary" onClick={() => navigate('profiles')}>← Back to models</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <button className="ghost" onClick={() => navigate('profiles')} style={{ fontSize: 12 }}>← All models</button>
      </div>

      <div className="title-block" style={{ borderLeft: `4px solid ${model.avatar_color || 'var(--accent)'}`, paddingLeft: 16 }}>
        <div style={{ flex: 1 }}>
          <div className="eyebrow">Model profile</div>
          <h1>{model.name}</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            {model.niche && <span className="pill" style={{ marginRight: 8 }}>{model.niche}</span>}
            {model.assigned_to_name && <>Assigned to <span style={{ color: 'var(--text-1)' }}>{model.assigned_to_username}</span></>}
          </div>
        </div>
      </div>

      {(model.brand_voice || model.notes) && (
        <div className="card" style={{ marginBottom: 22 }}>
          {model.brand_voice && (
            <div style={{ marginBottom: model.notes ? 8 : 0 }}>
              <label>Brand voice</label>
              <div style={{ fontStyle: 'italic', color: 'var(--text-1)' }}>"{model.brand_voice}"</div>
            </div>
          )}
          {model.notes && (
            <div>
              <label>Notes</label>
              <div className="muted">{model.notes}</div>
            </div>
          )}
        </div>
      )}

      {PLATFORMS.map(plat => {
        const platAccounts = accounts.filter(a => (a.platform || 'reddit') === plat.v);
        const isAddingThis = showAddPlatform === plat.v && !editing;
        const isEditingThis = editing && editing.platform === plat.v;

        return (
          <div key={plat.v} style={{ marginBottom: 28 }}>
            <div style={styles.platformHeader}>
              <span style={{ fontSize: 20 }}>{plat.icon}</span>
              <h2>{plat.label} accounts</h2>
              <span className="mono dim" style={{ fontSize: 12 }}>{platAccounts.length} linked</span>
              <div style={{ flex: 1 }} />
              {canManage && (
                <button className="primary" onClick={() => startAddFor(plat.v)}>
                  + Link {plat.label} account
                </button>
              )}
            </div>

            {(isAddingThis || isEditingThis) && (
              <form onSubmit={submit} className="card" style={{ marginBottom: 14 }}>
                <h3 style={{ marginBottom: 14 }}>
                  {editing ? `Edit ${plat.label} account` : `Link new ${plat.label} account`}
                </h3>
                {error && <div className="error-banner">{error}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                  <div>
                    <label>{plat.label} username</label>
                    <input
                      value={form.username}
                      disabled={!!editing}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder={plat.v === 'reddit' ? 'e.g. throwaway_redhead' : 'e.g. luna_creator'}
                    />
                  </div>
                  <div>
                    <label>Password {editing && <span className="dim mono" style={{textTransform:'none',letterSpacing:0,fontSize:10}}>(leave blank to keep)</span>}</label>
                    <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  </div>
                  <div>
                    <label>Linked email (optional)</label>
                    <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div>
                    <label>Email password (optional)</label>
                    <input type="text" value={form.emailPassword} onChange={(e) => setForm({ ...form, emailPassword: e.target.value })} />
                  </div>
                  <div>
                    <label>Status</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      {STATUS_OPTIONS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Proxy</label>
                    <select value={form.proxy_id} onChange={(e) => setForm({ ...form, proxy_id: e.target.value })}>
                      <option value="">— no proxy —</option>
                      {proxies.map(p => <option key={p.id} value={p.id}>{p.label} ({p.kind} {p.host}:{p.port})</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label>Notes</label>
                    <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="primary">{editing ? 'Save changes' : 'Link account'}</button>
                  <button type="button" className="ghost" onClick={cancel}>Cancel</button>
                </div>
              </form>
            )}

            {platAccounts.length === 0 ? (
              <div className="empty-state" style={{ padding: 28, fontSize: 13 }}>
                No {plat.label} accounts linked yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {platAccounts.map(a => (
                  <div key={a.id} style={styles.accountRow}>
                    <button
                      className="primary"
                      onClick={() => start(a.id)}
                      style={styles.startBtn}
                      title={`Open ${plat.label} as ${a.username}`}
                    >▶</button>
                    <span style={{ ...styles.dot, background: STATUS_COLORS[a.status] }} title={a.status} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        <span className="mono dim">{plat.usernamePrefix}</span>{a.username}
                        {a.has_password && <span className="mono dim" style={{ fontSize: 11, marginLeft: 8 }}>🔑</span>}
                      </div>
                      {a.notes && <div className="muted" style={{ fontSize: 12 }}>{a.notes}</div>}
                    </div>
                    {a.proxy_label && (
                      <span className="mono dim" style={{ fontSize: 11 }}>
                        via {a.proxy_label}
                      </span>
                    )}
                    <select
                      value={a.status}
                      onChange={(e) => quickStatus(a.id, e.target.value)}
                      style={styles.miniSelect}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                    </select>
                    {canManage && (
                      <>
                        <button className="ghost" onClick={() => startEdit(a)}>Edit</button>
                        <button className="danger" onClick={() => del(a.id)}>Remove</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ marginBottom: 28 }}>
        <div style={styles.platformHeader}>
          <span style={{ fontSize: 20 }}>🎯</span>
          <h2>NSFW promo subreddits</h2>
          <span className="mono dim" style={{ fontSize: 12 }}>{promoSubs.length} configured</span>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            When this model's accounts are in <strong>ready</strong> status, the AI composer pulls from this list for NSFW promo post suggestions.
          </div>
          <form onSubmit={addPromoSub} style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Add a subreddit (e.g. gonewild, RealGirls)"
              value={newPromoSub}
              onChange={(e) => setNewPromoSub(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="primary">Add</button>
          </form>
          {promoSubError && <div className="error-banner" style={{ marginTop: 10 }}>{promoSubError}</div>}
        </div>

        {promoSubs.length === 0 ? (
          <div className="empty-state" style={{ padding: 22, fontSize: 13 }}>
            No promo subreddits configured for this model yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {promoSubs.map(s => (
              <div key={s.id} style={styles.subChip}>
                <span className="mono">r/{s.name}</span>
                <button
                  onClick={() => delPromoSub(s.id)}
                  style={styles.subChipClose}
                  title="Remove"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  platformHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
  },
  accountRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px 8px 8px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
  },
  startBtn: {
    width: 36,
    height: 36,
    padding: 0,
    borderRadius: '50%',
    fontSize: 14,
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
  },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  miniSelect: { width: 'auto', padding: '5px 8px', fontSize: 12 },
  subChip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 4px 6px 12px',
    background: 'var(--bg-elev)', border: '1px solid var(--border)',
    borderRadius: 999, fontSize: 12,
  },
  subChipClose: {
    width: 22, height: 22, padding: 0, fontSize: 14, lineHeight: 1,
    background: 'transparent', border: 'none', color: 'var(--text-3)',
    borderRadius: '50%',
  },
};
