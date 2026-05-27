import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

const PROXY_KINDS = [
  { v: 'http', label: 'HTTP' },
  { v: 'https', label: 'HTTPS' },
  { v: 'socks5', label: 'SOCKS5' },
];

function blankProxy() {
  return { label: '', kind: 'http', host: '', port: '', username: '', password: '' };
}

// Proxy management. Reused on the Operations page.
export default function ProxiesPanel() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can('infra.proxies.manage');
  const [proxies, setProxies] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankProxy());
  const [error, setError] = useState(null);

  async function load() {
    const res = await window.api.proxies.list({ token });
    if (res.ok) setProxies(res.proxies);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.label || !form.host || !form.port) {
      setError('Label, host, and port are required');
      return;
    }
    let res;
    if (editing) {
      const updates = {
        label: form.label, kind: form.kind, host: form.host, port: Number(form.port),
        username: form.username || null,
      };
      if (form.password) updates.password = form.password;
      res = await window.api.proxies.update({ token, proxyId: editing, updates });
    } else {
      res = await window.api.proxies.create({
        token, label: form.label, kind: form.kind, host: form.host, port: form.port,
        username: form.username, password: form.password,
      });
    }
    if (!res.ok) { setError(res.error); return; }
    setShowAdd(false); setEditing(null); setForm(blankProxy()); load();
  }

  function startEdit(p) {
    setEditing(p.id);
    setForm({
      label: p.label, kind: p.kind, host: p.host, port: p.port,
      username: p.username || '', password: '',
    });
    setShowAdd(true);
  }

  async function del(id) {
    if (!confirm('Delete this proxy? Any account using it will fall back to no proxy.')) return;
    await window.api.proxies.delete({ token, proxyId: id });
    load();
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 18, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, flex: 1 }}>
          Proxies are assigned per Reddit account. Each account routes its browsing and posting through its assigned proxy.
          Supported types: HTTP, HTTPS, SOCKS5.
        </div>
        {canManage && (
          <button className="primary" onClick={() => { setEditing(null); setForm(blankProxy()); setShowAdd(v => !v); }}>
            {showAdd ? 'Cancel' : '+ Add proxy'}
          </button>
        )}
      </div>

      {showAdd && canManage && (
        <form onSubmit={submit} className="card" style={{ marginBottom: 22 }}>
          <h3 style={{ marginBottom: 14 }}>{editing ? 'Edit proxy' : 'Add proxy'}</h3>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Label</label>
              <input placeholder="e.g. NYC residential 1" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div>
              <label>Type</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {PROXY_KINDS.map(k => <option key={k.v} value={k.v}>{k.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Host</label>
              <input placeholder="e.g. proxy.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </div>
            <div>
              <label>Port</label>
              <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Username (optional)</label>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label>Password {editing && <span className="dim mono" style={{textTransform:'none',letterSpacing:0,fontSize:10}}>(leave blank to keep)</span>}</label>
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="primary">{editing ? 'Save changes' : 'Add proxy'}</button>
            <button type="button" className="ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {proxies.length === 0 ? (
        <div className="empty-state">No proxies yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-1)' }}>
                <th style={th}>Label</th>
                <th style={th}>Type</th>
                <th style={th}>Address</th>
                <th style={th}>Auth</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {proxies.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td}>{p.label}</td>
                  <td style={td}><span className="pill">{p.kind}</span></td>
                  <td style={td}><span className="mono">{p.host}:{p.port}</span></td>
                  <td style={td}>{p.username ? <span className="mono">{p.username}</span> : <span className="dim">none</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {canManage && (
                      <>
                        <button className="ghost" onClick={() => startEdit(p)}>Edit</button>
                        <button className="danger" onClick={() => del(p.id)} style={{ marginLeft: 6 }}>Delete</button>
                      </>
                    )}
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
