import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

// Full upvote.biz workspace — at-a-glance stats, order placement with cost
// preview, and a polished orders table. Lives on Operations → Upvotes.
export default function UpvotesPanel() {
  const { token } = useAuth();
  const can = useCan();
  const isAdmin = can('infra.upvotes.admin');
  const canPlaceOrders = can('infra.upvotes.place_order');

  const [hasKey, setHasKey] = useState(false);
  const [balance, setBalance] = useState(null);
  const [services, setServices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);
  const [serviceSearch, setServiceSearch] = useState('');
  const [busy, setBusy] = useState({}); // { [orderId]: 'sync' | 'refill' | 'refillStatus' }

  const [form, setForm] = useState({ serviceId: '', link: '', quantity: '', profileId: '' });

  async function refreshAll() {
    setErr(null);
    const keyRes = await window.api.votes.hasApiKey({ token });
    setHasKey(!!keyRes.hasKey);
    if (!keyRes.hasKey) return;
    setLoading(true);
    const [bal, svc, ord, prof] = await Promise.all([
      window.api.votes.balance({ token }),
      window.api.votes.services({ token }),
      window.api.votes.orders({ token }),
      window.api.profiles.list({ token }),
    ]);
    setLoading(false);
    if (bal.ok) setBalance({ balance: bal.balance, currency: bal.currency });
    else setErr(bal.error);
    if (svc.ok) setServices(svc.services || []);
    if (ord.ok) setOrders(ord.orders || []);
    if (prof.ok) setProfiles(prof.profiles || []);
  }

  useEffect(() => { refreshAll(); /* eslint-disable-next-line */ }, [token]);

  // Auto-dismiss success/error banners.
  useEffect(() => {
    if (!ok && !err) return;
    const t = setTimeout(() => { setOk(null); setErr(null); }, 4500);
    return () => clearTimeout(t);
  }, [ok, err]);

  const selectedService = services.find((s) => String(s.service) === String(form.serviceId));

  const filteredServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) =>
      `${s.name || ''} ${s.category || ''} ${s.type || ''}`.toLowerCase().includes(q)
    );
  }, [services, serviceSearch]);

  const servicesByCategory = filteredServices.reduce((acc, s) => {
    const cat = s.category || 'Other';
    (acc[cat] = acc[cat] || []).push(s);
    return acc;
  }, {});
  const sortedCategories = Object.keys(servicesByCategory).sort();

  const estimatedCost = useMemo(() => {
    if (!selectedService || !form.quantity || !selectedService.rate) return null;
    const rate = parseFloat(selectedService.rate);
    const qty = parseFloat(form.quantity);
    if (!isFinite(rate) || !isFinite(qty)) return null;
    return (rate * qty / 1000).toFixed(2);
  }, [selectedService, form.quantity]);

  // Stats from the orders list
  const stats = useMemo(() => {
    const s = { pending: 0, completed: 0, totalSpent: 0, currency: '' };
    for (const o of orders) {
      const st = (o.status || '').toLowerCase();
      if (st === 'completed') s.completed += 1;
      else if (st === 'in progress' || st === 'processing' || st === 'pending' || !st) s.pending += 1;
      const c = parseFloat(o.charge);
      if (isFinite(c)) { s.totalSpent += c; s.currency = o.currency || s.currency; }
    }
    return s;
  }, [orders]);

  // Auto-poll: while any order is still in flight, quietly resync every 60s.
  const hasActive = orders.some((o) => {
    const st = (o.status || '').toLowerCase();
    return st !== 'completed' && st !== 'canceled' && st !== 'cancelled' && st !== 'partial';
  });
  useEffect(() => {
    if (!hasKey || !hasActive) return;
    const id = setInterval(() => syncAll(true), 60000);
    return () => clearInterval(id);
    /* eslint-disable-next-line */
  }, [hasKey, hasActive, orders.length]);

  async function placeOrder(e) {
    e.preventDefault();
    setErr(null); setOk(null);
    if (!form.serviceId || !form.link || !form.quantity) { setErr('Fill in service, link, and quantity'); return; }
    if (selectedService) {
      const qty = Number(form.quantity);
      if (selectedService.min && qty < Number(selectedService.min)) {
        setErr(`Quantity must be at least ${selectedService.min} for this service`); return;
      }
      if (selectedService.max && qty > Number(selectedService.max)) {
        setErr(`Quantity must be at most ${selectedService.max} for this service`); return;
      }
    }
    const res = await window.api.votes.order({
      token,
      serviceId: form.serviceId,
      serviceName: selectedService?.name,
      link: form.link,
      quantity: Number(form.quantity),
      profileId: form.profileId || null,
    });
    if (!res.ok) { setErr(res.error); return; }
    setOk(`Order #${res.orderId} placed.`);
    setForm((f) => ({ serviceId: '', link: '', quantity: '', profileId: f.profileId }));
    refreshAll();
  }

  function setOrderBusy(id, kind) {
    setBusy((b) => {
      const next = { ...b };
      if (kind) next[id] = kind; else delete next[id];
      return next;
    });
  }

  async function refreshOrder(orderId) {
    setOrderBusy(orderId, 'sync');
    const res = await window.api.votes.refreshStatus({ token, orderId });
    if (!res.ok) setErr(res.error);
    await refreshAll();
    setOrderBusy(orderId, null);
  }

  async function refillOrder(orderId, remoteOrderId) {
    setErr(null); setOk(null);
    setOrderBusy(orderId, 'refill');
    const res = await window.api.votes.refill({ token, remoteOrderId });
    if (res.ok) { setOk(`Refill #${res.refillId} requested.`); await refreshAll(); }
    else setErr(res.error);
    setOrderBusy(orderId, null);
  }

  async function checkRefillStatus(orderId, refillId) {
    if (!refillId) return;
    setOrderBusy(orderId, 'refillStatus');
    await window.api.votes.refillStatus({ token, refillId });
    await refreshAll();
    setOrderBusy(orderId, null);
  }

  async function syncAll(quiet) {
    const ids = orders.map((o) => o.remote_order_id).filter(Boolean);
    if (!ids.length) return;
    if (!quiet) setLoading(true);
    const res = await window.api.votes.statusMulti({ token, remoteOrderIds: ids });
    if (!quiet) setLoading(false);
    if (!res.ok) { if (!quiet) setErr(res.error); return; }
    refreshAll();
  }

  if (!hasKey) {
    return (
      <div className="card" style={{ padding: 30, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>▲</div>
        <h3 style={{ marginBottom: 6 }}>upvote.biz isn't connected yet</h3>
        <div className="muted" style={{ fontSize: 13, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
          {isAdmin
            ? 'Open Settings and paste your upvote.biz API key. It will be stored encrypted using the OS keychain.'
            : 'Ask an admin to add the upvote.biz API key in Settings. Once connected, you can place orders and track them here.'}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Stat tiles */}
      <div style={statRow}>
        <StatTile
          label="Balance"
          value={balance ? `$${balance.balance}` : '—'}
          sub={balance?.currency}
          accent="gold"
        />
        <StatTile
          label="Pending"
          value={stats.pending}
          sub="orders in flight"
        />
        <StatTile
          label="Completed"
          value={stats.completed}
          sub="lifetime"
          accent="green"
        />
        <StatTile
          label="Total spent"
          value={stats.totalSpent ? `$${stats.totalSpent.toFixed(2)}` : '—'}
          sub={stats.currency || ''}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <button className="ghost" onClick={() => syncAll()} disabled={loading || !orders.length}>
            ↻ Sync all
          </button>
          <button className="ghost" onClick={refreshAll} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}
      {ok && <div style={okBanner}>{ok}</div>}

      {/* Place order */}
      {canPlaceOrders && (
        <div className="card bordered-glow" style={{ marginBottom: 22, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
            <h3 style={{ margin: 0 }}>Place an order</h3>
            <div className="muted" style={{ fontSize: 12 }}>
              Reddit services from upvote.biz only.
            </div>
          </div>

          <form onSubmit={placeOrder}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.6fr 0.9fr 0.7fr auto', gap: 12, alignItems: 'end', marginTop: 14 }}>
              <div>
                <label>Service</label>
                <input
                  placeholder="Search services…"
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  style={{ marginBottom: 6 }}
                />
                <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
                  <option value="">— pick a service —</option>
                  {sortedCategories.map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {servicesByCategory[cat].map((s) => {
                        const flags = [];
                        if (s.refill) flags.push('↻');
                        if (s.dripfeed) flags.push('drip');
                        return (
                          <option key={s.service} value={s.service}>
                            {s.name} {s.rate ? `· $${s.rate}/1k` : ''}{flags.length ? ` · ${flags.join(' ')}` : ''}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
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
                <label>Model</label>
                <select value={form.profileId} onChange={(e) => setForm({ ...form, profileId: e.target.value })}>
                  <option value="">— none —</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Quantity</label>
                <input
                  type="number"
                  min={selectedService?.min || 1}
                  max={selectedService?.max || undefined}
                  placeholder={selectedService ? `${selectedService.min}–${selectedService.max}` : ''}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <button type="submit" className="primary" style={{ height: 38, minWidth: 110 }}>
                {estimatedCost ? `Order · $${estimatedCost}` : 'Order'}
              </button>
            </div>

            {selectedService && (
              <div style={serviceDetails}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{selectedService.name}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {selectedService.category || 'Reddit'}{selectedService.type ? ` · ${selectedService.type}` : ''}
                  </div>
                </div>
                <Pill>min {selectedService.min}</Pill>
                <Pill>max {selectedService.max}</Pill>
                {selectedService.rate && <Pill accent="gold">${selectedService.rate}/1k</Pill>}
                {selectedService.refill && <Pill accent="green">↻ refill</Pill>}
                {selectedService.dripfeed && <Pill>dripfeed</Pill>}
              </div>
            )}
          </form>
        </div>
      )}

      {/* Orders */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Recent orders</h3>
          <span className="mono dim" style={{ fontSize: 12 }}>{orders.length}</span>
        </div>
        {orders.length === 0 ? (
          <div className="empty-state" style={{ padding: 40, border: 'none' }}>No orders yet. Place one above to get started.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-1)' }}>
                  <th style={th}>#</th>
                  <th style={th}>Model</th>
                  <th style={th}>Service</th>
                  <th style={th}>Target</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...th, textAlign: 'right' }}>Start</th>
                  <th style={{ ...th, textAlign: 'right' }}>Remains</th>
                  <th style={{ ...th, textAlign: 'right' }}>Charge</th>
                  <th style={th}>Status</th>
                  <th style={th}>Refill</th>
                  <th style={th}>Placed</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const progress = o.quantity && o.remains != null
                    ? Math.min(100, Math.max(0, ((o.quantity - Number(o.remains)) / o.quantity) * 100))
                    : null;
                  return (
                    <tr key={o.id} style={tr}>
                      <td style={td} className="mono dim">#{o.remote_order_id}</td>
                      <td style={td}>
                        {o.profile_name ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: o.profile_color || 'var(--gold)', flexShrink: 0 }} />
                            {o.profile_name}
                          </span>
                        ) : <span className="dim">—</span>}
                      </td>
                      <td style={td}>{o.service_name || `service ${o.service_id}`}</td>
                      <td style={td}>
                        <a href={o.link} target="_blank" rel="noreferrer" style={linkA} title={o.link}>
                          {shortLink(o.link)}
                        </a>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }} className="mono">{o.quantity}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="mono">{o.start_count ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="mono">{o.remains ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="mono">{o.charge ? `${o.charge} ${o.currency || ''}` : '—'}</td>
                      <td style={td}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={statusStyle(o.status)}>{o.status || '—'}</span>
                          {progress != null && progress > 0 && progress < 100 && (
                            <div style={progBar}><div style={{ ...progFill, width: `${progress}%` }} /></div>
                          )}
                        </div>
                      </td>
                      <td style={td}>
                        {o.refill_id ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="mono dim" style={{ fontSize: 11 }}>#{o.refill_id}</span>
                            <span style={statusStyle(o.refill_status)}>{o.refill_status || 'Pending'}</span>
                            <button
                              className="ghost"
                              onClick={() => checkRefillStatus(o.id, o.refill_id)}
                              style={tinyBtn}
                              disabled={busy[o.id] === 'refillStatus'}
                              title="Check refill status"
                            >{busy[o.id] === 'refillStatus' ? '…' : '↻'}</button>
                          </span>
                        ) : <span className="dim">—</span>}
                      </td>
                      <td style={td} className="muted" suppressHydrationWarning>
                        {o.created_at ? new Date(o.created_at + 'Z').toLocaleString() : '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          className="ghost"
                          onClick={() => refreshOrder(o.id)}
                          style={tinyBtn}
                          disabled={!!busy[o.id]}
                          title="Refresh this order"
                        >
                          {busy[o.id] === 'sync' ? '…' : 'Sync'}
                        </button>
                        {canPlaceOrders && (
                          <button
                            className="ghost"
                            onClick={() => refillOrder(o.id, o.remote_order_id)}
                            style={{ ...tinyBtn, marginLeft: 4 }}
                            disabled={!!busy[o.id]}
                            title="Request a refill from upvote.biz"
                          >
                            {busy[o.id] === 'refill' ? '…' : 'Refill'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, accent }) {
  const color = accent === 'gold' ? 'var(--gold-bright)' : accent === 'green' ? 'var(--green-bright)' : 'var(--text-1)';
  return (
    <div style={statTile}>
      <div style={statLabel}>{label}</div>
      <div style={{ ...statValue, color }}>{value}</div>
      {sub && <div style={statSub}>{sub}</div>}
    </div>
  );
}

function Pill({ children, accent }) {
  const color = accent === 'gold' ? 'var(--gold)' : accent === 'green' ? '#bdd5a3' : 'var(--text-2)';
  const bg = accent === 'gold' ? 'rgba(212,166,74,0.12)' : accent === 'green' ? 'rgba(122,154,90,0.12)' : 'var(--bg-elev)';
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 11, padding: '3px 9px', borderRadius: 999,
      background: bg, color, border: '1px solid var(--border)', whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function shortLink(link) {
  if (!link) return '';
  // Strip protocol and "www.reddit.com" prefix for compactness
  return link
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^reddit\.com\//, '')
    .slice(0, 56) + (link.length > 56 ? '…' : '');
}

function statusStyle(status) {
  const s = (status || '').toLowerCase();
  const base = {
    display: 'inline-block', padding: '2px 9px', borderRadius: 999,
    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, textTransform: 'capitalize',
    border: '1px solid transparent',
  };
  if (s === 'completed') return { ...base, background: 'rgba(122,154,90,0.15)', color: '#bdd5a3', borderColor: 'rgba(122,154,90,0.4)' };
  if (s === 'in progress' || s === 'processing') return { ...base, background: 'rgba(201,162,39,0.15)', color: 'var(--gold)', borderColor: 'rgba(201,162,39,0.4)' };
  if (s === 'pending') return { ...base, background: 'rgba(120,140,160,0.12)', color: 'var(--text-2)', borderColor: 'rgba(120,140,160,0.3)' };
  if (s === 'canceled' || s === 'cancelled' || s === 'partial') return { ...base, background: 'rgba(180,90,90,0.15)', color: '#e2a3a3', borderColor: 'rgba(180,90,90,0.4)' };
  return { ...base, background: 'rgba(255,255,255,0.04)', color: 'var(--muted)', borderColor: 'var(--border)' };
}

const statRow = {
  display: 'flex',
  gap: 12,
  marginBottom: 18,
  alignItems: 'stretch',
};
const statTile = {
  background: 'var(--bg-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: '12px 16px',
  minWidth: 130,
};
const statLabel = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
};
const statValue = {
  fontFamily: 'var(--font-display)',
  fontSize: 22,
  fontWeight: 600,
  marginTop: 4,
  lineHeight: 1.1,
};
const statSub = {
  fontSize: 10,
  color: 'var(--text-3)',
  marginTop: 2,
  fontFamily: 'var(--font-mono)',
};
const serviceDetails = {
  marginTop: 14,
  padding: '10px 14px',
  background: 'var(--bg-1)',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const th = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text-3)',
  fontWeight: 500,
  fontFamily: 'var(--font-mono)',
};
const td = { padding: '10px 14px', verticalAlign: 'middle' };
const tr = { borderTop: '1px solid var(--border)' };
const linkA = {
  color: 'var(--gold)',
  textDecoration: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};
const tinyBtn = { fontSize: 11, padding: '4px 10px' };
const progBar = {
  height: 3,
  background: 'var(--bg-elev)',
  borderRadius: 2,
  overflow: 'hidden',
  width: '100%',
  minWidth: 70,
};
const progFill = {
  height: '100%',
  background: 'linear-gradient(90deg, var(--gold), var(--green-bright))',
  transition: 'width 0.3s',
};
const okBanner = {
  background: 'rgba(122,154,90,0.12)',
  border: '1px solid var(--ok)',
  color: '#bdd5a3',
  padding: '10px 14px',
  borderRadius: 4,
  marginBottom: 12,
};
