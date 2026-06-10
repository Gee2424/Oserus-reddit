import React from 'react';

// PlatformExplainer — small card that tells the operator EXACTLY what
// autopilot or the scheduler does for the picked platform. Used on the
// Autopilot and Scheduler pages so each one is self-explanatory the
// first time a VA opens it.
//
// Two surfaces:
//   <PlatformExplainer surface="autopilot" platform="x" />
//   <PlatformExplainer surface="scheduler" platform="instagram" />

const COPY = {
  autopilot: {
    reddit: {
      icon: '🔴',
      headline: 'Reddit autopilot — feed engagement + API-based commenting',
      bullets: [
        'Opens a hidden browser as the account, lands on a niche-relevant subreddit (auto-derived from the model\'s niche field if no hashtags configured), and scrolls for the configured session window (typically 6–14 min).',
        'Likes / follows posts at the configured rates. Reddit\'s DOM comment selectors are too fragile — instead, when Comment % > 0, fires one API-based comment via the official Reddit endpoint after each engagement session.',
        'Commenting uses the model\'s niche + brand voice + the persona you picked, and only posts in your target_subs list.',
        'A full pass on a single account = 1 engagement session + 1 API comment (when enabled).',
      ],
      tip: 'Tip: set the model\'s "Preferred subreddits" on the model profile — autopilot uses those as the comment pool.',
    },
    x: {
      icon: '🐦',
      headline: 'X (Twitter) autopilot — AI tweets + DOM engagement',
      bullets: [
        'For posting: generates a tweet via Claude/Grok/OpenAI matched to the model\'s niche + brand voice, opens a hidden browser as the account, and submits via the X compose UI.',
        'For engagement: opens the search results for a niche hashtag (the "Top" tab — denser, more reply-able than "Latest"), scrolls, likes / follows at configured rates.',
        'Comment % > 0 → drops AI-generated replies on visible tweets using the same persona and niche the tweets use.',
        'Falls back to the home feed if no hashtags are configured.',
      ],
      tip: 'Tip: X engagement runs even if you don\'t post — set Comment % to 0 if you only want lurking warmup.',
    },
    instagram: {
      icon: '📸',
      headline: 'Instagram autopilot — hashtag-targeted engagement',
      bullets: [
        'Opens IG /explore/tags/<niche>/ in a hidden browser as the account.',
        'Scrolls posts, likes / follows at configured rates.',
        'Comment % > 0 → drops AI-generated comments matching the persona + brand voice on visible posts.',
        'Posting AI-generated feed content is NOT shipped yet (needs operator-supplied media). Today\'s autopilot is engagement-only on IG.',
      ],
      tip: 'Tip: niche field on the model profile becomes the landing hashtag automatically — no need to configure hashtags separately for most cases.',
    },
    tiktok: {
      icon: '🎵',
      headline: 'TikTok autopilot — hashtag feed engagement',
      bullets: [
        'Opens TikTok /tag/<niche> in a hidden browser as the account.',
        'Scrolls videos, watches each one for a humane window (longer on "watch fully" rolls), likes / follows at configured rates.',
        'Comment % > 0 → drops AI-generated short comments on videos that pass the "videos only" filter.',
        'Posting AI-generated TikTok videos is NOT shipped (needs an operator-supplied video upload pipeline).',
      ],
      tip: 'Tip: leave "Watch fully %" around 25% — fully watching every video is itself a bot tell.',
    },
    redgifs: {
      icon: '🎞️',
      headline: 'RedGifs autopilot — disabled by request',
      bullets: [
        'No engagement loop runs for RedGifs. Per operator request, autopilot is opt-out for this platform.',
        'Switch to the manual browser to engage on RedGifs.',
      ],
    },
  },
  scheduler: {
    reddit: {
      icon: '🔴',
      headline: 'Reddit scheduling — title + body, fires via Reddit API',
      bullets: [
        'Pick a subreddit, write a title (and body / link / image URL), pick a time. Fires at scheduled_for via the account\'s logged-in Reddit session — no OAuth, no manual approval.',
        'Conflict checker enforces protocol rules: quiet hours, daily cap, hours-between, posts-before-break.',
        'Boost (upvote.biz) integrates here — set qty + delay and it fires after the post lands.',
        'Auto-generate flag fills the title from Claude/Grok at fire-time when you want fresh wording.',
      ],
      tip: 'Tip: "Send to all preferred" fans the same post out across the model\'s preferred subs, 7 min apart per account.',
    },
    x: {
      icon: '🐦',
      headline: 'X (Twitter) scheduling — tweet at a specific time',
      bullets: [
        'Write the tweet text (and optional URL — X unfurls it as a card). Fires via the X compose UI in a hidden browser as the account.',
        '280 char limit enforced; longer text auto-trims with an ellipsis.',
        'No native media-upload pipeline yet — text + URL only.',
        'Conflict checker still respects the model\'s quiet hours and daily cap.',
      ],
    },
    instagram: {
      icon: '📸',
      headline: 'Instagram scheduling — drafts only for now',
      bullets: [
        'Saves the caption + media URL to scheduled_posts so it shows up on the Scheduler kanban.',
        'Auto-firing on Instagram needs a native media-upload pipeline — not shipped yet. For now, schedule as a reminder; an operator opens the Oserus Browser and posts manually.',
      ],
    },
    tiktok: {
      icon: '🎵',
      headline: 'TikTok scheduling — drafts only for now',
      bullets: [
        'Saves the caption to scheduled_posts so it shows up on the kanban.',
        'Native video-upload pipeline isn\'t shipped — schedule fires manually via the Oserus Browser today.',
      ],
    },
    redgifs: {
      icon: '🎞️',
      headline: 'RedGifs scheduling — manual only',
      bullets: [
        'RedGifs scheduling needs the native media-upload pipeline (not shipped). Use the manual browser to post.',
      ],
    },
  },
};

