import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        message,
        title: opts.title || 'Confirm',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        variant: opts.variant || 'danger',
      });
    });
  }, []);

  const handle = useCallback((result) => {
    setState(null);
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') handle(false);
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handle(true); }
  }, [handle]);

  return (
    <ConfirmCtx.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          className="modal-overlay"
          onClick={() => handle(false)}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
        >
          <div
            className="modal-card"
            style={{
              width: 420, maxWidth: '90vw', overflow: 'hidden',
              background: 'var(--bg-elev)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              borderTop: `3px solid ${state.variant === 'danger' ? 'var(--danger)' : 'var(--gold)'}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '20px 22px 14px' }}>
              <h3 style={{ margin: 0, marginBottom: 10, fontSize: 15 }}>{state.title}</h3>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-1)' }}>{state.message}</div>
            </div>
            <div style={{
              display: 'flex', gap: 8, justifyContent: 'flex-end',
              padding: '12px 22px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-1)',
            }}>
              <button
                className="ghost"
                onClick={() => handle(false)}
                autoFocus
              >{state.cancelLabel}</button>
              <button
                className={state.variant === 'danger' ? 'danger' : 'primary'}
                onClick={() => handle(true)}
              >{state.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) return { confirm: async () => false };
  return ctx;
}
