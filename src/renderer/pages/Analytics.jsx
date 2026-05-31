import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import PopOutButton from '../components/PopOutButton.jsx';

const STATUS_COLORS = { warming: '#d4a55a', ready: '#7a9a5a', paused: '#968b78', banned: '#b3473a' };

export default function AnalyticsPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recordOpen, setRecordOpen] = useState(null);
  const [form, setForm] = useState({ post_karma: '', comment_karma: '' });

  async function load() {
    setLoading(true);
    const res = await window.api.analytics.summary({ token });
    setLoading(false);
    if (res.ok) setData(res);
  }
  useEffect(() => { load(); }, [token]);

  async function recordKarma(e) {
    e.preventDefault();
    if (!recordOpen) return;
    await window.api.analytics.recordKarma({
      token,
      accountId: recordOpen.id,
      postKarma: Number(form.post_karma) || 0,
      commentKarma: Number(form.comment_karma) || 0,
    });
    setRecordOpen(null);
    setForm({ post_karma: '', comment_karma: '' });
    await load();
  }

  if (loading) return <div className="empty-state">Loading…</div>;
  if (!data) return <div className="empty-state">No data.</div>;

  const { accounts, totals } = data;
  const redditAccounts = accounts.filter(a => a.platform !== 'redgifs');

  return (
    <div>
      <div className="title-block" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="eyebrow">Performance</div>
          <h1>Analytics</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Karma growth and post engagement across your Reddit accounts.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <PopOutButton route="analytics" title="Analytics" />
          <button className="ghost" onClick={load}>Refresh</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
        <StatCard label="Total accounts" value={totals.accounts} />
        <StatCard label="Ready" value={totals.ready} accent="#7a9a5a" />
        <StatCard label="Warming" value={totals.warming} accent="#d4a55a" />
        <StatCard label="Paused" value={totals.paused} accent="#968b78" />
        <StatCard label="Banned" value={totals.banned} accent="#b3473a" />
        <StatCard label="Total karma" value={totals.total_karma.toLocaleString()} accent="var(--gold-bright)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
        <StatCard label="Scheduled" value={(totals.scheduled || 0).toLocaleString()} accent="#7aa2f7" />
        <StatCard label="Posted" value={(totals.posted || 0).toLocaleString()} accent="#7fd99a" />
        <StatCard label="Failed" value={(totals.failed || 0).toLocaleString()} accent="#e2a3a3" />
        <StatCard label="Events logged" value={(totals.events || 0).toLocaleString()} accent="var(--text-2)" />
        <StatCard label="Boosts ordered" value={(totals.boosts_ordered || 0).toLocaleString()} accent="#d4a64a" />
      </div>

      {totals.by_platform && Object.keys(totals.by_platform).length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Accounts by platform</span>
          {Object.entries(totals.by_platform).map(([p, n]) => {
            const color = p === 'redgifs' ? '#ff2e74' : p === 'x' ? '#1d9bf0' : p === 'instagram' ? '#e1306c' : p === 'tiktok' ? '#25f4ee' : '#ff4500';
            return (
              <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 12px', fontSize: 12 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                {p} <span className="dim">· {n}</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ marginBottom: 4 }}>Per-account snapshot</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            Karma values are manual snapshots for now — click <strong>Update</strong> on a row to record the latest counts from the Reddit profile page. Auto-pulling karma needs Reddit OAuth (coming next).
          </div>
        </div>
        {redditAccounts.length === 0 ? (
          <div className="empty-state" style={{ padding: 30, border: 'none' }}>No Reddit accounts yet.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={th}>Account</th>
                <th style={th}>Model</th>
                <th style={th}>Status</th>
                <th style={th}>Post karma</th>
                <th style={th}>Comment karma</th>
                <th style={th}>Drafts</th>
                <th style={th}>Scheduled</th>
                <th style={th}>Last snapshot</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {redditAccounts.map(a => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td} className="mono">u/{a.username}</td>
                  <td style={td}>{a.profile_name || '—'}</td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[a.status] || 'var(--text-3)' }} />
                      {a.status}
                    </span>
                  </td>
                  <td style={td}>{a.post_karma == null ? <span className="dim">—</span> : a.post_karma.toLocaleString()}</td>
                  <td style={td}>{a.comment_karma == null ? <span className="dim">—</span> : a.comment_karma.toLocaleString()}</td>
                  <td style={td}>{a.drafts}</td>
                  <td style={td}>{a.scheduled_pending}</td>
                  <td style={td} className="muted">{a.karma_taken_at ? new Date(a.karma_taken_at + 'Z').toLocaleDateString() : '—'}</td>
                  <td style={td}>
                    <button className="ghost" onClick={() => { setRecordOpen(a); setForm({ post_karma: a.post_karma || '', comment_karma: a.comment_karma || '' }); }}>Update</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {recordOpen && (
        <div style={overlay}>
          <form onSubmit={recordKarma} className="card" style={{ width: 380 }}>
            <h3 style={{ marginBottom: 12 }}>Record karma — u/{recordOpen.username}</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
              Open the Reddit profile (old.reddit.com/user/{recordOpen.username}) and paste the numbers shown there.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div>
                <label>Post karma</label>
                <input type="number" value={form.post_karma} onChange={(e) => setForm({ ...form, post_karma: e.target.value })} autoFocus />
              </div>
              <div>
                <label>Comment karma</label>
                <input type="number" value={form.comment_karma} onChange={(e) => setForm({ ...form, comment_karma: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" type="submit">Save snapshot</button>
              <button className="ghost" type="button" onClick={() => setRecordOpen(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontFamily: 'var(--font-display)', color: accent || 'var(--text-0)', marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

const th = { padding: '10px 14px', fontWeight: 500 };
const td = { padding: '10px 14px', verticalAlign: 'middle' };
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  display: 'grid', placeItems: 'center', zIndex: 100,
};
