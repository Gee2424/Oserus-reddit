import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

const PROXY_KINDS = [
  { v: 'http', label: 'HTTP' },
  { v: 'https', label: 'HTTPS' },
  { v: 'socks5', label: 'SOCKS5' },
];

export default function InfrastructurePage() {
  const { user } = useAuth();
  const can = useCan();
  const [tab, setTab] = useState('proxies');

  if (!can('page.infra')) {
    return <div className="empty-state">You don't have permission to view this page.</div>;
  }

  const canSeeProxies = can('infra.proxies.view');
  const canSeeUpvotes = can('infra.upvotes.view');
  if (!canSeeProxies && !canSeeUpvotes) {
    return <div className="empty-state">You don't have permission to view this page.</div>;
  }
  const activeTab = !canSeeProxies ? 'upvotes' : (!canSeeUpvotes ? 'proxies' : tab);

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Ops</div>
          <h1>Infrastructure</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Proxies and upvote.biz orders in one place.
          </div>
        </div>
      </div>

      {canSeeProxies && (
        <div style={tabBar}>
          <button
            style={{ ...tabBtn, ...(activeTab === 'proxies' ? tabBtnActive : {}) }}
            onClick={() => setTab('proxies')}
          >
            ⌁ Proxies
          </button>
          <button
            style={{ ...tabBtn, ...(activeTab === 'upvotes' ? tabBtnActive : {}) }}
            onClick={() => setTab('upvotes')}
          >
            ▲ Upvotes
          </button>
        </div>
      )}

      {activeTab === 'proxies' ? <ProxiesPanel /> : <UpvotesPanel />}
    </div>
  );
}

/* ---------------- PROXIES ---------------- */

