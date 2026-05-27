import React, { useState } from 'react';
import SchedulerPage from './Scheduler.jsx';
import AccountsPage from './Accounts.jsx';
import InboxPage from './Inbox.jsx';

const TABS = [
  { key: 'posting', label: 'Posting', icon: '◷', hint: 'Scheduled posts' },
  { key: 'reddit', label: 'Reddit', icon: '◈', hint: 'Connected accounts' },
  { key: 'inbox', label: 'Inbox', icon: '✉', hint: 'DMs & modmail' },
];

export default function RedditApiPage({ initialTab, navigate }) {
  const [tab, setTab] = useState(
    TABS.find((t) => t.key === initialTab) ? initialTab : 'posting'
  );

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Reddit API</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Posting, accounts, and inbox in one workspace. OAuth tokens are
            shared across all three — connect once per account, use everywhere.
          </div>
        </div>
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
      {tab === 'inbox' && <InboxPage embedded />}
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
