import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

export default function OperationsPage({ navigate }) {
  const { token, user } = useAuth();
  const [proxies, setProxies] = useState([]);
  const [voteOrders, setVoteOrders] = useState([]);
  const [voteBalance, setVoteBalance] = useState(null);
  const [hasVoteKey, setHasVoteKey] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [px, hasKey] = await Promise.all([
      window.api.proxies.list({ token }),
      window.api.votes.hasApiKey({ token }),
    ]);
    if (px.ok) setProxies(px.proxies);
    setHasVoteKey(!!hasKey.hasKey);

    if (hasKey.hasKey) {
      const [bal, ord] = await Promise.all([
        window.api.votes.balance({ token }),
        window.api.votes.orders({ token }),
      ]);
      if (bal.ok) setVoteBalance(bal);
      if (ord.ok) setVoteOrders(ord.orders);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, [token]);

  const pendingOrders = voteOrders.filter(o => o.status === 'pending' || o.status === 'In progress' || o.status === 'Processing').length;
  const completedOrders = voteOrders.filter(o => (o.status || '').toLowerCase() === 'completed').length;

  return (
    <div>
      <div className="title-block" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="eyebrow">Infrastructure</div>
          <h1>Operations</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Proxies and upvote.biz orders, side by side.
          </div>
        </div>
        <button className="ghost" onClick={load}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* Proxies */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>⌁</span>
            <h3>Proxies</h3>
            <span className="mono dim" style={{ fontSize: 12 }}>{proxies.length}</span>
            <div style={{ flex: 1 }} />
            <button className="ghost" onClick={() => navigate('infra')}>Manage →</button>
          </div>
          {proxies.length === 0 ? (
            <div className="empty-state" style={{ padding: 28, border: 'none' }}>No proxies yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {proxies.slice(0, 10).map(p => (
                <div key={p.id} style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green-bright)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</div>
                    <div className="mono dim" style={{ fontSize: 11 }}>{p.kind} · {p.host}:{p.port}</div>
                  </div>
                  {p.has_password && <span className="dim mono" style={{ fontSize: 11 }}>🔑</span>}
                </div>
              ))}
              {proxies.length > 10 && (
                <div className="muted" style={{ padding: '10px 18px', fontSize: 12, borderTop: '1px solid var(--border)' }}>
                  +{proxies.length - 10} more
                </div>
              )}
            </div>
          )}
        </div>

        {/* Votes */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>▲</span>
            <h3>Upvotes</h3>
            {voteBalance && (
              <span className="mono" style={{ fontSize: 12, color: 'var(--gold-bright)' }}>
                {voteBalance.balance} {voteBalance.currency || ''}
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button className="ghost" onClick={() => navigate('infra')}>Manage →</button>
          </div>

          {!hasVoteKey ? (
            <div className="empty-state" style={{ padding: 28, border: 'none' }}>
              {user.role === 'admin'
                ? 'Add the upvote.biz API key under Settings to enable orders.'
                : 'An admin needs to add the upvote.biz API key.'}
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>
                <div style={miniStat}>
                  <div className="muted" style={miniStatLabel}>Pending</div>
                  <div style={miniStatVal}>{pendingOrders}</div>
                </div>
                <div style={miniStat}>
                  <div className="muted" style={miniStatLabel}>Completed</div>
                  <div style={miniStatVal}>{completedOrders}</div>
                </div>
              </div>
              {voteOrders.length === 0 ? (
                <div className="empty-state" style={{ padding: 28, border: 'none' }}>No orders yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {voteOrders.slice(0, 6).map(o => (
                    <div key={o.id} style={{ padding: '10px 18px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span className="mono dim" style={{ fontSize: 11 }}>#{o.remote_order_id}</span>
                        <span style={{ fontSize: 13 }}>{o.service_name || o.service_id}</span>
                        <div style={{ flex: 1 }} />
                        <span className="mono dim" style={{ fontSize: 11 }}>{o.status || '—'}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        qty {o.quantity}{o.charge ? ` · ${o.charge} ${o.currency || ''}` : ''} · {o.link}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const miniStat = { background: 'var(--bg-elev)', padding: '12px 18px' };
const miniStatLabel = { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' };
const miniStatVal = { fontSize: 22, fontFamily: 'var(--font-display)', color: 'var(--gold-bright)', marginTop: 2 };
