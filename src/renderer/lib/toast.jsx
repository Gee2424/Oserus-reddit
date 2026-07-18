import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';

const ToastCtx = createContext(null);

const TOAST_ICONS = {
  ok:   '✓',
  err:  '✕',
  info: 'ℹ',
  warn: '⚠',
};

const TOAST_STYLES = {
  ok:   { bg: 'rgba(79,138,100,0.15)', border: 'var(--ok)',       fg: '#bdd5a3', iconFg: '#7fd99a' },
  err:  { bg: 'rgba(180,90,90,0.15)',  border: 'var(--danger)',   fg: '#e2a3a3', iconFg: '#e2a3a3' },
  info: { bg: 'rgba(58,111,140,0.12)', border: 'var(--blue)',     fg: 'var(--blue-bright)', iconFg: '#7aa8e0' },
  warn: { bg: 'rgba(212,166,74,0.12)', border: 'var(--gold)',     fg: 'var(--gold-bright)', iconFg: '#e8c068' },
};

const TTL = 4000;
const MAX_VISIBLE = 5;

let toastId = 0;

function ToastIcon({ kind }) {
  return (
    <span style={{
      width: 20, height: 20, borderRadius: '50%',
      display: 'grid', placeItems: 'center',
      background: TOAST_STYLES[kind]?.iconFg || 'var(--text-3)',
      color: '#0d0c0a',
      fontSize: 10,
      fontWeight: 700,
      flexShrink: 0,
    }}>
      {TOAST_ICONS[kind] || '•'}
    </span>
  );
}

function ToastItem({ id, kind, message, onDismiss }) {
  const [exiting, setExiting] = useState(false);

  const startDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(id), 250);
  }, [id, onDismiss]);

  useEffect(() => {
    const timer = setTimeout(startDismiss, TTL);
    return () => clearTimeout(timer);
  }, [startDismiss]);

  const s = TOAST_STYLES[kind] || TOAST_STYLES.info;

  return (
    <div
      onClick={startDismiss}
      style={{
        pointerEvents: 'auto', cursor: 'pointer',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.fg,
        padding: '10px 14px',
        borderRadius: 'var(--radius-lg)',
        fontSize: 13,
        maxWidth: 380,
        minWidth: 240,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3)',
        animation: exiting
          ? 'toast-slide-out 0.25s ease-in forwards'
          : 'toast-slide-in 0.3s ease-out',
        wordBreak: 'break-word',
        backdropFilter: 'blur(8px)',
      }}
    >
      <ToastIcon kind={kind} />
      <span style={{ flex: 1, marginTop: 2 }}>{message}</span>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((kind, message) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, kind, message }].slice(-MAX_VISIBLE));
  }, []);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={{ toast: add }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column-reverse', gap: 8,
        pointerEvents: 'none',
      }}>
        {toasts.map((t) => (
          <ToastItem key={t.id} id={t.id} kind={t.kind} message={t.message} onDismiss={remove} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) return { toast: () => {} };
  return ctx;
}
