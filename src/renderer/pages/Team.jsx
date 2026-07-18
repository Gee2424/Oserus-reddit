import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

export default function TeamPage({ navigate }) {
  const { user, activeTeamId } = useAuth();
  const can = useCan();
  const [tab, setTab] = useState('members');
  const [teams, setTeams] = useState([]);
  const [activeTeam, setActiveTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [machines, setMachines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [createName, setCreateName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('member');

  useEffect(() => {
    loadTeams();
  }, [activeTeamId]);

  async function createTeam() {
    const name = createName.trim();
    if (!name) return;
    setBusy(true);
    setMsg(null);
    const res = await window.api.team.createTeam({ name });
    setBusy(false);
    if (res.ok) {
      setCreateName('');
      navigate('dashboard');
    } else {
      setMsg({ kind: 'err', text: res.error });
    }
  }

  async function loadTeams() {
    const res = await window.api.team.listTeams({});
    if (res.ok) {
      const list = res.teams || [];
      setTeams(list);
      const match = activeTeamId ? list.find(t => t.id === activeTeamId) : null;
      setActiveTeam(match || list[0] || null);
    }
  }

  useEffect(() => {
    if (!activeTeam) return;
    loadMembers();
    loadMachines();
  }, [activeTeam]);

  async function loadMembers() {
    if (!activeTeam) return;
    const res = await window.api.team.listMembers({ teamId: activeTeam.id });
    if (res.ok) setMembers(res.members || []);
  }

  async function loadMachines() {
    if (!activeTeam) return;
    const res = await window.api.team.listMachines({ teamId: activeTeam.id });
    if (res.ok) setMachines(res.machines || []);
  }

  async function addMember() {
    const email = addEmail.trim();
    const role = addRole;
    if (!email) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await window.api.team.addMember({ teamId: activeTeam.id, email, role });
      if (res.ok) {
        if (res.method === 'invitation') {
          setMsg({ kind: 'ok', text: 'Invitation sent — they will be added when they sign up.' });
        } else {
          setMsg({ kind: 'ok', text: 'Member added to team.' });
        }
        loadMembers();
        setShowAdd(false);
        setAddEmail('');
        setAddRole('member');
      } else {
        setMsg({ kind: 'err', text: res.error });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
    }
    setBusy(false);
  }

  async function removeMember(userId) {
    if (!confirm('Remove this member from the team?')) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await window.api.team.removeMember({ teamId: activeTeam.id, userId });
      if (res.ok) {
        setMsg({ kind: 'ok', text: 'Member removed.' });
        loadMembers();
      } else {
        setMsg({ kind: 'err', text: res.error });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
    }
    setBusy(false);
  }

  async function changeRole(userId, newRole) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await window.api.team.changeRole({ teamId: activeTeam.id, userId, newRole });
      if (res.ok) {
        setMsg({ kind: 'ok', text: 'Role changed.' });
        loadMembers();
      } else {
        setMsg({ kind: 'err', text: res.error });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
    }
    setBusy(false);
  }

  async function toggleAutopilot(machineId, current) {
    const res = await window.api.team.toggleMachineAutopilot({ machineId, enabled: !current });
    if (res.ok) {
      setMachines(machines.map(m => m.machine_id === machineId ? { ...m, autopilot_enabled: !current } : m));
    }
  }

  if (!activeTeam && teams.length > 0) {
    return <div style={{ padding: 24 }}><span className="mono dim">Loading team data…</span></div>;
  }

  if (!activeTeam) {
    return (
      <div style={{ padding: 24, maxWidth: 500 }}>
        <h2 style={{ margin: '0 0 6px' }}>Create your team</h2>
        <p className="mono" style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 20 }}>
          You're not on any team yet. Name your team to get started.
        </p>
        {msg && (
          <div className={msg.kind === 'err' ? 'error-banner' : ''}
               style={msg.kind === 'ok' ? { color: 'var(--green)', marginBottom: 10, fontSize: 12 } : { marginBottom: 10 }}>
            {msg.text}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label>Team name</label>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Acme Agency"
              onKeyDown={(e) => e.key === 'Enter' && createTeam()}
              autoFocus
            />
          </div>
          <button className="primary" onClick={createTeam} disabled={busy || !createName.trim()}>
            {busy ? 'Creating…' : 'Create team'}
          </button>
        </div>
      </div>
    );
  }

  const myRole = (members.find(m => m.user_id === user?.id) || {}).role || '';
  const canManage = ['owner', 'admin', 'manager'].includes(myRole);
  const canFullManage = ['owner', 'admin'].includes(myRole);

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <h2 style={{ margin: '0 0 4px' }}>{activeTeam.name}</h2>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 16 }}>
        Your role: <span style={{ color: 'var(--gold)' }}>{myRole}</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {['members', 'machines'].map(t => (
          <button
            key={t}
            className={`ghost ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
              borderBottom: tab === t ? '2px solid var(--gold)' : '2px solid transparent',
              color: tab === t ? 'var(--gold-bright)' : 'var(--text-2)',
              background: 'transparent', borderWidth: 0, borderStyle: 'solid',
              borderColor: 'transparent', cursor: 'pointer',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {msg && (
        <div className={msg.kind === 'err' ? 'error-banner' : ''}
             style={msg.kind === 'ok' ? { color: 'var(--green)', marginBottom: 10, fontSize: 12 } : { marginBottom: 10 }}>
          {msg.text}
        </div>
      )}

      {tab === 'members' && (
        <div>
          {canManage && (
            showAdd ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label>Email</label>
                  <input
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="user@example.com"
                    onKeyDown={(e) => { if (e.key === 'Enter') addMember(); if (e.key === 'Escape') { setShowAdd(false); setAddEmail(''); } }}
                    autoFocus
                  />
                </div>
                <div>
                  <label>Role</label>
                  <select value={addRole} onChange={(e) => setAddRole(e.target.value)} style={{ padding: '6px 8px', fontSize: 12 }}>
                    <option value="member">Member</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button className="primary" onClick={addMember} disabled={busy || !addEmail.trim()}>
                  {busy ? 'Adding…' : 'Add'}
                </button>
                <button className="ghost" onClick={() => { setShowAdd(false); setAddEmail(''); setAddRole('member'); }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="primary" onClick={() => setShowAdd(true)} disabled={busy} style={{ marginBottom: 14 }}>
                + Add member
              </button>
            )
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)', position: 'sticky', top: 0, zIndex: 2 }}>
                <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>User ID</th>
                <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>Role</th>
                <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>Joined</th>
                {canFullManage && <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.user_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{m.user_id}</td>
                  <td style={{ padding: '8px' }}>
                    {canManage && m.role !== 'owner' ? (
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.user_id, e.target.value)}
                        style={{ fontSize: 12, padding: '2px 6px' }}
                      >
                        <option value="member">member</option>
                        <option value="manager">manager</option>
                        <option value="admin">admin</option>
                      </select>
                    ) : (
                      <span className={`pill ${m.role === 'admin' || m.role === 'owner' ? 'admin' : ''}`}>
                        {m.role}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-2)', fontSize: 11 }}>
                    {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '-'}
                  </td>
                  {canFullManage && (
                    <td style={{ padding: '8px' }}>
                      {m.role !== 'owner' && (
                        <button className="ghost" onClick={() => removeMember(m.user_id)}
                                style={{ color: 'var(--red, #c55)', fontSize: 12 }}>
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {members.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-1)', fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>
              No members on this team yet.
            </div>
          )}
        </div>
      )}

      {tab === 'machines' && (
        <div>
          {machines.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-1)', fontSize: 13, color: 'var(--text-3)' }}>
              No machines connected. They'll appear here when a member signs in on this team.
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)', position: 'sticky', top: 0, zIndex: 2 }}>
                <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>Machine</th>
                <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>User</th>
                <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>Last seen</th>
                <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>Autopilot</th>
                {canManage && <th style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)', textAlign: 'left' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {machines.map(m => {
                const isOnline = m.last_seen_at && (Date.now() - new Date(m.last_seen_at).getTime()) < 120_000;
                return (
                  <tr key={m.machine_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px' }}>{m.label || m.machine_id}</td>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {(m.user_id || '').slice(0, 8)}…
                    </td>
                    <td style={{ padding: '8px' }}>
                      <span style={{
                        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                        background: isOnline ? '#7a9a5a' : '#555', marginRight: 6,
                      }} />
                      {m.last_seen_at ? new Date(m.last_seen_at).toLocaleString() : 'Never'}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <span className={`pill ${m.autopilot_enabled ? 'admin' : ''}`}>
                        {m.autopilot_enabled ? 'On' : 'Off'}
                      </span>
                    </td>
                    {canManage && (
                      <td style={{ padding: '8px' }}>
                        <button className="ghost" onClick={() => toggleAutopilot(m.machine_id, m.autopilot_enabled)}
                                style={{ fontSize: 12 }}>
                          Toggle {m.autopilot_enabled ? 'off' : 'on'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
