import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import { useInboxLive } from '../lib/inboxLive.jsx';
import { PLATFORMS, platformColor } from '../lib/platforms.js';

const FOLDERS = [
  { key: 'all', label: 'Inbox', icon: '✉' },
  { key: 'unread', label: 'Requests', icon: '✦' },
  { key: 'sent', label: 'Hidden', icon: '◐' },
];

// Reddit is the only platform with a working JSON inbox today. The other
// platforms render the pill row + a sign-in prompt so the UI is honest about
// what's wired and what isn't.
const INBOX_LIVE = { reddit: true, redgifs: false, x: false, instagram: false, tiktok: false };

function timeAgo(unixSec) {
  if (!unixSec) return '';
  const s = Math.floor(Date.now() / 1000 - unixSec);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}
function fullStamp(unixSec) {
  if (!unixSec) return '';
  try {
    const d = new Date(unixSec * 1000);
    return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return ''; }
}
function initial(name) { return (name || '?').replace(/^u\//, '').charAt(0).toUpperCase(); }
function hueOf(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export default function InboxPage({ embedded, standalone, navigate }) {
  const { token } = useAuth();
  const { forPlatform } = useActiveAccount();
  const inboxLive = useInboxLive();
  const [platform, setPlatform] = useState('reddit');
  const { active, accounts: platformAccounts, setActive } = forPlatform(platform);

  const [folder, setFolder] = useState('all');
  const [err, setErr] = useState(null);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [selectedThreadKey, setSelectedThreadKey] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    window.api.messaging.templatesList({ token, profileId: active?.profile_id }).then((r) => {
      if (r.ok) setTemplates(r.templates || []);
    });
  }, [token, active?.profile_id]);

  useEffect(() => {
    if (!active && platformAccounts && platformAccounts.length > 0) setActive(platformAccounts[0].id);
  }, [active, platformAccounts, platform]);

  const isLive = INBOX_LIVE[platform];

  // Messages + unread counts come from the root-level InboxLiveProvider
  // (poll runs even when this page is unmounted). On page mount we still
  // kick a refresh for the active account so the UI is current.
  const messages = (inboxLive.byAccount?.[active?.id]?.messages) || [];
  const unreadByAccount = inboxLive.unreadByAccount || {};
  const loading = !!inboxLive.loading?.[active?.id];
  function setMessages(updater) {
    if (!active) return;
    inboxLive.patchMessages(active.id, typeof updater === 'function' ? updater : () => updater);
  }
  function setUnreadByAccount() { /* owned by InboxLiveProvider */ }
  const load = useCallback(async () => {
    if (!active || !isLive) return;
    setErr(null); setNotLoggedIn(false);
    try { await inboxLive.refresh(active.id, folder); }
    catch (e) { setErr(e?.message || String(e)); }
  }, [active?.id, folder, isLive, inboxLive]);

  useEffect(() => { load(); setSelectedThreadKey(null); }, [load]);
  // When the user leaves a thread (closes selection or switches platforms),
  // re-fetch so the conversation list reflects the latest state.
  const lastSelectedRef = useRef(null);
  useEffect(() => {
    if (lastSelectedRef.current && !selectedThreadKey) {
      load();
    }
    lastSelectedRef.current = selectedThreadKey;
  }, [selectedThreadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || !isLive) return;
    // Auto-refresh every 60s — but ONLY when no thread is open. Refreshing
    // while the user is reading/replying re-sorts the conversation list and
    // makes the thread jump, which is exactly the annoyance you flagged.
    const id = setInterval(() => { if (!selectedThreadKey) load(); }, 60000);
    return () => clearInterval(id);
  }, [load, active, isLive, selectedThreadKey]);

  // Cross-account unread polling now lives in InboxLiveProvider so it keeps
  // running even when this page is unmounted (Dashboard / Scheduler / etc).
  // No local fetch needed here.

  // Group messages into conversation threads. Reddit returns nested `replies`
  // so each message has a `firstMessageName` pointing at the root — we group
  // on that so the full back-and-forth shows together.
  const groups = (() => {
    const byKey = new Map();
    for (const m of messages) {
      const key = m.firstMessageName || m.name;
      // Counterparty = whichever side of the conversation isn't us.
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
    // Mark unread messages in the thread as read.
    const unreadInThread = g.items.filter((m) => m.isNew);
    for (const m of unreadInThread) {
      await window.api.inbox.markRead({ token, accountId: active.id, fullname: m.name });
    }
    if (unreadInThread.length) {
      setMessages((prev) => prev.map((x) => (g.items.find((it) => it.id === x.id) ? { ...x, isNew: false } : x)));
      setUnreadByAccount((prev) => ({ ...prev, [active.id]: Math.max(0, (prev[active.id] || 0) - unreadInThread.length) }));
    }
    // Fetch the FULL thread (not just whatever was in the inbox snapshot).
    // Reddit's /message/messages/{id}.json returns root + entire reply tree
    // even when the inbox listing truncated it.
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
    setSending(true); setErr(null);
    const body = replyText.trim();
    const res = await window.api.inbox.reply({ token, accountId: active.id, parentFullname: replyTarget.name, text: body });
    setSending(false);
    if (!res.ok) { setErr(res.error); return; }
    setReplyText('');
    // Optimistically append the sent message to the local state instead of
    // re-fetching the inbox — keeps the conversation list in its current
    // order so the thread doesn't jump out from under you while you're in it.
    // The next auto-refresh fires only after the thread is closed.
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

  return (
    <div>
      {!embedded && <div className="title-block"><div><div className="eyebrow">Messages</div><h1>Account Manager Pro</h1></div></div>}

      <div style={shell}>
        {/* Platform pill row — switches which account list + inbox source is shown. */}
        <div style={platformRow}>
          {PLATFORMS.map((p) => {
            const isActive = platform === p.v;
            return (
              <button
                key={p.v}
                onClick={() => { setPlatform(p.v); setSelectedThreadKey(null); }}
                style={{
                  background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: `1px solid ${isActive ? platformColor(p.v) : 'transparent'}`,
                  borderRadius: 999, padding: '5px 12px',
                  color: isActive ? '#fff' : '#9a9b9d',
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

        {/* Top action bar */}
        <div style={topBar}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Account Manager Pro</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={load} disabled={loading || !isLive}>↻ Refresh Account</button>
            <button className="ghost" disabled={!isLive} onClick={async () => {
              for (const a of platformAccounts) await inboxLive.refresh(a.id, 'unread');
            }}>↻ Refresh All Accounts</button>
            {navigate && <button className="ghost" onClick={() => navigate('add-accounts', { tab: 'proxies' })}>⚙ Proxies</button>}
            {!standalone && <button className="ghost" onClick={popOut}>⧉ Pop out</button>}
          </div>
        </div>

        {/* Messaging Analytics strip */}
        {(() => {
          const totalUnread = Object.values(unreadByAccount).reduce((s, n) => s + (n || 0), 0);
          const accountsWithUnread = Object.values(unreadByAccount).filter((n) => n > 0).length;
          const dayAgo = Math.floor(Date.now() / 1000) - 86400;
          const last24 = messages.filter((m) => (m.createdUtc || 0) >= dayAgo).length;
          const sent24 = messages.filter((m) => (m.createdUtc || 0) >= dayAgo && m.author === active?.username).length;
          const received24 = Math.max(0, last24 - sent24);
          const responseRate = received24 > 0 ? Math.round((sent24 / received24) * 100) : null;
          return (
            <div style={analyticsStrip}>
              <AnalyticsTile label="Total Unread" value={totalUnread} tone="red" />
              <AnalyticsTile label="Accounts w/ Unread" value={accountsWithUnread} tone="gold" />
              <AnalyticsTile label="Received 24h" value={received24} tone="blue" />
              <AnalyticsTile label="Sent 24h" value={sent24} tone="green" />
              <AnalyticsTile label="Response Rate" value={responseRate == null ? '—' : `${responseRate}%`} tone="purple" />
            </div>
          );
        })()}

        {/* Three columns */}
        <div style={threeCol}>
          {/* Column 1: accounts */}
          <div style={accountsCol}>
            {platformAccounts && platformAccounts.length ? platformAccounts.map((a) => {
              const isActive = a.id === active?.id;
              const unread = unreadByAccount[a.id] || 0;
              return (
                <button key={a.id} onClick={() => setActive(a.id)} style={{ ...accountRow, ...(isActive ? accountRowActive : {}) }}>
                  <div style={{ ...avatarLg, background: `hsl(${hueOf(a.username)},45%,40%)` }}>{initial(a.username)}</div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: '#d7dadc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.username}
                  </div>
                  {unread > 0 && <span style={badgeRed}>{unread > 999 ? '999+' : unread}</span>}
                </button>
              );
            }) : <Empty text={`No ${platform} accounts.`} />}
          </div>

          {/* Column 2: conversation list + folder tabs */}
          <div style={listCol}>
            <div style={{ padding: '12px 12px 0 12px' }}>
              <div style={{ background: '#0f0f10', border: '1px solid #2a2a2c', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#818384', marginBottom: 6 }}>Account: <span style={{ color: '#d7dadc', fontWeight: 600 }}>{active ? active.username : '—'}</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: loading ? 'var(--gold)' : '#818384' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: loading ? 'var(--gold)' : '#7fd99a' }} />
                  {loading ? 'Refreshing…' : 'Connected'}
                </div>
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
                <div style={{ padding: 18, textAlign: 'center', color: '#818384', fontSize: 12, lineHeight: 1.6 }}>
                  No JSON inbox adapter for {platform} yet. Use the Browser to read DMs for this account.
                </div>
              ) : !active ? <Empty text="No account selected." /> :
                notLoggedIn ? (
                  <div style={{ padding: 18, textAlign: 'center' }}>
                    <div style={{ color: '#818384', fontSize: 13, lineHeight: 1.6 }}>{active.username} isn't logged into {platform} yet.</div>
                    {navigate && <button onClick={() => { setActive(active.id); navigate('browser'); }} style={{ ...primaryBtn, marginTop: 12 }}>Sign in via Browser ↗</button>}
                  </div>
                ) :
                loading && messages.length === 0 ? <Empty text="Loading…" /> :
                groups.length === 0 ? <Empty text="No messages." /> :
                groups.map((g) => {
                  const m = g.last;
                  const isSel = g.key === selectedThreadKey;
                  return (
                    <button key={g.key} onClick={() => openThread(g)} style={{ ...convoRow, ...(isSel ? convoRowActive : {}) }}>
                      <div style={{ ...avatarMd, background: `hsl(${hueOf(g.other)},45%,40%)` }}>{initial(g.other)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontWeight: 600, color: '#d7dadc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.other}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#818384', flexShrink: 0 }}>{fullStamp(m.created).slice(0, 16)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#9a9b9d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                          {(m.body || m.subject || '').replace(/\s+/g, ' ').slice(0, 80)}
                        </div>
                        <div style={{ fontSize: 11, color: '#5d5e60', marginTop: 2 }}>{g.items.length} message{g.items.length > 1 ? 's' : ''}</div>
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
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#5c5e60' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>✉</div>
                  <div style={{ fontSize: 13 }}>Select a conversation</div>
                </div>
              </div>
            ) : (
              <>
                <div style={threadHeader}>
                  <div style={{ ...avatarMd, background: `hsl(${hueOf(selected.other)},45%,40%)` }}>{initial(selected.other)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#d7dadc' }}>{selected.other}</div>
                    <div style={{ fontSize: 11, color: '#818384' }}>{selectedThread.length} message{selectedThread.length === 1 ? '' : 's'}</div>
                  </div>
                </div>

                <div style={threadBody}>
                  {selectedThread.map((m) => {
                    const fromMe = m.author === active?.username;
                    return (
                      <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: fromMe ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
                        <div style={{ fontSize: 11, color: '#818384', marginBottom: 4 }}>
                          <span className="mono">{fullStamp(m.created)}</span>
                          <span style={{ marginLeft: 6, color: '#d7dadc', fontWeight: 600 }}>{fromMe ? 'You' : m.author}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: fromMe ? 'row-reverse' : 'row', maxWidth: '80%' }}>
                          <div style={{ ...avatarSm, background: `hsl(${hueOf(fromMe ? active?.username : m.author)},45%,40%)` }}>
                            {initial(fromMe ? active?.username : m.author)}
                          </div>
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
                            background: 'rgba(255,255,255,0.06)', border: '1px solid #343536',
                            color: '#d7dadc', borderRadius: 8, padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                          }}
                        >📋 {templates.length}</button>
                      )}
                      {showTemplates && (
                        <div style={{
                          position: 'absolute', bottom: 'calc(100% + 6px)', right: 0,
                          width: 280, maxHeight: 260, overflowY: 'auto',
                          background: '#1a1a1b', border: '1px solid #343536',
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
                                color: '#d7dadc', padding: '8px 10px', borderRadius: 6,
                              }}
                            >
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
                              <div style={{ fontSize: 11, color: '#818384', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body.slice(0, 60)}{t.body.length > 60 ? '…' : ''}</div>
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

        {err && <div style={{ padding: 12, color: '#e2a3a3', fontSize: 12, borderTop: '1px solid #272729' }}>{err}</div>}
      </div>
    </div>
  );
}

function Empty({ text }) { return <div style={{ padding: 30, textAlign: 'center', color: '#818384', fontSize: 12 }}>{text}</div>; }

function AnalyticsTile({ label, value, tone }) {
  const colors = {
    red: '#e2a3a3', gold: '#d4a64a', blue: '#7aa2f7', green: '#7fd99a', purple: '#b89aff',
  };
  const fg = colors[tone] || '#d7dadc';
  return (
    <div style={{
      flex: 1, minWidth: 110,
      background: '#0c0c0d', border: '1px solid #1f1f21',
      borderRadius: 10, padding: '10px 14px',
    }}>
      <div style={{ fontSize: 10, color: '#818384', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: fg, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const shell = { background: '#0f0f10', border: '1px solid #272729', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 30px -10px rgba(0,0,0,0.6)' };
const topBar = { display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #272729', background: '#131314' };
const analyticsStrip = { display: 'flex', gap: 10, padding: '14px 18px', borderBottom: '1px solid #272729', background: '#101011' };
const threeCol = { display: 'grid', gridTemplateColumns: '220px 340px 1fr', height: 'calc(100vh - 260px)', minHeight: 620, overflow: 'hidden' };
const platformRow = { display: 'flex', gap: 6, padding: '10px 18px', borderBottom: '1px solid #272729', background: '#0f0f10', flexWrap: 'wrap' };
const accountsCol = { background: '#0c0c0d', borderRight: '1px solid #1f1f21', padding: '12px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };
const listCol = { display: 'flex', flexDirection: 'column', background: '#0f0f10', borderRight: '1px solid #1f1f21', minHeight: 0, overflow: 'hidden' };
const threadCol = { display: 'flex', flexDirection: 'column', background: '#0a0a0b', minWidth: 0, minHeight: 0, overflow: 'hidden' };

const accountRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#15151700', border: '1px solid transparent', textAlign: 'left', cursor: 'pointer', width: '100%' };
const accountRowActive = { background: '#1c2a45', border: '1px solid #2a4170' };
const avatarLg = { width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 };
const avatarMd = { width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 };
const avatarSm = { width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 11, flexShrink: 0 };
const badgeRed = { background: '#e85d3a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999 };
const badgeRedSm = { background: '#e85d3a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, alignSelf: 'center' };

const folderTabs = { display: 'flex', gap: 6, marginBottom: 10 };
const folderTab = { flex: 1, background: '#171718', border: '1px solid #2a2a2c', color: '#9a9b9d', padding: '7px 10px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 };
const folderTabActive = { background: '#1a3a6a', color: '#d7dadc', borderColor: '#2a4170' };
const miniBadge = { background: '#e85d3a', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, marginLeft: 2 };

const convoRow = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 10px', width: '100%', textAlign: 'left', background: 'transparent', border: '1px solid transparent', borderRadius: 10, cursor: 'pointer', marginBottom: 4 };
const convoRowActive = { background: '#1c2a45', border: '1px solid #2a4170' };

const threadHeader = { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #1f1f21' };
const threadBody = { flex: 1, overflowY: 'auto', padding: '20px 22px', background: 'radial-gradient(ellipse at top, rgba(255,255,255,0.02), transparent 60%)' };

const bubbleThem = { background: '#1f1f22', color: '#d7dadc', padding: '9px 14px', borderRadius: '14px 14px 14px 4px', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' };
const bubbleMe = { background: '#2563c9', color: '#fff', padding: '9px 14px', borderRadius: '14px 14px 4px 14px', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' };

const composer = { display: 'flex', gap: 8, padding: 14, borderTop: '1px solid #1f1f21', alignItems: 'flex-end' };
const composerInput = { flex: 1, minHeight: 42, maxHeight: 140, background: '#0f0f10', border: '1px solid #2a2a2c', borderRadius: 18, color: '#d7dadc', padding: '11px 16px', fontSize: 13, resize: 'none', fontFamily: 'inherit' };
const sendBtn = { background: '#2563c9', border: 'none', color: '#fff', width: 42, height: 42, borderRadius: '50%', cursor: 'pointer', fontSize: 16, flexShrink: 0 };
const primaryBtn = { background: '#2563c9', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 18px', borderRadius: 999, cursor: 'pointer' };
