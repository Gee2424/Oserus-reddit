import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import PopOutButton from '../components/PopOutButton.jsx';

// ─────────────────────────────────────────────────── Management Hub
//
// Unified replacement for the old Dashboard + Team + Activity trio.
// One page, one workflow: owners and managers see who's working,
// what they did today, and whether they're performing well.
//
// Sections (top → bottom):
//
//   1. Org strip       — totals across the whole team for today.
//   2. Team table      — every member as a row with live metrics
//                        (presence, posts/comments today, karma
//                        gained, time on task). Row click expands
//                        a drawer with recent posts, comments,
//                        engagement sessions, generic actions,
//                        and the accounts they're farming.
//   3. Live feed       — chronological activity_log, filterable
//                        by member + action (was the Activity page).
//   4. Admin           — member + role admin (was the Team page),
//                        rendered inline under a permission gate.
//
// The accounts table that used to dominate Dashboard moved to the
// Models page where it belongs — Hub is a management view, not an
// operations grid.

export default function DashboardPage() {
  const { token, user } = useAuth();
  const can = useCan();
  const canSeeTeam = can('activity.view');
  const canAdminMembers = can('users.manage');
  const canAdminRoles = can('roles.manage');

  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [expanded, setExpanded] = useState(null); // member id
  const [detail, setDetail] = useState(null);

  const [activity, setActivity] = useState([]);
  const [actFilter, setActFilter] = useState({ action: '', username: '' });

  const [showAdmin, setShowAdmin] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [o, a] = await Promise.all([
        window.api.team.overview({ token }),
        window.api.activity.list({ token, limit: 200 }),
      ]);
      if (o.ok) { setOverview(o); setLoadError(null); }
      else      setLoadError(o.error || 'Could not load team overview');
      if (a.ok) setActivity(a.entries || []);
    } catch (err) {
      setLoadError(err.message);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);
  // Live refresh every 30s — cheap on the backend, keeps "online" presence
  // and today's counters from going stale while a manager is watching.
  useEffect(() => {
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Drawer payload — refetched whenever the expanded row changes so
  // the operator never sees the previous member's data flash.
  useEffect(() => {
    if (!expanded) { setDetail(null); return; }
    let alive = true;
    window.api.team.memberDetail({ token, userId: expanded }).then((r) => {
      if (!alive) return;
      setDetail(r.ok ? r : { ok: false, error: r.error });
    });
    return () => { alive = false; };
  }, [expanded, token]);

  const totals = overview?.totals || EMPTY_TOTALS;
  const members = overview?.members || [];

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const activityFiltered = useMemo(() => {
    return activity.filter((e) => {
      if (actFilter.action   && e.action   !== actFilter.action)   return false;
      if (actFilter.username && e.username !== actFilter.username) return false;
      return true;
    });
  }, [activity, actFilter]);
  const actionList   = useMemo(() => [...new Set(activity.map((e) => e.action))].sort(),   [activity]);
  const usernameList = useMemo(() => [...new Set(activity.map((e) => e.username).filter(Boolean))].sort(), [activity]);

  return (
    <div>
      <div style={topRow}>
        <div>
          <div className="eyebrow">Management Hub</div>
          <h1 style={{ margin: '4px 0 2px', fontSize: 24 }}>
            {greeting}, {user.display_name || user.username}.
          </h1>
          <div className="muted" style={{ fontSize: 13 }}>
            Who's working, what they did today, and whether the farm is healthy.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="ghost" onClick={refresh}>↻ Refresh</button>
          <PopOutButton route="dashboard" title="Hub" />
        </div>
      </div>

      {loadError && (
        <div className="error-banner" style={{ marginBottom: 14 }}>
          {loadError}
        </div>
      )}

      <OrgStrip totals={totals} />

      {canSeeTeam ? (
        <>
          <TeamTable
            members={members}
            expandedId={expanded}
            onExpand={(id) => setExpanded(expanded === id ? null : id)}
            detail={detail}
          />
          <ActivityFeed
            entries={activityFiltered}
            actions={actionList}
            users={usernameList}
            filter={actFilter}
            onFilter={setActFilter}
          />
        </>
      ) : (
        <div className="card" style={{ padding: 20, color: 'var(--text-3)', fontSize: 13 }}>
          You don't have permission to see team activity. Ask your owner / manager for
          the <span className="mono">activity.view</span> permission.
        </div>
      )}

      {(canAdminMembers || canAdminRoles) && (
        <AdminDrawer
          open={showAdmin}
          onToggle={() => setShowAdmin((v) => !v)}
          canMembers={canAdminMembers}
          canRoles={canAdminRoles}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────── Org strip

function OrgStrip({ totals }) {
  const items = [
    { label: 'Active now',     value: totals.active_now,                tone: '#7fd99a', sub: `of ${totals.members_total}` },
    { label: 'Posts today',    value: totals.posts_today,               tone: 'var(--gold-bright)' },
    { label: 'Comments today', value: totals.comments_today,            tone: '#9fc0ea' },
    { label: 'Karma · 24h',    value: totals.karma_today,               tone: '#e7c478' },
    { label: 'Time on task',   value: formatMins(totals.engagement_minutes_today), tone: 'var(--text-0)' },
    { label: 'Accounts',       value: totals.accounts_active,           tone: 'var(--text-0)', sub: totals.accounts_banned ? `${totals.accounts_banned} banned` : null },
    { label: 'Models',         value: totals.models_total,              tone: 'var(--text-0)' },
  ];
  return (
    <div style={orgStripWrap}>
      {items.map((it) => (
        <div key={it.label} style={orgCell}>
          <div style={orgLabel}>{it.label}</div>
          <div style={{ ...orgValue, color: it.tone }}>
            {typeof it.value === 'number' ? it.value.toLocaleString() : it.value}
          </div>
          {it.sub && <div style={orgSub}>{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────── Team table

function TeamTable({ members, expandedId, onExpand, detail }) {
  if (!members.length) {
    return (
      <div className="card" style={{ padding: 20, marginBottom: 14, color: 'var(--text-3)', fontSize: 13 }}>
        No team members yet. Add operators under Manage members below.
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <div style={tablesHead}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Team · live</h3>
        <span className="muted" style={{ fontSize: 11 }}>
          Click a row to see what they've been doing.
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)' }}>
              <th style={th}>Member</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Models</th>
              <th style={{ ...th, textAlign: 'right' }}>Accounts</th>
              <th style={{ ...th, textAlign: 'right' }}>Posts (24h)</th>
              <th style={{ ...th, textAlign: 'right' }}>Comments (24h)</th>
              <th style={{ ...th, textAlign: 'right' }}>Karma (24h)</th>
              <th style={{ ...th, textAlign: 'right' }}>Time on task</th>
              <th style={{ ...th, textAlign: 'right' }}>Last action</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <React.Fragment key={m.id}>
                <tr
                  onClick={() => onExpand(m.id)}
                  style={{
                    borderTop: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: expandedId === m.id ? 'rgba(212,166,74,0.05)' : 'transparent',
                  }}
                >
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: m.avatar_color || hueOf(m.username),
                        color: '#fff', fontWeight: 700, fontSize: 11,
                        display: 'grid', placeItems: 'center',
                      }}>
                        {(m.display_name || m.username || '?')[0].toUpperCase()}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{m.display_name || m.username}</div>
                        <div className="mono dim" style={{ fontSize: 11 }}>@{m.username}</div>
                      </div>
                    </div>
                  </td>
                  <td style={td}>
                    <RoleBadge role={m.role} />
                  </td>
                  <td style={td}><Presence presence={m.presence} lastSeen={m.last_seen} /></td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{m.models_assigned || 0}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">
                    {m.accounts_active || 0}
                    {m.accounts_banned > 0 && <span style={bannedTag}>{m.accounts_banned} banned</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{m.posts_today || 0}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{m.comments_today || 0}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono" title="Karma gained on assigned accounts in the last 24h">
                    {(m.karma_today || 0) > 0 ? `+${m.karma_today.toLocaleString()}` : (m.karma_today || 0).toLocaleString()}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono" title="Engagement-session seconds across assigned accounts in the last 24h">
                    {formatMins(m.engagement_minutes_today || 0)}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono dim">
                    {m.last_seen ? formatRelative(m.last_seen) : '—'}
                  </td>
                </tr>
                {expandedId === m.id && (
                  <tr>
                    <td colSpan={10} style={{ background: 'var(--bg-1)', padding: 14, borderTop: '1px solid var(--border)' }}>
                      <MemberDetail detail={detail} memberId={m.id} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MemberDetail({ detail, memberId }) {
  if (!detail) return <div className="muted" style={{ fontSize: 12 }}>Loading…</div>;
  if (!detail.ok) return <div className="error-banner">{detail.error}</div>;
  const { models, accounts, recent } = detail;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <div>
        <DrawerSection title={`Assigned models (${models.length})`}>
          {models.length === 0
            ? <div className="muted" style={{ fontSize: 12 }}>No models assigned.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {models.map((m) => (
                  <div key={m.id} style={modelRow}>
                    <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
                    <span className="mono dim" style={{ fontSize: 11 }}>
                      {m.accounts_count} acct{m.accounts_count === 1 ? '' : 's'}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--gold)' }}>
                      {(m.total_karma || 0).toLocaleString()} karma
                    </span>
                  </div>
                ))}
              </div>}
        </DrawerSection>

        <DrawerSection title={`Accounts (${accounts.length})`}>
          {accounts.length === 0
            ? <div className="muted" style={{ fontSize: 12 }}>No accounts under this teammate.</div>
            : <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {accounts.map((a) => (
                  <div key={a.id} style={accountRow}>
                    <span style={{ ...platformTag, background: platformColor(a.platform) }}>{a.platform}</span>
                    <span style={{ flex: 1, fontFamily: 'var(--font-mono)' }}>{a.username}</span>
                    <span className="dim" style={{ fontSize: 11 }}>{a.profile_name}</span>
                    <StatusDot status={a.status} />
                    <span className="mono" style={{ width: 70, textAlign: 'right' }}>
                      {a.karma_total != null ? a.karma_total.toLocaleString() : '—'}
                    </span>
                  </div>
                ))}
              </div>}
        </DrawerSection>
      </div>

      <div>
        <DrawerSection title={`Recent posts (${recent.posts.length})`}>
          {recent.posts.length === 0
            ? <div className="muted" style={{ fontSize: 12 }}>No posts in the recent window.</div>
            : recent.posts.slice(0, 8).map((p) => (
                <div key={p.id} style={recentLine}>
                  <StatusPill status={p.status} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.subreddit ? `r/${p.subreddit} · ` : ''}{p.title || p.error || '—'}
                  </span>
                  <span className="dim" style={{ fontSize: 11 }}>{formatRelative(p.created_at)}</span>
                </div>
              ))}
        </DrawerSection>

        <DrawerSection title={`Recent comments (${recent.comments.length})`}>
          {recent.comments.length === 0
            ? <div className="muted" style={{ fontSize: 12 }}>No auto-comment runs.</div>
            : recent.comments.slice(0, 6).map((c) => (
                <div key={c.id} style={recentLine}>
                  <StatusPill status={c.status} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    r/{c.subreddit} · {c.post_title || '(unknown)'}
                  </span>
                  <span className="dim" style={{ fontSize: 11 }}>{formatRelative(c.created_at)}</span>
                </div>
              ))}
        </DrawerSection>

        <DrawerSection title="Engagement sessions">
          {(!recent.engagement || recent.engagement.length === 0)
            ? <div className="muted" style={{ fontSize: 12 }}>No sessions recorded yet.</div>
            : recent.engagement.slice(0, 5).map((s) => (
                <div key={s.id} style={recentLine}>
                  <span className="mono dim" style={{ fontSize: 11, width: 60 }}>{s.platform}</span>
                  <span style={{ flex: 1, fontSize: 12 }}>
                    {s.posts_seen} seen · {s.likes} liked · {s.follows} followed · {s.comments || 0} commented
                  </span>
                  <span className="dim" style={{ fontSize: 11 }}>{formatMins(Math.round((s.seconds || 0) / 60))}</span>
                </div>
              ))}
        </DrawerSection>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────── Live activity

function ActivityFeed({ entries, actions, users, filter, onFilter }) {
  return (
    <div className="card" style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
      <div style={tablesHead}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Live activity</h3>
        <span className="muted" style={{ fontSize: 11 }}>
          Audit log: account creates, vote orders, bulk imports, and other operator actions.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <select value={filter.action}   onChange={(e) => onFilter({ ...filter, action:   e.target.value })} style={{ minWidth: 130 }}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filter.username} onChange={(e) => onFilter({ ...filter, username: e.target.value })} style={{ minWidth: 130 }}>
            <option value="">All members</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          {(filter.action || filter.username) && (
            <button className="ghost" onClick={() => onFilter({ action: '', username: '' })}>Clear</button>
          )}
        </div>
      </div>
      {entries.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
          Nothing matches that filter.
        </div>
      ) : (
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {entries.slice(0, 200).map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...td, width: 150 }} className="mono dim">
                    {new Date(e.created_at + 'Z').toLocaleString()}
                  </td>
                  <td style={{ ...td, width: 120 }}>{e.username || <span className="dim">system</span>}</td>
                  <td style={{ ...td, width: 160 }}>
                    <span style={actionChip}>{e.action}</span>
                  </td>
                  <td style={td}>{e.detail || <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Admin drawer

function AdminDrawer({ open, onToggle, canMembers, canRoles }) {
  // Lazy-mount the heavy member/role admin so the hub stays snappy.
  const [Users, setUsers] = useState(null);
  const [Roles, setRoles] = useState(null);
  useEffect(() => {
    if (!open) return;
    if (canMembers && !Users) import('./Users.jsx').then((m) => setUsers(() => m.default));
    if (canRoles   && !Roles) import('./Roles.jsx').then((m) => setRoles(() => m.default));
  }, [open, canMembers, canRoles, Users, Roles]);

  const [tab, setTab] = useState(canMembers ? 'members' : 'roles');

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none',
          padding: '12px 16px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, flex: 1 }}>Manage members & roles</h3>
        <span className="muted" style={{ fontSize: 11 }}>
          {open ? 'Click to collapse' : 'Click to expand'}
        </span>
        <span style={{ color: 'var(--text-3)', fontSize: 16 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ padding: 16 }}>
          {(canMembers && canRoles) && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
              {[
                { k: 'members', l: 'Members' },
                { k: 'roles',   l: 'Roles & permissions' },
              ].map((t) => (
                <button
                  key={t.k} onClick={() => setTab(t.k)}
                  style={{
                    background: 'transparent', border: 'none',
                    color: tab === t.k ? 'var(--gold-bright)' : 'var(--text-2)',
                    borderBottom: '2px solid ' + (tab === t.k ? 'var(--gold)' : 'transparent'),
                    padding: '8px 14px', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', marginBottom: -1,
                  }}
                >{t.l}</button>
              ))}
            </div>
          )}
          {tab === 'members' && canMembers && (Users ? <Users embedded /> : <div className="muted">Loading…</div>)}
          {tab === 'roles'   && canRoles   && (Roles ? <Roles />          : <div className="muted">Loading…</div>)}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── small bits

function DrawerSection({ title, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={drawerTitle}>{title}</div>
      {children}
    </div>
  );
}

function Presence({ presence, lastSeen }) {
  const map = {
    online:  { color: '#7fd99a', label: 'Online'  },
    idle:    { color: '#d4a64a', label: 'Idle'    },
    offline: { color: 'var(--text-3)', label: 'Offline' },
  };
  const p = map[presence] || map.offline;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          title={lastSeen ? `Last action ${formatRelative(lastSeen)}` : 'Never'}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, boxShadow: presence === 'online' ? `0 0 6px ${p.color}` : 'none' }} />
      {p.label}
    </span>
  );
}

function RoleBadge({ role }) {
  const palette = {
    admin:     { bg: 'rgba(212,166,74,0.18)',  fg: 'var(--gold-bright)' },
    manager:   { bg: 'rgba(159,192,234,0.18)', fg: '#9fc0ea' },
    reddit_va: { bg: 'rgba(127,217,154,0.18)', fg: '#7fd99a' },
    chatter:   { bg: 'rgba(226,163,163,0.18)', fg: '#e2a3a3' },
  };
  const c = palette[role] || { bg: 'rgba(255,255,255,0.06)', fg: 'var(--text-2)' };
  return (
    <span style={{
      ...c, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
      padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase',
      fontFamily: 'var(--font-mono)',
    }}>{(role || '').replace('_', ' ')}</span>
  );
}

function StatusPill({ status }) {
  const palette = {
    posted: { bg: 'rgba(127,217,154,0.18)', fg: '#7fd99a' },
    failed: { bg: 'rgba(226,163,163,0.18)', fg: '#e2a3a3' },
    skipped:{ bg: 'rgba(255,255,255,0.06)', fg: 'var(--text-3)' },
  };
  const c = palette[status] || palette.skipped;
  return (
    <span style={{
      ...c, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
      padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase',
    }}>{status || 'unknown'}</span>
  );
}

function StatusDot({ status }) {
  const colors = { ready: '#7fd99a', warming: '#d4a64a', paused: '#9aa0a6', banned: '#e2a3a3' };
  return (
    <span title={status} style={{
      width: 7, height: 7, borderRadius: '50%',
      background: colors[status] || 'var(--text-3)',
    }} />
  );
}

function platformColor(p) {
  return {
    reddit:    '#ff4500',
    redgifs:   '#d63d3d',
    x:         '#444',
    instagram: '#e1306c',
    tiktok:    '#69c9d0',
  }[p] || 'var(--text-3)';
}

function formatMins(m) {
  if (!m) return '0m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
function formatRelative(isoLike) {
  if (!isoLike) return '—';
  try {
    const t = new Date(isoLike.replace(' ', 'T') + (isoLike.endsWith('Z') ? '' : 'Z')).getTime();
    const diff = Math.max(0, Date.now() - t);
    if (diff < 60_000)   return 'just now';
    const m = Math.floor(diff / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return '—'; }
}
function hueOf(s) {
  let n = 0;
  for (const c of String(s || '')) n = (n * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${n}, 45%, 38%)`;
}

const EMPTY_TOTALS = {
  active_now: 0, members_total: 0, posts_today: 0, comments_today: 0,
  karma_today: 0, engagement_minutes_today: 0,
  accounts_active: 0, accounts_banned: 0, models_total: 0,
};

// ─────────────────────────────────────────────────────── styles

const topRow = {
  display: 'flex', alignItems: 'flex-end', gap: 10,
  marginBottom: 14, flexWrap: 'wrap',
};
const orgStripWrap = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 1, marginBottom: 14,
  background: 'var(--border)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
};
const orgCell = {
  background: 'var(--bg-elev)', padding: '12px 14px',
};
const orgLabel = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text-3)',
};
const orgValue = {
  fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600,
  marginTop: 4, lineHeight: 1.1,
};
const orgSub = {
  fontSize: 11, color: 'var(--text-3)', marginTop: 2, fontFamily: 'var(--font-mono)',
};
const tablesHead = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 14px', borderBottom: '1px solid var(--border)',
  background: 'var(--bg-1)',
};
const th = { textAlign: 'left', padding: '9px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', fontWeight: 600, fontFamily: 'var(--font-mono)' };
const td = { padding: '9px 12px', verticalAlign: 'middle' };
const bannedTag = {
  marginLeft: 6, fontSize: 9, color: '#e2a3a3',
  fontFamily: 'var(--font-mono)',
};
const drawerTitle = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--text-3)',
  marginBottom: 8, paddingBottom: 4, borderBottom: '1px dashed var(--border)',
};
const modelRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--bg-0)', padding: '6px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  fontSize: 13,
};
const accountRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 12,
};
const platformTag = {
  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
  color: '#fff', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
};
const recentLine = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '5px 0', borderBottom: '1px dashed var(--border)',
  fontSize: 12,
};
const actionChip = {
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
  padding: '2px 8px', borderRadius: 4,
  background: 'rgba(212,166,74,0.12)', color: 'var(--gold-bright)',
  letterSpacing: '0.05em',
};
