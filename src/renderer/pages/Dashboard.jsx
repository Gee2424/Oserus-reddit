import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { platformColor } from '../lib/platforms.js';
import { NAV } from '../components/Shell.jsx';
import PopOutButton from '../components/PopOutButton.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SetupChecklist from '../components/SetupChecklist.jsx';
import { DashboardSkeleton } from '../components/Skeletons.jsx';
import { StatusPill, StatTile, Avatar, EmptyState, Tag, thSm as th, tdSm as td } from '../components/ui.jsx';

// ─────────────────────────────────────────────────── Management Hub
//
// Unified replacement for the old Dashboard + Team + Activity trio.
// One page, one workflow: owners and managers see who's working,
// what they did today, and whether the farm is healthy.
//
// Visual hierarchy (top → bottom), not just a stack of equal-weight
// cards:
//
//   1. At-a-glance strip — org totals, the only thing everyone should
//      absorb in one glance.
//   2. Team table         — the primary surface: who's working right
//      now. Row click expands recent posts/comments/engagement.
//   3. Secondary tools     — audit log + (admin-only) member/role
//      admin, demoted into one tabbed card instead of two
//      full-width sections competing with #2 for attention.
//
// A role with no activity.view gets one friendly welcome panel
// instead of two stacked "permission denied" cards.

