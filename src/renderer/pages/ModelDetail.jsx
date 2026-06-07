import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { useActiveAccount, pickPreferredAccount } from '../lib/activeAccount.jsx';
import { PLATFORMS as SHARED_PLATFORMS } from '../lib/platforms.js';

const STATUS_OPTIONS = [
  { v: 'warming', label: 'Warming up' },
  { v: 'ready', label: 'Ready' },
  { v: 'paused', label: 'Paused' },
  { v: 'banned', label: 'Banned' },
];

const STATUS_COLORS = { warming: '#d4a55a', ready: '#7a9a5a', paused: '#968b78', banned: '#b3473a' };

// Add an emoji icon on top of the shared platform metadata for the section
// headers — everything else (color, label, login URL) comes from the single
// source of truth in lib/platforms.js.
const PLAT_ICONS = { reddit: '🔴', redgifs: '🟠', x: '🔵', instagram: '🟣', tiktok: '⚫' };
const PLATFORMS = SHARED_PLATFORMS.map((p) => ({ ...p, icon: PLAT_ICONS[p.v] || '◈' }));

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

  const [showAddProxy, setShowAddProxy] = useState(false);
  const [proxyForm, setProxyForm] = useState({ label: '', kind: 'http', host: '', port: '', username: '', password: '' });
  const [proxyError, setProxyError] = useState(null);

  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [activityEntries, setActivityEntries] = useState([]);
  const [modelDocs, setModelDocs] = useState([]);
  const [tab, setTab] = useState('resources'); // resources | analytics | activity
  // Reddit + RedGIFs share a single "Reddit" group inside Linked accounts —
  // this picks which sub-platform's section is currently visible.
  const [redditSub, setRedditSub] = useState('reddit');
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const can = useCan();
  const canManage = can('profiles.manage');
  const canViewActivity = can('activity.view');

  function blankForm() {
    return {
      username: '', password: '', email: '', emailPassword: '',
      status: 'warming', proxy_id: '', notes: '',
    };
  }

  async function load() {
    setLoading(true);
    const [profilesRes, accountsRes, proxiesRes, promoRes, schedRes, activityRes, docsRes] = await Promise.all([
      window.api.profiles.list({ token }),
      window.api.accounts.listForProfile({ token, profileId: Number(modelId) }),
      window.api.proxies.list({ token }),
      window.api.subs.listPromo({ token, profileId: Number(modelId) }),
      window.api.scheduled.list({ token, profileId: Number(modelId) }),
      canViewActivity
        ? window.api.activity.list({ token, limit: 20 })
        : Promise.resolve({ ok: true, entries: [] }),
      window.api.docs.list({ token, profileId: Number(modelId) }),
    ]);
    if (profilesRes.ok) {
      const found = profilesRes.profiles.find(p => p.id === Number(modelId));
      setModel(found || null);
    }
    if (accountsRes.ok) setAccounts(accountsRes.accounts);
    if (proxiesRes.ok) setProxies(proxiesRes.proxies);
    if (promoRes.ok) setPromoSubs(promoRes.subs);
    if (schedRes.ok) setScheduledPosts(schedRes.posts);
    if (activityRes.ok) setActivityEntries(activityRes.entries);
    if (docsRes.ok) setModelDocs(docsRes.docs);
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
    // Browsing happens in a dedicated Oserus Browser window now, not an
    // in-app page.
    await window.api.oserusBrowser.openAccount({ token, accountId });
  }

  async function addProxy(e) {
    e.preventDefault();
    setProxyError(null);
    if (!proxyForm.host || !proxyForm.port) { setProxyError('Host and port required'); return; }
    const res = await window.api.proxies.create({
      token,
      label: proxyForm.label || `${proxyForm.host}:${proxyForm.port}`,
      kind: proxyForm.kind,
      host: proxyForm.host,
      port: Number(proxyForm.port),
      username: proxyForm.username || null,
      password: proxyForm.password || null,
    });
    if (!res.ok) { setProxyError(res.error); return; }
    setProxyForm({ label: '', kind: 'http', host: '', port: '', username: '', password: '' });
    setShowAddProxy(false);
    await load();
  }

  // Which proxies are actually attached to this model's accounts?
  const usedProxyIds = new Set(accounts.map(a => a.proxy_id).filter(Boolean));
  const modelProxies = proxies.filter(p => usedProxyIds.has(p.id));
  const proxyUsageCount = (proxyId) => accounts.filter(a => a.proxy_id === proxyId).length;

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

      <div className="title-block" style={{ alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: model.avatar_color
            ? `linear-gradient(135deg, ${model.avatar_color}, var(--gold))`
            : 'var(--gradient-brand)',
          color: '#1a1a14',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700,
          boxShadow: '0 4px 14px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06) inset',
          flexShrink: 0,
        }}>
          {(model.name || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div className="eyebrow">Model profile</div>
          <h1 style={{ marginTop: 2 }}>{model.name}</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {model.niche && <span className="pill green">{model.niche}</span>}
            <span className="mono dim">{accounts.filter(a => a.platform !== 'redgifs').length} Reddit · {accounts.filter(a => a.platform === 'redgifs').length} RedGifs · {modelProxies.length} proxies</span>
            {model.assigned_to_name && <>Assigned to <span style={{ color: 'var(--text-1)' }}>{model.assigned_to_username}</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {accounts.some(a => a.platform !== 'redgifs') && (
            <button
              title="Start the first Reddit account and open the Reddit browser"
              onClick={async () => {
                const pick = pickPreferredAccount(accounts.filter(a => a.platform !== 'redgifs'));
                if (pick) {
                  await startAccount(pick.id);
                  await window.api.oserusBrowser.openAccount({ token, accountId: pick.id });
                }
              }}
              style={playBtnStyle}
            >▶ Reddit</button>
          )}
          {accounts.some(a => a.platform === 'redgifs') && (
            <button
              title="Start the first RedGifs account and open the RedGifs browser"
              onClick={async () => {
                const pick = pickPreferredAccount(accounts.filter(a => a.platform === 'redgifs'));
                if (pick) { await startAccount(pick.id); navigate('redgifs'); }
              }}
              style={playBtnStyle}
            >▶ RedGifs</button>
          )}
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

      <div style={tabBarStyle}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { v: 'resources', label: 'Linked accounts', count: accounts.length + modelProxies.length },
            { v: 'analytics', label: 'Analytics', count: 0 },
            ...(canManage ? [{ v: 'activity', label: 'Activity', count: activityEntries.length }] : []),
          ].map(t => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              style={{
                ...tabStyle,
                ...(tab === t.v ? tabActiveStyle : {}),
              }}
            >
              {t.label}
              {t.count > 0 && <span className="mono dim" style={{ marginLeft: 6, fontSize: 11 }}>{t.count}</span>}
            </button>
          ))}
        </div>
        {canManage && tab === 'resources' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="dim" style={{ fontSize: 11, marginRight: 4 }}>+ Add account:</span>
            {PLATFORMS.map((plat) => {
              const active = showAddPlatform === plat.v;
              const connected = accounts.filter((a) => (a.platform || 'reddit') === plat.v).length;
              return (
                <button
                  key={plat.v}
                  onClick={() => {
                    if (connected > 0) {
                      // Already linked — surface that fact instead of silently
                      // popping a second-add form. User can still add another
                      // from the per-platform section below.
                      alert(`Account already connected (${connected} ${plat.label} ${connected === 1 ? 'account' : 'accounts'}). Scroll down to that section to add another or manage them.`);
                      return;
                    }
                    startAddFor(plat.v);
                  }}
                  title={connected > 0 ? `Account already connected · ${connected}` : `Link a new ${plat.label} account to this model`}
                  style={{
                    background: active ? plat.color : 'var(--bg-1)',
                    color: active ? '#fff' : 'var(--text-1)',
                    border: `1px solid ${active ? plat.color : (connected > 0 ? 'var(--green)' : 'var(--border)')}`,
                    borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', opacity: connected > 0 ? 0.85 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: plat.color }} />
                  {plat.label}
                  {connected > 0 && <span style={{ fontSize: 9, color: 'var(--green-bright)', fontWeight: 700 }}>✓</span>}
                </button>
              );
            })}
            <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            <button
              onClick={() => setShowAddProxy(true)}
              className="ghost"
              style={{ fontSize: 12, padding: '5px 12px' }}
              title="Add a proxy to this model"
            >⌁ Proxy</button>
          </div>
        )}
      </div>

      {tab === 'resources' && (
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-elev)' }}>
          <h2 style={{ margin: 0, fontSize: 14, color: 'var(--gold-bright)' }}>Reddit ↔ RedGIFs</h2>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 999, padding: 2 }}>
            {[
              { k: 'reddit',  label: 'Reddit',  color: '#ff4500' },
              { k: 'redgifs', label: 'RedGIFs', color: '#ff2e74' },
            ].map((s) => {
              const active = redditSub === s.k;
              const n = accounts.filter((a) => (a.platform || 'reddit') === s.k).length;
              return (
                <button key={s.k} onClick={() => setRedditSub(s.k)} style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 999,
                  border: 'none', cursor: 'pointer',
                  background: active ? s.color : 'transparent',
                  color: active ? '#fff' : 'var(--text-2)',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
                  {s.label} <span style={{ opacity: 0.75 }}>· {n}</span>
                </button>
              );
            })}
          </div>
          <span className="dim" style={{ fontSize: 11, marginLeft: 'auto' }}>Reddit & RedGIFs accounts live in the same section — switch above.</span>
        </div>
      )}

      {tab === 'resources' && PLATFORMS.filter((p) => {
        // Reddit + RedGIFs share a section. Show whichever sub-platform is
        // currently picked; everything else (X, IG, TikTok) always renders.
        if (p.v === 'reddit')  return redditSub === 'reddit';
        if (p.v === 'redgifs') return redditSub === 'redgifs';
        return true;
      }).map(plat => {
        const platAccounts = accounts.filter(a => (a.platform || 'reddit') === plat.v);
        const isAddingThis = showAddPlatform === plat.v && !editing;
        const isEditingThis = editing && editing.platform === plat.v;

        // Empty X / IG / TikTok sections never render — the + Add pill row
        // above is the only way in, and the add form pops up as a modal.
        // Reddit + RedGIFs keep their empty header so the toggle stays
        // discoverable. We still render an empty section when the user has
        // started adding to it, otherwise the modal form has nothing to
        // mount inside.
        if (!platAccounts.length && !isEditingThis && !isAddingThis) {
          if (plat.v !== 'reddit' && plat.v !== 'redgifs') return null;
        }

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
              <div onClick={cancel} style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,0.6)',
                display: 'grid', placeItems: 'center', padding: 20,
              }}>
              <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card" style={{
                marginBottom: 0, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
                boxShadow: '0 24px 60px -10px rgba(0,0,0,0.7)',
                borderTop: `3px solid ${plat.color}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: plat.color, marginRight: 8 }} />
                  <h3 style={{ margin: 0, flex: 1 }}>
                    {editing ? `Edit ${plat.label} account` : `Link new ${plat.label} account`}
                  </h3>
                  <button type="button" className="ghost" onClick={cancel} style={{ fontSize: 12, padding: '4px 10px' }}>✕</button>
                </div>
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
              </div>
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
                    <button
                      className="ghost"
                      onClick={async () => {
                        try {
                          const r = await window.api.chrome.launch({
                            accountId: a.id,
                            accountUsername: a.username,
                            profileSlug: model?.name || 'default',
                            proxyUrl: a.proxy_url || model?.proxy_url || null,
                            startUrl: 'https://www.reddit.com',
                          });
                          if (r && r.ok === false) alert(r.error || 'Real Chrome launch failed.');
                        } catch (e) { alert(e.message || 'Real Chrome launch failed.'); }
                      }}
                      style={{ fontSize: 11, padding: '4px 8px' }}
                      title="Open this account in real Chrome with its own user-data-dir and proxy"
                    >Real Chrome</button>
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

      {tab === 'resources' && (
      <div style={{ marginBottom: 28 }}>
        <div style={styles.platformHeader}>
          <span style={{ fontSize: 20 }}>⌁</span>
          <h2>Proxies</h2>
          <span className="mono dim" style={{ fontSize: 12 }}>
            {modelProxies.length} in use{proxies.length > modelProxies.length ? ` · ${proxies.length - modelProxies.length} available` : ''}
          </span>
          <div style={{ flex: 1 }} />
          {canManage && (
            <button className="primary" onClick={() => setShowAddProxy(v => !v)}>
              {showAddProxy ? 'Cancel' : '+ Add proxy'}
            </button>
          )}
        </div>

        {showAddProxy && (
          <form onSubmit={addProxy} className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 14 }}>New proxy</h3>
            {proxyError && <div className="error-banner">{proxyError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label>Label</label>
                <input value={proxyForm.label} onChange={(e) => setProxyForm({ ...proxyForm, label: e.target.value })} placeholder="e.g. Mobile 1" />
              </div>
              <div>
                <label>Kind</label>
                <select value={proxyForm.kind} onChange={(e) => setProxyForm({ ...proxyForm, kind: e.target.value })}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>
              <div>
                <label>Host</label>
                <input value={proxyForm.host} onChange={(e) => setProxyForm({ ...proxyForm, host: e.target.value })} placeholder="proxy.example.com" />
              </div>
              <div>
                <label>Port</label>
                <input type="number" value={proxyForm.port} onChange={(e) => setProxyForm({ ...proxyForm, port: e.target.value })} placeholder="1080" />
              </div>
              <div>
                <label>Username</label>
                <input value={proxyForm.username} onChange={(e) => setProxyForm({ ...proxyForm, username: e.target.value })} placeholder="optional" />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label>Password</label>
                <input type="text" value={proxyForm.password} onChange={(e) => setProxyForm({ ...proxyForm, password: e.target.value })} placeholder="optional" />
              </div>
            </div>
            <button type="submit" className="primary">Save proxy</button>
          </form>
        )}

        {modelProxies.length === 0 ? (
          <div className="empty-state" style={{ padding: 22, fontSize: 13 }}>
            No proxies in use by this model's accounts.
            {canManage && proxies.length > 0 && ' Open an account above to assign one of your existing proxies.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {modelProxies.map(p => (
              <div key={p.id} style={styles.accountRow}>
                <div style={{ ...styles.dot, background: 'var(--green-bright)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {p.label}
                    {p.has_password && <span className="mono dim" style={{ fontSize: 11, marginLeft: 8 }}>🔑</span>}
                  </div>
                  <div className="muted mono" style={{ fontSize: 12 }}>
                    {p.kind} · {p.host}:{p.port}
                    {p.username && ` · ${p.username}`}
                  </div>
                </div>
                <span className="mono dim" style={{ fontSize: 11 }}>
                  {proxyUsageCount(p.id)} account{proxyUsageCount(p.id) === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {tab === 'inbox' && (
        <div style={{ marginBottom: 28 }}>
          <div className="card bordered-glow">
            <h3 style={{ marginBottom: 6 }}>Inbox for {model.name}</h3>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
              Per-account Reddit DM and modmail viewer goes here. Needs Reddit OAuth
              connected on each account — one-click <strong>Connect to Reddit</strong>
              button shipping next release. Until then, use the Reddit browser ▶ button
              up top to open the inbox manually.
            </div>
          </div>
        </div>
      )}

      {tab === 'analytics' && (
        <ModelAnalyticsTab token={token} profileId={Number(modelId)} accounts={accounts} />
      )}

      {tab === 'scheduler' && (
      <div style={{ marginBottom: 28 }}>
        <div style={styles.platformHeader}>
          <span style={{ fontSize: 20 }}>◷</span>
          <h2>Scheduled posts</h2>
          <span className="mono dim" style={{ fontSize: 12 }}>
            {scheduledPosts.filter(p => p.status === 'pending').length} upcoming
          </span>
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={() => navigate('scheduler')}>Open Scheduler →</button>
        </div>
        {scheduledPosts.length === 0 ? (
          <div className="empty-state" style={{ padding: 22, fontSize: 13 }}>
            No posts scheduled for this model's accounts yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {scheduledPosts.slice(0, 5).map(p => (
              <div key={p.id} style={styles.accountRow}>
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 10, fontFamily: 'var(--font-mono)',
                  background: p.status === 'pending' ? 'rgba(212,166,74,0.12)' : 'rgba(255,255,255,0.04)',
                  color: p.status === 'pending' ? 'var(--gold-bright)' : 'var(--text-2)',
                  border: `1px solid ${p.status === 'pending' ? 'var(--gold)' : 'var(--border-strong)'}`,
                  textTransform: 'uppercase',
                }}>{p.status}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.title}</div>
                  <div className="muted mono" style={{ fontSize: 11 }}>
                    r/{p.subreddit} · u/{p.account_username} · {new Date(p.scheduled_for).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
            {scheduledPosts.length > 5 && (
              <button className="ghost" onClick={() => navigate('scheduler')} style={{ alignSelf: 'flex-start' }}>
                +{scheduledPosts.length - 5} more in Scheduler
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {tab === 'activity' && canViewActivity && activityEntries.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={styles.platformHeader}>
            <span style={{ fontSize: 20 }}>☷</span>
            <h2>Recent activity</h2>
            <div style={{ flex: 1 }} />
            <button className="ghost" onClick={() => navigate('activity')}>Full log →</button>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {activityEntries.slice(0, 6).map((e, i) => (
              <div key={e.id} style={{
                padding: '10px 14px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
              }}>
                <span className="mono dim" style={{ fontSize: 11, minWidth: 130 }}>
                  {new Date(e.created_at + 'Z').toLocaleString()}
                </span>
                <span style={{ minWidth: 90 }}>{e.username || <span className="dim">system</span>}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--gold-bright)' }}>{e.action}</span>
                <span className="muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'docs' && (
      <div style={{ marginBottom: 28 }}>
        <div style={styles.platformHeader}>
          <span style={{ fontSize: 20 }}>◫</span>
          <h2>Docs for this model</h2>
          <span className="mono dim" style={{ fontSize: 12 }}>{modelDocs.length}</span>
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={() => navigate('docs')}>Open Docs →</button>
        </div>
        {modelDocs.length === 0 ? (
          <div className="empty-state" style={{ padding: 22, fontSize: 13 }}>
            No docs attached. Open Docs → New doc → pick this model from the dropdown.
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {modelDocs.slice(0, 5).map((d, i) => (
              <button
                key={d.id}
                onClick={() => navigate('docs')}
                style={{
                  textAlign: 'left', width: '100%',
                  padding: '12px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  borderRadius: 0,
                  color: 'var(--text-0)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500 }}>{d.title}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {d.author_name || 'unknown'} · updated {new Date(d.updated_at + 'Z').toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {tab === 'promo' && (
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
      )}
    </div>
  );
}

function ModelAnalyticsTab({ token, profileId, accounts }) {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    window.api.analytics.summary({ token, profileId }).then(r => {
      if (alive && r.ok) setData(r);
    });
    return () => { alive = false; };
  }, [token, profileId]);

  if (!data) return <div className="empty-state">Loading analytics…</div>;

  const reddit = data.accounts.filter(a => a.platform !== 'redgifs');
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Accounts</div>
          <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', marginTop: 2 }}>{data.totals.accounts}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Ready</div>
          <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color: '#7a9a5a', marginTop: 2 }}>{data.totals.ready}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Warming</div>
          <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color: '#d4a55a', marginTop: 2 }}>{data.totals.warming}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Total karma</div>
          <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color: 'var(--gold-bright)', marginTop: 2 }}>{data.totals.total_karma.toLocaleString()}</div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <h3>Per-account karma</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Manual snapshots for now. Open <strong>Analytics</strong> in the sidebar to record new ones.
          </div>
        </div>
        {reddit.length === 0 ? (
          <div className="empty-state" style={{ padding: 30, border: 'none' }}>No Reddit accounts.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 14px', fontWeight: 500 }}>Account</th>
                <th style={{ padding: '10px 14px', fontWeight: 500 }}>Post karma</th>
                <th style={{ padding: '10px 14px', fontWeight: 500 }}>Comment karma</th>
                <th style={{ padding: '10px 14px', fontWeight: 500 }}>Scheduled</th>
              </tr>
            </thead>
            <tbody>
              {reddit.map(a => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 14px' }} className="mono">u/{a.username}</td>
                  <td style={{ padding: '8px 14px' }}>{a.post_karma == null ? <span className="dim">—</span> : a.post_karma.toLocaleString()}</td>
                  <td style={{ padding: '8px 14px' }}>{a.comment_karma == null ? <span className="dim">—</span> : a.comment_karma.toLocaleString()}</td>
                  <td style={{ padding: '8px 14px' }}>{a.scheduled_pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const tabBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid var(--border)',
  marginBottom: 18,
  paddingBottom: 8,
  position: 'relative',
};

const tabStyle = {
  background: 'transparent',
  border: '1px solid transparent',
  borderBottom: 'none',
  color: 'var(--text-2)',
  padding: '8px 14px',
  borderRadius: '6px 6px 0 0',
  marginBottom: -9,
  fontSize: 13,
  cursor: 'pointer',
};

const tabActiveStyle = {
  background: 'var(--bg-elev)',
  borderColor: 'var(--border)',
  borderBottomColor: 'var(--bg-elev)',
  color: 'var(--gold-bright)',
};

const addMenuStyle = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 6px)',
  zIndex: 10,
  background: 'var(--bg-elev)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  boxShadow: '0 6px 22px rgba(0,0,0,0.5)',
  minWidth: 200,
  padding: 4,
};

const addMenuItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 13,
  color: 'var(--text-0)',
  cursor: 'pointer',
  borderRadius: 4,
};

const playBtnStyle = {
  background: 'var(--gradient-brand)',
  color: '#1a1a14',
  border: '1px solid var(--gold)',
  borderRadius: 999,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 2px 10px rgba(212,166,74,0.3)',
};

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
