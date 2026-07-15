import React, { createContext, useContext, useCallback, useState } from 'react';

const ToastCtx = createContext(null);

const TOAST_KINDS = {
  ok:   { bg: 'rgba(122,154,90,0.14)', border: 'var(--ok)',          fg: '#bdd5a3' },
  err:  { bg: 'rgba(180,90,90,0.14)',  border: 'var(--danger)',      fg: '#e2a3a3' },
  info: { bg: 'rgba(58,111,140,0.12)', border: 'var(--blue)',        fg: 'var(--blue-bright)' },
  warn: { bg: 'rgba(212,166,74,0.12)', border: 'var(--gold)',        fg: 'var(--gold-bright)' },
};

const TTL = 4000;
const MAX_VISIBLE = 3;

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((kind, message) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, kind, message }].slice(-MAX_VISIBLE));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TTL);
  }, []);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={{ toast: add }}>
      {children}
      <div style={{
        position: 'fixed', top: 16, right: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',
      }}>
        {toasts.map((t) => {
          const s = TOAST_KINDS[t.kind] || TOAST_KINDS.info;
          return (
            <div
              key={t.id}
              onClick={() => remove(t.id)}
              style={{
                pointerEvents: 'auto', cursor: 'pointer',
                background: s.bg, border: `1px solid ${s.border}`, color: s.fg,
                padding: '10px 16px', borderRadius: 'var(--radius-lg)',
                fontSize: 13, maxWidth: 380,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                animation: 'oserus-fade-in 0.15s ease-out',
                wordBreak: 'break-word',
              }}
            >{t.message}</div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) return { toast: () => {} };
  return ctx;
}
