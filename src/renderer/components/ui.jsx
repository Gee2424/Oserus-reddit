// Shared UI primitives — the bits I kept copy-pasting across pages.
// Importing these from one place keeps style/tone consistent and shrinks
// every page that uses them.

import React from 'react';

/* ------------------------------- Banner --------------------------------- */
// Drop-in for the auto-dismissing "ok"/"err"/"info" strips at the top of
// pages. Pages still own their own state; this just renders.

const banners = {
  ok:   { bg: 'rgba(122,154,90,0.12)', border: 'var(--ok)',          fg: '#bdd5a3' },
  err:  { bg: 'rgba(180,90,90,0.12)',  border: 'var(--danger)',      fg: '#e2a3a3' },
  info: { bg: 'rgba(58,111,140,0.10)', border: 'var(--blue)',        fg: 'var(--blue-bright)' },
  warn: { bg: 'rgba(212,166,74,0.10)', border: 'var(--gold)',        fg: 'var(--gold-bright)' },
};
export function Banner({ kind = 'info', children, style }) {
  const s = banners[kind] || banners.info;
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.fg,
      padding: '10px 14px', borderRadius: 'var(--radius-lg)', fontSize: 13,
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
export function Tag({ children, tone = 'neutral', style }) {
  const tones = {
    neutral: { fg: 'var(--text-1)',     bd: 'var(--border-strong)', bg: 'var(--bg-2)' },
    gold:    { fg: 'var(--gold-bright)',bd: 'var(--gold)',           bg: 'var(--gold-soft)' },
    green:   { fg: 'var(--green-bright)',bd: 'var(--green)',         bg: 'var(--green-soft)' },
    blue:    { fg: 'var(--blue-bright)',bd: 'var(--blue)',           bg: 'var(--blue-soft)' },
    pink:    { fg: '#d9a3d9',           bd: '#7a4a7a',               bg: 'rgba(150,90,150,0.12)' },
    danger:  { fg: '#e2a3a3',           bd: 'var(--danger)',         bg: 'rgba(180,90,90,0.12)' },
  }[tone] || { fg: 'var(--text-1)', bd: 'var(--border-strong)', bg: 'var(--bg-2)' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 600,
      padding: '2px 8px', borderRadius: 999,
      border: `1px solid ${tones.bd}`, color: tones.fg, background: tones.bg,
      letterSpacing: '0.03em', textTransform: 'uppercase',
      ...style,
    }}>{children}</span>
  );
}

/* ---------------------------- Status pill ------------------------------- */
// Pill with a leading colored dot. Used for live/warming/banned/etc.
const STATUS_TONES = {
  ready:   { label: 'LIVE',    fg: '#7fd99a',         bg: 'rgba(79,138,100,0.18)' },
  live:    { label: 'LIVE',    fg: '#7fd99a',         bg: 'rgba(79,138,100,0.18)' },
  warming: { label: 'WARMING', fg: 'var(--gold)',     bg: 'rgba(212,166,74,0.15)' },
  paused:  { label: 'PAUSED',  fg: 'var(--text-2)',   bg: 'rgba(255,255,255,0.05)' },
  banned:  { label: 'BANNED',  fg: '#e2a3a3',         bg: 'rgba(180,90,90,0.18)' },
  posted:  { label: 'POSTED',  fg: '#bdd5a3',         bg: 'rgba(122,154,90,0.15)' },
  failed:  { label: 'FAILED',  fg: '#e2a3a3',         bg: 'rgba(180,90,90,0.15)' },
  pending: { label: 'PENDING', fg: 'var(--gold)',     bg: 'rgba(201,162,39,0.15)' },
};
export function StatusPill({ status, label }) {
  const k = (status || '').toLowerCase();
  const t = STATUS_TONES[k] || { label: (label || status || '—').toUpperCase(), fg: 'var(--text-2)', bg: 'rgba(255,255,255,0.05)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 10, fontWeight: 700, padding: '3px 9px',
      borderRadius: 999, letterSpacing: '0.05em',
      color: t.fg, background: t.bg,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.fg }} />
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
  red:   { border: '#6e2c2c',          glow: 'rgba(180,70,70,0.12)',  fg: '#e2a3a3' },
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
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em',
        textTransform: 'uppercase', color: 'var(--text-3)',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 600,
        color: t.fg, lineHeight: 1.1, marginTop: 4,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{sub}</div>}
    </div>
  );
}

/* ----------------------------- EmptyState ------------------------------- */
export function EmptyState({ icon = '◌', title, hint, action }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-2)' }}>
      <div style={{ fontSize: 36, marginBottom: 8, color: 'var(--text-3)' }}>{icon}</div>
      {title && <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>{title}</div>}
      {hint && <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>{hint}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
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
  textAlign: 'left', padding: '11px 14px', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)',
};
export const td = { padding: '10px 14px', verticalAlign: 'middle' };
export const tableHeadRow = { background: 'var(--bg-2)' };
export const tableRow = { borderTop: '1px solid var(--border)' };