export default function PlatformExplainer({ surface, platform }) {
  const set = COPY[surface];
  if (!set) return null;
  if (!platform) {
    return (
      <div className="card" style={hint}>
        Pick a platform above to see what {surface === 'autopilot' ? 'autopilot' : 'the scheduler'} does for it.
      </div>
    );
  }
  const meta = set[platform];
  if (!meta) {
    return (
      <div className="card" style={hint}>
        No {surface} support for {platform} yet.
      </div>
    );
  }
  return (
    <div className="card" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={iconBubble}>{meta.icon}</span>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-0)' }}>
          {meta.headline}
        </div>
      </div>
      <ul style={list}>
        {meta.bullets.map((b, i) => (
          <li key={i} style={li}>
            <span style={liDot}>•</span>{b}
          </li>
        ))}
      </ul>
      {meta.tip && (
        <div style={tipBox}>
          <span style={{ fontWeight: 700 }}>Tip:</span> {meta.tip.replace(/^Tip:\s*/, '')}
        </div>
      )}
    </div>
  );
}

const card = {
  padding: 14,
  marginBottom: 14,
  background: 'linear-gradient(180deg, rgba(212,166,74,0.04), transparent 70%)',
  border: '1px solid var(--border)',
};
const hint = { padding: 14, marginBottom: 14, color: 'var(--text-3)', fontSize: 13 };
const iconBubble = {
  width: 28, height: 28, display: 'grid', placeItems: 'center',
  borderRadius: 8, background: 'var(--bg-1)', border: '1px solid var(--border)',
  fontSize: 16,
};
const list = { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 };
const li = {
  fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-1)',
  paddingLeft: 14, position: 'relative',
};
const liDot = {
  position: 'absolute', left: 0, top: 0,
  color: 'var(--gold)', fontWeight: 700,
};
const tipBox = {
  marginTop: 10, padding: '8px 10px',
  background: 'rgba(122,154,90,0.10)',
  border: '1px solid rgba(122,154,90,0.30)',
  borderRadius: 6, fontSize: 12, color: 'var(--text-1)', lineHeight: 1.5,
};
