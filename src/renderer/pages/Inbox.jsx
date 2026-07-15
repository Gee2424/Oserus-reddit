import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import { useInboxLive } from '../lib/inboxLive.jsx';
import { PLATFORMS, platformColor } from '../lib/platforms.js';
import { useCloakManagerLaunch } from '../hooks/useCloakManagerLaunch';
import { Avatar, EmptyState } from '../components/ui.jsx';
import { useToast } from '../lib/toast.jsx';
import { timeAgo, fullStamp } from '../lib/dates.js';

const FOLDERS = [
  { key: 'all', label: 'Inbox', icon: '✉' },
  { key: 'unread', label: 'Requests', icon: '✦' },
  { key: 'sent', label: 'Hidden', icon: '◐' },
];

const INBOX_LIVE = { reddit: true, redgifs: false, x: false, instagram: false, tiktok: false };

const TILE_COLORS = {
  red: '#e2a3a3', gold: 'var(--gold)', blue: 'var(--blue-bright)', green: 'var(--green-bright)', neutral: 'var(--text-1)',
};
function AnalyticsTile({ label, value, tone = 'neutral' }) {
  return (
    <div style={{
      flex: 1, minWidth: 90,
      background: 'var(--bg-1)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px',
    }}>
      <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: TILE_COLORS[tone] || TILE_COLORS.neutral, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export default function InboxPage({ embedded, standalone, navigate }) {
  const { token, activeTeamId } = useAuth();
  const { toast } = useToast();
  const { forPlatform, refresh: refreshAccounts, accounts: allAccounts } = useActiveAccount();
  const inboxLive = useInboxLive();
  const [platform, setPlatform] = useState('reddit');
  const ctx = forPlatform(platform);
  const { active, setActive } = ctx;
  const [localAccounts, setLocalAccounts] = useState(null);
  const platformAccounts = localAccounts || ctx.accounts;

  const [folder, setFolder] = useState('all');
  const [kindView, setKindView] = useState('messages');
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [selectedThreadKey, setSelectedThreadKey] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const { isAccountRunning } = useCloakManagerLaunch();
  const [launchingSignIn, setLaunchingSignIn] = useState(false);

  useEffect(() => {
    window.api.messaging.templatesList({ token, profileId: active?.profile_id }).then((r) => {
      if (r.ok) setTemplates(r.templates || []);
    });
  }, [token, active?.profile_id]);

  useEffect(() => { refreshAccounts(); }, [refreshAccounts]);

  useEffect(() => {
    window.api.accounts.listForUser({ token, teamId: activeTeamId }).then(r => {
      if (r.ok) setLocalAccounts(r.accounts);
    });
  }, [token, activeTeamId]);

  useEffect(() => {
    if (!active && platformAccounts && platformAccounts.length > 0) setActive(platformAccounts[0].id);
  }, [active, platformAccounts, platform]);

  const isLive = INBOX_LIVE[platform];

  const messages = (inboxLive.byAccount?.[active?.id]?.messages) || [];
  const unreadByAccount = inboxLive.unreadByAccount || {};
  const loading = !!inboxLive.loading?.[active?.id];
  function setMessages(updater) {
    if (!active) return;
    inboxLive.patchMessages(active.id, typeof updater === 'function' ? updater : () => updater);
  }
  function setUnreadByAccount() {}

  const refreshRef = useRef(inboxLive.refresh);
  refreshRef.current = inboxLive.refresh;
  const load = useCallback(async () => {
    if (!active || !isLive) return;
    setNotLoggedIn(false);
    try { await refreshRef.current(active.id, folder); }
    catch (e) { toast('err', e?.message || String(e)); }
  }, [active?.id, folder, isLive, toast]);

  useEffect(() => { load(); setSelectedThreadKey(null); }, [load, active?.id]);
  const lastSelectedRef = useRef(null);
  useEffect(() => {
    if (lastSelectedRef.current && !selectedThreadKey) { load(); }
    lastSelectedRef.current = selectedThreadKey;
  }, [selectedThreadKey]);
  useEffect(() => {
    if (!active || !isLive) return;
    const id = setInterval(() => { if (!selectedThreadKey) load(); }, 60000);
    return () => clearInterval(id);
  }, [load, active, isLive, selectedThreadKey]);

  const messagesOnly = messages.filter((m) => m.kind === 't4');
  const repliesOnly  = messages.filter((m) => m.kind === 't1' || m.kind === 't3');
  const unreadCounts = {
    messages: messagesOnly.filter((m) => m.isNew).length,
    replies:  repliesOnly.filter((m) => m.isNew).length,
  };
  const visibleMessages = kindView === 'replies' ? repliesOnly : messagesOnly;

  const groups = (() => {
    const byKey = new Map();
    for (const m of visibleMessages) {
      const key = m.firstMessageName || m.name;
      const other = (m.author === active?.username) ? m.dest : m.author;
      const cur = byKey.get(key) || { key, other: other || m.dest || m.author || 'reddit', items: [], unread: 0, lastTs: 0, last: m };
      cur.items.push(m);
      if (!cur.other && other) cur.other = other;
      if (m.isNew) cur.unread++;
      if ((m.created || 0) > cur.lastTs) { cur.lastTs = m.created; cur.last = m; }
      byKey.set(key, cur);
    }
    return [...byKey.values()].sort((a, b) => b.lastTs - a.lastTs);
  })();

  const selected = groups.find((g) => g.key === selectedThreadKey) || null;
  const selectedThread = selected
    ? [...selected.items].sort((a, b) => (a.created || 0) - (b.created || 0))
    : [];
  const replyTarget = selectedThread.length ? selectedThread[selectedThread.length - 1] : null;

  async function openThread(g) {
    setSelectedThreadKey(g.key);
    setReplyText('');
    const unreadInThread = g.items.filter((m) => m.isNew);
    for (const m of unreadInThread) {
      await window.api.inbox.markRead({ token, accountId: active.id, fullname: m.name });
    }
    if (unreadInThread.length) {
      setMessages((prev) => prev.map((x) => (g.items.find((it) => it.id === x.id) ? { ...x, isNew: false } : x)));
      setUnreadByAccount((prev) => ({ ...prev, [active.id]: Math.max(0, (prev[active.id] || 0) - unreadInThread.length) }));
    }
    try {
      const r = await window.api.inbox.fetchThread({ token, accountId: active.id, rootFullname: g.key });
      if (r.ok && r.messages?.length) {
        setMessages((prev) => {
          const map = new Map(prev.map((m) => [m.id, m]));
          for (const m of r.messages) map.set(m.id, { ...map.get(m.id), ...m });
          return [...map.values()];
        });
      }
    } catch {}
  }

  async function sendReply() {
    if (!replyText.trim() || !replyTarget) return;
    setSending(true);
    const body = replyText.trim();
    const res = await window.api.inbox.reply({ token, accountId: active.id, parentFullname: replyTarget.name, text: body });
    setSending(false);
    if (!res.ok) { toast('err', res.error); return; }
    setReplyText('');
    const now = Math.floor(Date.now() / 1000);
    const local = {
      id: `local-${now}`,
      name: `local-${now}`,
      firstMessageName: replyTarget.firstMessageName || replyTarget.name,
      kind: 't4',
      author: active.username,
      dest: selected?.other || replyTarget.author,
      subject: replyTarget.subject || '',
      body,
      created: now,
      isNew: false,
    };
    setMessages((prev) => [...prev, local]);
  }
  async function popOut() {
    await window.api.windows.openPopout({ route: 'inbox', title: 'Account Manager Pro', width: 1180, height: 760 });
  }

  // Analytics strip — derive stats from inbox live data
  const totalUnread = Object.values(unreadByAccount).reduce((s, n) => s + (n || 0), 0);
  const accountsWithUnread = Object.values(unreadByAccount).filter((n) => n > 0).length;
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const last24 = messages.filter((m) => (m.createdUtc || 0) >= dayAgo).length;
  const sent24 = messages.filter((m) => (m.createdUtc || 0) >= dayAgo && m.author === active?.username).length;
  const received24 = Math.max(0, last24 - sent24);
  const responseRate = received24 > 0 ? Math.round((sent24 / received24) * 100) : null;

  return (
    <div>
      {!embedded && (
        <div className="title-block">
          <div>
            <div className="eyebrow">Messages</div>
            <h1>Account Manager Pro</h1>
          </div>
        </div>
      )}

      <div style={shell}>
        {/* Platform pill row — only in standalone (pop-out) mode; the parent shell renders them otherwise. */}
        {standalone && (
        <div style={platformRow}>
            {PLATFORMS.map((p) => {
              const isActive = platform === p.v;
              return (
                <button
                  key={p.v}
                  onClick={() => { setPlatform(p.v); setSelectedThreadKey(null); }}
                  style={{
                    background: isActive ? 'var(--bg-2)' : 'transparent',
                    border: `1px solid ${isActive ? platformColor(p.v) : 'transparent'}`,
                    borderRadius: 999, padding: '5px 12px',
                    color: isActive ? 'var(--text-0)' : 'var(--text-2)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: platformColor(p.v) }} />
                  {p.label}
                  {!INBOX_LIVE[p.v] && <span style={{ fontSize: 9, opacity: 0.6 }}>browser</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Top action bar */}
        <div style={topBar}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Account Manager Pro</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={load} disabled={loading || !isLive}>↻ Refresh Account</button>
            <button className="ghost" disabled={!isLive} onClick={async () => {
              for (const a of platformAccounts) await inboxLive.refresh(a.id, 'unread');
            }}>↻ Refresh All Accounts</button>
            {!standalone && <button className="ghost" onClick={popOut}>⧉ Pop out</button>}
          </div>
        </div>

        {/* Messaging Analytics strip */}
        <div style={analyticsStrip}>
          <AnalyticsTile label="Total Unread" value={totalUnread} tone="red" />
          <AnalyticsTile label="Accounts w/ Unread" value={accountsWithUnread} tone="gold" />
          <AnalyticsTile label="Received 24h" value={received24} tone="blue" />
          <AnalyticsTile label="Sent 24h" value={sent24} tone="green" />
          <AnalyticsTile label="Response Rate" value={responseRate == null ? '—' : `${responseRate}%`} tone="neutral" />
        </div>

        {/* Three columns */}
        <div style={threeCol}>
          {/* Column 1: accounts — grouped by model profile */}
          <div style={accountsCol}>
            {(() => {
              if (!platformAccounts || !platformAccounts.length) {
                return <EmptyState title="" hint={`No ${platform} accounts.`} />;
              }
              const byProfile = {};
              for (const a of platformAccounts) {
                const key = a.profile_name || `Profile #${a.profile_id}`;
                if (!byProfile[key]) byProfile[key] = [];
                byProfile[key].push(a);
              }
              const keys = Object.keys(byProfile).sort();
              return keys.map((profileName) => (
                <div key={profileName}>
                  <div style={profileHeader}>{profileName}</div>
                  {byProfile[profileName].map((a) => {
                    const isActive = a.id === active?.id;
                    const unreadN = unreadByAccount[a.id] || 0;
                    const mode = a.browser_mode || 'electron';
                    const isCM = mode === 'cloakmanager';
                    const isRunning = a.cloak_actual_name && isAccountRunning(a.cloak_actual_name);
                    return (
                      <button key={a.id} onClick={() => setActive(a.id)} style={{ ...accountRow, ...(isActive ? accountRowActive : {}) }}>
                        <Avatar name={a.username} size={30} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.username}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                              background: isCM ? 'rgba(155,89,182,0.2)' : 'rgba(74,144,226,0.2)',
                              color: isCM ? '#c9a3d9' : '#7aa8e0',
                            }}>{isCM ? 'CM' : 'EB'}</span>
                            {isRunning && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ok)', flexShrink: 0 }} />}
                          </div>
                        </div>
                        {unreadN > 0 && <span style={badgeRed}>{unreadN > 999 ? '999+' : unreadN}</span>}
                      </button>
                    );
                  })}
                </div>
              ));
            })()}
          </div>

          {/* Column 2: conversation list + folder tabs */}
          <div style={listCol}>
            <div style={{ padding: '12px 12px 0 12px' }}>
              <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>
                  Account: <span style={{ color: 'var(--text-0)', fontWeight: 600 }}>{active ? active.username : '—'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: loading ? 'var(--gold)' : 'var(--text-2)' }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: (active?.cloak_actual_name && isAccountRunning(active?.cloak_actual_name)) ? 'var(--ok)' :
                               loading ? 'var(--gold)' : 'var(--green-bright)',
                  }} />
                  {(active?.cloak_actual_name && isAccountRunning(active?.cloak_actual_name)) ? 'Browser running' :
                   loading ? 'Refreshing…' : 'Connected'}
                </div>
              </div>

              <div style={kindTabs}>
                {[
                  { v: 'messages', label: 'Messages', sub: 'Direct messages (PMs)', count: unreadCounts.messages },
                  { v: 'replies',  label: 'Replies',  sub: 'Post & comment replies', count: unreadCounts.replies },
                ].map((k) => {
                  const isActive = kindView === k.v;
                  return (
                    <button
                      key={k.v}
                      onClick={() => { setKindView(k.v); setSelectedThreadKey(null); }}
                      style={{ ...kindTab, ...(isActive ? kindTabActive : {}) }}
                      title={k.sub}
                    >
                      <span>{k.label}</span>
                      {k.count > 0 && <span style={kindBadge}>{k.count}</span>}
                    </button>
                  );
                })}
              </div>

              <div style={folderTabs}>
                {FOLDERS.map((f) => {
                  const isActive = folder === f.key;
                  const count = f.key === 'unread' ? (unreadByAccount[active?.id] || 0) : null;
                  return (
                    <button key={f.key} onClick={() => { setFolder(f.key); setSelectedThreadKey(null); }} style={{ ...folderTab, ...(isActive ? folderTabActive : {}) }}>
                      <span>{f.icon}</span> {f.label}
                      {count > 0 && <span style={miniBadge}>{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 10px 8px', minHeight: 0 }}>
              {!isLive ? (
                <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-2)', fontSize: 12, lineHeight: 1.6 }}>
                  No JSON inbox adapter for {platform} yet. Use the Browser to read DMs for this account.
                </div>
              ) : !active ? <EmptyState title="" hint="No account selected." /> :
                notLoggedIn ? (
                  <div style={{ padding: 18, textAlign: 'center' }}>
                    <div style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>{active.username} isn't logged into {platform} yet.</div>
                    {active && (
                      <button
                        onClick={async () => {
                          setLaunchingSignIn(true);
                          try {
                            await window.api.oserusBrowser.openAccount({ token, accountId: active.id });
                          } finally {
                            setTimeout(() => setLaunchingSignIn(false), 2000);
                          }
                        }}
                        disabled={launchingSignIn}
                        style={{
                          ...primaryBtn,
                          marginTop: 12,
                          opacity: launchingSignIn ? 0.6 : 1,
                          cursor: launchingSignIn ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {launchingSignIn ? 'Opening browser…' : 'Sign in via Browser ↗'}
                      </button>
                    )}
                  </div>
                ) :
                loading && messages.length === 0 ? <EmptyState title="" hint="Loading…" /> :
                groups.length === 0 ? <EmptyState title="" hint="No messages." /> :
                groups.map((g) => {
                  const m = g.last;
                  const isSel = g.key === selectedThreadKey;
                  return (
                    <button key={g.key} onClick={() => openThread(g)} style={{ ...convoRow, ...(isSel ? convoRowActive : {}) }}>
                      <Avatar name={g.other} size={30} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.other}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-2)', flexShrink: 0 }}>{fullStamp(m.created).slice(0, 16)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                          {(m.body || m.subject || '').replace(/\s+/g, ' ').slice(0, 80)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{g.items.length} message{g.items.length > 1 ? 's' : ''}</div>
                      </div>
                      {g.unread > 0 && <span style={badgeRedSm}>{g.unread}</span>}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Column 3: thread / chat view */}
          <div style={threadCol}>
            {!selected ? (
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>✉</div>
                  <div style={{ fontSize: 13 }}>Select a conversation</div>
                </div>
              </div>
            ) : (
              <>
                <div style={threadHeader}>
                  <Avatar name={selected.other} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-0)' }}>{selected.other}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{selectedThread.length} message{selectedThread.length === 1 ? '' : 's'}</div>
                  </div>
                </div>

                <div style={threadBody}>
                  {selectedThread.map((m) => {
                    const fromMe = m.author === active?.username;
                    return (
                      <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: fromMe ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>
                          <span className="mono">{fullStamp(m.created)}</span>
                          <span style={{ marginLeft: 6, color: 'var(--text-0)', fontWeight: 600 }}>{fromMe ? 'You' : m.author}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: fromMe ? 'row-reverse' : 'row', maxWidth: '80%' }}>
                          <Avatar name={fromMe ? active?.username : m.author} size={24} />
                          <div style={fromMe ? bubbleMe : bubbleThem}>{m.body}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {folder !== 'sent' && replyTarget && (
                  <div style={composer}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={`Reply as ${active.username}…`}
                        style={{ ...composerInput, width: '100%' }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); }}
                      />
                      {templates.length > 0 && (
                        <button
                          onClick={() => setShowTemplates((v) => !v)}
                          title="Insert from canned templates"
                          style={{
                            position: 'absolute', right: 8, top: 8,
                            background: 'var(--bg-2)', border: '1px solid var(--border)',
                            color: 'var(--text-0)', borderRadius: 8, padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                          }}
                        >📋 {templates.length}</button>
                      )}
                      {showTemplates && (
                        <div style={{
                          position: 'absolute', bottom: 'calc(100% + 6px)', right: 0,
                          width: 280, maxHeight: 260, overflowY: 'auto',
                          background: 'var(--bg-elev)', border: '1px solid var(--border)',
                          borderRadius: 10, padding: 6, zIndex: 50,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                        }}>
                          {templates.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => { setReplyText((cur) => cur + (cur ? '\n\n' : '') + t.body); setShowTemplates(false); }}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                color: 'var(--text-0)', padding: '8px 10px', borderRadius: 6,
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body.slice(0, 60)}{t.body.length > 60 ? '…' : ''}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={sendReply} disabled={sending || !replyText.trim()} style={sendBtn}>{sending ? '…' : '➤'}</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const shell = { background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 30px -10px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column' };
const topBar = { display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg-1)' };
const analyticsStrip = { display: 'flex', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg-0)' };
const threeCol = { display: 'grid', gridTemplateColumns: 'minmax(170px, 220px) minmax(260px, 340px) 1fr', flex: 1, minHeight: 0, overflow: 'hidden' };
const platformRow = { display: 'flex', gap: 6, padding: '10px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elev)', flexWrap: 'wrap' };
const accountsCol = { background: 'var(--bg-0)', borderRight: '1px solid var(--border)', padding: '12px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };
const profileHeader = { fontSize: 11, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '12px 10px 6px 10px', borderBottom: '1px solid var(--border)', marginBottom: 4 };
const listCol = { display: 'flex', flexDirection: 'column', background: 'var(--bg-elev)', borderRight: '1px solid var(--border)', minHeight: 0, overflow: 'hidden' };
const threadCol = { display: 'flex', flexDirection: 'column', background: 'var(--bg-0)', minWidth: 0, minHeight: 0, overflow: 'hidden' };

const accountRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'transparent', border: '1px solid transparent', textAlign: 'left', cursor: 'pointer', width: '100%' };
const accountRowActive = { background: 'var(--accent-soft)', border: '1px solid var(--accent)' };
const badgeRed = { background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999 };
const badgeRedSm = { background: 'var(--danger)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, alignSelf: 'center' };

const kindTabs = { display: 'flex', gap: 0, marginBottom: 10, background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 10, padding: 3 };
const kindTab = {
  flex: 1, background: 'transparent', border: 'none',
  color: 'var(--text-2)', padding: '6px 8px',
  fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};
const kindTabActive = {
  background: 'var(--gold-soft)',
  color: 'var(--gold-bright)',
  boxShadow: 'inset 0 0 0 1px rgba(212,166,74,0.35)',
};
const kindBadge = {
  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
  background: 'rgba(226,163,163,0.18)', color: '#e2a3a3',
};
const folderTabs = { display: 'flex', gap: 6, marginBottom: 10 };
const folderTab = { flex: 1, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '7px 10px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 };
const folderTabActive = { background: 'var(--accent-soft)', color: 'var(--text-0)', borderColor: 'var(--accent)' };
const miniBadge = { background: 'var(--danger)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, marginLeft: 2 };

const convoRow = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 10px', width: '100%', textAlign: 'left', background: 'transparent', border: '1px solid transparent', borderRadius: 10, cursor: 'pointer', marginBottom: 4 };
const convoRowActive = { background: 'var(--accent-soft)', border: '1px solid var(--accent)' };

const threadHeader = { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' };
const threadBody = { flex: 1, overflowY: 'auto', padding: '20px 22px', background: 'radial-gradient(ellipse at top, rgba(255,255,255,0.02), transparent 60%)' };

const bubbleThem = { background: 'var(--bg-2)', color: 'var(--text-0)', padding: '9px 14px', borderRadius: '14px 14px 14px 4px', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' };
const bubbleMe = { background: 'var(--accent)', color: '#fff', padding: '9px 14px', borderRadius: '14px 14px 4px 14px', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' };

const composer = { display: 'flex', gap: 8, padding: 14, borderTop: '1px solid var(--border)', alignItems: 'flex-end' };
const composerInput = { flex: 1, minHeight: 42, maxHeight: 140, background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 18, color: 'var(--text-0)', padding: '11px 16px', fontSize: 13, resize: 'none', fontFamily: 'var(--font-body)' };
const sendBtn = { background: 'var(--accent)', border: 'none', color: '#fff', width: 42, height: 42, borderRadius: '50%', cursor: 'pointer', fontSize: 16, flexShrink: 0 };
const primaryBtn = { background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 18px', borderRadius: 999, cursor: 'pointer' };
