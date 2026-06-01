import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { usePermissions } from '../lib/permissions.jsx';

const blankRole = { key: '', label: '', description: '', permissions: [] };

export default function RolesPage() {
  const { token } = useAuth();
  const { previewAs, previewing, effectiveRole, reload } = usePermissions();
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [editing, setEditing] = useState(null); // role key being edited
  const [draft, setDraft] = useState(blankRole);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  async function load() {
    const r = await window.api.roles.list({ token });
    if (r.ok) {
      setRoles(r.roles);
      setPermissions(r.permissions);
    }
  }
  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const g = {};
    for (const p of permissions) (g[p.group] = g[p.group] || []).push(p);
    return g;
  }, [permissions]);

  function startCreate() {
    setError(null);
    setCreating(true);
    setEditing(null);
    setDraft({ ...blankRole });
  }

  function startEdit(role) {
    setError(null);
    setCreating(false);
    setEditing(role.key);
    setDraft({
      key: role.key,
      label: role.label,
      description: role.description || '',
      permissions: [...role.permissions],
    });
  }

  function togglePerm(key) {
    setDraft((d) => ({
      ...d,
      permissions: d.permissions.includes(key)
        ? d.permissions.filter((p) => p !== key)
        : [...d.permissions, key],
    }));
  }

  function toggleGroup(group, value) {
    const keys = grouped[group].map((p) => p.key);
    setDraft((d) => {
      const set = new Set(d.permissions);
      if (value) keys.forEach((k) => set.add(k));
      else keys.forEach((k) => set.delete(k));
      return { ...d, permissions: Array.from(set) };
    });
  }

  async function save() {
    setError(null);
    try {
      if (creating) {
        const res = await window.api.roles.create({
          token,
          key: draft.key,
          label: draft.label,
          description: draft.description,
          permissions: draft.permissions,
        });
        if (!res.ok) throw new Error('create failed');
      } else {
        const res = await window.api.roles.update({
          token,
          key: editing,
          label: draft.label,
          description: draft.description,
          permissions: draft.permissions,
        });
        if (!res.ok) throw new Error('update failed');
      }
      setEditing(null);
      setCreating(false);
      setFlash('Saved.');
      setTimeout(() => setFlash(null), 2500);
      await load();
      reload();
    } catch (e) {
      setError(e.message || 'Failed to save');
    }
  }

  async function remove(role) {
    if (!confirm(`Delete role "${role.label}"? This can't be undone.`)) return;
    try {
      const res = await window.api.roles.delete({ token, key: role.key });
      if (!res.ok) throw new Error('delete failed');
      setFlash('Deleted.');
      setTimeout(() => setFlash(null), 2500);
      await load();
    } catch (e) {
      alert(e.message || 'Failed to delete');
    }
  }

  return (
    <div>
      <div className="title-block">
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="primary" onClick={startCreate}>+ New role</button>
        </div>
      </div>

      {flash && <div style={styles.ok}>{flash}</div>}

      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Roles define which permissions a user has. Edit builtin roles to tweak
        their defaults, or create custom roles for niche team setups. Use{' '}
        <strong>Preview as</strong> on any role to see exactly what they see.
      </div>

      {(creating || editing) && (
        <div className="card bordered-glow" style={{ marginBottom: 18 }}>
          <h3 style={{ marginBottom: 14 }}>{creating ? 'New role' : `Edit ${editing}`}</h3>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Key (used in code)</label>
              <input
                value={draft.key}
                disabled={!creating}
                placeholder="social_media_manager"
                onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })}
              />
            </div>
            <div>
              <label>Display label</label>
              <input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="Social Media Manager"
              />
            </div>
            <div>
              <label>Description</label>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What this role is for"
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8 }}>Permissions</label>
            <div style={{ display: 'grid', gap: 14 }}>
              {Object.entries(grouped).map(([group, items]) => {
                const allChecked = items.every((i) => draft.permissions.includes(i.key));
                const someChecked = items.some((i) => draft.permissions.includes(i.key));
                return (
                  <div key={group} style={styles.permGroup}>
                    <div style={styles.permGroupHead}>
                      <strong style={{ flex: 1 }}>{group}</strong>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => toggleGroup(group, !allChecked)}
                        style={{ fontSize: 11 }}
                      >
                        {allChecked ? 'Uncheck all' : 'Check all'}
                      </button>
                    </div>
                    <div style={styles.permGrid}>
                      {items.map((p) => (
                        <label key={p.key} style={styles.permRow}>
                          <input
                            type="checkbox"
                            checked={draft.permissions.includes(p.key)}
                            onChange={() => togglePerm(p.key)}
                          />
                          <span>{p.label}</span>
                          <span className="dim mono" style={{ fontSize: 10, marginLeft: 'auto' }}>{p.key}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button className="primary" onClick={save}>{creating ? 'Create role' : 'Save changes'}</button>
            <button className="ghost" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {roles.map((r) => (
          <div key={r.key} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <h3 style={{ flex: 1, marginBottom: 0 }}>{r.label}</h3>
              {r.is_builtin && <span className="pill">builtin</span>}
            </div>
            <div className="mono dim" style={{ fontSize: 11, marginBottom: 6 }}>{r.key}</div>
            {r.description && <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{r.description}</div>}
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              {r.permissions.length} permission{r.permissions.length === 1 ? '' : 's'} ·{' '}
              {r.user_count} user{r.user_count === 1 ? '' : 's'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => startEdit(r)}>Edit</button>
              <button onClick={() => previewAs(r.key)}>
                {previewing && effectiveRole === r.key ? 'Previewing…' : 'Preview as'}
              </button>
              {!r.is_builtin && (
                <button className="danger" onClick={() => remove(r)} style={{ marginLeft: 'auto' }}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  ok: {
    background: 'rgba(122,154,90,0.12)',
    border: '1px solid var(--ok)',
    color: '#bdd5a3',
    padding: '10px 14px',
    borderRadius: 4,
    marginBottom: 12,
  },
  permGroup: {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
  },
  permGroupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: 'var(--bg-2)',
    borderBottom: '1px solid var(--border)',
    fontSize: 12,
  },
  permGrid: {
    padding: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 6,
  },
  permRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    padding: '4px 6px',
    cursor: 'pointer',
  },
};
