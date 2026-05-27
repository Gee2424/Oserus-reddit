import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

const ACTION_STYLE = {
  'account.create':      { bg: 'rgba(122,154,90,0.12)', fg: '#bdd5a3', label: 'created' },
  'account.delete':      { bg: 'rgba(179,71,58,0.12)', fg: '#f4b8af', label: 'deleted' },
  'account.bulkImport':  { bg: 'rgba(122,154,90,0.12)', fg: '#bdd5a3', label: 'bulk imported' },
  'votes.order':         { bg: 'rgba(212,166,74,0.12)', fg: 'var(--gold-bright)', label: 'votes order' },
};

export default function ActivityPage() {
  const { token } = useAuth();
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState({ action: '', username: '' });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await window.api.activity.list({
      token,
      limit: 500,
      filter: { ...(filter.action && { action: filter.action }), ...(filter.username && { username: filter.username }) },
    });
    setLoading(false);
    if (res.ok) setEntries(res.entries);
  }

  useEffect(() => { load(); }, [token]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [filter.action, filter.username]);

  const uniqueActions = [...new Set(entries.map(e => e.action))].sort();
  const uniqueUsers = [...new Set(entries.map(e => e.username).filter(Boolean))].sort();

  return (
    <div>
      <div className="title-block" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="eyebrow">Audit trail</div>
          <h1>Activity</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Who did what and when — accounts created/deleted, vote orders placed, bulk imports.
          </div>
        </div>
        <button className="ghost" onClick={load}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label>Action</label>
          <select value={filter.action} onChange={(e) => setFilter({ ...filter, action: e.target.value })}>
            <option value="">— all actions —</option>
            {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label>User</label>
          <select value={filter.username} onChange={(e) => setFilter({ ...filter, username: e.target.value })}>
            <option value="">— all users —</option>
            {uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {(filter.action || filter.username) && (
          <button className="ghost" onClick={() => setFilter({ action: '', username: '' })}>Clear</button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>No activity matching that filter.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={th}>When</th>
                <th style={th}>User</th>
                <th style={th}>Action</th>
                <th style={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const s = ACTION_STYLE[e.action] || { bg: 'rgba(255,255,255,0.04)', fg: 'var(--text-2)', label: e.action };
                return (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={td} className="mono dim">{new Date(e.created_at + 'Z').toLocaleString()}</td>
                    <td style={td}>{e.username || <span className="dim">system</span>}</td>
                    <td style={td}>
                      <span style={{ background: s.bg, color: s.fg, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                        {s.label}
                      </span>
                    </td>
                    <td style={td}>{e.detail || <span className="dim">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: '10px 14px', fontWeight: 500 };
const td = { padding: '8px 14px', verticalAlign: 'middle' };
