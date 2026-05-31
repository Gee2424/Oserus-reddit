import React, { useState } from 'react';
import SchedulerPage from './Scheduler.jsx';
import AccountsPage from './Accounts.jsx';
import InboxPage from './Inbox.jsx';

const TABS = [
  { key: 'posting', label: 'Posting', icon: '◷', hint: 'Scheduled posts' },
  { key: 'reddit', label: 'Reddit', icon: '◈', hint: 'Connected accounts' },
  { key: 'inbox', label: 'Inbox', icon: '✉', hint: 'DMs & modmail' },
];

const PLATFORM_PILLS = [
  { v: 'reddit',    label: 'Reddit',    color: '#ff4500', live: true  },
  { v: 'redgifs',   label: 'RedGIFs',   color: '#ff2e74', live: true  },
  { v: 'x',         label: 'X',         color: '#1d9bf0', live: false },
  { v: 'instagram', label: 'Instagram', color: '#e1306c', live: false },
  { v: 'tiktok',    label: 'TikTok',    color: '#25f4ee', live: false },
];

export default function RedditApiPage({ initialTab, navigate }) {
  const [tab, setTab] = useState(
    TABS.find((t) => t.key === initialTab) ? initialTab : 'posting'
  );
  const [platform, setPlatform] = useState('reddit');

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Account Manager Pro</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Posting, accounts, and inbox in one workspace — across every
            platform. Sessions and tokens stay per-account.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {PLATFORM_PILLS.map((p) => {
          const active = platform === p.v;
          return (
            <button
              key={p.v}
              onClick={() => p.live && setPlatform(p.v)}
              disabled={!p.live}
              title={p.live ? p.label : `${p.label} — adapter coming soon`}
              style={{
                background: active ? p.color : 'var(--bg-1)',
                color: active ? '#fff' : (p.live ? 'var(--text-1)' : 'var(--text-3)'),
                border: `1px solid ${active ? p.color : 'var(--border)'}`,
                borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 600,
                cursor: p.live ? 'pointer' : 'not-allowed', opacity: p.live ? 1 : 0.55,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color }} />
              {p.label}
              {!p.live && <span style={{ fontSize: 9, opacity: 0.8 }}>soon</span>}
            </button>
          );
        })}
      </div>

      <div style={tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ ...tabBtn, ...(active ? tabBtnActive : {}) }}
            >
              <span style={{ marginRight: 8, fontFamily: 'var(--font-mono)' }}>{t.icon}</span>
              {t.label}
              <span className="dim" style={{ marginLeft: 8, fontSize: 11, fontWeight: 400 }}>
                {t.hint}
              </span>
            </button>
          );
        })}
      </div>

      {tab === 'posting' && <SchedulerPage embedded />}
      {tab === 'reddit' && <AccountsPage navigate={navigate} embedded />}
      {tab === 'inbox' && <InboxPage embedded navigate={navigate} />}
    </div>
  );
}

const tabBar = {
  display: 'flex',
  gap: 4,
  marginBottom: 22,
  borderBottom: '1px solid var(--border)',
};
const tabBtn = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-2)',
  padding: '12px 18px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  marginBottom: -1,
  display: 'flex',
  alignItems: 'center',
};
const tabBtnActive = {
  color: 'var(--gold-bright)',
  borderBottomColor: 'var(--gold)',
};
