import React from 'react';

// Small reusable "open this module in a pinnable window" button.
// Used in module headers; the underlying pop-out infra (window.api.windows
// .openPopout) loads the same renderer with #popout=<route>.
export default function PopOutButton({ route, title, width = 1180, height = 760 }) {
  async function open() {
    await window.api.windows.openPopout({ route, title, width, height });
  }
  return (
    <button
      onClick={open}
      title="Open in its own pinnable window"
      style={{
        background: 'transparent', border: '1px solid var(--border-strong)',
        color: 'var(--text-1)', borderRadius: 6, padding: '4px 10px',
        fontSize: 12, cursor: 'pointer',
      }}
    >
      ⧉ Pop out
    </button>
  );
}
