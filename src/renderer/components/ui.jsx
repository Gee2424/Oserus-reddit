// Shared UI primitives — the bits I kept copy-pasting across pages.
// Importing these from one place keeps style/tone consistent and shrinks
// every page that uses them.
//
// Feedback conventions (use these consistently — no more raw alert()):
//   • transient action result ("Saved", "Launch failed")  → useToast().toast(kind, msg)
//   • form / field validation                             → <Field error="…"> or <Banner kind="err">
//   • destructive confirmation                            → useConfirm().confirm(msg, {variant:'danger'})
//   • grouped / advanced settings                         → <Section title="Advanced">

import React, { useEffect, useId, useRef, useState } from 'react';

/* ------------------------------- Banner --------------------------------- */
// Drop-in for the auto-dismissing "ok"/"err"/"info" strips at the top of
// pages. Pages still own their own state; this just renders.

const banners = {
  ok:   { bg: 'rgba(122,154,90,0.12)', border: 'var(--ok)',          fg: 'var(--success-fg)' },
  err:  { bg: 'rgba(180,90,90,0.12)',  border: 'var(--danger)',      fg: 'var(--danger-fg)' },
  info: { bg: 'rgba(58,111,140,0.10)', border: 'var(--blue)',        fg: 'var(--blue-bright)' },
  warn: { bg: 'rgba(212,166,74,0.10)', border: 'var(--gold)',        fg: 'var(--gold-bright)' },
};
export function Banner({ kind = 'info', children, style }) {
  const s = banners[kind] || banners.info;
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.fg,
      padding: '10px 14px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-body)',
      marginBottom: 14, ...style,
    }}>{children}</div>
  );
}

/* ------------------------------ Avatar ---------------------------------- */
export function hueOf(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
export function initial(name) {
  return (name || '?').replace(/^u\//, '').replace(/^r\//i, '').charAt(0).toUpperCase();
}
export function Avatar({ name, size = 30, fontSize }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700,
      fontSize: fontSize || Math.round(size * 0.42),
      background: `hsl(${hueOf(name)},45%,40%)`,
    }}>{initial(name)}</div>
  );
}

/* -------------------------------- Tag ----------------------------------- */
// Small bordered chip — used for class names, kinds, free-form labels.
export function Tag({ children, tone = 'neutral', hue, style }) {
  const tones = {
    neutral: { fg: 'var(--text-1)',     bd: 'var(--border-strong)', bg: 'var(--bg-2)' },
    gold:    { fg: 'var(--gold-bright)',bd: 'var(--gold)',           bg: 'var(--gold-soft)' },
    green:   { fg: 'var(--green-bright)',bd: 'var(--green)',         bg: 'var(--green-soft)' },
    blue:    { fg: 'var(--blue-bright)',bd: 'var(--blue)',           bg: 'var(--blue-soft)' },
    pink:    { fg: '#d9a3d9',           bd: '#7a4a7a',               bg: 'rgba(150,90,150,0.12)' },
    danger:  { fg: 'var(--danger-fg)',   bd: 'var(--danger)',         bg: 'rgba(180,90,90,0.12)' },
  }[tone] || { fg: 'var(--text-1)', bd: 'var(--border-strong)', bg: 'var(--bg-2)' };
  const hueStyle = hue != null ? { background: `hsl(${hue}, 40%, 50%, 0.18)`, color: `hsl(${hue}, 60%, 70%)`, borderColor: `hsl(${hue}, 40%, 50%, 0.3)` } : {};
  return (
    <span style={{
      display: 'inline-block', fontSize: 'var(--text-xs)', fontWeight: 600,
      padding: '2px 8px', borderRadius: 'var(--radius-pill)',
      border: `1px solid ${tones.bd}`, color: tones.fg, background: tones.bg,
      fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', textTransform: 'uppercase',
      ...hueStyle,
      ...style,
    }}>{children}</span>
  );
}

