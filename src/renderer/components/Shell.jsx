import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan, usePermissions } from '../lib/permissions.jsx';
import logoUrl from '../assets/logo.png';

const NAV = [
  { key: 'dashboard',     label: 'Dashboard',           icon: '⬢', group: 'Overview',  perm: 'page.dashboard' },
  { key: 'profiles',      label: 'Models',              icon: '◇', group: 'Overview',  perm: 'page.profiles' },
  { key: 'analytics',     label: 'Analytics',           icon: '◧', group: 'Overview',  perm: 'page.analytics' },
  { key: 'inbox',         label: 'Account Manager Pro', icon: '✉', group: 'Workspace', perm: 'page.reddit-api' },
  { key: 'automation',    label: 'Automation',          icon: '⟳', group: 'Workspace', perm: 'page.autopilot' },
  { key: 'intel',         label: 'Intelligence',        icon: '◎', group: 'Workspace', perm: 'page.intel' },
  { key: 'team',          label: 'Team',                icon: '⚑', group: 'Team',      perm: 'page.team' },
  { key: 'docs',          label: 'Documentation',       icon: '◫', group: 'Team',      perm: 'page.docs' },
  { key: 'settings',      label: 'Configuration',       icon: '⚙', group: 'Configure', perm: 'page.settings' },
];

