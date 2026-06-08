import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

// Operator-editable preset of tiles shown on the Oserus Browser new-tab
// page. Tiles are global (shared across every account window) for V1.

const PRESET_COLORS = ['#d4a64a', '#ff4500', '#1d9bf0', '#e1306c', '#69c9d0', '#1877f2', '#ff0000', '#5865f2', '#ff9900', '#0a66c2', '#00aff0', '#34a853'];

export default function HomepageTilesPanel() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can('infra.proxies.manage');
  const [tiles, setTiles] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);

  async function load() {
    const r = await window.api.homepage.list({ token });
    if (r.ok) { setTiles(r.tiles || []); setDirty(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  function update(i, patch) {
    setTiles((arr) => arr.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
    setDirty(true);
  }
  function remove(i) {
    setTiles((arr) => arr.filter((_, idx) => idx !== i));
    setDirty(true);
  }
  function add() {
    setTiles((arr) => [...arr, { label: '', url: '', color: PRESET_COLORS[arr.length % PRESET_COLORS.length] }]);
    setDirty(true);
  }
  function move(i, dir) {
    setTiles((arr) => {
      const next = [...arr];
      const j = i + dir;
      if (j < 0 || j >= next.length) return arr;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setMsg(null);
    const clean = tiles.filter((t) => t.label && t.url);
    const r = await window.api.homepage.save({ token, tiles: clean });
    if (!r.ok) { setMsg({ kind: 'err', text: r.error || 'Save failed' }); return; }
    setTiles(r.tiles || []);
    setDirty(false);
    setMsg({ kind: 'ok', text: 'Saved — new tabs will use this preset.' });
  }

  return (
    <div>
      {msg && (
        <div
          className={msg.kind === 'err' ? 'error-banner' : ''}
          style={msg.kind === 'ok'
            ? { background: 'rgba(122,154,90,0.12)', border: '1px solid var(--ok)', color: '#bdd5a3', padding: '10px 14px', borderRadius: 4, marginBottom: 14 }
            : { marginBottom: 14 }}
        >{msg.text}</div>
      )}

      <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, flex: 1 }}>
          These tiles appear on the Oserus Browser new-tab page (the page that opens when you click <span className="mono">+</span> or close all tabs). Drag order with the ↑↓ arrows. Changes apply to <strong>new tabs opened after Save</strong>.
        </div>
        {canManage && (
          <>
            <button onClick={add}>+ Add tile</button>
            <button className="primary" disabled={!dirty} onClick={save}>Save</button>
          </>
        )}
      </div>

      {tiles.length === 0 ? (
        <div className="empty-state">No tiles configured. Click "+ Add tile" to start.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-1)' }}>
                <th style={th}>Order</th>
                <th style={th}>Label</th>
                <th style={th}>URL</th>
                <th style={th}>Accent</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {tiles.map((t, i) => (
                <tr key={t.id ?? `new-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ghost" style={tiny} onClick={() => move(i, -1)} disabled={i === 0 || !canManage}>↑</button>
                      <button className="ghost" style={tiny} onClick={() => move(i, 1)} disabled={i === tiles.length - 1 || !canManage}>↓</button>
                    </div>
                  </td>
                  <td style={td}>
                    <input value={t.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Label" disabled={!canManage} style={{ width: '100%' }} />
                  </td>
                  <td style={td}>
                    <input value={t.url} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://…" disabled={!canManage} style={{ width: '100%' }} className="mono" />
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="color"
                        value={t.color || '#d4a64a'}
                        onChange={(e) => update(i, { color: e.target.value })}
                        disabled={!canManage}
                        style={{ width: 36, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: canManage ? 'pointer' : 'not-allowed' }}
                      />
                      <span className="mono dim" style={{ fontSize: 11 }}>{t.color || '#d4a64a'}</span>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {canManage && <button className="danger" style={tiny} onClick={() => remove(i)}>Remove</button>}
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
const td = { padding: '8px 14px', verticalAlign: 'middle' };
const tiny = { fontSize: 11, padding: '4px 8px' };
