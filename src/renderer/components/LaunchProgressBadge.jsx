import React from 'react';

/**
 * LaunchProgressBadge Component
 *
 * Reusable progress indicator badge for account launch operations.
 * Shows different states based on progress and status:
 * - RUNNING: Green "LIVE" badge when account is actively running
 * - Progress: Blue percentage badge with pulsing animation during launch
 * - Error: Red "ERROR" badge when launch fails
 *
 * @param {Object} props
 * @param {Object} props.progress - Progress object with `progress` (0-1) property
 * @param {string} props.status - Status string ('running' | 'stopped' | 'error')
 */
export function LaunchProgressBadge({ progress, status }) {
  if (status === 'running') {
    return (
      <span style={{
        position: 'absolute',
        top: -2,
        right: -2,
        background: 'var(--ok)',
        color: '#0d0c0a',
        fontSize: 8,
        padding: '1px 4px',
        borderRadius: 999,
        fontWeight: 700,
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        zIndex: 1
      }}>
        LIVE
      </span>
    );
  }

  if (progress && progress.progress < 1) {
    return (
      <span style={{
        position: 'absolute',
        top: -2,
        right: -2,
        background: 'var(--blue)',
        color: '#fff',
        fontSize: 8,
        padding: '1px 4px',
        borderRadius: 999,
        fontWeight: 700,
        animation: 'pulse 1s infinite',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        zIndex: 1
      }}>
        {Math.round(progress.progress * 100)}%
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span style={{
        position: 'absolute',
        top: -2,
        right: -2,
        background: 'var(--danger)',
        color: '#fff',
        fontSize: 8,
        padding: '1px 4px',
        borderRadius: 999,
        fontWeight: 700,
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        zIndex: 1
      }}>
        ERROR
      </span>
    );
  }

  return null;
}

export default LaunchProgressBadge;