export default function Shell({ route, navigate, children }) {
  const { user, logout, activeTeamId, setActiveTeam } = useAuth();
  const can = useCan();
  const { previewing, effectiveRole, exitPreview } = usePermissions();
  const [version, setVersion] = useState('');
  const [cloudConnected, setCloudConnected] = useState(false);
  const [teams, setTeams] = useState([]);
  const [pendingInvites, setPendingInvites] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');

  useEffect(() => {
    if (window.api?.app?.version) {
      window.api.app.version().then(v => setVersion(v.version));
    }
  }, []);

  useEffect(() => {
    if (!window.api?.cloud) return;
    window.api.cloud.getStatus().then((s) => s && setCloudConnected(!!s.connected));
    const off = window.api.cloud.onStatus((s) => setCloudConnected(!!s?.connected));
    return () => { try { off && off(); } catch {} };
  }, []);

  useEffect(() => {
    if (!user) return;
    window.api.team.listTeams({}).then(res => {
      if (res.ok && res.teams) setTeams(res.teams);
    }).catch(() => {});
    window.api.team.listMyInvitations({}).then(res => {
      if (res.ok && res.invitations) setPendingInvites(res.invitations.length);
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    window.api.team.acceptPendingInvitations({}).catch(() => {});
  }, [user]);

  const grouped = {};
  for (const item of NAV) {
    if (item.perm && !can(item.perm)) continue;
    (grouped[item.group] = grouped[item.group] || []).push(item);
  }

  const currentTeam = teams.find(t => t.id === activeTeamId) || teams[0] || null;

  return (
    <div style={styles.root}>
      <aside style={styles.sidebar} className="app-sidebar">
        <div style={styles.brand}>
          <img src={logoUrl} alt="Oserus Management" style={styles.logo} />
        </div>

        {/* Team switcher */}
        {teams.length > 0 && (
          <div style={{ padding: '0 14px 14px' }}>
            {creating ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Escape') { setCreating(false); setNewTeamName(''); return; }
                    if (e.key !== 'Enter') return;
                    const name = newTeamName.trim();
                    if (!name) return;
                    const res = await window.api.team.createTeam({ name });
                    setCreating(false);
                    setNewTeamName('');
                    if (res.ok) {
                      const teamsRes = await window.api.team.listTeams({});
                      if (teamsRes.ok && teamsRes.teams) {
                        setTeams(teamsRes.teams);
                        setActiveTeam(res.team.id);
                      }
                    }
                  }}
                  placeholder="Team name"
                  autoFocus
                  style={{
                    flex: 1, fontSize: 12, padding: '4px 6px',
                    background: 'var(--bg-2)', border: '1px solid var(--gold)',
                    borderRadius: 'var(--radius)', color: 'var(--text-1)',
                    outline: 'none',
                  }}
                />
                <button
                  className="ghost"
                  onClick={() => { setCreating(false); setNewTeamName(''); }}
                  style={{
                    width: 26, height: 26, padding: 0, display: 'grid', placeItems: 'center',
                    fontSize: 13, borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', background: 'var(--bg-2)',
                    color: 'var(--text-2)', cursor: 'pointer', lineHeight: 1,
                  }}
                  title="Cancel"
                >✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <select
                  value={activeTeamId || ''}
                  onChange={(e) => setActiveTeam(e.target.value)}
                  style={{
                    flex: 1, fontSize: 12, padding: '5px 6px',
                    background: 'var(--bg-2)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', color: 'var(--text-1)',
                  }}
                >
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  className="ghost"
                  onClick={() => setCreating(true)}
                  style={{
                    width: 26, height: 26, padding: 0, display: 'grid', placeItems: 'center',
                    fontSize: 14, fontWeight: 600, borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', background: 'var(--bg-2)',
                    color: 'var(--text-2)', cursor: 'pointer', lineHeight: 1,
                  }}
                  title="Create a new team"
                >+</button>
              </div>
            )}
          </div>
        )}

        {pendingInvites > 0 && (
          <div style={{
            margin: '0 14px 12px', padding: '6px 10px',
            background: 'rgba(212,166,74,0.12)', border: '1px solid var(--gold)',
            borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--gold-bright)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ flex: 1 }}>{pendingInvites} pending invitation{pendingInvites > 1 ? 's' : ''}</span>
            <button className="ghost" onClick={() => navigate('team')} style={{ fontSize: 11, textDecoration: 'underline', padding: '2px 6px' }}>
              View
            </button>
          </div>
        )}

        <nav style={styles.nav}>
          {Object.entries(grouped).map(([group, items], gi) => (
            <div key={group} style={{ marginBottom: 6 }}>
              <div style={styles.navGroup}>
                <span>{group}</span>
                {gi > 0 && <div style={styles.navGroupLine} />}
              </div>
              {items.map((it) => {
                const active = route === it.key;
                return (
                  <button
                    key={it.key}
                    onClick={() => navigate(it.key)}
                    style={{ ...styles.navItem, ...(active ? styles.navItemActive : {}) }}
                  >
                    <span style={{ ...styles.navIcon, ...(active ? styles.navIconActive : {}) }}>
                      {it.icon}
                    </span>
                    <span style={active ? { color: 'var(--gold-bright)' } : {}}>{it.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={styles.userBlock}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={styles.avatar}>
              {(user.display_name || user.username)[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.userName}>{user.display_name || user.username}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                <span className={`pill ${(effectiveRole || user.role) === 'admin' ? 'admin' : ''}`}>
                  {(effectiveRole || user.role).replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="ghost" onClick={logout} style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}>
              Sign out
            </button>
            <div style={styles.cloudRow} className="mono" title={cloudConnected ? 'Cloud synced' : 'Offline'}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: cloudConnected ? '#7a9a5a' : '#555',
                boxShadow: cloudConnected ? '0 0 6px rgba(122,154,90,0.8)' : 'none',
              }} />
              <span>{cloudConnected ? 'Cloud' : 'Offline'}</span>
            </div>
          </div>
          {version && (
            <div style={styles.versionTag} className="mono">v{version}</div>
          )}
        </div>
      </aside>

      <main style={styles.main}>
        {previewing && (
          <div style={styles.previewBanner}>
            <span>Previewing as <strong>{effectiveRole}</strong> — you see what they see.</span>
            <button className="ghost" onClick={exitPreview} style={{ marginLeft: 'auto', fontSize: 11 }}>Exit preview</button>
          </div>
        )}
        <section style={styles.content}>{children}</section>
      </main>
    </div>
  );
}

const styles = {
  root: { display: 'flex', height: '100%', background: 'var(--bg-0)' },
  sidebar: {
    width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column',
    paddingTop: 34, overflow: 'hidden',
  },
  brand: {
    padding: '2px 18px 16px', borderBottom: '1px solid var(--border)',
    marginBottom: 12, display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 1,
  },
  logo: { width: 180, height: 'auto', filter: 'drop-shadow(0 2px 8px rgba(61, 107, 79, 0.2))' },
  nav: { flex: 1, overflowY: 'auto', padding: '0 10px', position: 'relative', zIndex: 1 },
  navGroup: {
    fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.18em',
    textTransform: 'uppercase', color: 'var(--text-3)',
    padding: '10px 12px 6px', display: 'flex', alignItems: 'center', gap: 10,
    position: 'relative',
  },
  navGroupLine: {
    flex: 1, height: 1,
    background: 'linear-gradient(90deg, var(--border-strong) 0%, transparent 100%)',
  },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    textAlign: 'left', background: 'transparent', border: '1px solid transparent',
    color: 'var(--text-1)', padding: '7px 10px',
    borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 400,
    marginBottom: 1, cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s',
  },
  navItemActive: {
    background: 'linear-gradient(90deg, rgba(212,166,74,0.14) 0%, rgba(58,111,140,0.08) 100%)',
    color: 'var(--gold-bright)', fontWeight: 600,
    borderColor: 'rgba(212,166,74,0.2)',
    boxShadow: 'inset 3px 0 0 var(--gold)',
  },
  navIcon: {
    width: 22, height: 22, display: 'grid', placeItems: 'center',
    fontSize: 14, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flexShrink: 0,
  },
  navIconActive: { color: 'var(--gold)' },
  userBlock: {
    margin: '12px 10px 14px', padding: 12,
    background: 'var(--bg-1)', borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)', position: 'relative', zIndex: 1,
  },
  avatar: {
    width: 34, height: 34, borderRadius: '50%',
    background: 'linear-gradient(135deg, var(--green), var(--gold))',
    color: 'var(--bg-0)', display: 'grid', placeItems: 'center',
    fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700,
    flexShrink: 0,
  },
  userName: { fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  versionTag: {
    marginTop: 8, fontSize: 9, letterSpacing: '0.15em',
    color: 'var(--text-3)', textAlign: 'center',
  },
  cloudRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, color: 'var(--text-2)', gap: 6,
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  previewBanner: {
    background: 'linear-gradient(90deg, rgba(212,166,74,0.18), rgba(79,138,100,0.12))',
    borderBottom: '1px solid var(--gold)', color: 'var(--gold-bright)',
    padding: '8px 24px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 10,
  },
  content: { flex: 1, overflow: 'auto', padding: 24 },
};
