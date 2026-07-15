import React, { useEffect, useState } from 'react';
import { Banner, EmptyState, Spinner } from './ui.jsx';

export default function CDPHistoryPanel({ token }) {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await window.api.cloakmanager.getExecutionHistory({ token, limit: 100 });
    setLoading(false);
    if (r.ok) setExecutions(r.executions || []);
  }

  useEffect(() => { load(); }, [token]);

  const statusColor = (s) => {
    if (!s) return 'var(--text-2)';
    const lower = s.toLowerCase();
    if (lower === 'success' || lower === 'completed') return 'var(--ok)';
    if (lower === 'running' || lower === 'in_progress') return 'var(--gold)';
    if (lower === 'failed' || lower === 'error') return 'var(--danger)';
    return 'var(--text-2)';
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>CDP Script Execution History</h3>
        <button className="ghost" onClick={load} disabled={loading} style={{ fontSize: 12 }}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {loading && executions.length === 0 ? (
        <Spinner label="Loading history…" />
      ) : executions.length === 0 ? (
        <EmptyState title="No executions" hint="CDP script execution history will appear here after profiles launch." />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={th}>Time</th>
                <th style={th}>Script</th>
                <th style={th}>Account</th>
                <th style={th}>Model</th>
                <th style={th}>Status</th>
                <th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td} className="mono dim">
                    {e.started_at ? new Date(e.started_at + 'Z').toLocaleString().slice(0, 16) : '—'}
                  </td>
                  <td style={td}>
                    <span className="mono" style={{ fontSize: 11 }}>{e.script_id}</span>
                  </td>
                  <td style={td}>
                    {e.username || <span className="dim">—</span>}
                  </td>
                  <td style={td}>
                    {e.profile_name || <span className="dim">—</span>}
                  </td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                      fontSize: 10, fontWeight: 700,
                      background: e.status === 'success' ? 'rgba(122,154,90,0.15)' :
                                 e.status === 'failed' ? 'rgba(180,90,90,0.15)' :
                                 e.status === 'running' ? 'rgba(212,166,74,0.15)' : 'rgba(255,255,255,0.05)',
                      color: statusColor(e.status),
                    }}>
                      {(e.status || '—').toUpperCase()}
                    </span>
                  </td>
                  <td style={{ ...td, color: 'var(--danger)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.error || <span className="dim">—</span>}
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

const th = { textAlign: 'left', padding: '8px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', fontWeight: 500 };
const td = { padding: '8px 12px', verticalAlign: 'middle' };
