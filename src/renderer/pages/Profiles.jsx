import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { useActiveAccount, pickPreferredAccount } from '../lib/activeAccount.jsx';

const COLORS = ['#c8553d', '#d4a55a', '#7a9a5a', '#5a7a9a', '#9a5a8e', '#8e6a4a'];

export default function ProfilesPage({ navigate }) {
  const { token, user } = useAuth();
  const { startAccount } = useActiveAccount();
  const [profiles, setProfiles] = useState([]);

  async function playModel(profileId, platform = 'reddit') {
    const res = await window.api.accounts.listForProfile({ token, profileId, platform });
    if (!res.ok || !res.accounts.length) {
      alert(`No ${platform} accounts on this model yet. Open the model and link one.`);
      return;
    }
    const pick = pickPreferredAccount(res.accounts);
    await startAccount(pick.id);
    navigate(platform);
  }

  const [users, setUsers] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blank());
  const [error, setError] = useState(null);
  const [importMsg, setImportMsg] = useState(null);

  const can = useCan();
  const canManage = can('profiles.manage');

  function blank() {
    return { name: '', assigned_user_id: '', niche: '', brand_voice: '', notes: '', avatar_color: COLORS[0] };
  }

  async function load() {
    const p = await window.api.profiles.list({ token });
    if (p.ok) setProfiles(p.profiles);
    if (canManage) {
      const u = await window.api.auth.listUsers({ token });
      if (u.ok) setUsers(u.users);
    }
  }
  useEffect(() => { load(); }, []);

  async function addProfile(e) {
    e.preventDefault();
    setError(null);
    if (!form.name) { setError('Name is required'); return; }
    const res = await window.api.profiles.create({
      token, name: form.name,
      assignedUserId: form.assigned_user_id ? Number(form.assigned_user_id) : null,
      niche: form.niche, brandVoice: form.brand_voice, notes: form.notes,
      avatarColor: form.avatar_color,
    });
    if (!res.ok) { setError(res.error); return; }
    setForm(blank()); setShowAdd(false); load();
  }

  async function reassign(profileId, userId) {
    await window.api.profiles.assign({ token, profileId, assignedUserId: userId || null });
    load();
  }

  async function del(id) {
    if (!confirm('Delete this model profile? All its Reddit account records will be removed too.')) return;
    await window.api.profiles.delete({ token, profileId: id });
    load();
  }

  async function exportProfile(profileId) {
    const res = await window.api.bundle.export({ token, profileId });
    if (!res.ok && res.error !== 'Cancelled') alert('Export failed: ' + res.error);
    else if (res.ok) setImportMsg({ kind: 'ok', text: `Exported to ${res.path}` });
  }

  async function importProfile() {
    const res = await window.api.bundle.import({ token, assignedUserId: null });
    if (!res.ok) {
      if (res.error !== 'Cancelled') alert('Import failed: ' + res.error);
      return;
    }
    setImportMsg({ kind: 'ok', text: `Imported "${res.profileName}" with ${res.accountCount} account(s)` });
    load();
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Manage</div>
          <h1>Model Profiles</h1>
        </div>
        {canManage && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={importProfile}>Import from file</button>
            <button className="primary" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? 'Cancel' : '+ New model'}
            </button>
          </div>
        )}
      </div>

      {importMsg && (
        <div style={{ background: 'rgba(122,154,90,0.12)', border: '1px solid var(--ok)', color: '#bdd5a3', padding: '10px 14px', borderRadius: 4, marginBottom: 16 }}>
          {importMsg.text}
        </div>
      )}

      {showAdd && canManage && (
        <form onSubmit={addProfile} className="card" style={{ marginBottom: 22 }}>
          <h3 style={{ marginBottom: 14 }}>New model profile</h3>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Model name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Luna" />
            </div>
            <div>
              <label>Assign to team member</label>
              <select value={form.assigned_user_id} onChange={(e) => setForm({ ...form, assigned_user_id: e.target.value })}>
                <option value="">— unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>
                ))}
              </select>
            </div>
            <div>
              <label>Niche / category</label>
              <input value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} placeholder="e.g. gym, latina, gamer" />
            </div>
            <div>
              <label>Color</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {COLORS.map(c => (
                  <button key={c} type="button"
                    onClick={() => setForm({ ...form, avatar_color: c })}
                    style={{
                      width: 28, height: 28, padding: 0, borderRadius: '50%',
                      background: c, border: form.avatar_color === c ? '2px solid var(--text-0)' : '2px solid transparent',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>Brand voice (optional)</label>
            <textarea rows={3} value={form.brand_voice} onChange={(e) => setForm({ ...form, brand_voice: e.target.value })} placeholder="Tone, vibe, dos and don'ts for posting style…" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>Notes (optional)</label>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="primary">Create</button>
            <button type="button" className="ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </form>
      )}

      {profiles.length === 0 ? (
        <div className="empty-state">No model profiles yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {profiles.map((p) => (
            <div key={p.id} className="card" style={{ borderLeft: `3px solid ${p.avatar_color || 'var(--accent)'}`, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: 18, position: 'relative' }}>
                <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 6, zIndex: 2 }}>
                  <button
                    title="Start Reddit browser as this model's first account"
                    onClick={(e) => { e.stopPropagation(); playModel(p.id, 'reddit'); }}
                    style={{
                      width: 38, height: 38, borderRadius: '50%', padding: 0,
                      display: 'grid', placeItems: 'center', fontSize: 14,
                      background: 'var(--gradient-brand)', color: '#1a1a14',
                      border: '1px solid var(--gold)', cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(212,166,74,0.35)',
                    }}
                  >▶</button>
                </div>
                <div
                  onClick={() => navigate && navigate('model', { modelId: p.id })}
                  style={{ cursor: 'pointer', paddingRight: 52 }}
                >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                  <h3>{p.name}</h3>
                  {p.niche && <span className="pill">{p.niche}</span>}
                  <div style={{ flex: 1 }} />
                </div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  {p.account_count} accounts ({p.ready_count} ready)
                  {p.assigned_to_name && <> · assigned to <span style={{ color: 'var(--text-1)' }}>{p.assigned_to_username}</span></>}
                </div>
                {p.brand_voice && <div className="muted" style={{ fontSize: 12, marginBottom: 8, fontStyle: 'italic' }}>"{p.brand_voice}"</div>}
                {p.notes && <div className="muted" style={{ fontSize: 12 }}>{p.notes}</div>}
                </div>
              </div>
              {canManage && (
                <div style={{ padding: 18, paddingTop: 12, borderTop: '1px solid var(--border)', background: 'var(--bg-1)' }}>
                  <label>Assigned team member</label>
                  <select
                    value={p.assigned_user_id || ''}
                    onChange={(e) => reassign(p.id, e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">— unassigned —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>
                    ))}
                  </select>
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <button className="ghost" onClick={() => exportProfile(p.id)}>Export</button>
                    <button className="danger" onClick={() => del(p.id)}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
