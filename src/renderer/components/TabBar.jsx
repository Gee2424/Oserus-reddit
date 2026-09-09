import React from 'react';

export default function TabBar({ items, activeKey, onChange, variant = 'underline', style }) {
  if (variant === 'pill') {
    return (
      <div style={{ display: 'flex', gap: 6, ...style }}>
        {items.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            title={t.hint}
            style={{
              background: activeKey === t.key ? 'var(--gold-soft)' : 'transparent',
              borderWidth: 1, borderStyle: 'solid',
              borderColor: activeKey === t.key ? 'var(--gold)' : 'var(--border)',
              color: activeKey === t.key ? 'var(--gold-bright)' : 'var(--text-2)',
              padding: '6px 14px', borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t.label}{t.badge}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', ...style }}>
      {items.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          title={t.hint}
          style={{
            background: 'transparent', border: 'none',
            borderBottomWidth: 2, borderBottomStyle: 'solid',
            borderBottomColor: activeKey === t.key ? 'var(--gold)' : 'transparent',
            color: activeKey === t.key ? 'var(--gold-bright)' : 'var(--text-2)',
            padding: '10px 16px', fontSize: 'var(--text-body)', fontWeight: activeKey === t.key ? 600 : 400,
            cursor: 'pointer', marginBottom: -1,
          }}
        >
          {t.label}{t.badge}
        </button>
      ))}
    </div>
  );
}
