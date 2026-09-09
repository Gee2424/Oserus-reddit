import React, { useEffect, useState, useSyncExternalStore } from 'react';

// Background-work surface: a bell + slide-over listing what the coordinator
// did while the operator was elsewhere (post fired/failed, circuit tripped,
// proxy down) plus accounts flagged needs_attention.
//
// Module-level store + a one-time IPC subscription so events aren't lost
// when the drawer is closed or the component unmounts on a route change.

const MAX = 60;
let _events = [];          // newest first
let _lastSeen = 0;         // timestamp of the newest event the user has seen
const _subs = new Set();
function _emit() { for (const fn of _subs) fn(); }
function _snapshot() { return _events; }

function _push(evt) {
  _events = [{ id: `${evt.at}-${Math.random().toString(36).slice(2, 7)}`, ...evt }, ..._events].slice(0, MAX);
  _emit();
}

let _wired = false;
function _ensureWired() {
  if (_wired || typeof window === 'undefined' || !window.api) return;
  _wired = true;
  try {
    window.api.coordinator?.onEvent?.((e) => _push(e));
    window.api.accounts?.onNeedsAttention?.((d) =>
      _push({ kind: 'needs_attention', at: Date.now(), accountId: d.accountId, code: d.code, error: d.reason }));
  } catch { /* ignore */ }
}

const LABELS = {
  post_fired:      (e) => `Post published${e.subreddit ? ` to r/${e.subreddit}` : ''}`,
  post_failed:     (e) => `Post failed${e.subreddit ? ` (r/${e.subreddit})` : ''}: ${trim(e.error)}`,
  circuit_tripped: (e) => `Account paused after repeated failures: ${trim(e.lastError)}`,
  proxy_down:      (e) => `Proxy down: ${e.label || e.proxyId}`,
  needs_attention: (e) => `Account needs attention: ${trim(e.error) || e.code}`,
};
const TONES = {
  post_fired: 'var(--online-green)',
  post_failed: 'var(--danger)',
  circuit_tripped: 'var(--gold)',
  proxy_down: 'var(--danger)',
  needs_attention: 'var(--danger)',
};
function trim(s) { return s ? String(s).slice(0, 90) : ''; }
function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

export default function ActivityDrawer({ navigate }) {
  _ensureWired();
  const events = useSyncExternalStore(
    (cb) => { _subs.add(cb); return () => _subs.delete(cb); },
    _snapshot,
  );
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);

  // Re-render the relative times once a minute while open.
  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (open && events[0]) _lastSeen = events[0].at;
  }, [open, events]);

  const unread = events.filter((e) => e.at > _lastSeen).length;

  return (
    <>
      <button
        className="ghost"
        onClick={() => setOpen((o) => !o)}
        title="Recent background activity"
        style={{ position: 'relative', fontSize: 13, padding: '4px 8px', lineHeight: 1 }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3, minWidth: 15, height: 15, padding: '0 3px',
            borderRadius: 8, background: 'var(--danger)', color: '#fff',
            fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center',
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 900 }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 360, zIndex: 901,
            background: 'var(--bg-1)', borderLeft: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,0.5)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '14px 16px', borderBottom: '1px solid var(--border)',
            }}>
              <strong style={{ fontSize: 13, flex: 1 }}>Recent activity</strong>
              <button className="ghost" style={{ fontSize: 11 }} onClick={() => setOpen(false)}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {events.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                  Nothing yet. Posts, failures and proxy issues from the background loop show up here.
                </div>
              ) : events.map((e) => (
                <div
                  key={e.id}
                  onClick={() => {
                    if ((e.kind === 'post_fired' || e.kind === 'post_failed') && navigate) navigate('automation', { section: 'scheduler' });
                    else if ((e.kind === 'needs_attention' || e.kind === 'circuit_tripped') && navigate) navigate('profiles');
                    else if (e.kind === 'proxy_down' && navigate) navigate('proxies');
                    setOpen(false);
                  }}
                  style={{
                    padding: '10px 16px', borderBottom: '1px solid var(--border)',
                    cursor: navigate ? 'pointer' : 'default', display: 'flex', gap: 10,
                  }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                    background: TONES[e.kind] || 'var(--text-3)',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-1)', lineHeight: 1.4 }}>
                      {(LABELS[e.kind] || ((x) => x.kind))(e)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{ago(e.at)} ago</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
