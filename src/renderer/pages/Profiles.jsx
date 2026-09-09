import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { useCloudReload } from '../lib/cloudReload.jsx';
import { useCloakManagerLaunch } from '../hooks/useCloakManagerLaunch';
import { EmptyState } from '../components/ui.jsx';
import { useToast } from '../lib/toast.jsx';
import { useConfirm } from '../lib/confirm.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { ProfilesSkeleton } from '../components/Skeletons.jsx';

const COLORS = ['#c8553d', 'var(--gold)', 'var(--green-bright)', '#5a7a9a', '#9a5a8e', '#8e6a4a'];

export default function ProfilesPage({ navigate }) {
  const { token, user, activeTeamId } = useAuth();
  const { isAvailable, checkAvailability } = useCloakManagerLaunch();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [profiles, setProfiles] = useState([]);
  const [loadingSkel, setLoadingSkel] = useState(true);

  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blank());
  const [error, setError] = useState(null);
  const [memberForms, setMemberForms] = useState({});
  const [emailDrafts, setEmailDrafts] = useState({});
  const can = useCan();
  const canManage = can('profiles.manage');

  function blank() {
    return { name: '', assigned_user_id: '', niche: '', brand_voice: '', notes: '', avatar_color: COLORS[0], browser_mode: 'electron' };
  }

  async function load() {
    const p = await window.api.profiles.list({ token, teamId: activeTeamId });
    if (p.ok) setProfiles(p.profiles);
    if (canManage) {
      const u = await window.api.auth.listUsers({ token });
      if (u.ok) setUsers(u.users);
    }
    const px = await window.api.proxies.list({ token, teamId: activeTeamId }).catch(() => ({ ok: false }));
    if (px.ok) setProxies(px.proxies || []);
    const r = await window.api.roles.list({ token }).catch(() => ({ ok: false }));
    if (r.ok) setRoles(r.roles || []);
    setLoadingSkel(false);
  }

  async function setModelProxy(profileId, proxyId) {
    const res = await window.api.profiles.update({ token, profileId, updates: { proxy_id: proxyId ? Number(proxyId) : null }, teamId: activeTeamId });
    if (!res.ok) {
      toast('err', `Failed to update proxy: ${res.error || 'Unknown error'}`);
      return;
    }
    setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, proxy_id: proxyId ? Number(proxyId) : null } : p));
  }
  useEffect(() => {
    load();
    checkAvailability(token);
  }, [token, activeTeamId]);
  useCloudReload(['model_profiles', 'proxies', 'roles', 'role_permissions'], () => { load(); });

  async function addProfile(e) {
    e.preventDefault();
    setError(null);
    if (!form.name) { setError('Name is required'); return; }
    const res = await window.api.profiles.create({
      token, name: form.name,
      assignedUserId: form.assigned_user_id ? Number(form.assigned_user_id) : null,
      niche: form.niche, brandVoice: form.brand_voice, notes: form.notes,
      avatarColor: form.avatar_color,
      browserMode: form.browser_mode,
      teamId: activeTeamId,
    });
    if (!res.ok) { setError(res.error); return; }
    const newId = res.id;
    setForm(blank()); setShowAdd(false); await load();
    if (form.browser_mode === 'cloakmanager') {
      toast(res.cmProfile?.ok ? 'ok' : 'err',
        res.cmProfile?.ok
          ? `Model created — CloakManager profile "${res.cmProfile.profileName}" ready.`
          : `Model created, but CloakManager profile failed: ${res.cmProfile?.error || 'unknown error'}`);
    } else {
      toast('ok', 'Model created.');
    }
    setTimeout(() => {
      const el = document.querySelector(`*[data-profile-id="${newId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }

  async function reassign(profileId, userId) {
    const res = await window.api.profiles.assign({ token, profileId, assignedUserId: userId || null, teamId: activeTeamId });
    if (!res.ok) {
      toast('err', `Failed to reassign profile: ${res.error || 'Unknown error'}`);
      return;
    }
    setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, assigned_user_id: userId || null } : p));
  }

  async function del(id) {
    const ok = await confirm('Delete this model profile? All its linked platform accounts will be removed too.', { confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    const res = await window.api.profiles.delete({ token, profileId: id, teamId: activeTeamId });
    if (!res.ok) {
      toast('err', `Failed to delete profile: ${res.error || 'Unknown error'}`);
      return;
    }
    toast('ok', 'Model deleted.');
    load();
  }

  async function exportProfile(profileId) {
    const res = await window.api.bundle.export({ token, profileId });
    if (!res.ok && res.error !== 'Cancelled') toast('err', 'Export failed: ' + res.error);
    else if (res.ok) toast('ok', `Exported to ${res.path}`);
  }

  async function importProfile() {
    const res = await window.api.bundle.import({ token, assignedUserId: null });
    if (!res.ok) {
      if (res.error !== 'Cancelled') toast('err', 'Import failed: ' + res.error);
      return;
    }
    toast('ok', `Imported "${res.profileName}" with ${res.accountCount} account(s)`);
    load();
  }

  return (
    <div>
      <PageHeader eyebrow="Manage" title="Model Profiles">
        {canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={importProfile}>Import from file</button>
            <button className="primary" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? 'Cancel' : '+ New model'}
            </button>
          </div>
        )}
      </PageHeader>

      {/* CloakManager Availability Status */}
      {isAvailable !== null && (
        <div style={{
          padding: '8px 12px',
          background: isAvailable ? 'rgba(122,154,90,0.12)' : 'rgba(180,90,90,0.12)',
          borderWidth: 1, borderStyle: 'solid',
          borderColor: isAvailable ? 'var(--ok)' : 'var(--danger)',
          borderRadius: 'var(--radius)',
          fontSize: 12,
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isAvailable ? 'var(--online-green)' : 'var(--danger-fg)'
          }} />
          CloakManager: {isAvailable ? 'Available' : 'Unavailable'}
        </div>
      )}

      {loadingSkel ? (
        <ProfilesSkeleton />
      ) : (
        <>
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
                      background: c,                       borderWidth: 2, borderStyle: 'solid',
                      borderColor: form.avatar_color === c ? 'var(--text-0)' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </div>
            <div>
              <label>Browser mode</label>
              <select value={form.browser_mode} onChange={(e) => setForm({ ...form, browser_mode: e.target.value })}>
                <option value="electron">Electron (default)</option>
                <option value="cloakmanager">CloakManager</option>
              </select>
              <div className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>
                {form.browser_mode === 'cloakmanager'
                  ? "One shared antidetect browser profile is created for this model right now."
                  : 'Built-in Oserus Browser, one session per account. Can switch to CloakManager later.'}
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
        <EmptyState icon="◇" title="No model profiles yet" hint="Create your first model profile to start organizing accounts by brand or persona." action={canManage && <button className="primary" onClick={() => setShowAdd(true)}>+ New model</button>} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {profiles.map((p) => (
            <div key={p.id} className="card" data-profile-id={p.id} style={{ borderLeft: `3px solid ${p.avatar_color || 'var(--accent)'}`, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: 18, position: 'relative' }}>
                <div
                  onClick={() => navigate && navigate('model', { modelId: p.id })}
                  style={{ cursor: 'pointer' }}
                  title={`Open ${p.name} profile`}
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
                        borderRadius: 'var(--radius-pill)', padding: '3px 9px', fontSize: 11,
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
                    <select
                      value={(memberForms[p.id] || {}).userId || ''}
                      onChange={(e) => setMemberForms(m => ({ ...m, [p.id]: { ...(m[p.id] || {}), userId: e.target.value } }))}
                      style={{ flex: 2 }}
                    >
                      <option value="">— pick user —</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>
                      ))}
                    </select>
                    <select
                      value={(memberForms[p.id] || {}).role || ''}
                      onChange={(e) => setMemberForms(m => ({ ...m, [p.id]: { ...(m[p.id] || {}), role: e.target.value } }))}
                      style={{ flex: 1 }}
                      disabled={roles.length === 0}
                    >
                      {roles.length === 0
                        ? <option value="">— no roles —</option>
                        : roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)
                      }
                    </select>
                    <button className="ghost" onClick={async () => {
                      const formData = memberForms[p.id] || {};
                      const u = Number(formData.userId);
                      const r = formData.role;
                      if (!u) return;
                      await window.api.profiles.addMember({ token, profileId: p.id, userId: u, role: r });
                      setMemberForms(m => { const n = { ...m }; delete n[p.id]; return n; });
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
                              setProfiles(prev => prev.map(pr => {
                                if (pr.id !== p.id) return pr;
                                return { ...pr, members: (pr.members || []).map(mb => mb.user_id === m.user_id ? { ...mb, role: e.target.value } : mb) };
                              }));
                            }}
                            style={{ fontSize: 11, padding: '2px 6px' }}
                          >
                            {!roles.some((r) => r.key === m.role) && <option value={m.role}>{m.role}</option>}
                            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
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
                    value={emailDrafts[p.id] ?? p.main_email ?? ''}
                    onChange={(e) => setEmailDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                    placeholder="primary@example.com"
                    onBlur={async (e) => {
                      const v = e.target.value.trim() || null;
                      if (v === (p.main_email || null)) { setEmailDrafts(d => { const n = { ...d }; delete n[p.id]; return n; }); return; }
                      await window.api.profiles.update({ token, profileId: p.id, updates: { main_email: v }, teamId: activeTeamId });
                      setEmailDrafts(d => { const n = { ...d }; delete n[p.id]; return n; });
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
      </>
      )}
    </div>
  );
}
