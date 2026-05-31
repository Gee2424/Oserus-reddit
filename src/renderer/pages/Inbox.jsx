import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';

const FOLDERS = [
  { key: 'all', label: 'Inbox', icon: '✉' },
  { key: 'unread', label: 'Requests', icon: '✦' },
  { key: 'sent', label: 'Hidden', icon: '◐' },
];

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
  const { active, accounts: redditAccounts, setActive } = forPlatform('reddit');

  const [folder, setFolder] = useState('all');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [unreadByAccount, setUnreadByAccount] = useState({}); // { [accountId]: count }
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    window.api.messaging.templatesList({ token, profileId: active?.profile_id }).then((r) => {
      if (r.ok) setTemplates(r.templates || []);
    });
  }, [token, active?.profile_id]);

  useEffect(() => {
    if (!active && redditAccounts && redditAccounts.length > 0) setActive(redditAccounts[0].id);
  }, [active, redditAccounts]);

  const load = useCallback(async () => {
    if (!active) { setMessages([]); return; }
    setLoading(true); setErr(null); setNotLoggedIn(false);
    await window.api.session.prepareForAccount({ accountId: active.id });
    const res = await window.api.inbox.fetch({ token, accountId: active.id, folder });
    setLoading(false);
    if (res.ok) {
      setMessages(res.messages || []);
      const u = (res.messages || []).filter((m) => m.isNew).length;
      setUnreadByAccount((prev) => ({ ...prev, [active.id]: u }));
    } else if (res.notLoggedIn) { setNotLoggedIn(true); setMessages([]); }
    else setErr(res.error);
  }, [active?.id, folder, token]);

  useEffect(() => { load(); setSelectedId(null); }, [load]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load, active]);

  // Background-fetch unread counts for the OTHER accounts so the left rail
  // can show badges like Infloww. Light cadence to avoid hammering Reddit.
  useEffect(() => {
    if (!redditAccounts || redditAccounts.length <= 1) return;
    let cancelled = false;
    (async () => {
      for (const a of redditAccounts) {
        if (cancelled || a.id === active?.id) continue;
        await window.api.session.prepareForAccount({ accountId: a.id });
        const r = await window.api.inbox.fetch({ token, accountId: a.id, folder: 'unread' });
        if (cancelled) return;
        if (r.ok) setUnreadByAccount((prev) => ({ ...prev, [a.id]: (r.messages || []).length }));
      }
    })();
    return () => { cancelled = true; };
  }, [redditAccounts, active?.id, token]);

  const selected = messages.find((m) => m.id === selectedId) || null;

  async function openMessage(m) {
    setSelectedId(m.id);
    setReplyText('');
    if (m.isNew) {
      await window.api.inbox.markRead({ token, accountId: active.id, fullname: m.name });
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isNew: false } : x)));
      setUnreadByAccount((prev) => ({ ...prev, [active.id]: Math.max(0, (prev[active.id] || 1) - 1) }));
    }
  }

  async function sendReply() {
    if (!replyText.trim() || !selected) return;
    setSending(true); setErr(null);
    const res = await window.api.inbox.reply({ token, accountId: active.id, parentFullname: selected.name, text: replyText.trim() });
    setSending(false);
    if (res.ok) { setReplyText(''); load(); }
    else setErr(res.error);
  }
  async function popOut() {
    await window.api.windows.openPopout({ route: 'inbox', title: 'Inbox Manager', width: 1180, height: 760 });
  }

  // Build a synthetic conversation grouping: by counterparty username so the
  // middle column reads like a messenger thread list, not a flat mail list.
  const groups = (() => {
    const byOther = new Map();
    for (const m of messages) {
      const other = folder === 'sent' ? m.dest : (m.author || m.dest || 'reddit');
      const k = other || '_';
      const cur = byOther.get(k) || { other: k, items: [], unread: 0, lastTs: 0, last: m };
      cur.items.push(m);
      if (m.isNew) cur.unread++;
      if ((m.created || 0) > cur.lastTs) { cur.lastTs = m.created; cur.last = m; }
      byOther.set(k, cur);
    }
    return [...byOther.values()].sort((a, b) => b.lastTs - a.lastTs);
  })();

  return (
    <div>
      {!embedded && <div className="title-block"><div><div className="eyebrow">Messages</div><h1>Inbox Manager</h1></div></div>}

      <div style={shell}>
        {/* Top action bar */}
        <div style={topBar}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Inbox Manager</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={load} disabled={loading}>↻ Refresh Account</button>
            <button className="ghost" onClick={async () => {
              for (const a of redditAccounts) {
                await window.api.session.prepareForAccount({ accountId: a.id });
                const r = await window.api.inbox.fetch({ token, accountId: a.id, folder: 'unread' });
                if (r.ok) setUnreadByAccount((p) => ({ ...p, [a.id]: (r.messages || []).length }));
              }
            }}>↻ Refresh All Accounts</button>
            {!standalone && <button className="ghost" onClick={popOut}>⧉ Pop out</button>}
          </div>
        </div>

        {/* Three columns */}
        <div style={threeCol}>
          {/* Column 1: accounts */}
          <div style={accountsCol}>
            {redditAccounts && redditAccounts.length ? redditAccounts.map((a) => {
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
            }) : <Empty text="No Reddit accounts." />}
          </div>

          {/* Column 2: conversation list + folder tabs */}
          <div style={listCol}>
            <div style={{ padding: '12px 12px 0 12px' }}>
              <div style={{ background: '#0f0f10', border: '1px solid #2a2a2c', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#818384', marginBottom: 6 }}>Account: <span style={{ color: '#d7dadc', fontWeight: 600 }}>{active ? `u/${active.username}` : '—'}</span></div>
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
                    <button key={f.key} onClick={() => { setFolder(f.key); setSelectedId(null); }} style={{ ...folderTab, ...(isActive ? folderTabActive : {}) }}>
                      <span>{f.icon}</span> {f.label}
                      {count > 0 && <span style={miniBadge}>{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 10px 8px' }}>
              {!active ? <Empty text="No Reddit account selected." /> :
                notLoggedIn ? (
                  <div style={{ padding: 18, textAlign: 'center' }}>
                    <div style={{ color: '#818384', fontSize: 13, lineHeight: 1.6 }}>u/{active.username} isn't logged into Reddit yet.</div>
                    {navigate && <button onClick={() => { setActive(active.id); navigate('reddit'); }} style={{ ...primaryBtn, marginTop: 12 }}>Sign in via Browser ↗</button>}
                  </div>
                ) :
                loading && messages.length === 0 ? <Empty text="Loading…" /> :
                groups.length === 0 ? <Empty text="No messages." /> :
                groups.map((g) => {
                  const m = g.last;
                  const isSel = m.id === selectedId;
                  return (
                    <button key={g.other + m.id} onClick={() => openMessage(m)} style={{ ...convoRow, ...(isSel ? convoRowActive : {}) }}>
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
                  <div style={{ ...avatarMd, background: `hsl(${hueOf(selected.author || selected.dest)},45%,40%)` }}>{initial(selected.author || selected.dest)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#d7dadc' }}>{folder === 'sent' ? selected.dest : selected.author}</div>
                    <div style={{ fontSize: 11, color: '#818384' }}>{messages.filter((m) => (m.author || m.dest) === (selected.author || selected.dest)).length} messages</div>
                  </div>
                </div>

                <div style={threadBody}>
                  {messages
                    .filter((m) => (folder === 'sent' ? m.dest : (m.author || m.dest)) === (folder === 'sent' ? selected.dest : (selected.author || selected.dest)))
                    .sort((a, b) => (a.created || 0) - (b.created || 0))
                    .map((m) => {
                      const fromMe = folder === 'sent' || (m.dest && m.dest === active?.username);
                      return (
                        <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: fromMe ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
                          <div style={{ fontSize: 11, color: '#818384', marginBottom: 4 }}>
                            <span className="mono">{fullStamp(m.created)}</span>
                            {fromMe && <span style={{ marginLeft: 6, color: '#d7dadc', fontWeight: 600 }}>You</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: fromMe ? 'row-reverse' : 'row', maxWidth: '80%' }}>
                            <div style={{ ...avatarSm, background: `hsl(${hueOf(fromMe ? active?.username : (m.author || m.dest))},45%,40%)` }}>
                              {initial(fromMe ? active?.username : (m.author || m.dest))}
                            </div>
                            <div style={fromMe ? bubbleMe : bubbleThem}>{m.body}</div>
                          </div>
                        </div>
                      );
                    })}
                </div>

                {folder !== 'sent' && (
                  <div style={composer}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={`Reply as u/${active.username}…`}
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

const shell = { background: '#0f0f10', border: '1px solid #272729', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 30px -10px rgba(0,0,0,0.6)' };
const topBar = { display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #272729', background: '#131314' };
const threeCol = { display: 'grid', gridTemplateColumns: '220px 340px 1fr', height: '70vh', minHeight: 520 };
const accountsCol = { background: '#0c0c0d', borderRight: '1px solid #1f1f21', padding: '12px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 };
const listCol = { display: 'flex', flexDirection: 'column', background: '#0f0f10', borderRight: '1px solid #1f1f21' };
const threadCol = { display: 'flex', flexDirection: 'column', background: '#0a0a0b', minWidth: 0 };

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
