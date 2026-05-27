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

export default function AccountsPage({ navigate }) {
  const { token } = useAuth();
  const { refresh: refreshActive, startAccount } = useActiveAccount();
  const [profiles, setProfiles] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [error, setError] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkForm, setBulkForm] = useState({ profileId: '', platform: 'reddit', proxyId: '', status: 'warming', lines: '' });
  const [bulkResult, setBulkResult] = useState(null);

  function blankForm() {
    return {
      profile_id: '', platform: 'reddit', username: '', password: '',
      email: '', emailPassword: '',
      status: 'warming', proxy_id: '', notes: '',
    };
  }

  async function load() {
    const [p, a, px] = await Promise.all([
      window.api.profiles.list({ token }),
      window.api.accounts.listForUser({ token }),
      window.api.proxies.list({ token }),
    ]);
    if (p.ok) setProfiles(p.profiles);
    if (a.ok) setAccounts(a.accounts);
    if (px.ok) setProxies(px.proxies);
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.profile_id || !form.username) {
      setError('Profile and username required');
      return;
    }
    const payload = {
      token,
      profileId: Number(form.profile_id),
      platform: form.platform || 'reddit',
      username: form.username.trim().replace(/^[u@]\//, '').replace(/^@/, ''),
      password: form.password || null,
      email: form.email || null,
      emailPassword: form.emailPassword || null,
      status: form.status,
      proxyId: form.proxy_id ? Number(form.proxy_id) : null,
      notes: form.notes,
    };
    let res;
    if (editing) {
      res = await window.api.accounts.update({
        token, accountId: editing,
        updates: {
          status: form.status,
          proxy_id: form.proxy_id ? Number(form.proxy_id) : null,
          notes: form.notes,
          email: form.email || null,
          ...(form.password ? { password: form.password } : {}),
          ...(form.emailPassword ? { emailPassword: form.emailPassword } : {}),
        },
      });
    } else {
      res = await window.api.accounts.create(payload);
    }
    if (!res.ok) { setError(res.error); return; }
    setShowAdd(false);
    setEditing(null);
    setForm(blankForm());
    await load();
    await refreshActive();
  }

  async function quickStatus(accountId, status) {
    await window.api.accounts.update({ token, accountId, updates: { status } });
    await load();
    await refreshActive();
  }

  async function quickProxy(accountId, proxyId) {
    await window.api.accounts.update({
      token, accountId,
      updates: { proxy_id: proxyId ? Number(proxyId) : null }
    });
    await load();
    await refreshActive();
  }

  function startEdit(account) {
    setEditing(account.id);
    setForm({
      profile_id: account.profile_id,
      username: account.username,
      password: '',
      email: account.email || '',
      emailPassword: '',
      status: account.status,
      proxy_id: account.proxy_id || '',
      notes: account.notes || '',
    });
    setShowAdd(true);
  }

  async function del(id) {
    if (!confirm('Delete this account record? The Reddit account itself is untouched.')) return;
    await window.api.accounts.delete({ token, accountId: id });
    await load();
    await refreshActive();
  }

  async function start(accountId) {
    await startAccount(accountId);
    if (navigate) navigate('reddit');
  }

  const filtered = accounts.filter(a =>
    (filter === 'all' || a.status === filter) &&
    (platformFilter === 'all' || (a.platform || 'reddit') === platformFilter)
  );
  const grouped = {};
  for (const a of filtered) (grouped[a.profile_name] = grouped[a.profile_name] || []).push(a);

  const statusCounts = accounts.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Manage</div>
          <h1>Logins</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Every Reddit and RedGifs login across all your models, in one list.
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="ghost" onClick={() => { setShowBulk(v => !v); setShowAdd(false); }}>
            {showBulk ? 'Close bulk import' : '↥ Bulk import'}
          </button>
          <button className="primary" onClick={() => {
            setEditing(null);
            setForm(blankForm());
            setShowAdd(v => !v);
            setShowBulk(false);
          }}>
            {showAdd ? 'Cancel' : '+ Add login'}
          </button>
        </div>
      </div>

      <div style={styles.filterRow}>
        {['all', 'reddit', 'redgifs'].map(p => (
          <button
            key={p}
            onClick={() => setPlatformFilter(p)}
            style={{ ...styles.filterChip, ...(platformFilter === p ? styles.filterChipActive : {}) }}
          >
            {p === 'all' ? 'Both platforms' : p === 'reddit' ? 'Reddit' : 'RedGifs'}
            <span className="mono dim" style={{ marginLeft: 6, fontSize: 11 }}>
              {p === 'all' ? accounts.length : accounts.filter(a => (a.platform || 'reddit') === p).length}
            </span>
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 6px' }} />
        {['all', ...STATUS_OPTIONS.map(s => s.v)].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ ...styles.filterChip, ...(filter === f ? styles.filterChipActive : {}) }}
          >
            {f === 'all' ? `All statuses (${accounts.length})` : `${f} (${statusCounts[f] || 0})`}
          </button>
        ))}
      </div>

      {showBulk && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBulkResult(null);
            if (!bulkForm.profileId) { setBulkResult({ error: 'Pick a model first' }); return; }
            if (!bulkForm.lines.trim()) { setBulkResult({ error: 'Paste some credentials first' }); return; }
            const res = await window.api.accounts.bulkCreate({
              token, profileId: Number(bulkForm.profileId),
              platform: bulkForm.platform, status: bulkForm.status,
              proxyId: bulkForm.proxyId ? Number(bulkForm.proxyId) : null,
              lines: bulkForm.lines,
            });
            if (!res.ok) { setBulkResult({ error: res.error }); return; }
            setBulkResult({ created: res.created.length, errors: res.errors });
            if (res.created.length) {
              setBulkForm({ ...bulkForm, lines: '' });
              load();
            }
          }}
          className="card"
          style={{ marginBottom: 22 }}
        >
          <h3 style={{ marginBottom: 6 }}>Bulk import</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            One credential per line. Format: <code style={{ color: 'var(--gold-bright)' }}>username:password</code> or <code style={{ color: 'var(--gold-bright)' }}>username:password:email:emailpassword</code>. Lines starting with # are skipped.
          </div>
          {bulkResult?.error && <div className="error-banner">{bulkResult.error}</div>}
          {bulkResult?.created != null && (
            <div className="card bordered-glow" style={{ marginBottom: 12, padding: 14 }}>
              <strong>{bulkResult.created} imported.</strong>
              {bulkResult.errors?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <div className="muted">{bulkResult.errors.length} errors:</div>
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {bulkResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>Line {e.line}{e.username ? ` (${e.username})` : ''}: {e.error}</li>
                    ))}
                    {bulkResult.errors.length > 10 && <li>…and {bulkResult.errors.length - 10} more</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label>Model</label>
              <select value={bulkForm.profileId} onChange={(e) => setBulkForm({ ...bulkForm, profileId: e.target.value })}>
                <option value="">— pick a model —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label>Platform</label>
              <select value={bulkForm.platform} onChange={(e) => setBulkForm({ ...bulkForm, platform: e.target.value })}>
                <option value="reddit">Reddit</option>
                <option value="redgifs">RedGifs</option>
              </select>
            </div>
            <div>
              <label>Initial status</label>
              <select value={bulkForm.status} onChange={(e) => setBulkForm({ ...bulkForm, status: e.target.value })}>
                {STATUS_OPTIONS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label>Proxy (optional, applied to all)</label>
              <select value={bulkForm.proxyId} onChange={(e) => setBulkForm({ ...bulkForm, proxyId: e.target.value })}>
                <option value="">— no proxy —</option>
                {proxies.map(p => <option key={p.id} value={p.id}>{p.label} ({p.kind})</option>)}
              </select>
            </div>
          </div>
          <textarea
            value={bulkForm.lines}
            onChange={(e) => setBulkForm({ ...bulkForm, lines: e.target.value })}
            placeholder={'throwaway123:mypassword\nanother_user:pw:user@mail.com:mailpw'}
            style={{ minHeight: 180, fontFamily: 'var(--font-mono)', fontSize: 12 }}
          />
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="primary">Import all</button>
          </div>
        </form>
      )}

      {showAdd && (
        <form onSubmit={submit} className="card" style={{ marginBottom: 22 }}>
          <h3 style={{ marginBottom: 14 }}>{editing ? 'Edit login' : `Add ${form.platform === 'redgifs' ? 'RedGifs' : 'Reddit'} login`}</h3>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label>Model profile</label>
              <select
                value={form.profile_id}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
              >
                <option value="">— pick a profile —</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label>Platform</label>
              <select value={form.platform} disabled={!!editing} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                <option value="reddit">Reddit</option>
                <option value="redgifs">RedGifs</option>
              </select>
            </div>
            <div>
              <label>Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUS_OPTIONS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <label>{form.platform === 'redgifs' ? 'RedGifs' : 'Reddit'} username</label>
              <input value={form.username} disabled={!!editing} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label>Reddit password {editing && <span className="dim mono" style={{textTransform:'none',letterSpacing:0,fontSize:10}}>(leave blank to keep current)</span>}</label>
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
              <label>Proxy</label>
              <select value={form.proxy_id} onChange={(e) => setForm({ ...form, proxy_id: e.target.value })}>
                <option value="">— no proxy —</option>
                {proxies.map(p => (
                  <option key={p.id} value={p.id}>{p.label} ({p.kind} {p.host}:{p.port})</option>
                ))}
              </select>
              {proxies.length === 0 && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  No proxies configured. Add some under <strong>Proxies</strong>.
                </div>
              )}
            </div>
            <div>
              <label>Notes (optional)</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button type="submit" className="primary">{editing ? 'Save changes' : 'Add account'}</button>
            <button type="button" className="ghost" onClick={() => { setShowAdd(false); setEditing(null); setForm(blankForm()); }}>Cancel</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 14, fontStyle: 'italic' }}>
            Credentials are encrypted on disk using your OS keychain. They're shown only when explicitly requested.
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          {accounts.length === 0
            ? (profiles.length === 0 ? 'Create a model profile first.' : 'No Reddit accounts yet. Add one above.')
            : `No ${filter} accounts.`}
        </div>
      ) : (
        Object.entries(grouped).map(([profile, items]) => (
          <div key={profile} style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 10 }}>{profile}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((a) => (
                <div key={a.id} style={styles.row}>
                  <button
                    className="primary"
                    onClick={() => start(a.id)}
                    style={styles.startBtn}
                    title={`Open ${a.platform || 'reddit'} as ${a.username}`}
                  >▶</button>
                  <span style={{ ...styles.dot, background: STATUS_COLORS[a.status] }} title={a.status} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                      <span className="mono dim" style={{ fontSize: 10, marginRight: 6, padding: '1px 5px', background: 'var(--bg-2)', borderRadius: 3, textTransform: 'uppercase' }}>
                        {a.platform || 'reddit'}
                      </span>
                      <span className="mono dim">{(a.platform === 'redgifs') ? '@' : 'u/'}</span>{a.username}
                      {a.has_password && <span className="mono dim" style={{ fontSize: 11, marginLeft: 8 }}>🔑 saved</span>}
                    </div>
                    {a.notes && <div className="muted" style={{ fontSize: 12 }}>{a.notes}</div>}
                  </div>

                  <select
                    value={a.status}
                    onChange={(e) => quickStatus(a.id, e.target.value)}
                    style={styles.miniSelect}
                  >
                    {STATUS_OPTIONS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>

                  <select
                    value={a.proxy_id || ''}
                    onChange={(e) => quickProxy(a.id, e.target.value)}
                    style={styles.miniSelect}
                  >
                    <option value="">no proxy</option>
                    {proxies.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>

                  <button className="ghost" onClick={() => startEdit(a)}>Edit</button>
                  <button className="danger" onClick={() => del(a.id)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const styles = {
  filterRow: { display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' },
  filterChip: {
    fontSize: 11, padding: '4px 10px', textTransform: 'capitalize',
    background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--text-2)',
  },
  filterChipActive: { background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' },
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', background: 'var(--bg-elev)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
  },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  miniSelect: { width: 'auto', padding: '5px 8px', fontSize: 12 },
  startBtn: {
    width: 32, height: 32, padding: 0, borderRadius: '50%',
    fontSize: 12, display: 'grid', placeItems: 'center', flexShrink: 0,
  },
};
