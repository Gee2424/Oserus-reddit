import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import AccountSwitcher from '../components/AccountSwitcher.jsx';

const FOLDERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'messages', label: 'Messages' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'sent', label: 'Sent' },
];

const ORANGE = '#ff4500';

function timeAgo(unixSec) {
  if (!unixSec) return '';
  const s = Math.floor(Date.now() / 1000 - unixSec);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}
function fullTime(unixSec) {
  if (!unixSec) return '';
  try { return new Date(unixSec * 1000).toLocaleString(); } catch { return ''; }
}
function initial(name) {
  return (name || '?').replace(/^u\//, '').charAt(0).toUpperCase();
}
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 45%, 42%)`;
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
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!active && redditAccounts && redditAccounts.length > 0) setActive(redditAccounts[0].id);
  }, [active, redditAccounts]);

  const load = useCallback(async () => {
    if (!active) { setMessages([]); return; }
    setLoading(true); setErr(null); setNotLoggedIn(false);
    await window.api.session.prepareForAccount({ accountId: active.id });
    const res = await window.api.inbox.fetch({ token, accountId: active.id, folder });
    setLoading(false);
    if (res.ok) setMessages(res.messages || []);
    else if (res.notLoggedIn) { setNotLoggedIn(true); setMessages([]); }
    else setErr(res.error);
  }, [active?.id, folder, token]);

  useEffect(() => { load(); setSelectedId(null); }, [load]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load, active]);

  const unreadCount = messages.filter((m) => m.isNew).length;
  const filtered = search.trim()
    ? messages.filter((m) => `${m.subject} ${m.body} ${m.author} ${m.subreddit}`.toLowerCase().includes(search.toLowerCase()))
    : messages;
  const selected = messages.find((m) => m.id === selectedId) || null;

  async function openMessage(m) {
    setSelectedId(m.id);
    setReplyText('');
    if (m.isNew) {
      await window.api.inbox.markRead({ token, accountId: active.id, fullname: m.name });
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isNew: false } : x)));
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
    await window.api.windows.openPopout({ route: 'inbox', title: 'Inbox — Oserus', width: 900, height: 720 });
  }

  // ---- list pane ----
  const listPane = (
    <div style={{ ...listCol, ...(standalone && selected ? { display: 'none' } : {}) }}>
      <div style={searchWrap}>
        <input
          placeholder="Search messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchInput}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!active ? (
          <Empty text="No Reddit account selected." />
        ) : notLoggedIn ? (
          <div style={{ padding: 26, textAlign: 'center' }}>
            <div style={{ color: '#818384', fontSize: 13, lineHeight: 1.6 }}>
              u/{active.username} isn't logged into Reddit yet.
            </div>
            {navigate && (
              <button onClick={() => { setActive(active.id); navigate('reddit'); }} style={{ ...primaryBtn, marginTop: 14 }}>
                Sign in via Browser ↗
              </button>
            )}
          </div>
        ) : loading && messages.length === 0 ? (
          <Empty text="Loading…" />
        ) : filtered.length === 0 ? (
          <Empty text={folder === 'unread' ? 'Inbox zero ✓' : 'No messages.'} />
        ) : (
          filtered.map((m) => {
            const who = folder === 'sent' ? m.dest : m.author || m.dest;
            const isSel = m.id === selectedId;
            return (
              <button key={m.id} onClick={() => openMessage(m)} style={{ ...listItem, ...(isSel ? listItemActive : {}) }}>
                <div style={{ ...avatar, background: avatarColor(who) }}>{initial(who)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontWeight: m.isNew ? 700 : 500, fontSize: 13, color: '#d7dadc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {who ? `u/${who}` : '(reddit)'}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#818384', flexShrink: 0 }}>{timeAgo(m.created)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: m.isNew ? '#d7dadc' : '#b8babd', fontWeight: m.isNew ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                    {m.subject || '(no subject)'}
                  </div>
                  <div style={{ fontSize: 12, color: '#818384', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                    {(m.body || '').replace(/\s+/g, ' ').slice(0, 80)}
                  </div>
                </div>
                {m.isNew && <span style={unreadDot} />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  // ---- thread / detail pane ----
  const detailPane = (
    <div style={{ ...detailCol, ...(standalone && !selected ? { display: 'none' } : {}) }}>
      {!selected ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <div style={{ textAlign: 'center', color: '#5c5e60' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✉</div>
            <div style={{ fontSize: 13 }}>Select a message to read</div>
          </div>
        </div>
      ) : (
        <>
          <div style={threadHeader}>
            {standalone && (
              <button onClick={() => setSelectedId(null)} style={backBtn}>←</button>
            )}
            <div style={{ ...avatar, background: avatarColor(selected.author || selected.dest), width: 36, height: 36 }}>
              {initial(selected.author || selected.dest)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#d7dadc' }}>
                {folder === 'sent' ? `to u/${selected.dest}` : `u/${selected.author || selected.dest || 'reddit'}`}
              </div>
              <div style={{ fontSize: 11, color: '#818384' }}>
                {selected.subreddit ? `r/${selected.subreddit} · ` : ''}{fullTime(selected.created)}
              </div>
            </div>
          </div>

          <div style={threadBody}>
            <div style={subjectLine}>{selected.subject || '(no subject)'}</div>
            <div style={msgBubble}>{selected.body}</div>
            {selected.linkTitle && (
              <div style={{ fontSize: 11, color: '#818384', marginTop: 10 }}>
                {selected.wasComment ? 'Comment reply on:' : 'Re:'} {selected.linkTitle}
              </div>
            )}
          </div>

          {folder !== 'sent' && (
            <div style={composer}>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply as u/${active.username}…`}
                style={composerInput}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); }}
              />
              <button onClick={sendReply} disabled={sending || !replyText.trim()} style={sendBtn}>
                {sending ? '…' : '➤'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div style={embedded ? {} : undefined}>
      {!embedded && (
        <div className="title-block">
          <div>
            <div className="eyebrow">Messages</div>
            <h1>Inbox</h1>
          </div>
        </div>
      )}

      <div style={shell}>
        {/* header */}
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={snoo}>✉</span>
            <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>Inbox</span>
            {active && <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>u/{active.username}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AccountSwitcher platform="reddit" />
            <button onClick={load} disabled={loading} style={iconBtn} title="Refresh">{loading ? '…' : '↻'}</button>
            {!standalone && (
              <button onClick={popOut} style={iconBtn} title="Pop out into its own window">⧉</button>
            )}
          </div>
        </div>

        {/* folders */}
        <div style={folderBar}>
          {FOLDERS.map((f) => {
            const isActive = folder === f.key;
            return (
              <button key={f.key} onClick={() => { setFolder(f.key); setSelectedId(null); }} style={{ ...folderTab, ...(isActive ? folderTabActive : {}) }}>
                {f.label}
                {f.key === 'unread' && unreadCount > 0 && <span style={badge}>{unreadCount}</span>}
              </button>
            );
          })}
        </div>

        {err && <div style={{ background: 'rgba(180,90,90,0.15)', color: '#e2a3a3', padding: '8px 14px', fontSize: 12 }}>{err}</div>}

        {/* two-pane body */}
        <div style={{ ...body, height: standalone ? 'calc(100vh - 180px)' : body.height }}>
          {listPane}
          {detailPane}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: 40, textAlign: 'center', color: '#818384', fontSize: 13 }}>{text}</div>;
}

