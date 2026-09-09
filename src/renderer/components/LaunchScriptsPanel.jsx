import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Banner, Spinner } from './ui.jsx';
import { usePlatforms } from '../lib/platforms.js';

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#0e1311', color: '#e6e3d2',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    maxWidth: 720, width: '96%', maxHeight: '82vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 12px 50px rgba(0,0,0,0.55)',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '16px 20px 12px',
  },
  stats: {
    fontSize: 12, color: 'var(--text-2)', marginTop: 4,
  },
  body: {
    padding: '0 12px 14px', overflowY: 'auto', flex: 1,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 12px', borderRadius: 8,
  },
  rowAlt: {
    background: 'rgba(255,255,255,0.025)',
  },
  drag: {
    cursor: 'grab', color: 'var(--text-3)', fontSize: 16, lineHeight: 1,
    userSelect: 'none', padding: '0 2px', fontWeight: 700,
  },
  dot: {
    width: 18, height: 18, borderRadius: '50%', border: 'none', cursor: 'pointer',
    flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 13,
    padding: 0, lineHeight: 1,
  },
  nameCol: {
    flex: 1, minWidth: 0, overflow: 'hidden',
  },
  nameLine: {
    color: '#e6e3d2', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500,
    lineHeight: 1.3,
  },
  descLine: {
    fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4, marginTop: 2,
    overflow: 'hidden', textOverflow: 'ellipsis',
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  },
  tag: {
    flexShrink: 0, fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-pill)',
    fontWeight: 600, fontFamily: 'monospace', whiteSpace: 'nowrap',
  },
  select: {
    flexShrink: 0, width: 80,
    background: 'transparent', color: 'var(--text-2)',
    border: '1px solid transparent', borderRadius: 6,
    padding: '2px 4px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 8px 6px', color: 'var(--text-3)',
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700,
  },
  dividerLine: {
    flex: 1, height: 1, background: 'var(--border)',
  },
  addBtn: {
    background: 'none', border: '1px dashed var(--border)', borderRadius: 8,
    padding: '6px 14px', width: '100%', cursor: 'pointer',
    color: 'var(--text-3)', fontSize: 12, fontFamily: 'inherit',
    marginTop: 4, textAlign: 'left',
  },
  iconBtn: {
    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px',
    borderRadius: 4, fontSize: 13, lineHeight: 1,
  },
  subOverlay: {
    position: 'fixed', inset: 0, zIndex: 10001,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  subModal: {
    background: '#0e1311', color: '#e6e3d2',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)', maxWidth: 600, width: '92%',
    maxHeight: '85vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 12px 50px rgba(0,0,0,0.55)',
  },
  subHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid var(--border)',
  },
  subBody: {
    padding: '14px 18px', overflowY: 'auto',
  },
  field: {
    width: '100%', padding: '7px 10px',
    background: '#0e1311', color: '#e6e3d2',
    border: '1px solid var(--border)', borderRadius: 6, fontSize: 13,
    fontFamily: 'inherit',
  },
  textarea: {
    width: '100%', minHeight: 200,
    background: '#0e1311', color: '#e6e3d2',
    border: '1px solid var(--border)', borderRadius: 8,
    padding: 12, fontSize: 12, fontFamily: 'monospace',
    resize: 'vertical', lineHeight: 1.6, tabSize: 2,
  },
  btn: {
    padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
  },
};

const RUN_MODES = [
  { v: 'always', label: 'Always' },
  { v: 'once',   label: 'Once' },
];

const TEMPLATE = `// Available:  page, browserContext, browser, sleep(ms)
// Context:    { credentials, accountId, platform, profileName }
// Must return { success: true/false, ... }

await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
await sleep(2000 + Math.random() * 2000);

return { success: true, title: await page.title() };`;

