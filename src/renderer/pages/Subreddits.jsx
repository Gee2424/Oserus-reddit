import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

export default function SubredditsPage() {
  const { token } = useAuth();
  const can = useCan();
  const [subs, setSubs] = useState([]);
  const [form, setForm] = useState({ name: '', vibe: '', description: '' });
  const [error, setError] = useState(null);

  const canManage = can('subreddits.manage');

  async function load() {
    const res = await window.api.subs.listWarmup({ token });
    if (res.ok) setSubs(res.subs);
  }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    setError(null);
    if (!form.name) { setError('Subreddit name required'); return; }
    const res = await window.api.subs.createWarmup({
      token, name: form.name, vibe: form.vibe, description: form.description,
    });
    if (!res.ok) { setError(res.error); return; }
    setForm({ name: '', vibe: '', description: '' });
    load();
  }

  async function del(id) {
    if (!confirm('Remove this subreddit from the warm-up list?')) return;
    await window.api.subs.deleteWarmup({ token, id });
    load();
  }

  if (!canManage) {
    return <div className="empty-state">Manager or admin access only.</div>;
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Manage</div>
          <h1>Warm-up Subreddits</h1>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          These are mainstream, non-promotional subreddits where new Reddit accounts post to build comment karma and account age.
          The AI composer pulls from this list when generating SFW engagement posts for accounts whose status is <strong>warming</strong>.
        </div>
      </div>

      <form onSubmit={add} className="card" style={{ marginBottom: 22 }}>
        <h3 style={{ marginBottom: 14 }}>Add subreddit</h3>
        {error && <div className="error-banner">{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label>Subreddit name</label>
            <input
              placeholder="e.g. CasualConversation (no r/ prefix needed)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label>Vibe (optional)</label>
            <input
              placeholder="e.g. friendly chat, witty observation, curious"
              value={form.vibe}
              onChange={(e) => setForm({ ...form, vibe: e.target.value })}
            />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label>Description (optional — helps the AI match the tone)</label>
          <input
            placeholder="One short sentence about what kinds of posts do well here"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <button type="submit" className="primary">Add to warm-up list</button>
      </form>

      {subs.length === 0 ? (
        <div className="empty-state">No warm-up subreddits configured.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={styles.table}>
            <thead>
              <tr style={{ background: 'var(--bg-1)' }}>
                <th style={styles.th}>Subreddit</th>
                <th style={styles.th}>Vibe</th>
                <th style={styles.th}>Description</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={styles.td}><span className="mono">r/{s.name}</span></td>
                  <td style={styles.td}>{s.vibe ? <span className="pill">{s.vibe}</span> : <span className="dim">—</span>}</td>
                  <td style={styles.td} className="muted">{s.description || <span className="dim">—</span>}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <button className="danger" onClick={() => del(s.id)}>Remove</button>
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

const styles = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', fontWeight: 500 },
  td: { padding: '10px 14px' },
};