const shell = { border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#1a1a1b', display: 'flex', flexDirection: 'column' };
const header = { background: ORANGE, padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 };
const snoo = { width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'inline-grid', placeItems: 'center', fontSize: 12, color: '#fff' };
const iconBtn = { background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 14, flexShrink: 0 };
const folderBar = { display: 'flex', gap: 2, padding: '0 8px', background: '#272729', borderBottom: '1px solid #343536' };
const folderTab = { background: 'transparent', border: 'none', color: '#818384', padding: '10px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', borderBottom: '3px solid transparent', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6 };
const folderTabActive = { color: '#d7dadc', borderBottomColor: ORANGE };
const badge = { background: ORANGE, color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '1px 6px', minWidth: 16, textAlign: 'center' };
const body = { display: 'flex', height: '60vh', minHeight: 420 };
const listCol = { width: 300, flexShrink: 0, borderRight: '1px solid #272729', display: 'flex', flexDirection: 'column', background: '#161617' };
const detailCol = { flex: 1, display: 'flex', flexDirection: 'column', background: '#1a1a1b', minWidth: 0 };
const searchWrap = { padding: 8, borderBottom: '1px solid #272729' };
const searchInput = { width: '100%', background: '#0f0f10', border: '1px solid #343536', borderRadius: 8, color: '#d7dadc', padding: '7px 11px', fontSize: 12.5 };
const listItem = { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid #222223', cursor: 'pointer' };
const listItemActive = { background: 'rgba(255,69,0,0.10)' };
const avatar = { width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 };
const unreadDot = { width: 9, height: 9, borderRadius: '50%', background: ORANGE, flexShrink: 0, alignSelf: 'center' };
const threadHeader = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #272729' };
const backBtn = { background: '#272729', border: 'none', color: '#d7dadc', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 16, flexShrink: 0 };
const threadBody = { flex: 1, overflowY: 'auto', padding: '16px 18px' };
const subjectLine = { fontSize: 15, fontWeight: 700, color: '#d7dadc', marginBottom: 12 };
const msgBubble = { background: '#222223', borderRadius: 12, padding: '12px 14px', color: '#d7dadc', fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' };
const composer = { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #272729', alignItems: 'flex-end' };
const composerInput = { flex: 1, minHeight: 42, maxHeight: 140, background: '#0f0f10', border: '1px solid #343536', borderRadius: 20, color: '#d7dadc', padding: '11px 16px', fontSize: 13, resize: 'none', fontFamily: 'inherit' };
const sendBtn = { background: ORANGE, border: 'none', color: '#fff', width: 42, height: 42, borderRadius: '50%', cursor: 'pointer', fontSize: 16, flexShrink: 0 };
const primaryBtn = { background: ORANGE, border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 18px', borderRadius: 999, cursor: 'pointer' };
