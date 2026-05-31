// Single source of truth for platform metadata. Every renderer file should
// import from here — if a brand color, login URL, or display label needs to
// change, this is the one place to touch it.

export const PLATFORMS = [
  { v: 'reddit',    label: 'Reddit',    short: 'R',  color: '#ff4500',
    home: 'https://www.reddit.com/',                 login: 'https://www.reddit.com/login',
    usernamePrefix: 'u/' },
  { v: 'redgifs',   label: 'RedGIFs',   short: 'G',  color: '#ff2e74',
    home: 'https://www.redgifs.com/',                login: 'https://www.redgifs.com/signin',
    usernamePrefix: '@' },
  { v: 'x',         label: 'X',         short: '𝕏', color: '#1d9bf0',
    home: 'https://x.com/home',                       login: 'https://x.com/login',
    usernamePrefix: '@' },
  { v: 'instagram', label: 'Instagram', short: 'IG', color: '#e1306c',
    home: 'https://www.instagram.com/',               login: 'https://www.instagram.com/accounts/login/',
    usernamePrefix: '@' },
  { v: 'tiktok',    label: 'TikTok',    short: 'TT', color: '#25f4ee',
    home: 'https://www.tiktok.com/foryou',            login: 'https://www.tiktok.com/login',
    usernamePrefix: '@' },
];

export const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((p) => [p.v, p]));

export function platformColor(v)  { return (PLATFORM_MAP[v] || PLATFORM_MAP.reddit).color; }
export function platformLabel(v)  { return (PLATFORM_MAP[v] || PLATFORM_MAP.reddit).label; }
export function platformHome(v)   { return (PLATFORM_MAP[v] || PLATFORM_MAP.reddit).home; }
export function platformShort(v)  { return (PLATFORM_MAP[v] || PLATFORM_MAP.reddit).short; }
