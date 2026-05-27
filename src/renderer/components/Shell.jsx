import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import logoUrl from '../assets/logo.png';

const ROLE_LABEL = {
  admin: 'admin',
  manager: 'manager',
  reddit_va: 'reddit va',
  chatter: 'chatter',
};

// Nav items - icon + label + group, with role-based visibility
const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '⬢', group: 'Overview', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },
  { key: 'analytics', label: 'Analytics', icon: '◧', group: 'Overview', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },

  { key: 'profiles', label: 'Models', icon: '◇', group: 'Manage', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },
  { key: 'accounts', label: 'Accounts', icon: '◈', group: 'Manage', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },
  { key: 'users', label: 'Team', icon: '◉', group: 'Manage', roles: ['admin', 'manager'] },
  { key: 'activity', label: 'Activity', icon: '☷', group: 'Manage', roles: ['admin', 'manager'] },

  { key: 'reddit', label: 'Reddit', icon: 'R', group: 'Operate', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },
  { key: 'redgifs', label: 'RedGifs', icon: 'G', group: 'Operate', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },
  { key: 'inbox', label: 'Inbox', icon: '✉', group: 'Operate', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },
  { key: 'scheduler', label: 'Scheduler', icon: '◷', group: 'Operate', roles: ['admin', 'manager', 'reddit_va'] },
  { key: 'webviews', label: 'Custom Pages', icon: '⬡', group: 'Operate', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },

  { key: 'docs', label: 'Docs', icon: '◫', group: 'Configure', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },
  { key: 'proxies', label: 'Proxies', icon: '⌁', group: 'Configure', roles: ['admin', 'manager'] },
  { key: 'subreddits', label: 'Warm-up Subs', icon: '✦', group: 'Configure', roles: ['admin', 'manager'] },
  { key: 'votes', label: 'Votes', icon: '▲', group: 'Configure', roles: ['admin', 'manager', 'reddit_va'] },
  { key: 'settings', label: 'Settings', icon: '⚙', group: 'Configure', roles: ['admin', 'manager', 'reddit_va', 'chatter'] },
];

export default function Shell({ route, navigate, children }) {
  const { user, logout } = useAuth();
  const [version, setVersion] = useState('');

  useEffect(() => {
    if (window.api?.app?.version) {
      window.api.app.version().then(v => setVersion(v.version));
    }
  }, []);

  const grouped = {};
  for (const item of NAV) {
    if (item.roles && !item.roles.includes(user.role)) continue;
    (grouped[item.group] = grouped[item.group] || []).push(item);
  }

  return (
    <div style={styles.root}>
      <aside style={styles.sidebar} className="brand-glow app-sidebar">
        {/* Logo block at top-left */}
        <div style={styles.brand}>
          <img src={logoUrl} alt="Oserus Management" style={styles.logo} />
        </div>

        <nav style={styles.nav}>
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 18 }}>
              <div style={styles.navGroup}>{group}</div>
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
                    <span>{it.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={styles.userBlock}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={styles.avatar}>
              {(user.display_name || user.username)[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.userName}>{user.display_name || user.username}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <span className={`pill ${user.role === 'admin' ? 'admin' : ''}`}>
                  {ROLE_LABEL[user.role] || user.role}
                </span>
              </div>
            </div>
          </div>
          <button className="ghost" onClick={logout} style={{ width: '100%', marginTop: 10, fontSize: 12 }}>
            Sign out
          </button>
          {version && (
            <div style={styles.versionTag} className="mono">v{version}</div>
          )}
        </div>
      </aside>

      <main style={styles.main}>
        <section style={styles.content}>{children}</section>
      </main>
    </div>
  );
}

const styles = {
  root: { display: 'flex', height: '100%', background: 'var(--bg-0)' },
  sidebar: {
    width: 230,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    paddingTop: 38, // mac traffic light space
    overflow: 'hidden',
  },
  brand: {
    padding: '6px 18px 18px',
    borderBottom: '1px solid var(--border)',
    marginBottom: 14,
    display: 'flex',
    justifyContent: 'flex-start',
    position: 'relative',
    zIndex: 1,
  },
  logo: {
    width: 180,
    height: 'auto',
    filter: 'drop-shadow(0 2px 8px rgba(61, 107, 79, 0.2))',
  },
  nav: { flex: 1, overflowY: 'auto', padding: '0 12px', position: 'relative', zIndex: 1 },
  navGroup: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: 'var(--text-3)',
    padding: '0 10px 6px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--text-1)',
    padding: '8px 10px',
    borderRadius: 'var(--radius)',
    fontSize: 13,
    fontWeight: 400,
    marginBottom: 2,
    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
  },
  navItemActive: {
    background: 'linear-gradient(90deg, rgba(79,138,100,0.22) 0%, rgba(212,166,74,0.10) 100%)',
    color: 'var(--gold-bright)',
    borderColor: 'transparent',
    fontWeight: 500,
    boxShadow: 'inset 2px 0 0 var(--gold), 0 0 18px rgba(79,138,100,0.18)',
  },
  navIcon: {
    width: 22,
    height: 22,
    display: 'grid',
    placeItems: 'center',
    fontSize: 14,
    color: 'var(--text-3)',
    fontFamily: 'var(--font-mono)',
    flexShrink: 0,
  },
  navIconActive: { color: 'var(--gold)' },
  userBlock: {
    margin: 12,
    padding: 10,
    background: 'var(--bg-2)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
    position: 'relative',
    zIndex: 1,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, var(--green), var(--gold))',
    color: 'var(--bg-0)',
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'var(--font-display)',
    fontSize: 14,
    fontWeight: 700,
  },
  userName: {
    fontSize: 13,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  versionTag: {
    marginTop: 8,
    fontSize: 9,
    letterSpacing: '0.15em',
    color: 'var(--text-3)',
    textAlign: 'center',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  content: { flex: 1, overflow: 'auto', padding: 24 },
};
