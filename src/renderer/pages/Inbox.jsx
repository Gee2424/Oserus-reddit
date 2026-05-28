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
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export default function InboxPage({ embedded }) {
  const { token } = useAuth();
  const { forPlatform } = useActiveAccount();
  const { active, accounts: redditAccounts, setActive } = forPlatform('reddit');

  const [folder, setFolder] = useState('all');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // Auto-pick the first reddit account so the page is never empty.
  useEffect(() => {
    if (!active && redditAccounts && redditAccounts.length > 0) setActive(redditAccounts[0].id);
  }, [active, redditAccounts]);

  const load = useCallback(async () => {
    if (!active) { setMessages([]); return; }
    setLoading(true); setErr(null); setNotLoggedIn(false);
    // Ensure proxy + UA are applied to this account's session first.
    await window.api.session.prepareForAccount({ accountId: active.id });
    const res = await window.api.inbox.fetch({ token, accountId: active.id, folder });
    setLoading(false);
    if (res.ok) { setMessages(res.messages || []); }
    else if (res.notLoggedIn) { setNotLoggedIn(true); setMessages([]); }
    else setErr(res.error);
  }, [active?.id, folder, token]);

  useEffect(() => { load(); setOpenId(null); }, [load]);

  const unreadCount = messages.filter((m) => m.isNew).length;

  async function openMessage(m) {
    if (openId === m.id) { setOpenId(null); return; }
    setOpenId(m.id);
    setReplyText('');
    if (m.isNew) {
      await window.api.inbox.markRead({ token, accountId: active.id, fullname: m.name });
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isNew: false } : x)));
    }
  }

  async function sendReply(m) {
    if (!replyText.trim()) return;
    setSending(true); setErr(null);
    const res = await window.api.inbox.reply({
      token, accountId: active.id, parentFullname: m.name, text: replyText.trim(),
    });
    setSending(false);
    if (res.ok) { setReplyText(''); setOpenId(null); load(); }
    else setErr(res.error);
  }

  return (
    <div>
      {!embedded && (
        <div className="title-block">
          <div>
            <div className="eyebrow">Messages</div>
            <h1>Inbox</h1>
          </div>
        </div>
      )}

      {/* Reddit-styled inbox card */}
      <div style={shell}>
        {/* Reddit header bar */}
        <div style={header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Snoo />
            <span style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>Reddit Inbox</span>
            {active && (
              <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
                u/{active.username}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AccountSwitcher platform="reddit" />
            <button onClick={load} disabled={loading} style={refreshBtn}>
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>

        {/* Folder tabs */}
        <div style={folderBar}>
          {FOLDERS.map((f) => {
            const isActive = folder === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFolder(f.key)}
                style={{ ...folderTab, ...(isActive ? folderTabActive : {}) }}
              >
                {f.label}
                {f.key === 'unread' && unreadCount > 0 && (
                  <span style={unreadBadge}>{unreadCount}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={body}>
          {!active ? (
            <Empty text="No Reddit account selected. Add one under Reddit → Accounts." />
          ) : notLoggedIn ? (
            <Empty
              text={`u/${active.username} isn't logged into Reddit yet. Open this account in the Browser tab and sign in once — the inbox will read from that session.`}
            />
          ) : err ? (
            <div style={{ padding: 24, color: '#ff8a8a', fontSize: 13 }}>{err}</div>
          ) : loading && messages.length === 0 ? (
            <Empty text="Loading messages…" />
          ) : messages.length === 0 ? (
            <Empty text={folder === 'unread' ? 'No unread messages. Inbox zero.' : 'No messages here.'} />
          ) : (
            messages.map((m) => (
              <div key={m.id}>
                <div
                  onClick={() => openMessage(m)}
                  style={{ ...msgRow, ...(m.isNew ? msgRowUnread : {}) }}
                >
                  {m.isNew && <span style={unreadDot} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontWeight: m.isNew ? 700 : 600, color: '#d7dadc', fontSize: 13 }}>
                        {m.subject || '(no subject)'}
                      </span>
                      {m.subreddit && <span style={subredditPill}>r/{m.subreddit}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                      <span style={{ color: ORANGE, fontSize: 12, fontWeight: 500 }}>
                        {folder === 'sent' ? `to u/${m.dest}` : `u/${m.author || m.dest || 'reddit'}`}
                      </span>
                      <span style={{ color: '#818384', fontSize: 12 }}>· {timeAgo(m.created)}</span>
                    </div>
                    {openId !== m.id && (
                      <div style={preview}>{m.body?.replace(/\s+/g, ' ').slice(0, 140)}</div>
                    )}
                  </div>
                </div>

                {openId === m.id && (
                  <div style={expanded}>
                    <div style={msgBody}>{m.body}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                      {m.permalink && (
                        <span style={{ color: '#818384', fontSize: 11 }}>
                          {m.wasComment ? 'Comment reply' : 'Direct message'}
                          {m.linkTitle ? ` · ${m.linkTitle}` : ''}
                        </span>
                      )}
                    </div>
                    {folder !== 'sent' && (
                      <div style={{ marginTop: 10 }}>
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder={`Reply as u/${active.username}…`}
                          style={replyBox}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button
                            onClick={() => sendReply(m)}
                            disabled={sending || !replyText.trim()}
                            style={replyBtn}
                          >
                            {sending ? 'Sending…' : 'Reply'}
                          </button>
                          <button onClick={() => setOpenId(null)} className="ghost">Close</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: 40, textAlign: 'center', color: '#818384', fontSize: 13, lineHeight: 1.6 }}>{text}</div>;
}

function Snoo() {
  return (
    <span style={{
      width: 24, height: 24, borderRadius: '50%', background: ORANGE,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, flexShrink: 0,
    }}>
      <span style={{ color: '#fff', fontWeight: 700 }}>✉</span>
    </span>
  );
}

const shell = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  background: '#1a1a1b',
};
const header = {
  background: ORANGE,
  padding: '10px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const refreshBtn = {
  background: 'rgba(255,255,255,0.2)',
  border: 'none',
  color: '#fff',
  width: 30, height: 30,
  borderRadius: '50%',
  cursor: 'pointer',
  fontSize: 15,
};
const folderBar = {
  display: 'flex',
  gap: 2,
  padding: '0 10px',
  background: '#272729',
  borderBottom: '1px solid #343536',
};
const folderTab = {
  background: 'transparent',
  border: 'none',
  color: '#818384',
  padding: '12px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  borderBottom: '3px solid transparent',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const folderTabActive = {
  color: '#d7dadc',
  borderBottomColor: ORANGE,
};
const unreadBadge = {
  background: ORANGE,
  color: '#fff',
  fontSize: 10,
  fontWeight: 700,
  borderRadius: 999,
  padding: '1px 6px',
  minWidth: 16,
  textAlign: 'center',
};
const body = { maxHeight: '62vh', overflowY: 'auto', background: '#1a1a1b' };
const msgRow = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '12px 16px',
  borderBottom: '1px solid #272729',
  cursor: 'pointer',
};
const msgRowUnread = { background: 'rgba(255,69,0,0.06)' };
const unreadDot = {
  width: 8, height: 8, borderRadius: '50%', background: ORANGE,
  marginTop: 6, flexShrink: 0,
};
const subredditPill = {
  fontSize: 11, color: '#818384', fontWeight: 500,
};
const preview = {
  color: '#818384', fontSize: 12, marginTop: 4,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const expanded = {
  padding: '14px 16px 18px 16px',
  background: '#131314',
  borderBottom: '1px solid #272729',
};
const msgBody = {
  color: '#d7dadc', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
};
const replyBox = {
  width: '100%',
  minHeight: 72,
  background: '#1a1a1b',
  border: '1px solid #343536',
  borderRadius: 8,
  color: '#d7dadc',
  padding: '10px 12px',
  fontSize: 13,
  resize: 'vertical',
  fontFamily: 'inherit',
};
const replyBtn = {
  background: ORANGE,
  border: 'none',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  padding: '8px 20px',
  borderRadius: 999,
  cursor: 'pointer',
};
