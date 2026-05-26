import React, { useState, useEffect, useRef } from 'react';
import { useActiveAccount } from '../lib/activeAccount.jsx';

const STATUS_META = {
  warming: { color: '#d4a55a', label: 'warming' },
  ready: { color: '#7a9a5a', label: 'ready' },
  paused: { color: '#968b78', label: 'paused' },
  banned: { color: '#b3473a', label: 'banned' },
};

const PLATFORM_PREFIX = { reddit: 'u/', redgifs: '@' };

// Platform-filtered switcher. `platform` prop: 'reddit' or 'redgifs'.
// If omitted, shows all accounts (legacy global switcher).
export default function AccountSwitcher({ platform }) {
  const ctx = useActiveAccount();
  const { accounts, active, setActive } = platform
    ? ctx.forPlatform(platform)
    : { accounts: ctx.accounts, active: ctx.activeReddit || ctx.activeRedgifs, setActive: () => {} };

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = filter === 'all' ? accounts : accounts.filter(a => a.status === filter);
  const groups = {};
  for (const a of filtered) {
    (groups[a.profile_name] = groups[a.profile_name] || []).push(a);
  }

  const prefix = active ? (PLATFORM_PREFIX[active.platform] || 'u/') : 'u/';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((v) => !v)} style={styles.trigger}>
        <span style={styles.dot(active ? STATUS_META[active.status]?.color || '#968b78' : null)} />
        <span style={styles.triggerText}>
          {active ? (
            <>
              <span style={{ color: 'var(--text-3)' }} className="mono">{prefix}</span>
              <span>{active.username}</span>
              <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>·</span>
              <span style={{ color: 'var(--text-2)', marginLeft: 6 }}>{active.profile_name}</span>
              {active.proxy_label && (
                <span className="mono" style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 11 }}>
                  via {active.proxy_label}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--text-2)' }}>
              {platform ? `No ${platform === 'reddit' ? 'Reddit' : 'RedGifs'} account selected` : 'No account selected'}
            </span>
          )}
        </span>
        <span style={{ color: 'var(--text-3)' }}>▾</span>
      </button>

      {open && (
        <div style={styles.menu}>
          <div style={styles.filterBar}>
            {['all', 'ready', 'warming', 'paused', 'banned'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{ ...styles.filterBtn, ...(filter === f ? styles.filterBtnActive : {}) }}
              >{f}</button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 14, color: 'var(--text-2)', fontStyle: 'italic', fontSize: 13 }}>
              {accounts.length === 0
                ? (platform === 'redgifs'
                    ? 'No RedGifs accounts yet. Link one from a Model Profile.'
                    : 'No Reddit accounts yet. Link one from a Model Profile.')
                : `No ${filter} accounts.`}
            </div>
          ) : (
            Object.entries(groups).map(([profile, items]) => (
              <div key={profile}>
                <div style={styles.menuGroupLabel}>{profile}</div>
                {items.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => { setActive(a.id); setOpen(false); }}
                    style={{
                      ...styles.menuItem,
                      ...(active?.id === a.id ? styles.menuItemActive : {}),
                    }}
                  >
                    <span style={styles.dot(STATUS_META[a.status]?.color || '#968b78')} />
                    <span className="mono" style={{ color: 'var(--text-3)' }}>{PLATFORM_PREFIX[a.platform] || 'u/'}</span>
                    <span style={{ flex: 1 }}>{a.username}</span>
                    {a.proxy_label && (
                      <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10 }}>{a.proxy_kind}</span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
          <div style={styles.menuFooter}>
            <button
              className="ghost"
              style={{ width: '100%' }}
              onClick={() => { setActive(null); setOpen(false); }}
            >Clear selection</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  trigger: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
    minWidth: 320, background: 'var(--bg-2)', border: '1px solid var(--border)',
  },
  triggerText: { flex: 1, textAlign: 'left', fontSize: 13 },
  dot: (color) => ({
    width: 8, height: 8, borderRadius: '50%',
    background: color || 'var(--text-3)',
    boxShadow: color ? `0 0 6px ${color}80` : 'none',
    flexShrink: 0,
  }),
  menu: {
    position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 360,
    background: 'var(--bg-elev)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-2)',
    padding: 6, zIndex: 50, maxHeight: 500, overflowY: 'auto',
  },
  filterBar: {
    display: 'flex', gap: 4, padding: '4px 4px 8px', borderBottom: '1px solid var(--border)', marginBottom: 4,
  },
  filterBtn: {
    flex: 1, fontSize: 11, padding: '4px 6px',
    background: 'transparent', border: '1px solid transparent', color: 'var(--text-2)',
    textTransform: 'capitalize',
  },
  filterBtnActive: { background: 'var(--bg-2)', borderColor: 'var(--border)', color: 'var(--text-0)' },
  menuGroupLabel: {
    fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em',
    textTransform: 'uppercase', color: 'var(--text-3)', padding: '10px 10px 4px',
  },
  menuItem: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none', padding: '8px 12px', fontSize: 13,
    color: 'var(--text-0)', borderRadius: 'var(--radius)',
  },
  menuItemActive: { background: 'var(--accent-soft)', color: 'var(--accent)' },
  menuFooter: { padding: 6, borderTop: '1px solid var(--border)', marginTop: 4 },
};