export default function DashboardPage({ navigate }) {
  const { token, user, activeTeamId } = useAuth();
  const can = useCan();
  const canSeeTeam = can('activity.view');
  const canAdminMembers = can('users.manage');
  const canAdminRoles = can('roles.manage');
  const canAdmin = canAdminMembers || canAdminRoles;

  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expanded, setExpanded] = useState(null); // member id
  const [detail, setDetail] = useState(null);

  const [activity, setActivity] = useState([]);
  const [actFilter, setActFilter] = useState({ action: '', username: '' });

  const [secondaryTab, setSecondaryTab] = useState('activity');

  // Track recently updated stat keys for flash animation
  const prevTotalsRef = useRef(null);
  const [updatedKeys, setUpdatedKeys] = useState(new Set());
  const [lastRefreshTime, setLastRefreshTime] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [o, a] = await Promise.all([
        window.api.team.overview({ token, teamId: activeTeamId }),
        canSeeTeam ? window.api.activity.list({ token, limit: 200 }) : Promise.resolve({ ok: true, entries: [] }),
      ]);
      if (o.ok) {
        // Detect changed stat keys for flash animation
        const prev = prevTotalsRef.current;
        const totals = o.totals || EMPTY_TOTALS;
        if (prev) {
          const changed = new Set();
          for (const key of Object.keys(totals)) {
            if (totals[key] !== prev[key]) changed.add(key);
          }
          if (changed.size > 0) {
            setUpdatedKeys(changed);
            setTimeout(() => setUpdatedKeys(new Set()), 600);
          }
        }
        prevTotalsRef.current = totals;
        setOverview(o);
        setLoadError(null);
        setLastRefreshTime(Date.now());
      }
      else setLoadError(o.error || 'Could not load team overview');
      if (a.ok) setActivity(a.entries || []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, activeTeamId, canSeeTeam]);

  useEffect(() => { refresh(); }, [refresh]);
  // Live refresh every 10s so heartbeat-driven presence and time-on-task
  // visibly tick while a manager is watching. The query is one round-trip
  // of indexed sub-selects, so this is still cheap even with dozens of
  // users.
  useEffect(() => {
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Drawer payload — refetched whenever the expanded row changes so
  // the operator never sees the previous member's data flash.
  useEffect(() => {
    if (!expanded) { setDetail(null); return; }
    let alive = true;
    window.api.team.memberDetail({ token, teamId: activeTeamId, userId: expanded }).then((r) => {
      if (!alive) return;
      setDetail(r.ok ? r : { ok: false, error: r.error });
    });
    return () => { alive = false; };
  }, [expanded, token, activeTeamId]);

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

  // Sections this role can actually reach — for the restricted-role
  // welcome panel, and reused nowhere else.
  const reachableNav = useMemo(() => NAV.filter((item) => !item.perm || can(item.perm)), [can]);

  if (loading && !overview) return <DashboardSkeleton />;

  return (
    <div>
      <PageHeader
        eyebrow="Management Hub"
        title={`${greeting}, ${user.display_name || user.username}.`}
        subtitle={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Who's working, what they did today, and whether the farm is healthy.
            {lastRefreshTime && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}>
                &nbsp;·&nbsp;
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--ok)',
                  boxShadow: '0 0 6px var(--green-soft)',
                  animation: 'pulse 2s ease-in-out infinite',
                }} />
                Live
              </span>
            )}
          </span>
        }
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ghost" onClick={refresh}>↻ Refresh</button>
          <PopOutButton route="dashboard" title="Hub" />
        </div>
      </PageHeader>

      {loadError && (
        <div className="error-banner" style={{ marginBottom: 14 }}>
          {loadError}
        </div>
      )}

      {canAdmin && <SetupChecklist navigate={navigate} />}

      {canSeeTeam ? (
        <>
          <OrgStrip totals={totals} updatedKeys={updatedKeys} prevTotals={prevTotalsRef.current} />
          <TeamTable
            members={members}
            expandedId={expanded}
            onExpand={(id) => setExpanded(expanded === id ? null : id)}
            detail={detail}
          />
          <SecondaryTools
            tab={secondaryTab}
            onTab={setSecondaryTab}
            canAdmin={canAdmin}
            canAdminMembers={canAdminMembers}
            canAdminRoles={canAdminRoles}
            entries={activityFiltered}
            actions={actionList}
            users={usernameList}
            filter={actFilter}
            onFilter={setActFilter}
          />
        </>
      ) : (
        <EmptyState
          icon="⬢"
          title="Welcome to Oserus Management"
          hint={
            reachableNav.length
              ? "Your role doesn't include team activity — here's what you can get to:"
              : "Your role doesn't have any sections assigned yet. Ask your owner or manager to grant access."
          }
          action={reachableNav.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {reachableNav.filter((item) => item.key !== 'dashboard').map((item) => (
                <button key={item.key} className="ghost" onClick={() => navigate && navigate(item.key)}>
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          )}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────── Org strip

function OrgStrip({ totals, updatedKeys, prevTotals }) {
  const trendOf = (numKey) => {
    const prev = prevTotals ? prevTotals[numKey] : null;
    const cur = totals[numKey];
    if (prev == null || cur == null || prev === cur) return null;
    const diff = cur - prev;
    const pct = prev !== 0 ? Math.round((diff / prev) * 100) : (diff > 0 ? 100 : -100);
    return { dir: diff > 0 ? 'up' : 'down', pct: Math.abs(pct), label: diff > 0 ? `+${diff}` : `${diff}` };
  };
  const items = [
    { key: 'active_now',     label: 'Active now',    value: totals.active_now,     tone: 'green', sub: `of ${totals.members_total} members`, numKey: 'active_now' },
    { key: 'posts_today',    label: 'Posts today',   value: totals.posts_today,    tone: 'gold',  numKey: 'posts_today' },
    { key: 'comments_today', label: 'Comments today',value: totals.comments_today, tone: 'blue',  numKey: 'comments_today' },
    { key: 'accounts_active',label: 'Accounts',      value: totals.accounts_active,tone: 'neutral', sub: totals.accounts_banned ? `${totals.accounts_banned} banned` : null, numKey: 'accounts_active' },
    { key: 'models_total',   label: 'Models',        value: totals.models_total,  tone: 'neutral', numKey: 'models_total' },
  ];
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
      {items.map((it) => {
        const trend = trendOf(it.numKey);
        const subParts = [it.sub, trend && `${trend.dir === 'up' ? '↑' : '↓'}${trend.label}`].filter(Boolean);
        return (
          <div key={it.key} style={{
            flex: 1, minWidth: 140,
            animation: updatedKeys?.has(it.key) ? 'glow-pulse 0.6s ease-out' : 'none',
            borderRadius: 'var(--radius-lg)',
          }}>
            <StatTile
              label={it.label}
              value={typeof it.value === 'number' ? it.value.toLocaleString() : it.value}
              sub={subParts.length ? subParts.join(' · ') : null}
              tone={it.tone}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────── Team table

function TeamTable({ members, expandedId, onExpand, detail }) {
  if (!members.length) {
    return (
      <EmptyState
        icon="⚑"
        title="No team members yet"
        hint="Add operators under Team → Members."
        compact
      />
    );
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
      <div style={tablesHead}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Team · live</h3>
        <span className="muted" style={{ fontSize: 11 }}>
          Click a row for recent posts, comments, and time on task.
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2)', position: 'sticky', top: 0, zIndex: 2 }}>
              <th style={th}>Member</th>
              <th style={th}>Role</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Models</th>
              <th style={{ ...th, textAlign: 'right' }}>Accounts</th>
              <th style={{ ...th, textAlign: 'right' }}>Posts (24h)</th>
              <th style={{ ...th, textAlign: 'right' }}>Comments (24h)</th>
              <th style={{ ...th, textAlign: 'right' }}>Growth (24h)</th>
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
                      <Avatar name={m.display_name || m.username} size={26} fontSize={11} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{m.display_name || m.username}</div>
                        <div className="mono dim" style={{ fontSize: 11 }}>@{m.username}</div>
                      </div>
                    </div>
                  </td>
                  <td style={td}>
                    <Tag hue={roleHue(m.role)}>{m.role.replace('_', ' ')}</Tag>
                  </td>
                  <td style={td}><Presence presence={m.presence} lastSeen={m.last_seen} /></td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{m.models_assigned || 0}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">
                    {m.accounts_active || 0}
                    {m.accounts_banned > 0 && <span style={bannedTag}>{m.accounts_banned} banned</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{m.posts_today || 0}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{m.comments_today || 0}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono" title="Account growth on assigned accounts in the last 24h">
                    {(m.karma_today || 0) > 0 ? `+${m.karma_today.toLocaleString()}` : (m.karma_today || 0).toLocaleString()}
                  </td>
                </tr>
                {expandedId === m.id && (
                  <tr>
                    <td colSpan={8} style={{ background: 'var(--bg-1)', padding: 14, borderTop: '1px solid var(--border)' }}>
                      <MemberDetail detail={detail} memberId={m.id} timeOnTaskMinutes={m.time_on_task_minutes} />
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

function MemberDetail({ detail, memberId, timeOnTaskMinutes }) {
  if (!detail) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
      <span style={{
        width: 12, height: 12, borderRadius: '50%',
        border: '2px solid var(--border-strong)',
        borderTopColor: 'var(--gold)',
        animation: 'spinner-rotate 0.7s linear infinite',
        display: 'inline-block',
      }} />
      Loading…
    </div>
  );
  if (!detail.ok) return <div className="error-banner">{detail.error}</div>;
  const { models, accounts, recent } = detail;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <div>
        <DrawerSection title={`Time on task — ${formatMins(timeOnTaskMinutes || 0)}`}>
          <div className="muted" style={{ fontSize: 12 }}>
            Active time in the app + Oserus Browser today. Pauses after 5 min of no input.
          </div>
        </DrawerSection>

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

// ─────────────────────────────────────────────── Secondary tools

function SecondaryTools({ tab, onTab, canAdmin, canAdminMembers, canAdminRoles, entries, actions, users, filter, onFilter }) {
  const tabs = [
    { k: 'activity', l: 'Activity log' },
    ...(canAdmin ? [{ k: 'admin', l: 'Members & Roles' }] : []),
  ];
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px 0', borderBottom: '1px solid var(--border)' }}>
        {tabs.map((t) => (
          <button
            key={t.k} onClick={() => onTab(t.k)}
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
      {tab === 'activity' && (
        <ActivityFeed entries={entries} actions={actions} users={users} filter={filter} onFilter={onFilter} />
      )}
      {tab === 'admin' && canAdmin && (
        <AdminPanel canMembers={canAdminMembers} canRoles={canAdminRoles} />
      )}
    </div>
  );
}

function ActivityFeed({ entries, actions, users, filter, onFilter }) {
  return (
    <div>
      <div style={{ ...tablesHead, borderBottom: '1px solid var(--border)' }}>
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

function AdminPanel({ canMembers, canRoles }) {
  // Lazy-mount the heavy member/role admin so the hub stays snappy until
  // this tab is actually opened.
  const [Users, setUsers] = useState(null);
  const [Roles, setRoles] = useState(null);
  useEffect(() => {
    if (canMembers && !Users) import('./Users.jsx').then((m) => setUsers(() => m.default));
    if (canRoles   && !Roles) import('./Roles.jsx').then((m) => setRoles(() => m.default));
  }, [canMembers, canRoles, Users, Roles]);

  const [subTab, setSubTab] = useState(canMembers ? 'members' : 'roles');

  return (
    <div style={{ padding: 16 }}>
      {(canMembers && canRoles) && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
          {[
            { k: 'members', l: 'Members' },
            { k: 'roles',   l: 'Roles & permissions' },
          ].map((t) => (
            <button
              key={t.k} onClick={() => setSubTab(t.k)}
              style={{
                background: 'transparent', border: 'none',
                color: subTab === t.k ? 'var(--gold-bright)' : 'var(--text-2)',
                borderBottom: '2px solid ' + (subTab === t.k ? 'var(--gold)' : 'transparent'),
                padding: '8px 14px', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', marginBottom: -1,
              }}
            >{t.l}</button>
          ))}
        </div>
      )}
      {subTab === 'members' && canMembers && (Users ? <Users embedded /> : <div className="muted">Loading…</div>)}
      {subTab === 'roles'   && canRoles   && (Roles ? <Roles />          : <div className="muted">Loading…</div>)}
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
    online:  { color: 'var(--online-green)', label: 'Online'  },
    idle:    { color: 'var(--gold)', label: 'Idle'    },
    offline: { color: 'var(--text-3)', label: 'Offline' },
  };
  const p = map[presence] || map.offline;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }}
          title={lastSeen ? `Last action ${formatRelative(lastSeen)}` : 'Never'}>
      <span style={{ width: 7, height: 7, borderRadius: 'var(--radius-circle)', background: p.color, boxShadow: presence === 'online' ? `0 0 6px ${p.color}` : 'none' }} />
      {p.label}
    </span>
  );
}

function roleHue(role) {
  let h = 0; for (let i = 0; i < (role || '').length; i++) h = (h * 31 + (role || '').charCodeAt(i)) >>> 0;
  return h % 360;
}

function StatusDot({ status }) {
  const colors = { ready: 'var(--online-green)', warming: 'var(--gold)', paused: 'var(--text-3)', banned: 'var(--danger-fg)' };
  return (
    <span title={status} style={{
      width: 7, height: 7, borderRadius: 'var(--radius-circle)',
      background: colors[status] || 'var(--text-3)',
    }} />
  );
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

const EMPTY_TOTALS = {
  active_now: 0, members_total: 0, posts_today: 0, comments_today: 0,
  karma_today: 0, engagement_minutes_today: 0,
  accounts_active: 0, accounts_banned: 0, models_total: 0,
};

// ─────────────────────────────────────────────────────── styles

const tablesHead = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 14px', borderBottom: '1px solid var(--border)',
  background: 'var(--bg-1)',
};
const bannedTag = {
  marginLeft: 6, fontSize: 9, color: 'var(--danger-fg)',
  fontFamily: 'var(--font-mono)',
};
const drawerTitle = {
  fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--text-3)',
  marginBottom: 8, paddingBottom: 4, borderBottom: '1px dashed var(--border)',
};
const modelRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--bg-0)', padding: '6px 10px',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  fontSize: 'var(--text-body)',
};
const accountRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '5px 8px', borderBottom: '1px solid var(--border)', fontSize: 'var(--text-sm)',
};
const platformTag = {
  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 'var(--radius-sm)',
  color: 'var(--text-on-accent)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
};
const recentLine = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '5px 0', borderBottom: '1px dashed var(--border)',
  fontSize: 'var(--text-sm)',
};
const actionChip = {
  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontWeight: 600,
  padding: '2px 8px', borderRadius: 'var(--radius-sm)',
  background: 'rgba(212,166,74,0.12)', color: 'var(--gold-bright)',
  letterSpacing: '0.05em',
};
