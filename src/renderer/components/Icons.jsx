const ICONS = {
  dashboard: '⬢',
  models: '◇',
  analytics: '◧',
  inbox: '✉',
  automation: '⟳',
  intelligence: '◎',
  team: '⚑',
  docs: '◫',
  settings: '⚙',
  infrastructure: '⚡',
  cloud: '☁',
  browser: '◐',
  proxies: '⌁',
  platformReddit: '🔴',
  platformRedGifs: '🟠',
  platformX: '🔵',
  platformInstagram: '🟣',
  platformTikTok: '⚫',
  play: '▶',
  pause: '⏸',
  stop: '⏹',
  refresh: '⟳',
  plus: '+',
  close: '✕',
  check: '✓',
  warning: '⚠',
  lock: '🔒',
};

export function Icon({ name, size = 14, style }) {
  return (
    <span style={{ fontSize: size, lineHeight: 1, ...style }}>
      {ICONS[name] || '◈'}
    </span>
  );
}

export default ICONS;
