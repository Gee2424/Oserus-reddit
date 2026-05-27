import React, { useState } from 'react';
import { useCan } from '../lib/permissions.jsx';
import UsersPage from './Users.jsx';
import RolesPage from './Roles.jsx';

export default function TeamPage() {
  const can = useCan();
  const showRoles = can('roles.manage');
  const [tab, setTab] = useState('members');

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Manage</div>
          <h1>Team</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Team members and the roles that control what they can see and do.
          </div>
        </div>
      </div>

      {showRoles && (
        <div style={tabBar}>
          {[
            { key: 'members', label: 'Members' },
            { key: 'roles', label: 'Roles & permissions' },
          ].map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{ ...tabBtn, ...(active ? tabBtnActive : {}) }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {tab === 'members' && <UsersPage embedded />}
      {tab === 'roles' && showRoles && <RolesPage />}
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
};
const tabBtnActive = {
  color: 'var(--gold-bright)',
  borderBottomColor: 'var(--gold)',
};
