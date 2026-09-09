import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { PLATFORMS, refreshPlatforms, platformColor, platformLabel } from '../lib/platforms.js';
import { useToast } from '../lib/toast.jsx';
import { useConfirm } from '../lib/confirm.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function PlatformsPage({ navigate }) {
  const { token } = useAuth();
  const can = useCan();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const canManage = can('profiles.manage');
  const [platforms, setPlatforms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [error, setError] = useState(null);

  function blankForm() {
    return { key: '', label: '', short: '', color: '#888888', home_url: '', login_url: '', username_prefix: '@', icon: '' };
  }

  async function load() {
    const res = await window.api.platforms.list();
    if (res.ok) setPlatforms(res.platforms);
  }

  useEffect(() => { load(); }, []);

  function startAdd() {
    setEditing(null);
    setForm(blankForm());
    setError(null);
    setShowForm(true);
  }

  function startEdit(p) {
    setEditing(p);
    setForm({
      key: p.key,
      label: p.label,
      short: p.short || '',
      color: p.color || '#888888',
      home_url: p.home_url || '',
      login_url: p.login_url || '',
      username_prefix: p.username_prefix || '@',
      icon: p.icon || '',
    });
    setError(null);
    setShowForm(true);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.label.trim()) { setError('Label required'); return; }

    if (editing) {
      const res = await window.api.platforms.update({
        token, platformId: editing.id,
        updates: {
          label: form.label,
          short: form.short || form.label.charAt(0).toUpperCase(),
          color: form.color,
          home_url: form.home_url || null,
          login_url: form.login_url || null,
          username_prefix: form.username_prefix || '@',
          icon: form.icon || null,
        },
      });
      if (!res.ok) { setError(res.error); return; }
      toast('ok', 'Platform updated');
    } else {
      if (!form.key.trim()) { setError('Key required'); return; }
      const res = await window.api.platforms.create({
        token,
        platform: {
          key: form.key,
          label: form.label,
          short: form.short || form.label.charAt(0).toUpperCase(),
          color: form.color,
          home_url: form.home_url || null,
          login_url: form.login_url || null,
          username_prefix: form.username_prefix || '@',
          icon: form.icon || null,
        },
      });
      if (!res.ok) { setError(res.error); return; }
      toast('ok', 'Platform created');
    }

    setShowForm(false);
    await load();
    await refreshPlatforms();
  }

  async function remove(p) {
    const ok = await confirm(`Delete platform "${p.label}"? This cannot be undone.`, { confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    const res = await window.api.platforms.delete({ token, platformId: p.id });
    if (!res.ok) { toast('err', res.error); return; }
    toast('ok', 'Platform deleted');
    await load();
    await refreshPlatforms();
  }

  if (!canManage) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
        <h2>Admin only</h2>
        <div className="muted">Only admins can manage platforms.</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Platforms"
        subtitle="Manage the websites and social platforms your models use. Built-in platforms have specialized automation; custom platforms get browser sessions with fingerprint isolation."
      />

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <form onSubmit={submit} onClick={e => e.stopPropagation()} style={{
            width: 520, maxHeight: '90vh', overflowY: 'auto',
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: 22,
          }} className="modal-card">
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, flex: 1 }}>{editing ? `Edit ${editing.label}` : 'Add Platform'}</h3>
              <button type="button" onClick={() => setShowForm(false)} style={{
                width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'var(--bg-2)',
                color: 'var(--text-2)', cursor: 'pointer', display: 'grid',
                placeItems: 'center', fontSize: 13, padding: 0,
              }}>×</button>
            </div>
            {error && <div className="error-banner">{error}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label>Key (slug) {editing && <span className="dim">(cannot change)</span>}</label>
                <input
                  value={form.key}
                  disabled={!!editing}
                  onChange={e => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                  placeholder="e.g. onlyfans"
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label>Label</label>
                <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. OnlyFans" />
              </div>
              <div>
                <label>Short label</label>
                <input value={form.short} onChange={e => setForm({ ...form, short: e.target.value })} placeholder="e.g. OF" />
              </div>
              <div>
                <label>Color</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} style={{ width: 40, height: 34, padding: 0, border: 'none', cursor: 'pointer' }} />
                  <input value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} style={{ flex: 1, fontFamily: 'monospace' }} />
                </div>
              </div>
              <div>
                <label>Username prefix</label>
                <input value={form.username_prefix} onChange={e => setForm({ ...form, username_prefix: e.target.value })} placeholder="@" />
              </div>
              <div>
                <label>Icon (emoji)</label>
                <input value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="◈" />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label>Home URL</label>
              <input value={form.home_url} onChange={e => setForm({ ...form, home_url: e.target.value })} placeholder="https://www.example.com/" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label>Login URL</label>
              <input value={form.login_url} onChange={e => setForm({ ...form, login_url: e.target.value })} placeholder="https://www.example.com/login" />
            </div>

            <div className="muted" style={{ fontSize: 11, marginBottom: 14 }}>
              Custom platforms support browser sessions with fingerprint and proxy isolation.
              Automated posting and engagement are only available for built-in platforms.
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="primary">{editing ? 'Save changes' : 'Create platform'}</button>
              <button type="button" className="ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>All platforms</h2>
        <span className="mono dim" style={{ fontSize: 12 }}>{platforms.length} configured</span>
        <div style={{ flex: 1 }} />
        <button className="primary" onClick={startAdd}>+ Add platform</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {platforms.map(p => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-elev)',
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: p.color || '#888',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                {p.icon && <span>{p.icon}</span>}
                {p.label}
                <span className="mono dim" style={{ fontSize: 11 }}>{p.key}</span>
                {p.is_builtin ? (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 'var(--radius-pill)',
                    background: 'rgba(122,154,90,0.2)', color: 'var(--success-fg)', fontWeight: 700,
                  }}>BUILT-IN</span>
                ) : (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 'var(--radius-pill)',
                    background: 'rgba(155,89,182,0.2)', color: '#9b59b6', fontWeight: 700,
                  }}>CUSTOM</span>
                )}
              </div>
              <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
                {p.home_url || 'No URL set'}
                {p.username_prefix && ` · prefix: ${p.username_prefix}`}
              </div>
            </div>
            <button className="ghost" onClick={() => startEdit(p)}>Edit</button>
            {!p.is_builtin && (
              <button className="danger" onClick={() => remove(p)}>Delete</button>
            )}
          </div>
        ))}
      </div>

      {platforms.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-1)', fontSize: 13, color: 'var(--text-3)' }}>
          No platforms configured yet.
        </div>
      )}
    </div>
  );
}