/* ---------------------------- Status pill ------------------------------- */
// Pill with a leading colored dot. Used for live/warming/banned/etc.
const STATUS_TONES = {
  ready:   { label: 'LIVE',    fg: 'var(--online-green)', bg: 'rgba(79,138,100,0.18)' },
  live:    { label: 'LIVE',    fg: 'var(--online-green)', bg: 'rgba(79,138,100,0.18)' },
  warming: { label: 'WARMING', fg: 'var(--gold)',     bg: 'rgba(212,166,74,0.15)' },
  paused:  { label: 'PAUSED',  fg: 'var(--text-2)',   bg: 'rgba(255,255,255,0.05)' },
  banned:  { label: 'BANNED',  fg: 'var(--danger-fg)', bg: 'rgba(180,90,90,0.18)' },
  posted:  { label: 'POSTED',  fg: 'var(--success-fg)', bg: 'rgba(122,154,90,0.15)' },
  failed:  { label: 'FAILED',  fg: 'var(--danger-fg)', bg: 'rgba(180,90,90,0.15)' },
  pending: { label: 'PENDING', fg: 'var(--gold)',     bg: 'rgba(201,162,39,0.15)' },
};
export function StatusPill({ status, label }) {
  const k = (status || '').toLowerCase();
  const t = STATUS_TONES[k] || { label: (label || status || '—').toUpperCase(), fg: 'var(--text-2)', bg: 'rgba(255,255,255,0.05)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 'var(--text-xs)', fontWeight: 700, padding: '3px 9px',
      borderRadius: 'var(--radius-pill)', letterSpacing: '0.05em',
      color: t.fg, background: t.bg,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-circle)', background: t.fg }} />
      {label || t.label}
    </span>
  );
}

/* ------------------------------ StatTile -------------------------------- */
// Large stat card with a tinted border + glow per tone.
const STAT_TONES = {
  blue:  { border: '#2c4a6e',          glow: 'rgba(60,110,180,0.12)', fg: '#7fa8e0' },
  green: { border: 'var(--green)',     glow: 'var(--green-soft)',     fg: 'var(--green-bright)' },
  gold:  { border: 'var(--gold)',      glow: 'var(--gold-soft)',      fg: 'var(--gold-bright)' },
  red:   { border: '#6e2c2c',          glow: 'rgba(180,70,70,0.12)',  fg: 'var(--danger-fg)' },
  neutral: { border: 'var(--border-strong)', glow: 'rgba(255,255,255,0.02)', fg: 'var(--text-0)' },
};
export function StatTile({ label, value, sub, tone = 'neutral' }) {
  const t = STAT_TONES[tone] || STAT_TONES.neutral;
  return (
    <div style={{
      flex: 1, border: `1px solid ${t.border}`,
      background: `linear-gradient(135deg, ${t.glow}, transparent)`,
      borderRadius: 'var(--radius-lg)', padding: '18px 20px', minWidth: 130,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.15em',
        textTransform: 'uppercase', color: 'var(--text-3)',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 600,
        color: t.fg, lineHeight: 1.1, marginTop: 4,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{sub}</div>}
    </div>
  );
}

/* ----------------------------- EmptyState ------------------------------- */
export function EmptyState({ icon = '◌', title, hint, action, compact }) {
  return (
    <div className="empty-state-modern" style={{
      padding: compact ? 24 : 48,
      textAlign: 'center', color: 'var(--text-2)',
      border: '1px dashed var(--border)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-1)',
    }}>
      <div style={{
        fontSize: compact ? 28 : 40,
        marginBottom: compact ? 4 : 10,
        color: 'var(--text-3)',
        lineHeight: 1,
      }}>{icon}</div>
      {title && <div style={{
        fontSize: compact ? 'var(--text-body)' : 15,
        fontWeight: 600,
        color: 'var(--text-1)',
        marginBottom: compact ? 4 : 6,
      }}>{title}</div>}
      {hint && <div style={{
        fontSize: compact ? 'var(--text-sm)' : 'var(--text-body)',
        lineHeight: 1.6,
        maxWidth: 400,
        margin: '0 auto',
        color: 'var(--text-3)',
      }}>{hint}</div>}
      {action && <div style={{ marginTop: compact ? 12 : 18 }}>{action}</div>}
    </div>
  );
}

/* ---------------------------- Table styles ------------------------------ */
// Importable style objects so every table looks the same. Use as `style={th}`.
/* ------------------------------ Spinner -------------------------------- */
export function Spinner({ size = 20, label, overlay }) {
  const spin = (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      color: 'var(--text-2)', fontSize: 13,
    }}>
      <span style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        border: '2px solid var(--border-strong)',
        borderTopColor: 'var(--gold)',
        animation: 'spinner-rotate 0.7s linear infinite',
      }} />
      {label && <span>{label}</span>}
    </span>
  );
  if (overlay) {
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
        background: 'rgba(7,9,10,0.6)', zIndex: 10,
      }}>{spin}</div>
    );
  }
  return spin;
}

