import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

const MODE_STYLES = {
  electron: { bg: 'rgba(74,144,226,0.2)', color: '#7aa8e0', label: 'EB' },
  cloakmanager: { bg: 'rgba(155,89,182,0.2)', color: '#c9a3d9', label: 'CM' },
};

const STATUS_COLORS = {
  completed: { bg: 'rgba(122,154,90,0.15)', fg: '#bdd5a3' },
  failed: { bg: 'rgba(180,90,90,0.15)', fg: '#e2a3a3' },
  running: { bg: 'rgba(212,166,74,0.15)', fg: 'var(--gold)' },
  queued: { bg: 'rgba(255,255,255,0.05)', fg: 'var(--text-3)' },
  skipped: { bg: 'rgba(255,255,255,0.05)', fg: 'var(--text-3)' },
};

function StatusPill({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.queued;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 700,
      background: s.bg, color: s.fg,
    }}>
      {status.toUpperCase()}
    </span>
  );
}

export default function RunHistory() {
  const { token } = useAuth();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', runType: '' });
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await window.api.automation.listRuns({
        token,
        limit: 100,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.runType ? { runType: filter.runType } : {}),
      });
      if (res.ok) setRuns(res.runs || []);
    } catch (e) {
      console.error('[RunHistory] load error', e);
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);

  const runTypes = [...new Set(runs.map(r => r.run_type))].sort();
  const statuses = [...new Set(runs.map(r => r.status))].sort();

  return (
    <div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Automation Run History</h3>
          <span className="muted" style={{ fontSize: 11 }}>{runs.length} entries</span>
          <button className="ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => { setLoading(true); load(); }}>
            Refresh
          </button>
        </div>

        <div style={{ padding: '8px 16px', display: 'flex', gap: 8, borderBottom: '1px solid var(--border)' }}>
          <select
            value={filter.status}
            onChange={e => { setFilter(f => ({ ...f, status: e.target.value })); setLoading(true); }}
            style={{ fontSize: 11, padding: '4px 8px', background: 'var(--bg-2)', color: 'var(--text-0)', border: '1px solid var(--border)', borderRadius: 6, maxWidth: 140 }}
          >
            <option value="">All statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filter.runType}
            onChange={e => { setFilter(f => ({ ...f, runType: e.target.value })); setLoading(true); }}
            style={{ fontSize: 11, padding: '4px 8px', background: 'var(--bg-2)', color: 'var(--text-0)', border: '1px solid var(--border)', borderRadius: 6, maxWidth: 140 }}
          >
            <option value="">All types</option>
            {runTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {loading && runs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }} className="muted">Loading...</div>
          ) : runs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>~~</div>
              <div className="muted" style={{ fontSize: 13 }}>No automation runs recorded yet</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Runs appear here when scheduled posts fire or autopilot executes
              </div>
            </div>
          ) : (
            runs.map(r => (
              <div key={r.id}>
                <div
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                    borderBottom: '1px solid var(--border)', cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <StatusPill status={r.status} />
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                    background: (MODE_STYLES[r.browser_mode] || MODE_STYLES.electron).bg,
                    color: (MODE_STYLES[r.browser_mode] || MODE_STYLES.electron).color,
                  }}>
                    {(MODE_STYLES[r.browser_mode] || MODE_STYLES.electron).label}
                  </span>
                  <span style={{ minWidth: 60 }} className="muted">{r.run_type}</span>
                  <span style={{ fontWeight: 600 }}>{r.platform}</span>
                  <span>{r.username || r.account_id}</span>
                  {r.profile_name && <span className="muted" style={{ fontSize: 10 }}>{r.profile_name}</span>}
                  <span className="muted" style={{ fontSize: 10, minWidth: 70 }}>
                    {r.triggered_by}
                  </span>
                  <span className="muted" style={{ fontSize: 10, marginLeft: 'auto' }}>
                    {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : ''}
                  </span>
                  <span className="muted" style={{ fontSize: 10, minWidth: 140, textAlign: 'right' }}>
                    {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
                  </span>
                </div>
                {expanded === r.id && (
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', fontSize: 11 }}>
                    {r.error && (
                      <div style={{ color: '#e2a3a3', marginBottom: 4 }}>
                        Error: {r.error}
                      </div>
                    )}
                    {r.result_json && (
                      <div>
                        <span className="muted">Result: </span>
                        <span style={{ wordBreak: 'break-all' }}>
                          {(() => {
                            try {
                              const parsed = JSON.parse(r.result_json);
                              if (parsed.url) return parsed.url;
                              return JSON.stringify(parsed).slice(0, 200);
                            } catch { return r.result_json.slice(0, 200); }
                          })()}
                        </span>
                      </div>
                    )}
                    {r.script_id && <div className="muted">Script: {r.script_id}</div>}
                    <div className="muted">Duration: {r.duration_ms ? `${r.duration_ms}ms` : 'N/A'}</div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
