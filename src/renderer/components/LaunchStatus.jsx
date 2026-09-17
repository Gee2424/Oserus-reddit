import React from 'react';

/**
 * Inline status for a CloakManager browser launch.
 *
 * Renders one of:
 *   • the current launch phase as a short label + dot
 *     (launching → warming → connecting → logging in → ready)
 *   • a "needs attention" failure with a one-tap fix action
 *   • "Running" once the profile is up
 *
 * Data comes from `useCloakManagerLaunch()`:
 *   phase      = getLaunchPhase(profileName)  → { stage, ok, reason, message }
 *   attention  = getAttention(accountId)      → { code, reason }
 *   running    = isAccountRunning(profileName)
 *
 * The parent supplies the actions (navigate / retry) so this stays presentational.
 */

const STAGE_LABEL = {
  launching: 'Launching…',
  // First-ever launch only: CloakManager downloads ~550MB of CloakBrowser
  // before it can start anything. Can take minutes — showing the real
  // percent here (not a generic "Launching…") is the difference between
  // this looking broken and looking like it's doing something.
  downloading_browser: 'Downloading browser…',
  warming: 'Warming up…',
  cdp_connecting: 'Connecting…',
  running_scripts: 'Logging in…',
  ready: 'Ready',
  failed: 'Failed',
};

// code → { text, action } where action is a key the parent maps to a handler
const FAILURE = {
  auth_rejected:       { text: 'Wrong username or password', action: 'fixCredentials', actionLabel: 'Fix credentials' },
  two_factor_required: { text: 'Reddit asked for a 2FA code', action: 'openBrowser',   actionLabel: 'Open & enter code' },
  challenge_required:  { text: 'Reddit is showing a captcha', action: 'openBrowser',   actionLabel: 'Open browser' },
  not_logged_in:       { text: 'Account is logged out',       action: 'openBrowser',   actionLabel: 'Open & sign in' },
  rate_limited:        { text: 'Reddit rate-limited this account', action: 'retry',    actionLabel: 'Retry later' },
  transport_error:     { text: 'Connection problem — check the proxy', action: 'openProxies', actionLabel: 'Proxies' },
  cdp_unavailable:     { text: 'Browser started but not reachable', action: 'retry',   actionLabel: 'Retry' },
  launch_failed:       { text: 'CloakManager could not start the browser', action: 'retry', actionLabel: 'Retry' },
  timeout:             { text: 'Launch timed out',            action: 'retry',         actionLabel: 'Retry' },
  disconnected:        { text: 'Browser disconnected mid-run', action: 'retry',        actionLabel: 'Retry' },
  binary_down:         { text: 'CloakManager service is not running', action: 'startBinary', actionLabel: 'Start service' },
};

function Dot({ color, pulse }) {
  return (
    <span style={{
      width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color,
      boxShadow: pulse ? `0 0 0 3px ${color}22` : 'none',
      animation: pulse ? 'pulse 1.6s infinite' : 'none',
    }} />
  );
}

export default function LaunchStatus({
  phase, attention, running, launching,
  actions = {}, compact = false,
}) {
  const wrap = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontSize: compact ? 'var(--text-xs)' : 'var(--text-sm)',
  };
  const linkBtn = {
    background: 'transparent', border: '1px solid var(--border-strong)',
    color: 'var(--blue-bright)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-xs)', cursor: 'pointer', lineHeight: 1.4, marginLeft: 4,
  };

  // 1. Hard failure that needs a human — highest priority.
  const failCode = attention?.code
    || (phase && phase.stage === 'failed' && phase.reason)
    || null;
  if (failCode) {
    const f = FAILURE[failCode] || { text: attention?.reason || phase?.message || 'Launch failed', action: 'retry', actionLabel: 'Retry' };
    const onAction = actions[f.action];
    return (
      <span style={{ ...wrap, color: 'var(--danger-fg)' }} title={attention?.reason || phase?.message || ''}>
        <Dot color="var(--danger)" />
        <span>{f.text}</span>
        {onAction && <button style={linkBtn} onClick={onAction}>{f.actionLabel}</button>}
        {actions.clearAttention && attention?.code && (
          <button style={{ ...linkBtn, color: 'var(--text-2)' }} onClick={actions.clearAttention}>Dismiss</button>
        )}
      </span>
    );
  }

  // 2. In-flight launch.
  if (launching || (phase && phase.stage && phase.stage !== 'ready')) {
    const stage = phase?.stage || 'launching';
    const pct = typeof phase?.progress === 'number' ? Math.round(phase.progress * 100) : null;
    return (
      <span style={{ ...wrap, color: 'var(--gold-bright)' }}>
        <Dot color="var(--gold)" pulse />
        <span>{STAGE_LABEL[stage] || 'Launching…'}{pct != null && (stage === 'warming' || stage === 'downloading_browser') ? ` ${pct}%` : ''}</span>
      </span>
    );
  }

  // 3. Up and ready.
  if (running || phase?.stage === 'ready') {
    return (
      <span style={{ ...wrap, color: 'var(--online-green)' }}>
        <Dot color="var(--online-green)" />
        <span>Running</span>
      </span>
    );
  }

  // 4. Idle — parent usually renders its own "Open Browser" button in this case.
  return null;
}
