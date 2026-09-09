import React from 'react';

export default function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <div className="title-block" style={{ ...(children ? { marginBottom: 22 } : {}) }}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {title && <h1>{title}</h1>}
        {subtitle && <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {children && <div style={{ marginLeft: 'auto', flexShrink: 0, alignSelf: 'center' }}>{children}</div>}
    </div>
  );
}
