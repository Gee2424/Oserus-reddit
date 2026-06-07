import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

// Chrome-extension registry. Each row is an unpacked extension folder
// (point at the dir containing manifest.json). Enabled extensions are
// loaded into every account's session partition by sessionPrep.js, so
// the same uBlock / MetaMask / etc. runs across every profile.

export default function ExtensionsPanel() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can('infra.proxies.manage');
  const [rows, setRows] = useState([]);
  const [path, setPath] = useState('');
  const [err, setErr] = useState(null);

  async function load() {
    const r = await window.api.extensions.list({ token });
    if (r.ok) setRows(r.extensions);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  async function add(e) {
    e.preventDefault();
    setErr(null);
    if (!path.trim()) return;
    const r = await window.api.extensions.add({ token, path: path.trim() });
    if (!r.ok) { setErr(r.error); return; }
    setPath('');
    load();
  }

  async function toggle(id, enabled) {
    await window.api.extensions.toggle({ token, id, enabled });
    load();
  }

  async function remove(id) {
    if (!confirm('Remove this extension? Browser windows opened after this will no longer load it.')) return;
    await window.api.extensions.remove({ token, id });
    load();
  }

  return (
    <div>
      {canManage && (
        <form onSubmit={add} className="card" style={{ marginBottom: 16, padding: 14, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label>Extension folder path</label>
            <input
              placeholder="C:\\Users\\you\\extensions\\ublock"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
              Point at the unpacked extension folder (the one containing <code>manifest.json</code>). Manifest V3 supported.
            </div>
          </div>
          <button type="submit" className="primary">Add</button>
        </form>
      )}
      {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}

      {rows.length === 0 ? (
        <div className="empty-state">No extensions installed.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-1)' }}>
                <th style={th}>Name</th>
                <th style={th}>Path</th>
                <th style={th}>Enabled</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td}>{r.name}</td>
                  <td style={td}><span className="mono" style={{ fontSize: 11 }}>{r.path}</span></td>
                  <td style={td}>
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={!!r.enabled}
                      onChange={(e) => toggle(r.id, e.target.checked)}
                    />
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {canManage && <button className="danger" onClick={() => remove(r.id)}>Remove</button>}
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

const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', fontWeight: 500 };
const td = { padding: '10px 14px' };
