import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

const ROLE_COLORS = {
  admin: '#c8553d',
  manager: '#d4a55a',
  reddit_va: '#7a9a5a',
  chatter: '#5a7a9a',
};

const blank = { username: '', password: '', display_name: '', email: '', phone: '', notes: '', role: 'reddit_va' };

export default function UsersPage({ embedded }) {
  const { token, user: me } = useAuth();
  const can = useCan();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);

  useEffect(() => {
    // Load roles list for the dropdown. Falls back gracefully if the user
    // doesn't have roles.manage — they still see role names from the user list.
    if (!can('roles.manage')) {
      setRoles([
        { key: 'admin', label: 'Admin', description: 'Full access' },
        { key: 'manager', label: 'Manager', description: 'Day-to-day ops' },
        { key: 'reddit_va', label: 'Reddit VA', description: 'Posts on Reddit' },
        { key: 'chatter', label: 'Chatter', description: 'Inbox only' },
      ]);
      return;
    }
    window.api.roles.list({ token }).then((r) => {
      if (r.ok) setRoles(r.roles);
    }).catch(() => {});
  }, [token, can]);

  const roleByKey = roles.reduce((acc, r) => (acc[r.key] = r, acc), {});
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [resetForId, setResetForId] = useState(null);
  const [newPw, setNewPw] = useState('');

  async function load() {
    const res = await window.api.auth.listUsers({ token });
    if (res.ok) setUsers(res.users);
  }
  useEffect(() => { load(); }, []);

  function startAdd() {
    setEditingId(null);
    setForm(blank);
    setShowForm(true);
    setError(null);
  }

  function startEdit(u) {
    setEditingId(u.id);
    setForm({
      username: u.username,
      password: '',
      display_name: u.display_name || '',
      email: u.email || '',
      phone: u.phone || '',
      notes: u.notes || '',
      role: u.role,
    });
    setShowForm(true);
    setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!editingId) {
      if (!form.username || !form.password) { setError('Username and password are required'); return; }
      if (form.password.length < 6) { setError('Password must be 6+ characters'); return; }
      const res = await window.api.auth.createUser({
        token,
        username: form.username,
        password: form.password,
        role: form.role,
        displayName: form.display_name || form.username,
        email: form.email,
        phone: form.phone,
        notes: form.notes,
      });
      if (!res.ok) { setError(res.error); return; }
    } else {
      const res = await window.api.auth.updateUser({
        token,
        userId: editingId,
        data: {
          display_name: form.display_name,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
          role: form.role,
        },
      });
      if (!res.ok) { setError(res.error); return; }
    }
    setShowForm(false);
    setEditingId(null);
    setFlash({ kind: 'ok', text: editingId ? 'Updated.' : 'Created.' });
    setTimeout(() => setFlash(null), 3000);
    load();
  }

  async function del(id, username) {
    if (!confirm(`Delete user "${username}"? Their assignments will become unassigned but profile data stays.`)) return;
    const res = await window.api.auth.deleteUser({ token, userId: id });
    if (!res.ok) { alert(res.error); return; }
    load();
  }

  async function doReset() {
    const res = await window.api.auth.resetUserPassword({ token, userId: resetForId, newPassword: newPw });
    if (!res.ok) { alert(res.error); return; }
    setResetForId(null);
    setNewPw('');
    setFlash({ kind: 'ok', text: 'Password reset.' });
    setTimeout(() => setFlash(null), 3000);
  }

  return (
    <div>
      <div className="title-block">
        {!embedded && (
          <div>
            <div className="eyebrow">Manage</div>
            <h1>Team Profiles</h1>
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button className="primary" onClick={startAdd}>+ Add team member</button>
        </div>
      </div>

      {flash && <div style={styles.ok}>{flash.text}</div>}

      {showForm && (
        <form onSubmit={submit} className="card" style={{ marginBottom: 22 }}>
          <h3 style={{ marginBottom: 14 }}>{editingId ? 'Edit team profile' : 'Add team member'}</h3>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label>Display name</label>
              <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div>
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <div className="muted" style={{ fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>
                {roleByKey[form.role]?.description}
              </div>
            </div>
            {!editingId && (
              <>
                <div>
                  <label>Username (login)</label>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
                </div>
                <div>
                  <label>Password (temporary)</label>
                  <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" />
                </div>
              </>
            )}
            <div>
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Notes</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="responsibilities, schedule, anything else" />
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button type="submit" className="primary">{editingId ? 'Save changes' : 'Create'}</button>
            <button type="button" className="ghost" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</button>
          </div>
          {!editingId && (
            <div className="muted" style={{ fontSize: 12, marginTop: 14, fontStyle: 'italic' }}>
              Share the credentials with them privately. They can change their password themselves under Settings.
            </div>
          )}
        </form>
      )}

      {/* Password reset modal */}
      {resetForId && (
        <div className="card" style={{ marginBottom: 22, borderColor: 'var(--accent)' }}>
          <h3 style={{ marginBottom: 10 }}>Reset password for {users.find(u => u.id === resetForId)?.username}</h3>
          <input type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="new password (6+ chars)" autoFocus />
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="primary" onClick={doReset}>Set new password</button>
            <button className="ghost" onClick={() => { setResetForId(null); setNewPw(''); }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {users.map((u) => (
          <div key={u.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={styles.avatar}>{(u.display_name || u.username)[0].toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ marginBottom: 2 }}>{u.display_name || u.username}</h3>
                <div className="mono dim" style={{ fontSize: 11 }}>@{u.username}</div>
              </div>
              <span style={{
                ...styles.rolePill,
                color: ROLE_COLORS[u.role] || 'var(--text-2)',
                borderColor: ROLE_COLORS[u.role] || 'var(--border-strong)',
                background: (ROLE_COLORS[u.role] || '#222') + '20',
              }}>
                {roleByKey[u.role]?.label || u.role}
              </span>
            </div>
            {u.email && <div className="muted" style={{ fontSize: 12 }}>📧 {u.email}</div>}
            {u.phone && <div className="muted" style={{ fontSize: 12 }}>📱 {u.phone}</div>}
            {u.notes && <div className="muted" style={{ fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>{u.notes}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
              <button onClick={() => startEdit(u)}>Edit</button>
              <button onClick={() => { setResetForId(u.id); setNewPw(''); }}>Reset password</button>
              <div style={{ flex: 1 }} />
              {u.id !== me.id && <button className="danger" onClick={() => del(u.id, u.username)}>Delete</button>}
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
  avatar: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    fontWeight: 600,
  },
  rolePill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 10px',
    borderRadius: 999,
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    border: '1px solid',
  },
};