export const th = {
  textAlign: 'left', padding: '11px 14px', fontSize: 'var(--text-xs)',
  textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)',
};
export const thSm = {
  textAlign: 'left', padding: '9px 12px', fontSize: 'var(--text-xs)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-3)', fontWeight: 600, fontFamily: 'var(--font-mono)',
};
export const td = { padding: '10px 14px', verticalAlign: 'middle' };
export const tdSm = { padding: '9px 12px', verticalAlign: 'middle' };
export const tableHeadRow = { background: 'var(--bg-2)' };
export const tableRow = { borderTop: '1px solid var(--border)' };

export function FormGrid({ cols = 2, gap = 12, children, style }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap,
      ...style,
    }}>{children}</div>
  );
}

/* -------------------------------- Modal -------------------------------- */
// Wraps the existing .modal-overlay / .modal-card CSS. Esc + backdrop close,
// focus moves into the card on open, focus returns on close, body scroll
// locked while open. header / body / footer via props.
export function Modal({ open, onClose, title, children, footer, width = 460, accent }) {
  const cardRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // focus the card so Esc + tab work
    const t = setTimeout(() => { cardRef.current?.focus(); }, 0);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      try { returnFocusRef.current?.focus?.(); } catch { /* element gone */ }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={cardRef}
        className="modal-card"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={{
          width, maxWidth: '92vw', outline: 'none',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          borderTop: accent ? `3px solid ${accent}` : '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {title != null && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '16px 20px 12px', borderBottom: '1px solid var(--border)',
          }}>
            <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>{title}</h3>
            <button
              className="ghost"
              onClick={onClose}
              aria-label="Close"
              style={{ width: 26, height: 26, padding: 0, display: 'grid', placeItems: 'center', fontSize: 14, lineHeight: 1 }}
            >✕</button>
          </div>
        )}
        <div style={{ padding: '16px 20px', overflowY: 'auto' }}>{children}</div>
        {footer && (
          <div style={{
            display: 'flex', gap: 8, justifyContent: 'flex-end',
            padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-1)',
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Field ------------------------------- */
// Label + control + hint + inline error. Pass the control as children; it
// gets an id wired to the label. `error` (string) turns the border red and
// shows the message; use it for validation, not for action results.
export function Field({ label, hint, error, required, children, style }) {
  const id = useId();
  const child = React.isValidElement(children)
    ? React.cloneElement(children, {
        id: children.props.id || id,
        className: [children.props.className, error ? 'invalid' : ''].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? 'true' : undefined,
      })
    : children;
  return (
    <div style={{ marginBottom: 12, ...style }}>
      {label && (
        <label htmlFor={id} style={{ display: 'block', marginBottom: 4 }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
        </label>
      )}
      {child}
      {error
        ? <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger-fg)', marginTop: 4 }}>{error}</div>
        : hint && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/* -------------------------------- Toggle ------------------------------ */
export function Toggle({ checked, onChange, label, disabled, hint }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }}>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        style={{
          flexShrink: 0, marginTop: 1, width: 34, height: 20, padding: 2, borderRadius: 'var(--radius-pill)',
          border: '1px solid ' + (checked ? 'var(--green)' : 'var(--border-strong)'),
          background: checked ? 'var(--green-soft)' : 'var(--bg-2)',
          display: 'flex', justifyContent: checked ? 'flex-end' : 'flex-start',
          transition: 'background .12s, border-color .12s, justify-content .12s', cursor: 'inherit',
        }}
      >
        <span style={{
          width: 14, height: 14, borderRadius: '50%',
          background: checked ? 'var(--green-bright)' : 'var(--text-3)',
        }} />
      </button>
      {label && (
        <span>
          <span style={{ fontSize: 'var(--text-body)' }}>{label}</span>
          {hint && <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-3)', marginTop: 2 }}>{hint}</span>}
        </span>
      )}
    </label>
  );
}

/* ------------------------------- Section ----------------------------- */
// Collapsible titled card — use for "Advanced" / grouped settings so a page
// isn't a wall of knobs. `right` renders in the header (e.g. a count / toggle).
export function Section({ title, children, defaultOpen = true, right, style }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-1)', marginBottom: 12, overflow: 'hidden', ...style,
    }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
          padding: '11px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)',
          transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s',
        }}>▶</span>
        <span style={{ flex: 1, fontSize: 'var(--text-body)', fontWeight: 600 }}>{title}</span>
        {right}
      </button>
      {open && <div style={{ padding: '4px 14px 14px' }}>{children}</div>}
    </div>
  );
}
