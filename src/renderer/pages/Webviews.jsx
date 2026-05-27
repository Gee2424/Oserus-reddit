import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

export default function WebviewsPage() {
  const { token, user } = useAuth();
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', isLocked: false });
  const [error, setError] = useState(null);
  const webviewRef = useRef(null);

  // Credential management state (admin/manager only, locked tabs only)
  const [credentials, setCredentials] = useState([]);
  const [showCredForm, setShowCredForm] = useState(false);
  const [credForm, setCredForm] = useState(blankCred());
  const [credError, setCredError] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [credsCollapsed, setCredsCollapsed] = useState(false);

  const can = useCan();
  const isAdmin = can('webviews.manage');

  function blankCred() {
    return { profile_id: '', label: '', username: '', password: '', notes: '' };
  }

  async function load() {
    const res = await window.api.webviews.list({ token });
    if (res.ok) {
      setTabs(res.tabs);
      if (res.tabs.length && (!active || !res.tabs.find(t => t.id === active.id))) {
        setActive(res.tabs[0]);
      }
    }
    if (isAdmin) {
      const p = await window.api.profiles.list({ token });
      if (p.ok) setProfiles(p.profiles);
    }
  }
  useEffect(() => { load(); }, []);

  // Load creds for the active tab if it's locked
  async function loadCreds(tab) {
    setCredentials([]);
    if (!tab || !tab.is_locked) return;
    const res = await window.api.webviews.listCredentials({ token, tabId: tab.id });
    if (res.ok) setCredentials(res.credentials);
  }
  useEffect(() => { loadCreds(active); }, [active?.id]);

  async function add(e) {
    e.preventDefault();
    setError(null);
    const res = await window.api.webviews.create({
      token, title: form.title, url: form.url, isLocked: form.isLocked,
    });
    if (!res.ok) { setError(res.error); return; }
    setForm({ title: '', url: '', isLocked: false });
    setShowAdd(false);
    load();
  }

  async function toggleLock(tab) {
    if (!isAdmin) return;
    await window.api.webviews.update({
      token, tabId: tab.id, updates: { isLocked: !tab.is_locked },
    });
    load();
  }

  async function del(tab) {
    if (tab.is_locked && !isAdmin) return;
    const msg = tab.is_locked
      ? 'Delete this locked tab? It will be removed from all users.'
      : 'Remove this tab?';
    if (!confirm(msg)) return;
    await window.api.webviews.delete({ token, tabId: tab.id });
    if (active?.id === tab.id) setActive(null);
    load();
  }

  async function addCredential(e) {
    e.preventDefault();
    setCredError(null);
    if (!credForm.username && !credForm.password) {
      setCredError('Enter at least a username or password');
      return;
    }
    const res = await window.api.webviews.createCredential({
      token, tabId: active.id,
      profileId: credForm.profile_id ? Number(credForm.profile_id) : null,
      label: credForm.label,
      username: credForm.username,
      password: credForm.password,
      notes: credForm.notes,
    });
    if (!res.ok) { setCredError(res.error); return; }
    setCredForm(blankCred());
    setShowCredForm(false);
    loadCreds(active);
  }

  async function delCredential(id) {
    if (!confirm('Remove this pre-login?')) return;
    await window.api.webviews.deleteCredential({ token, credentialId: id });
    loadCreds(active);
  }

  function copy(text) { navigator.clipboard.writeText(text); }

  return (
    <div style={styles.wrap}>
      <div style={styles.sidebar}>
        <div style={{ padding: '0 4px 12px', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
          <h3 style={{ marginBottom: 4 }}>Custom Web Pages</h3>
          <div className="muted" style={{ fontSize: 12 }}>Embed any URL for quick access.</div>
        </div>

        {tabs.length === 0 && (
          <div className="muted" style={{ fontSize: 12, fontStyle: 'italic', marginBottom: 12 }}>
            No tabs yet. Add one below.
          </div>
        )}

        {tabs.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <button
              onClick={() => setActive(t)}
              style={{
                flex: 1, textAlign: 'left',
                background: active?.id === t.id ? 'var(--bg-2)' : 'transparent',
                border: '1px solid ' + (active?.id === t.id ? 'var(--border)' : 'transparent'),
                color: 'var(--text-1)', padding: '7px 10px', fontSize: 13,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {t.is_locked && <span style={{ fontSize: 10 }} title="Locked / shared">🔒</span>}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            </button>
            {((t.is_locked && isAdmin) || (!t.is_locked && t.user_id === user.id)) && (
              <button className="ghost" onClick={() => del(t)} style={{ padding: '4px 8px' }} title="Remove">×</button>
            )}
          </div>
        ))}

        <button className="primary" onClick={() => setShowAdd(true)} style={{ width: '100%', marginTop: 14 }}>
          + New tab
        </button>

        {showAdd && (
          <form onSubmit={add} style={{ marginTop: 12, padding: 10, background: 'var(--bg-2)', borderRadius: 'var(--radius)' }}>
            {error && <div className="error-banner">{error}</div>}
            <label>Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <div style={{ height: 8 }} />
            <label>URL</label>
            <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" required />
            {isAdmin && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, textTransform: 'none', letterSpacing: 0, fontSize: 12, color: 'var(--text-0)' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.isLocked} onChange={(e) => setForm({ ...form, isLocked: e.target.checked })} />
                Lock this tab — shared with all users, only admins can edit/remove
              </label>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button type="submit" className="primary" style={{ flex: 1 }}>Add</button>
              <button type="button" className="ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div style={styles.viewer}>
        {active ? (
          <>
            <div style={styles.viewerBar}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {active.is_locked && <span style={{ fontSize: 12 }} title="Locked tab — shared with all users">🔒</span>}
                <div style={{ fontSize: 13, fontWeight: 500 }}>{active.title}</div>
                <span className="mono dim" style={{ fontSize: 11, marginLeft: 8 }}>{active.url}</span>
              </div>
              <div style={{ flex: 1 }} />
              {isAdmin && (
                <button className="ghost" onClick={() => toggleLock(active)} style={{ fontSize: 11 }}>
                  {active.is_locked ? 'Unlock' : 'Lock & share'}
                </button>
              )}
              <button className="ghost" onClick={() => webviewRef.current?.reload()}>↻</button>
            </div>

            {/* Pre-login credentials for locked tabs */}
            {active.is_locked && (credentials.length > 0 || isAdmin) && (
              <div style={styles.credsSection}>
                <div style={styles.credsHeader}>
                  <button
                    className="ghost"
                    onClick={() => setCredsCollapsed(v => !v)}
                    style={styles.collapseBtn}
                  >
                    {credsCollapsed ? '▸' : '▾'}
                  </button>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Pre-logins</span>
                  <span className="mono dim" style={{ fontSize: 11 }}>{credentials.length}</span>
                  <div style={{ flex: 1 }} />
                  {isAdmin && (
                    <button className="ghost" onClick={() => setShowCredForm(v => !v)} style={{ fontSize: 11 }}>
                      {showCredForm ? 'Cancel' : '+ Add pre-login'}
                    </button>
                  )}
                </div>

                {!credsCollapsed && (
                  <>
                    {showCredForm && isAdmin && (
                      <form onSubmit={addCredential} style={styles.credForm}>
                        {credError && <div className="error-banner">{credError}</div>}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                          <div>
                            <label>Scope</label>
                            <select value={credForm.profile_id} onChange={(e) => setCredForm({ ...credForm, profile_id: e.target.value })}>
                              <option value="">Global (everyone sees)</option>
                              {profiles.map(p => <option key={p.id} value={p.id}>Only for model: {p.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label>Label (optional)</label>
                            <input value={credForm.label} onChange={(e) => setCredForm({ ...credForm, label: e.target.value })} placeholder="e.g. main account" />
                          </div>
                          <div>
                            <label>Username</label>
                            <input value={credForm.username} onChange={(e) => setCredForm({ ...credForm, username: e.target.value })} />
                          </div>
                          <div>
                            <label>Password</label>
                            <input type="text" value={credForm.password} onChange={(e) => setCredForm({ ...credForm, password: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <label>Notes (optional)</label>
                          <input value={credForm.notes} onChange={(e) => setCredForm({ ...credForm, notes: e.target.value })} />
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                          <button type="submit" className="primary">Save pre-login</button>
                        </div>
                      </form>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 14px 10px' }}>
                      {credentials.length === 0 && !showCredForm && (
                        <div className="muted" style={{ fontSize: 12, fontStyle: 'italic', padding: '4px 0' }}>
                          No pre-logins configured.
                        </div>
                      )}
                      {credentials.map(c => (
                        <div key={c.id} style={styles.credRow}>
                          <span className="pill" style={{ background: c.is_global ? 'var(--bg-2)' : 'var(--accent-soft)', color: c.is_global ? 'var(--text-2)' : 'var(--accent)', borderColor: c.is_global ? 'var(--border)' : 'var(--accent)' }}>
                            {c.is_global ? 'global' : c.profile_name}
                          </span>
                          {c.label && <span style={{ fontSize: 12, fontWeight: 500 }}>{c.label}</span>}
                          {c.username && (
                            <div style={styles.credChip}>
                              <span className="mono dim" style={{ fontSize: 10 }}>user</span>
                              <span className="mono" style={{ fontSize: 11 }}>{c.username}</span>
                              <button className="ghost" onClick={() => copy(c.username)} style={{ padding: '0 4px', fontSize: 10 }}>copy</button>
                            </div>
                          )}
                          {c.password && (
                            <div style={styles.credChip}>
                              <span className="mono dim" style={{ fontSize: 10 }}>pass</span>
                              <span className="mono" style={{ fontSize: 11 }}>{'•'.repeat(Math.min(c.password.length, 10))}</span>
                              <button className="ghost" onClick={() => copy(c.password)} style={{ padding: '0 4px', fontSize: 10 }}>copy</button>
                            </div>
                          )}
                          {c.notes && <span className="muted" style={{ fontSize: 11 }}>{c.notes}</span>}
                          <div style={{ flex: 1 }} />
                          {isAdmin && (
                            <button className="ghost" onClick={() => delCredential(c.id)} style={{ padding: '2px 6px', fontSize: 10 }}>×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <webview
              key={active.id}
              ref={webviewRef}
              src={active.url}
              partition={`persist:custom-tab-${active.id}`}
              style={{ flex: 1, width: '100%' }}
              allowpopups="true"
            />
          </>
        ) : (
          <div className="empty-state" style={{ margin: 24 }}>
            {tabs.length === 0 ? 'Add a tab on the left to embed a site here.' : 'Pick a tab from the left.'}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrap: { height: '100%', display: 'flex', margin: -24 },
  sidebar: {
    width: 240, flexShrink: 0,
    background: 'var(--bg-1)', borderRight: '1px solid var(--border)',
    padding: 14, overflowY: 'auto',
  },
  viewer: { flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' },
  viewerBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px',
    background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
  },
  credsSection: { background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' },
  credsHeader: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 14px',
  },
  collapseBtn: { background: 'transparent', border: 'none', padding: 2, fontSize: 11, color: 'var(--text-2)' },
  credForm: {
    padding: '10px 14px 12px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-1)',
  },
  credRow: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    padding: '6px 10px',
    background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 4,
  },
  credChip: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '2px 5px', background: 'var(--bg-1)', borderRadius: 3, border: '1px solid var(--border)',
  },
};
