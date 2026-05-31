import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { useActiveAccount, pickPreferredAccount } from '../lib/activeAccount.jsx';

const COLORS = ['#c8553d', '#d4a55a', '#7a9a5a', '#5a7a9a', '#9a5a8e', '#8e6a4a'];

export default function ProfilesPage({ navigate }) {
  const { token, user } = useAuth();
  const { startAccount } = useActiveAccount();
  const [profiles, setProfiles] = useState([]);

  async function playModel(profileId) {
    const res = await window.api.accounts.listForProfile({ token, profileId });
    if (!res.ok || !res.accounts.length) {
      alert('No accounts on this model yet. Link one first.');
      return;
    }
    // Pre-cookied Chrome window per account (Electron BrowserWindow uses the
    // account's persist:<partition> so cookies + UA + proxy are already wired).
    for (const a of res.accounts) {
      await window.api.windows.openAccountBrowser({ accountId: a.id });
    }
  }

  const [users, setUsers] = useState([]);
  const [proxies, setProxies] = useState([]);
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
    const px = await window.api.proxies.list({ token }).catch(() => ({ ok: false }));
    if (px.ok) setProxies(px.proxies || []);
  }

  async function setModelProxy(profileId, proxyId) {
    await window.api.profiles.update({ token, profileId, updates: { proxy_id: proxyId ? Number(proxyId) : null } });
    load();
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
                    title="Open Model Hub"
                    onClick={(e) => { e.stopPropagation(); navigate && navigate('model-hub', { modelId: p.id }); }}
                    style={{
                      width: 38, height: 38, borderRadius: '50%', padding: 0,
                      display: 'grid', placeItems: 'center', fontSize: 16,
                      background: 'var(--bg-1)', color: 'var(--gold-bright)',
                      border: '1px solid var(--gold)', cursor: 'pointer',
                    }}
                  >◇</button>
                  <button
                    title="Start Reddit browser as this model's first account"
                    onClick={(e) => { e.stopPropagation(); playModel(p.id); }}
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
              {(p.members && p.members.length > 0) && (
                <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg-1)' }}>
                  <div className="dim" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Team</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {p.members.map((m) => (
                      <span key={m.id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: 'var(--bg-2)', border: '1px solid var(--border)',
                        borderRadius: 999, padding: '3px 9px', fontSize: 11,
                      }} title={`${m.display_name} · ${m.role}`}>
                        <span style={{ color: 'var(--gold)' }}>{m.display_name}</span>
                        <span className="dim" style={{ fontSize: 10 }}>{m.role}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {canManage && (
                <div style={{ padding: 18, paddingTop: 12, borderTop: '1px solid var(--border)', background: 'var(--bg-1)' }}>
                  <label>Primary manager</label>
                  <select
                    value={p.assigned_user_id || ''}
                    onChange={(e) => reassign(p.id, e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">— unassigned —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>
                    ))}
                  </select>
                  <label style={{ marginTop: 10 }}>Add team member</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select id={`member-user-${p.id}`} defaultValue="" style={{ flex: 2 }}>
                      <option value="">— pick user —</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>
                      ))}
                    </select>
                    <select id={`member-role-${p.id}`} defaultValue="chatter" style={{ flex: 1 }}>
                      <option value="manager">Manager</option>
                      <option value="chatter">Chatter</option>
                      <option value="coordinator">Coordinator</option>
                      <option value="marketing">Marketing</option>
                    </select>
                    <button className="ghost" onClick={async () => {
                      const u = Number(document.getElementById(`member-user-${p.id}`).value);
                      const r = document.getElementById(`member-role-${p.id}`).value;
                      if (!u) return;
                      await window.api.profiles.addMember({ token, profileId: p.id, userId: u, role: r });
                      load();
                    }}>Add</button>
                  </div>
                  {p.members && p.members.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {p.members.map((m) => (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <span style={{ flex: 1 }}>{m.display_name} <span className="dim">({m.username})</span></span>
                          <select
                            value={m.role}
                            onChange={async (e) => {
                              await window.api.profiles.setMemberRole({ token, profileId: p.id, userId: m.user_id, role: e.target.value });
                              load();
                            }}
                            style={{ fontSize: 11, padding: '2px 6px' }}
                          >
                            <option value="manager">Manager</option>
                            <option value="chatter">Chatter</option>
                            <option value="coordinator">Coordinator</option>
                            <option value="marketing">Marketing</option>
                          </select>
                          <button className="ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={async () => {
                            await window.api.profiles.removeMember({ token, profileId: p.id, userId: m.user_id });
                            load();
                          }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label style={{ marginTop: 10 }}>Main email <span className="dim" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(primary recovery email shown on the Dashboard)</span></label>
                  <input
                    type="email"
                    defaultValue={p.main_email || ''}
                    placeholder="primary@example.com"
                    onBlur={async (e) => {
                      const v = e.target.value.trim() || null;
                      if (v === (p.main_email || null)) return;
                      await window.api.profiles.update({ token, profileId: p.id, updates: { main_email: v } });
                      load();
                    }}
                  />
                  <label style={{ marginTop: 10 }}>Model proxy <span className="dim" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(inherited by accounts without their own)</span></label>
                  <select
                    value={p.proxy_id || ''}
                    onChange={(e) => setModelProxy(p.id, e.target.value)}
                  >
                    <option value="">— none —</option>
                    {proxies.map((px) => (
                      <option key={px.id} value={px.id}>{px.label} · {px.kind} {px.host}:{px.port}</option>
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
