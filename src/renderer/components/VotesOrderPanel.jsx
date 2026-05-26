import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

const POST_URL_RE = /reddit\.com\/(r\/[^/]+\/comments\/|comments\/)/i;

export default function VotesOrderPanel({ currentUrl }) {
  const { token } = useAuth();

  const [hasKey, setHasKey] = useState(false);
  const [balance, setBalance] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  const [form, setForm] = useState({ serviceId: '', link: currentUrl || '', quantity: '' });

  useEffect(() => {
    setForm((f) => ({ ...f, link: currentUrl || f.link }));
  }, [currentUrl]);

  useEffect(() => {
    (async () => {
      const k = await window.api.votes.hasApiKey({ token });
      setHasKey(!!k.hasKey);
      if (!k.hasKey) return;
      setLoading(true);
      const [bal, svc] = await Promise.all([
        window.api.votes.balance({ token }),
        window.api.votes.services({ token }),
      ]);
      setLoading(false);
      if (bal.ok) setBalance({ balance: bal.balance, currency: bal.currency });
      else setErr(bal.error);
      if (svc.ok) setServices(svc.services || []);
    })();
  }, [token]);

  const selectedService = services.find((s) => String(s.service) === String(form.serviceId));
  const looksLikePost = POST_URL_RE.test(form.link || '');

  async function placeOrder(e) {
    e.preventDefault();
    setErr(null); setOk(null);
    if (!form.serviceId || !form.link || !form.quantity) { setErr('Pick a service, paste a link, and enter quantity.'); return; }
    const res = await window.api.votes.order({
      token,
      serviceId: form.serviceId,
      serviceName: selectedService?.name,
      link: form.link,
      quantity: Number(form.quantity),
    });
    if (!res.ok) { setErr(res.error); return; }
    setOk(`Order #${res.orderId} placed.`);
    setForm((f) => ({ ...f, serviceId: '', quantity: '' }));
    const bal = await window.api.votes.balance({ token });
    if (bal.ok) setBalance({ balance: bal.balance, currency: bal.currency });
  }

  if (!hasKey) {
    return (
      <div style={{ padding: 16 }}>
        <div className="card">
          <h3 style={{ marginBottom: 6 }}>No upvote.biz key</h3>
          <div className="muted" style={{ fontSize: 13 }}>
            An admin or manager needs to add the upvote.biz API key in Settings before placing orders.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {balance && (
        <div style={{
          padding: '8px 12px',
          borderRadius: 6,
          background: 'var(--gradient-brand-soft)',
          border: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Balance</span>
          <span className="mono" style={{ fontSize: 14, color: 'var(--gold-bright)' }}>
            {balance.balance} {balance.currency || ''}
          </span>
        </div>
      )}

      {err && <div className="error-banner">{err}</div>}
      {ok && <div style={styles.ok}>{ok}</div>}

      <form onSubmit={placeOrder} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label>Service</label>
          <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
            <option value="">{loading ? 'Loading services…' : '— pick a service —'}</option>
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
          <label>Reddit post URL</label>
          <input
            type="url"
            placeholder="https://www.reddit.com/r/.../comments/..."
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {looksLikePost
              ? '✓ Looks like a Reddit post URL'
              : 'Tip: navigate to the post you want votes on — this field auto-fills.'}
          </div>
        </div>

        <div>
          <label>Quantity</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {[10, 25, 50, 100, 250, 500].map((q) => (
              <button
                type="button"
                key={q}
                className="ghost"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => setForm({ ...form, quantity: String(q) })}
              >
                {q}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={selectedService?.min || 1}
            max={selectedService?.max || undefined}
            placeholder="how many"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </div>

        <button type="submit" className="primary" style={{ marginTop: 4 }}>
          Place order
        </button>
      </form>
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
    fontSize: 13,
  },
};