function ProxiesPanel() {
  const { token } = useAuth();
  const [proxies, setProxies] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankProxy());
  const [error, setError] = useState(null);

  function blankProxy() {
    return { label: '', kind: 'http', host: '', port: '', username: '', password: '' };
  }

  async function load() {
    const res = await window.api.proxies.list({ token });
    if (res.ok) setProxies(res.proxies);
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.label || !form.host || !form.port) {
      setError('Label, host, and port are required');
      return;
    }
    let res;
    if (editing) {
      const updates = {
        label: form.label, kind: form.kind, host: form.host, port: Number(form.port),
        username: form.username || null,
      };
      if (form.password) updates.password = form.password;
      res = await window.api.proxies.update({ token, proxyId: editing, updates });
    } else {
      res = await window.api.proxies.create({
        token, label: form.label, kind: form.kind, host: form.host, port: form.port,
        username: form.username, password: form.password,
      });
    }
    if (!res.ok) { setError(res.error); return; }
    setShowAdd(false); setEditing(null); setForm(blankProxy()); load();
  }

  function startEdit(p) {
    setEditing(p.id);
    setForm({
      label: p.label, kind: p.kind, host: p.host, port: p.port,
      username: p.username || '', password: '',
    });
    setShowAdd(true);
  }

  async function del(id) {
    if (!confirm('Delete this proxy? Any account using it will fall back to no proxy.')) return;
    await window.api.proxies.delete({ token, proxyId: id });
    load();
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 18, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, flex: 1 }}>
          Proxies are assigned per Reddit account. Each account routes its browsing and posting through its assigned proxy.
          Supported types: HTTP, HTTPS, SOCKS5.
        </div>
        <button className="primary" onClick={() => { setEditing(null); setForm(blankProxy()); setShowAdd(v => !v); }}>
          {showAdd ? 'Cancel' : '+ Add proxy'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={submit} className="card" style={{ marginBottom: 22 }}>
          <h3 style={{ marginBottom: 14 }}>{editing ? 'Edit proxy' : 'Add proxy'}</h3>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Label</label>
              <input placeholder="e.g. NYC residential 1" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div>
              <label>Type</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {PROXY_KINDS.map(k => <option key={k.v} value={k.v}>{k.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Host</label>
              <input placeholder="e.g. proxy.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </div>
            <div>
              <label>Port</label>
              <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Username (optional)</label>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label>Password {editing && <span className="dim mono" style={{textTransform:'none',letterSpacing:0,fontSize:10}}>(leave blank to keep)</span>}</label>
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="primary">{editing ? 'Save changes' : 'Add proxy'}</button>
            <button type="button" className="ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {proxies.length === 0 ? (
        <div className="empty-state">No proxies yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-1)' }}>
                <th style={th}>Label</th>
                <th style={th}>Type</th>
                <th style={th}>Address</th>
                <th style={th}>Auth</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {proxies.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td}>{p.label}</td>
                  <td style={td}><span className="pill">{p.kind}</span></td>
                  <td style={td}><span className="mono">{p.host}:{p.port}</span></td>
                  <td style={td}>{p.username ? <span className="mono">{p.username}</span> : <span className="dim">none</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button className="ghost" onClick={() => startEdit(p)}>Edit</button>
                    <button className="danger" onClick={() => del(p.id)} style={{ marginLeft: 6 }}>Delete</button>
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

/* ---------------- UPVOTES (upvote.biz) ---------------- */

function UpvotesPanel() {
  const { token } = useAuth();
  const can = useCan();
  const isAdmin = can('infra.upvotes.admin');
  const canPlaceOrders = can('infra.upvotes.place_order');

  const [hasKey, setHasKey] = useState(false);
  const [balance, setBalance] = useState(null);
  const [services, setServices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  const [form, setForm] = useState({ serviceId: '', link: '', quantity: '' });

  async function refreshAll() {
    setErr(null);
    const keyRes = await window.api.votes.hasApiKey({ token });
    setHasKey(!!keyRes.hasKey);
    if (!keyRes.hasKey) return;
    setLoading(true);
    const [bal, svc, ord] = await Promise.all([
      window.api.votes.balance({ token }),
      window.api.votes.services({ token }),
      window.api.votes.orders({ token }),
    ]);
    setLoading(false);
    if (bal.ok) setBalance({ balance: bal.balance, currency: bal.currency });
    else setErr(bal.error);
    if (svc.ok) setServices(svc.services || []);
    if (ord.ok) setOrders(ord.orders || []);
  }

  useEffect(() => { refreshAll(); /* eslint-disable-next-line */ }, [token]);

  const selectedService = services.find((s) => String(s.service) === String(form.serviceId));

  const servicesByCategory = services.reduce((acc, s) => {
    const cat = s.category || 'Other';
    (acc[cat] = acc[cat] || []).push(s);
    return acc;
  }, {});
  const sortedCategories = Object.keys(servicesByCategory).sort();

  async function placeOrder(e) {
    e.preventDefault();
    setErr(null); setOk(null);
    if (!form.serviceId || !form.link || !form.quantity) { setErr('Fill in service, link, and quantity'); return; }
    const res = await window.api.votes.order({
      token,
      serviceId: form.serviceId,
      serviceName: selectedService?.name,
      link: form.link,
      quantity: Number(form.quantity),
    });
    if (!res.ok) { setErr(res.error); return; }
    setOk(`Order #${res.orderId} placed.`);
    setForm({ serviceId: '', link: '', quantity: '' });
    refreshAll();
  }

  async function refreshOrder(orderId) {
    const res = await window.api.votes.refreshStatus({ token, orderId });
    if (!res.ok) setErr(res.error);
    refreshAll();
  }

  async function refillOrder(remoteOrderId) {
    setErr(null); setOk(null);
    const res = await window.api.votes.refill({ token, remoteOrderId });
    if (!res.ok) { setErr(res.error); return; }
    setOk(`Refill requested. Refill ID: ${res.refillId}`);
  }

  if (!hasKey) {
    return (
      <div className="card">
        <h3>No upvote.biz API key configured</h3>
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {isAdmin
            ? 'Open Settings to add your upvote.biz API key. It will be stored encrypted using the OS keychain.'
            : 'Ask an admin to add the upvote.biz API key in Settings.'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        {balance && (
          <div className="card" style={{ padding: '8px 14px', margin: 0 }}>
            <div className="muted" style={{ fontSize: 11 }}>Balance</div>
            <div className="mono" style={{ fontSize: 15, color: 'var(--gold)' }}>
              {balance.balance} {balance.currency || ''}
            </div>
          </div>
        )}
        <button className="ghost" onClick={refreshAll} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}
      {ok && <div style={okBanner}>{ok}</div>}

      {canPlaceOrders && (
      <div className="card" style={{ marginBottom: 22 }}>
        <h3 style={{ marginBottom: 4 }}>Place an order</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Only Reddit-related services from upvote.biz are listed below.
        </div>
        <form onSubmit={placeOrder} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label>Service</label>
            <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
              <option value="">— pick a service —</option>
              {sortedCategories.map((cat) => (
                <optgroup key={cat} label={cat}>
                  {servicesByCategory[cat].map((s) => (
                    <option key={s.service} value={s.service}>
                      {s.name} {s.rate ? `(${s.rate}/1k)` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedService && (
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                min {selectedService.min} · max {selectedService.max}{selectedService.type ? ` · ${selectedService.type}` : ''}
              </div>
            )}
          </div>
          <div>
            <label>Reddit URL</label>
            <input
              type="url"
              placeholder="https://www.reddit.com/r/.../comments/..."
              value={form.link}
              onChange={(e) => setForm({ ...form, link: e.target.value })}
            />
          </div>
          <div>
            <label>Quantity</label>
            <input
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>
          <button type="submit" className="primary">Order</button>
        </form>
      </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Recent orders</h3>
        {orders.length === 0 ? (
          <div className="empty-state" style={{ padding: 22 }}>No orders yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={smTh}>#</th>
                  <th style={smTh}>Service</th>
                  <th style={smTh}>Link</th>
                  <th style={smTh}>Qty</th>
                  <th style={smTh}>Charge</th>
                  <th style={smTh}>Status</th>
                  <th style={smTh}>Remains</th>
                  <th style={smTh}>Placed</th>
                  <th style={smTh}></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={smTd} className="mono">{o.remote_order_id}</td>
                    <td style={smTd}>{o.service_name || o.service_id}</td>
                    <td style={smTd}>
                      <a href={o.link} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
                        {o.link.length > 50 ? `${o.link.slice(0, 50)}…` : o.link}
                      </a>
                    </td>
                    <td style={smTd}>{o.quantity}</td>
                    <td style={smTd}>{o.charge ? `${o.charge} ${o.currency || ''}` : '—'}</td>
                    <td style={smTd}>
                      <span style={statusStyle(o.status)}>{o.status || '—'}</span>
                    </td>
                    <td style={smTd}>{o.remains ?? '—'}</td>
                    <td style={smTd} className="muted" suppressHydrationWarning>
                      {o.created_at ? new Date(o.created_at + 'Z').toLocaleString() : '—'}
                    </td>
                    <td style={smTd}>
                      <button className="ghost" onClick={() => refreshOrder(o.id)}>Sync</button>
                      {canPlaceOrders && (
                        <button className="ghost" onClick={() => refillOrder(o.remote_order_id)} style={{ marginLeft: 4 }}>
                          Refill
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function statusStyle(status) {
  const s = (status || '').toLowerCase();
  const base = { padding: '2px 8px', borderRadius: 3, fontSize: 11, textTransform: 'capitalize' };
  if (s === 'completed') return { ...base, background: 'rgba(122,154,90,0.15)', color: '#bdd5a3' };
  if (s === 'in progress' || s === 'processing') return { ...base, background: 'rgba(201,162,39,0.15)', color: 'var(--gold)' };
  if (s === 'canceled' || s === 'cancelled' || s === 'partial') return { ...base, background: 'rgba(180,90,90,0.15)', color: '#e2a3a3' };
  return { ...base, background: 'rgba(255,255,255,0.05)', color: 'var(--muted)' };
}

const tabBar = { display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)' };
const tabBtn = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-2)',
  padding: '10px 16px',
  fontSize: 13,
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  marginBottom: -1,
};
const tabBtnActive = {
  color: 'var(--gold-bright)',
  borderBottomColor: 'var(--gold)',
};
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', fontWeight: 500 };
const td = { padding: '10px 14px' };
const smTh = { padding: '6px 8px', fontWeight: 500 };
const smTd = { padding: '8px', verticalAlign: 'middle' };
const okBanner = {
  background: 'rgba(122,154,90,0.12)',
  border: '1px solid var(--ok)',
  color: '#bdd5a3',
  padding: '10px 14px',
  borderRadius: 4,
  marginBottom: 12,
};