function Row({ script, idx, dragIdx, onDragStart, onDragOver, onDrop, onToggle, onModeChange, onEdit, onDelete }) {
  const dragging = dragIdx === idx;
  return (
    <div
      style={{ ...S.row, ...(idx % 2 === 0 ? S.rowAlt : {}), opacity: dragging ? 0.35 : 1 }}
      draggable
      onDragStart={() => onDragStart(idx)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(idx)}
    >
      <span style={S.drag}>≡</span>

      <button
        style={{
          ...S.dot,
          background: script.enabled ? 'var(--success-fg)' : 'rgba(255,255,255,0.1)',
          border: script.enabled ? 'none' : '1px solid rgba(255,255,255,0.15)',
          color: script.enabled ? 'var(--bg-0)' : 'var(--text-3)',
        }}
        onClick={(e) => { e.stopPropagation(); onToggle(script.scriptId, !script.enabled); }}
        title={script.enabled ? 'Disable' : 'Enable'}
      >
        {script.enabled ? '' : ''}
      </button>

      <div style={S.nameCol}>
        <div style={S.nameLine}>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#e6e3d2' }}>
            {script.name}
          </span>
          {script.type === 'custom' && (
            <span style={{ ...S.tag, background: 'rgba(90,130,190,0.18)', color: 'var(--blue)' }}>custom</span>
          )}
          {script.type === 'builtin' && script.platform !== 'all' && (
            <span style={{ ...S.tag, background: 'rgba(180,140,70,0.15)', color: 'var(--gold)' }}>
              {script.platform}-only
            </span>
          )}
          {script.accountScoped && (
            <span style={{ ...S.tag, background: 'rgba(155,89,182,0.15)', color: '#9b59b6' }}
              title="Needs a specific account — only runs on a launch targeted at that account, not the model-level generic launch">
              per-account
            </span>
          )}
        </div>
        {script.description && (
          <div style={S.descLine}>{script.description}</div>
        )}
        {script.type === 'custom' && script.description && (
          <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
            <button style={S.iconBtn} onClick={() => onEdit(script)}
              title="Edit">✏️</button>
            <button style={{ ...S.iconBtn, color: 'var(--danger-fg)' }} onClick={() => onDelete(script.customId)}
              title="Delete">🗑️</button>
          </div>
        )}
      </div>

      <select
        value={script.runMode}
        onChange={(e) => onModeChange(script.scriptId, e.target.value)}
        style={S.select}
      >
        {RUN_MODES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
      </select>

      {script.type === 'custom' && !script.description && (
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={S.iconBtn} onClick={() => onEdit(script)}
            title="Edit">✏️</button>
          <button style={{ ...S.iconBtn, color: 'var(--danger-fg)' }} onClick={() => onDelete(script.customId)}
            title="Delete">🗑️</button>
        </div>
      )}
    </div>
  );
}

function ScriptEditor({ editId, editName, editDesc, editPlatform, editCode, onChange, onSave, onClose }) {
  const [msg, setMsg] = useState(null);
  const rawPlatforms = usePlatforms();
  const PLATFORMS = useMemo(() => [
    { v: 'all', label: 'All platforms' },
    ...rawPlatforms.map(p => ({ v: p.v, label: p.label })),
  ], [rawPlatforms]);

  const handleSave = async () => {
    if (!editName.trim()) { setMsg({ kind: 'err', text: 'Name is required' }); return; }
    if (!editCode.trim()) { setMsg({ kind: 'err', text: 'Code is required' }); return; }
    setMsg(null);
    try {
      await onSave();
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
    }
  };

  return (
    <div style={S.subOverlay} onClick={onClose}>
      <div style={S.subModal} onClick={e => e.stopPropagation()}>
        <div style={S.subHeader}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {editId ? 'Edit Custom Script' : 'New Custom Script'}
          </div>
          <button className="ghost" onClick={onClose} style={{ fontSize: 20, padding: '0 8px' }}>&times;</button>
        </div>
        <div style={S.subBody}>
          {msg && <Banner kind={msg.kind} style={{ marginBottom: 14 }}>{msg.text}</Banner>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="muted" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Name</label>
              <input style={S.field} value={editName}
                onChange={e => onChange('editName', e.target.value)}
                placeholder="My Cookie Gatherer" />
            </div>
            <div>
              <label className="muted" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Platform</label>
              <select style={{ ...S.select, width: '100%' }} value={editPlatform}
                onChange={e => onChange('editPlatform', e.target.value)}>
                {PLATFORMS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="muted" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Description</label>
            <input style={S.field} value={editDesc}
              onChange={e => onChange('editDesc', e.target.value)}
              placeholder="Optional description..." />
          </div>
          <div>
            <label className="muted" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Code</label>
            <textarea style={S.textarea} value={editCode}
              onChange={e => onChange('editCode', e.target.value)} spellCheck={false} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="primary" style={S.btn} onClick={handleSave}>
              {editId ? 'Update' : 'Save'}
            </button>
            <button className="ghost" style={S.btn} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LaunchScriptsPanel({ profileId, modelName, onClose }) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState([]);
  const [configured, setConfigured] = useState([]);
  const [customs, setCustoms] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [dragIdx, setDragIdx] = useState(null);

  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPlatform, setEditPlatform] = useState('all');
  const [editCode, setEditCode] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.cloakmanager.getModelLaunchScripts({ token, profileId });
      if (!res.ok) throw new Error(res.error);
      setAvailable(res.available || []);
      setConfigured(res.configured || []);
      setCustoms(res.custom || []);
      setPlatforms(res.platforms || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, profileId]);

  useEffect(() => { load(); }, [load]);

  const merged = useMemo(() => {
    const cfgMap = new Map();
    for (const c of configured) cfgMap.set(c.script_id, c);

    const items = [];
    for (const sc of available) {
      const cfg = cfgMap.get(sc.id);
      items.push({
        scriptId: sc.id,
        type: 'builtin',
        name: sc.name,
        description: sc.description,
        platform: sc.platform,
        accountScoped: !!sc.accountScoped,
        enabled: cfg ? !!cfg.enabled : true,
        runMode: cfg ? cfg.run_mode : 'always',
        sortOrder: cfg ? cfg.sort_order : 999,
      });
      cfgMap.delete(sc.id);
    }
    for (const cc of customs) {
      const scriptId = `custom:${cc.id}`;
      const cfg = cfgMap.get(scriptId);
      items.push({
        scriptId,
        type: 'custom',
        customId: cc.id,
        name: cc.name,
        description: cc.description || '',
        platform: cc.platform,
        enabled: cfg ? !!cfg.enabled : false,
        runMode: cfg ? cfg.run_mode : 'always',
        sortOrder: cfg ? cfg.sort_order : 999,
      });
      cfgMap.delete(scriptId);
    }
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    return items;
  }, [available, configured, customs]);

  const update = useCallback(async (scriptId, changes) => {
    const res = await window.api.cloakmanager.updateModelLaunchScript({ token, profileId, scriptId, ...changes });
    if (!res.ok) { setError(res.error); return; }
    if (res.script) {
      setConfigured(prev => [res.script, ...prev.filter(c => c.script_id !== scriptId)]);
    }
  }, [token, profileId]);

  const reorder = useCallback(async (ids) => {
    const res = await window.api.cloakmanager.reorderModelLaunchScripts({ token, profileId, scriptIds: ids });
    if (!res.ok) { setError(res.error); return; }
    load();
  }, [token, profileId, load]);

  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (toIdx) => {
    if (dragIdx == null || dragIdx === toIdx) { setDragIdx(null); return; }
    const items = [...merged];
    const [moved] = items.splice(dragIdx, 1);
    items.splice(toIdx, 0, moved);
    reorder(items.map(i => i.scriptId));
    setDragIdx(null);
  };

  const toggleScript = (scriptId, on) => update(scriptId, { enabled: on });
  const setRunMode = (scriptId, mode) => update(scriptId, { runMode: mode });

  const openEditor = (custom) => {
    if (custom) {
      setEditId(custom.id || custom.customId);
      setEditName(custom.name);
      setEditDesc(custom.description || '');
      setEditPlatform(custom.platform || 'all');
      setEditCode(custom.code || '');
    } else {
      setEditId(null);
      setEditName('');
      setEditDesc('');
      setEditPlatform('all');
      setEditCode(TEMPLATE);
    }
    setShowEditor(true);
  };

  const saveCustom = async () => {
    const res = await window.api.cloakmanager.saveCustomScript({
      token, id: editId, name: editName.trim(),
      description: editDesc.trim(), platform: editPlatform, code: editCode,
    });
    if (!res.ok) throw new Error(res.error);
    if (!editId && res.script) {
      await update(`custom:${res.script.id}`, { enabled: true, runMode: 'always' });
    }
    await load();
    setShowEditor(false);
  };

  const deleteCustom = async (customId) => {
    if (!confirm('Delete this custom script? It will be removed from every model.')) return;
    const res = await window.api.cloakmanager.deleteCustomScript({ token, id: customId });
    if (!res.ok) { setError(res.error); return; }
    load();
  };

  const nBuiltin = merged.filter(i => i.type === 'builtin').length;
  const nCustom = merged.filter(i => i.type === 'custom').length;
  const nEnabled = merged.filter(i => i.enabled).length;
  const nOnce = merged.filter(i => i.runMode === 'once').length;

  if (loading) {
    return (
      <div style={S.overlay} onClick={onClose}>
        <div style={S.modal} onClick={e => e.stopPropagation()}>
          <div style={S.header}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Launch Scripts</div>
          </div>
          <div style={{ padding: 40, textAlign: 'center' }}><Spinner label="Loading..." /></div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.header}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Launch Scripts</div>
            <div style={S.stats}>
              {nBuiltin + nCustom} script{nBuiltin + nCustom !== 1 ? 's' : ''}
              &nbsp;·&nbsp;{nEnabled} enabled
              &nbsp;·&nbsp;{nOnce} run-once
              &nbsp;&nbsp;—&nbsp;&nbsp;<span className="mono">{modelName || `#${profileId}`}</span>
              {platforms.length > 0 && (
                <span className="dim" style={{ marginLeft: 6, fontSize: 11 }}>{platforms.join(', ')}</span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Shared by every account on this model — CloakManager launches one browser. Account-scoped steps (login, inbox) only run for whichever account a launch was targeted at.
            </div>
          </div>
          <button className="ghost" onClick={onClose} style={{ fontSize: 20, padding: '0 8px', flexShrink: 0 }}>
            &times;
          </button>
        </div>

        <div style={S.body}>
          {error && <Banner kind="err" style={{ margin: '0 4px 10px' }}>{error}<button className="ghost" style={{ marginLeft: 12, fontSize: 11 }} onClick={() => setError(null)}>Dismiss</button></Banner>}

          {nBuiltin === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: '12px 8px' }}>No built-in scripts found.</div>
          )}

          {merged.filter(i => i.type === 'builtin').map((script, idx) => (
            <Row
              key={script.scriptId}
              script={script}
              idx={idx}
              dragIdx={dragIdx}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onToggle={toggleScript}
              onModeChange={setRunMode}
            />
          ))}

          <div style={S.divider}>
            <div style={S.dividerLine} />
            <span>Custom Scripts</span>
            <div style={S.dividerLine} />
          </div>

          {nCustom === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: '4px 8px 8px' }}>No custom scripts yet.</div>
          )}

          {merged.filter(i => i.type === 'custom').map((script, idx) => (
            <Row
              key={script.scriptId}
              script={script}
              idx={nBuiltin + idx}
              dragIdx={dragIdx}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onToggle={toggleScript}
              onModeChange={setRunMode}
              onEdit={openEditor}
              onDelete={deleteCustom}
            />
          ))}

          <button style={S.addBtn} onClick={() => openEditor(null)}>
            + New custom script
          </button>
        </div>
      </div>

      {showEditor && (
        <ScriptEditor
          editId={editId}
          editName={editName}
          editDesc={editDesc}
          editPlatform={editPlatform}
          editCode={editCode}
          onChange={(field, value) => {
            if (field === 'editName') setEditName(value);
            else if (field === 'editDesc') setEditDesc(value);
            else if (field === 'editPlatform') setEditPlatform(value);
            else if (field === 'editCode') setEditCode(value);
          }}
          onSave={saveCustom}
          onClose={() => setShowEditor(false)}
        />
      )}
    </div>
  );
}
