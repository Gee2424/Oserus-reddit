import React, { useEffect, useMemo, useState } from 'react';

// Reddit subreddit quick-launch rail. Pulls the shared warm-up list and
// the account's model-specific promo list, groups them, and lets the
// VA jump straight into either the sub's feed or its post composer.
// Collapsed by default so it stays out of the way on non-Reddit tabs.

export default function SubredditRail({ accountId, onOpen }) {
  const [collapsed, setCollapsed] = useState(false);
  const [warmup, setWarmup] = useState([]);
  const [promo, setPromo] = useState([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.oserusBrowser.session.listSubreddits({ accountId });
        if (cancelled || !res?.ok) return;
        setWarmup(res.warmup || []);
        setPromo(res.promo || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  const { warmupShown, promoShown } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (s) => !q || s.name.toLowerCase().includes(q);
    return {
      warmupShown: warmup.filter(match),
      promoShown: promo.filter(match),
    };
  }, [warmup, promo, filter]);

  if (collapsed) {
    return (
      <button onClick={() => setCollapsed(false)} style={collapsedRail} title="Show subreddits">
        <span style={{ fontSize: 11, writingMode: 'vertical-rl', transform: 'rotate(180deg)', letterSpacing: '0.1em' }}>
          SUBREDDITS
        </span>
      </button>
    );
  }

  return (
    <aside style={rail}>
      <div style={header}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          Subreddits
        </div>
        <button onClick={() => setCollapsed(true)} style={collapseBtn} title="Collapse">‹</button>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter…"
        style={filterInput}
      />

      {promoShown.length > 0 && (
        <Section title="Promo (NSFW)" tone="gold">
          {promoShown.map((s) => <SubRow key={`p-${s.name}`} sub={s} onOpen={onOpen} />)}
        </Section>
      )}

      <Section title={`Warm-up · ${warmupShown.length}`} tone="green">
        {warmupShown.length === 0
          ? <div style={emptyHint}>No warm-up subs configured. Add them in Operations → Warmup.</div>
          : warmupShown.map((s) => <SubRow key={`w-${s.name}`} sub={s} onOpen={onOpen} />)}
      </Section>
    </aside>
  );
}

function Section({ title, tone, children }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: tone === 'gold' ? 'var(--gold)' : '#7fd99a',
        padding: '4px 2px', borderBottom: '1px solid var(--border)', marginBottom: 4,
      }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  );
}

function SubRow({ sub, onOpen }) {
  return (
    <div style={subRow} title={sub.description || `r/${sub.name}`}>
      <button onClick={() => onOpen(sub.name, 'browse')} style={subName}>r/{sub.name}</button>
      <button onClick={() => onOpen(sub.name, 'submit')} style={postBtn} title={`Open the post composer for r/${sub.name}`}>
        post
      </button>
    </div>
  );
}

const rail = {
  width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column',
  background: 'var(--bg-1)', borderRight: '1px solid var(--border)',
  padding: 10, overflowY: 'auto',
};
const collapsedRail = {
  width: 22, flexShrink: 0,
  background: 'var(--bg-1)', borderRight: '1px solid var(--border)',
  border: 'none', cursor: 'pointer', color: 'var(--text-3)',
  display: 'grid', placeItems: 'center',
};
const header = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: 8,
};
const collapseBtn = {
  width: 22, height: 22, borderRadius: 4,
  background: 'transparent', border: 'none', color: 'var(--text-3)',
  cursor: 'pointer', fontSize: 14, lineHeight: 1,
};
const filterInput = {
  width: '100%', padding: '5px 8px', borderRadius: 4,
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  color: 'var(--text-0)', fontSize: 11, outline: 'none',
};
const subRow = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '3px 4px', borderRadius: 4,
};
const subName = {
  flex: 1, textAlign: 'left',
  background: 'transparent', border: 'none', color: 'var(--text-1)',
  fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer',
  padding: '2px 4px', borderRadius: 3,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const postBtn = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
  padding: '2px 7px', borderRadius: 3,
  background: 'transparent', border: '1px solid var(--gold)',
  color: 'var(--gold)', cursor: 'pointer',
};
const emptyHint = {
  fontSize: 11, color: 'var(--text-3)', padding: '6px 2px',
  fontStyle: 'italic',
};
