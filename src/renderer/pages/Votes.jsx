import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

export default function VotesPage() {
  const { token, user } = useAuth();
  const isAdmin = user.role === 'admin';

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

  if (!hasKey) {
    return (
      <div>
        <div className="title-block">
          <div>
            <div className="eyebrow">External services</div>
            <h1>Votes</h1>
          </div>
        </div>
        <div className="card">
          <h3>No upvote.biz API key configured</h3>
          <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            {isAdmin
              ? 'Open Settings to add your upvote.biz API key. It will be stored encrypted using the OS keychain.'
              : 'Ask an admin to add the upvote.biz API key in Settings.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="title-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow">External services</div>
          <h1>Votes</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
      </div>

      {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}
      {ok && <div style={styles.ok}>{ok}</div>}

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
              {services.map((s) => (
                <option key={s.service} value={s.service}>
                  {s.name} {s.rate ? `(${s.rate}/1k)` : ''}
                </option>
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

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Recent orders</h3>
        {orders.length === 0 ? (
          <div className="empty-state" style={{ padding: 22 }}>No orders yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Service</th>
                  <th style={styles.th}>Link</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Charge</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Remains</th>
                  <th style={styles.th}>Placed</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={styles.td} className="mono">{o.remote_order_id}</td>
                    <td style={styles.td}>{o.service_name || o.service_id}</td>
                    <td style={styles.td}>
                      <a href={o.link} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)' }}>
                        {o.link.length > 50 ? `${o.link.slice(0, 50)}…` : o.link}
                      </a>
                    </td>
                    <td style={styles.td}>{o.quantity}</td>
                    <td style={styles.td}>{o.charge ? `${o.charge} ${o.currency || ''}` : '—'}</td>
                    <td style={styles.td}>
                      <span style={statusStyle(o.status)}>{o.status || '—'}</span>
                    </td>
                    <td style={styles.td}>{o.remains ?? '—'}</td>
                    <td style={styles.td} className="muted" suppressHydrationWarning>
                      {o.created_at ? new Date(o.created_at + 'Z').toLocaleString() : '—'}
                    </td>
                    <td style={styles.td}>
                      <button className="ghost" onClick={() => refreshOrder(o.id)}>Sync</button>
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

const styles = {
  th: { padding: '6px 8px', fontWeight: 500 },
  td: { padding: '8px', verticalAlign: 'middle' },
  ok: {
    background: 'rgba(122,154,90,0.12)',
    border: '1px solid var(--ok)',
    color: '#bdd5a3',
    padding: '10px 14px',
    borderRadius: 4,
    marginBottom: 12,
  },
};
