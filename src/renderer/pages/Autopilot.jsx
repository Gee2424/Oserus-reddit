import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import PopOutButton from '../components/PopOutButton.jsx';
import AccountSelector from '../components/AccountSelector.jsx';
import PlatformExplainer from '../components/PlatformExplainer.jsx';
import { Banner } from '../components/ui.jsx';
import { useCloudReload } from '../lib/cloudReload.jsx';

// Autopilot page.
//
// One workflow: pick a model → pick a platform → (optional) pick an
// account. Everything below scopes to that selection. The Run button
// hits autopilot:runNow and surfaces the live result inline so the
// operator sees the loop actually move.
//
// The legacy `protocols.get/set` rules editor (global / platform
// scope, hours-between, daily-cap, quiet-hours fields) was removed —
// the autopilot loop reads autopilot_protocols, which is what this
// page edits. The Cloud-sync (Supabase) placeholder and the admin
// warmup-pool table were also removed; they belong on other pages.

const PERSONAS = [
  { v: 'curious', l: 'Curious',  hint: 'Asks short questions, notices specifics.' },
  { v: 'playful', l: 'Playful',  hint: 'Light teasing, real-viewer energy.' },
  { v: 'flirty',  l: 'Flirty',   hint: 'Confident, not crude.' },
  { v: 'dry',     l: 'Dry',      hint: 'Deadpan, one short observation.' },
  { v: 'custom',  l: 'Custom',   hint: 'Write your own system prompt below.' },
];

export default function AutopilotPage() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can('protocols.manage');
  const canRun     = can('protocols.run');

  const [profiles, setProfiles] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [sel, setSel] = useState({ profileId: null, platform: null, accountId: null });
  const [proto, setProto] = useState(null);
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [lastRun, setLastRun] = useState(null);   // result of the most recent Run Now
  const [lastPost, setLastPost] = useState(null); // result of the most recent Post Now

  // -- bootstrap profile + account lists --
  useEffect(() => {
    window.api.profiles.list({ token }).then((r) => { if (r.ok) setProfiles(r.profiles || []); });
    window.api.accounts.listForUser({ token }).then((r) => { if (r.ok) setAccounts(r.accounts || []); });
  }, [token]);

  // -- load the protocol for the current (profile, platform) selection --
  const loadProtocol = useCallback(async () => {
    if (!sel.profileId || !sel.platform) { setProto(null); return; }
    const r = await window.api.autopilot.get({
      token, profileId: sel.profileId, platform: sel.platform,
    });
    setProto(r.ok ? r.protocol : null);
  }, [token, sel.profileId, sel.platform]);
  useEffect(() => { loadProtocol(); }, [loadProtocol]);
  useCloudReload(['autopilot_protocols', 'autopilot_prompts'], () => loadProtocol());

  // -- master status (enabled / interval / last pass) + recent events --
  const loadStatus = useCallback(async () => {
    const [s, e] = await Promise.all([
      window.api.autopilot.status({ token }),
      window.api.protocols.events({ token, limit: 60 }),
    ]);
    if (s.ok) setStatus(s);
    if (e.ok) setEvents(e.events || []);
  }, [token]);
  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 5000);
    return () => clearInterval(id);
  }, [loadStatus]);

  // Recent activity narrowed to the current scope.
  const scopedEvents = useMemo(() => {
    return events.filter((e) => {
      if (sel.accountId && e.account_id !== sel.accountId) return false;
      if (sel.profileId && e.profile_id && e.profile_id !== sel.profileId) return false;
      if (sel.platform  && e.platform   && e.platform   !== sel.platform)  return false;
      return true;
    });
  }, [events, sel]);

  // -- transient toasts --
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, err]);

  // Stable callback so the protocol editor's form-mirror effect doesn't
  // re-fire on every parent render (the effect depends on `onChange`).
  const setProtoField = useCallback((patch) => {
    setProto((p) => ({ ...(p || {}), ...patch }));
  }, []);

  async function save() {
    if (!sel.profileId || !sel.platform || !proto) return;
    setBusy(true); setErr(null);
    const arr = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    let filter = {};
    try { filter = JSON.parse(proto.target_filter_json || '{}'); } catch {}
    const r = await window.api.autopilot.set({
      token,
      profileId: sel.profileId,
      platform:  sel.platform,
      patch: {
        ...proto,
        hashtags:    arr(proto._hashtagsText),
        follow_list: arr(proto._followText),
        target_subs: arr(proto._subsText),
        target_filter: { ...filter, exclude_keywords: arr(proto._excludeText) },
      },
    });
    setBusy(false);
    if (r.ok) { setMsg('Saved.'); setProto(r.protocol); }
    else setErr(r.error || 'Failed to save');
  }

  async function runNow({ dryRun = false } = {}) {
    if (!sel.profileId || !sel.platform) {
      setErr('Pick a model and platform first.'); return;
    }
    setBusy(true); setLastRun({ state: 'running', accountId: sel.accountId });
    const r = await window.api.autopilot.runNow({
      token,
      profileId: sel.profileId,
      platform:  sel.platform,
      accountId: sel.accountId || undefined,
      dryRun,
    });
    setBusy(false);
    if (!r?.ok) {
      setLastRun({ state: 'failed', error: r?.error || 'Run failed' });
      setErr(r?.error || 'Run failed');
      return;
    }
    setLastRun({
      state: 'ok',
      dryRun,
      stats: r.stats,
      seconds: r.seconds,
      sessionId: r.sessionId,
    });
    loadStatus(); // refresh recent activity
  }

  async function postNow() {
    if (!sel.profileId || !sel.platform) { setErr('Pick a model and platform first.'); return; }
    setBusy(true); setLastPost({ state: 'running' });
    const r = await window.api.autopilot.postNow({
      token, profileId: sel.profileId, platform: sel.platform,
      accountId: sel.accountId || undefined,
    });
    setBusy(false);
    if (!r?.ok) {
      setLastPost({ state: 'failed', error: r?.error || 'Post failed' });
      setErr(r?.error || 'Post failed');
      return;
    }
    const s = r.summary || {};
    setLastPost({
      state: 'ok',
      posted: s.posted || 0,
      skipped: s.skipped || 0,
      failed: s.failed || 0,
      reason: Object.keys(s.reasons || {})[0] || null,
      error: (s.errors || [])[0] || null,
    });
    loadStatus();
  }

  // Per-scope enable toggle — saves the autopilot_protocols row and,
  // because autopilot:set auto-enables the master kv when scope=on,
  // refreshes status to reflect the master flipping on too.
  async function toggleScopeEnabled(next) {
    if (!sel.profileId || !sel.platform) return;
    setBusy(true);
    const r = await window.api.autopilot.set({
      token, profileId: sel.profileId, platform: sel.platform,
      patch: { ...(proto || {}), enabled: next ? 1 : 0 },
    });
    setBusy(false);
    if (r.ok) {
      setProto(r.protocol);
      setMsg(next ? `Autopilot ON for ${sel.platform}.` : `Autopilot OFF for ${sel.platform}.`);
      loadStatus();
    } else setErr(r.error || 'Failed to toggle');
  }

  async function toggleAutopilot() {
    const next = !status?.enabled;
    const r = await window.api.autopilot.setEnabled({ token, enabled: next });
    if (r.ok) { setMsg(next ? 'Autopilot enabled.' : 'Autopilot paused.'); loadStatus(); }
    else setErr(r.error);
  }

  const masterOn = !!status?.enabled;
  const protoOn  = !!proto?.enabled;

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Automation</div>
          <h1>Autopilot</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            <strong>1.</strong> Pick a model + platform. <strong>2.</strong> Edit the settings below and Save. <strong>3.</strong> Flip <em>Turn ON for &lt;platform&gt;</em>. Saving with the switch on auto-starts the background loop — no separate master step.
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <PopOutButton route="autopilot" title="Autopilot" />
        </div>
      </div>

      {/* ── 1. Master switch ─────────────────────────────────────── */}
      <MasterBanner
        on={masterOn}
        status={status}
        canManage={canManage}
        onToggle={toggleAutopilot}
      />

      {/* ── 2. Scope selector ──────────────────────────────────── */}
      <AccountSelector
        accounts={accounts}
        profiles={profiles}
        value={sel}
        onChange={setSel}
      />

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

      {/* ── 3. Per-platform explainer + run controls ─────────────── */}
      <PlatformExplainer surface="autopilot" platform={sel.platform} />

      {sel.platform && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          {/* Row 1: scope state + the per-scope on/off switch.
              Pulled out of the editor card so the operator sees and
              flips it in the same place they trigger runs from. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{
              ...statusDot,
              width: 10, height: 10,
              background: protoOn ? 'var(--ok)' : '#e2a3a3',
            }} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {protoOn
                  ? `Autopilot is ON for ${sel.platform}`
                  : `Autopilot is OFF for ${sel.platform}`}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {proto?.last_run_at
                  ? `Last live run ${formatRelative(proto.last_run_at)}.`
                  : 'No live runs yet for this scope.'}
                {' '}Saving with this switch on auto-enables the master loop.
              </div>
            </div>
            {canManage && (
              <button
                className={protoOn ? 'danger' : 'primary'}
                disabled={busy}
                onClick={() => toggleScopeEnabled(!protoOn)}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                {protoOn ? 'Turn OFF for this scope' : `Turn ON for ${sel.platform}`}
              </button>
            )}
          </div>

          {/* Row 2: manual actions. Three buttons, one row, in the
              order an operator uses them: preview → engage → post. */}
          {canRun && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="ghost"
                disabled={busy}
                onClick={() => runNow({ dryRun: true })}
                title="Open a hidden browser as this account, scroll the feed, and report what a live pass would do. No clicks, no posts. ~60s."
              >
                Preview (dry run)
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => runNow({ dryRun: false })}
                title="Real engagement session: scroll, like, follow, comment per your rates. 6–14 min by default."
              >
                {busy ? 'Running…' : 'Run engagement now'}
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={postNow}
                title="Generate an AI post and submit it through the platform adapter, right now. Same code path the background loop uses."
                style={{ background: 'var(--gold)' }}
              >
                {busy ? '…' : 'Post one now'}
              </button>
            </div>
          )}

          {lastRun  && <RunResult  result={lastRun}  platform={sel.platform} />}
          {lastPost && <PostResult result={lastPost} platform={sel.platform} />}
        </div>
      )}

      {/* ── Engagement settings for this (profile, platform) ──────── */}
      <ProtocolEditor
        proto={proto}
        platform={sel.platform}
        onChange={setProtoField}
        onSave={save}
        busy={busy}
        canManage={canManage}
      />

      {/* ── This account's voice library ──────────────────────────── */}
      {sel.accountId
        ? <ExampleLibrary token={token} accountId={sel.accountId} />
        : <div className="card" style={{ padding: 14, marginBottom: 16, color: 'var(--text-3)', fontSize: 13 }}>
            Pick a specific account to manage its example library.
          </div>}

      {/* ── Activity scoped to the current selection ──────────────── */}
      <RecentActivity events={scopedEvents} />
    </div>
  );
}

// ─────────────────────────────────────────────────── Master switch banner
//
// Big visible state. Most operators look at this first when they open
// the page; the rest of the UI is meaningless if the master is off.

function MasterBanner({ on, status, canManage, onToggle }) {
  const next = status?.nextRunInSec || {};
  const fmt = (s) => {
    if (s == null) return '—';
    if (s <= 0) return 'now';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };
  return (
    <div className="card" style={{
      padding: '14px 16px', marginBottom: 14,
      background: on
        ? 'linear-gradient(180deg, rgba(122,154,90,0.10), transparent 70%)'
        : 'linear-gradient(180deg, rgba(180,90,90,0.08), transparent 70%)',
      border: `1px solid ${on ? 'rgba(122,154,90,0.40)' : 'rgba(180,90,90,0.40)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ ...statusDot, width: 14, height: 14, background: on ? 'var(--ok)' : '#e2a3a3' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {on ? 'Autopilot master is RUNNING' : 'Autopilot master is PAUSED'}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {on ? (
              <>
                Next posts pass: <strong>{fmt(next.autopilot)}</strong>
                {' · '}engagement: <strong>{fmt(next.engagement)}</strong>
                {' · '}scheduler: <strong>{fmt(next.scheduled)}</strong>
              </>
            ) : (
              <>Background loop is off. Saving any scope with its switch ON will auto-start it.</>
            )}
            {status?.lastRun && (
              <> · Last pass {new Date(status.lastRun).toLocaleString()}</>
            )}
          </div>
        </div>
        {canManage && (
          <button
            className={on ? 'danger' : 'primary'}
            onClick={onToggle}
            style={{ fontSize: 13, padding: '8px 14px' }}
          >
            {on ? 'Pause' : 'Start'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────── Run-result block

function RunResult({ result, platform }) {
  if (result.state === 'running') {
    return (
      <div style={resultBox(true)}>
        <span style={spinDot} /> Opening hidden browser, navigating to feed…
      </div>
    );
  }
  if (result.state === 'failed') {
    return (
      <div style={{ ...resultBox(false), color: '#e2a3a3', borderColor: 'rgba(180,90,90,0.4)' }}>
        ✗ {result.error}
      </div>
    );
  }
  const s = result.stats || {};
  const isDry = !!result.dryRun;
  const labelFor = (k) => ({ posts_seen: 'seen', likes: 'liked', follows: 'followed', comments: 'commented' })[k];
  return (
    <div style={resultBox(false)}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {isDry
          ? `✓ Preview complete in ${result.seconds ?? '?'}s`
          : `✓ Live ${platform || ''} pass complete in ${result.seconds ?? '?'}s`}
      </div>
      {isDry ? (
        <div style={{ fontSize: 12 }}>
          Saw <strong>{s.posts_seen || 0}</strong> posts. A live pass would have
          {' '}<strong>liked {s.would_like || 0}</strong>,
          {' '}<strong>followed {s.would_follow || 0}</strong>,
          {' '}<strong>commented on {s.would_comment || 0}</strong>.
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            No clicks happened — these numbers are what your rates produced over the feed we scrolled.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12 }}>
          Saw <strong>{s.posts_seen || 0}</strong> posts ·
          {' '}<strong>liked {s.likes || 0}</strong> ·
          {' '}<strong>followed {s.follows || 0}</strong> ·
          {' '}<strong>commented {s.comments || 0}</strong>.
          {platform === 'reddit' && (s.comments > 0) && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              On Reddit, the comment fires via API after the scroll-engagement window.
            </div>
          )}
        </div>
      )}
      {Array.isArray(s.errors) && s.errors.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
          {s.errors.filter((x) => !/^dry-run/.test(x)).slice(0, 3).join(' · ')}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────── Post-result block
//
// Mirrors RunResult but speaks in posting terms — generated, submitted,
// failed — so the operator can tell at a glance whether the AI post path
// actually fired (and which step it hit if not).

function PostResult({ result, platform }) {
  if (result.state === 'running') {
    return <div style={resultBox(true)}><span style={spinDot} /> Generating + submitting one post…</div>;
  }
  if (result.state === 'failed') {
    return <div style={{ ...resultBox(false), color: '#e2a3a3', borderColor: 'rgba(180,90,90,0.4)' }}>✗ {result.error}</div>;
  }
  if (result.posted) {
    return (
      <div style={resultBox(false)}>
        <div style={{ fontWeight: 600 }}>✓ Posted on {platform}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          Look in the activity feed for the post_event row + remote id.
        </div>
      </div>
    );
  }
  // Posted=0 — coordinator ran but didn't actually submit. Surface the
  // reason ("Protocol disabled", "Daily cap reached", "Too soon", etc.)
  // so the operator knows what to fix rather than seeing a silent no-op.
  return (
    <div style={{ ...resultBox(false), color: '#e7c478', borderColor: 'rgba(231,196,120,0.4)' }}>
      <div style={{ fontWeight: 600 }}>Did not post.</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        {result.error ? result.error
          : result.reason ? `Skipped: ${result.reason.replace(/_/g, ' ')}`
          : 'Coordinator returned no posted rows — check the editor settings (cap, quiet hours, hours-between).'}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────── Engagement protocol editor

function ProtocolEditor({ proto, platform, onChange, onSave, busy, canManage }) {
  // Mirror the JSON columns to free-text fields so the form is editable
  // without round-tripping JSON every keystroke.
  useEffect(() => {
    if (!proto) return;
    if (proto._mirrored) return;
    const arr = (key) => { try { return JSON.parse(proto[key] || '[]') || []; } catch { return []; } };
    let filter = {};
    try { filter = JSON.parse(proto.target_filter_json || '{}') || {}; } catch {}
    onChange({
      _hashtagsText: arr('hashtags_json').join(', '),
      _followText:   arr('follow_list_json').join(', '),
      _subsText:     arr('target_subs_json').join(', '),
      _excludeText:  (filter.exclude_keywords || []).join(', '),
      _mirrored: true,
    });
  }, [proto, onChange]);

  if (!proto) {
    return (
      <div className="card" style={{ padding: 14, marginBottom: 16, color: 'var(--text-3)', fontSize: 13 }}>
        Pick a model and platform to load its autopilot settings.
      </div>
    );
  }

  let targetFilter = {};
  try { targetFilter = JSON.parse(proto.target_filter_json || '{}') || {}; } catch {}
  const supportsHashtags   = platform === 'tiktok' || platform === 'instagram';
  const supportsTargetSubs = platform === 'reddit';

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Engagement settings</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          scrolling · liking · following · AI commenting — one config per model + platform
        </span>
      </div>

      {/* Per-scope on/off now lives on the run-controls card above so
          the operator can flip it in the same place they trigger runs.
          Don't duplicate it here. */}

      {/* Pacing */}
      <Section title="Pacing">
        <Grid cols={3}>
          <NumField label="Sessions per day" value={proto.sessions_per_day ?? 3} min={1}
                    onChange={(v) => onChange({ sessions_per_day: v })} disabled={!canManage} />
          <NumField label="Session min (min)" value={proto.session_minutes_min ?? 6} min={1}
                    onChange={(v) => onChange({ session_minutes_min: v })} disabled={!canManage} />
          <NumField label="Session max (min)" value={proto.session_minutes_max ?? 14} min={1}
                    onChange={(v) => onChange({ session_minutes_max: v })} disabled={!canManage} />
        </Grid>
        <Grid cols={4}>
          <NumField label="Hours between (min)" value={proto.hours_between_min ?? 0} min={0} step="0.1"
                    onChange={(v) => onChange({ hours_between_min: v })} disabled={!canManage} />
          <NumField label="Hours between (max)" value={proto.hours_between_max ?? 0} min={0} step="0.1"
                    onChange={(v) => onChange({ hours_between_max: v })} disabled={!canManage} />
          <NumField label="Daily cap · comments" placeholder="0 = unlimited"
                    value={proto.daily_cap_comments ?? 0} min={0}
                    onChange={(v) => onChange({ daily_cap_comments: v })} disabled={!canManage} />
          <NumField label="Daily cap · posts" placeholder="0 = unlimited"
                    value={proto.daily_cap_posts ?? 0} min={0}
                    onChange={(v) => onChange({ daily_cap_posts: v })} disabled={!canManage} />
        </Grid>
        <Grid cols={2}>
          <NumField label="Quiet hours start (0-23)" placeholder="(no quiet hours)"
                    value={proto.quiet_start ?? ''} min={0} max={23}
                    onChange={(v) => onChange({ quiet_start: v === '' ? null : v })} disabled={!canManage} />
          <NumField label="Quiet hours end (0-23)" placeholder="(no quiet hours)"
                    value={proto.quiet_end ?? ''} min={0} max={23}
                    onChange={(v) => onChange({ quiet_end: v === '' ? null : v })} disabled={!canManage} />
        </Grid>
      </Section>

      {/* Engagement rates */}
      <Section title="Engagement rates">
        <Grid cols={4}>
          <NumField label="Like %"        value={proto.like_rate_pct ?? 18}        min={0} max={100}
                    onChange={(v) => onChange({ like_rate_pct: v })} disabled={!canManage} />
          <NumField label="Follow %"      value={proto.follow_rate_pct ?? 4}       min={0} max={100}
                    onChange={(v) => onChange({ follow_rate_pct: v })} disabled={!canManage} />
          <NumField label="Watch-fully %" value={proto.watch_full_rate_pct ?? 25}  min={0} max={100}
                    onChange={(v) => onChange({ watch_full_rate_pct: v })} disabled={!canManage} />
          <NumField label="Comment %"     value={proto.comment_rate_pct ?? 0}      min={0} max={100}
                    onChange={(v) => onChange({ comment_rate_pct: v })} disabled={!canManage} />
        </Grid>
      </Section>

      {/* Targeting */}
      <Section title="Targeting · which accounts your model engages with">
        <Grid cols={2}>
          <NumField label="Min followers" placeholder="(no minimum)"
            value={targetFilter.min_followers ?? ''} min={0}
            onChange={(v) => {
              const f = { ...targetFilter };
              if (v === '' || v == null) delete f.min_followers; else f.min_followers = Number(v);
              onChange({ target_filter_json: JSON.stringify(f) });
            }}
            disabled={!canManage}
          />
          <NumField label="Max followers" placeholder="(no maximum)"
            value={targetFilter.max_followers ?? ''} min={0}
            onChange={(v) => {
              const f = { ...targetFilter };
              if (v === '' || v == null) delete f.max_followers; else f.max_followers = Number(v);
              onChange({ target_filter_json: JSON.stringify(f) });
            }}
            disabled={!canManage}
          />
        </Grid>
        <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
          <CheckLabel checked={!!targetFilter.verified_only}
            onChange={(b) => {
              const f = { ...targetFilter, verified_only: b };
              if (!b) delete f.verified_only;
              onChange({ target_filter_json: JSON.stringify(f) });
            }}
            disabled={!canManage}>
            Verified accounts only
          </CheckLabel>
          <CheckLabel checked={!!(proto.comment_videos_only ?? 1)}
            onChange={(b) => onChange({ comment_videos_only: b ? 1 : 0 })}
            disabled={!canManage}>
            Only comment on videos
          </CheckLabel>
        </div>
        {platform === 'reddit' && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>
              Reddit-only targeting
            </div>
            <Grid cols={3}>
              <NumField label="Min upvote ratio (0.0–1.0)"
                value={proto.min_upvote_ratio ?? 0} min={0} max={1} step="0.05"
                onChange={(v) => onChange({ min_upvote_ratio: v })} disabled={!canManage} />
              <NumField label="Min post score (karma)"
                value={proto.min_post_score ?? 0} min={0}
                onChange={(v) => onChange({ min_post_score: v })} disabled={!canManage} />
              <CheckLabel checked={!!proto.nsfw_only}
                onChange={(b) => onChange({ nsfw_only: b ? 1 : 0 })}
                disabled={!canManage}>
                NSFW subs only
              </CheckLabel>
            </Grid>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <label>Exclude posts whose caption contains</label>
          <textarea rows={2} placeholder="onlyfans, fansly, link in bio"
            value={proto._excludeText || ''}
            onChange={(e) => onChange({ _excludeText: e.target.value })}
            disabled={!canManage}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Comma-separated. Case-insensitive substring match.
          </div>
        </div>
      </Section>

      {/* AI comment persona */}
      <Section title="How the AI comments">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: 'var(--text-2)', margin: 0 }}>AI provider</label>
          <select value={proto.ai_provider || 'claude'}
                  onChange={(e) => onChange({ ai_provider: e.target.value })}
                  disabled={!canManage}
                  style={{ fontSize: 12 }}>
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
            <option value="grok">Grok (xAI)</option>
          </select>
          <span className="muted" style={{ fontSize: 11 }}>
            Falls back to the Autopilot Anthropic key if the chosen provider isn't configured.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {PERSONAS.map((p) => {
            const active = (proto.comment_persona || 'curious') === p.v;
            return (
              <button key={p.v}
                onClick={() => onChange({ comment_persona: p.v })}
                title={p.hint}
                disabled={!canManage}
                style={{
                  background: active ? 'rgba(212,166,74,0.18)' : 'transparent',
                  border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                  borderRadius: 999, padding: '4px 11px',
                  color: active ? 'var(--gold)' : 'var(--text-2)',
                  fontSize: 11, fontWeight: 600, cursor: canManage ? 'pointer' : 'default',
                }}
              >{p.l}</button>
            );
          })}
        </div>
        {proto.comment_persona === 'custom' && (
          <div>
            <label>Custom system prompt for comments</label>
            <textarea rows={4} value={proto.comment_prompt || ''}
              onChange={(e) => onChange({ comment_prompt: e.target.value })}
              disabled={!canManage}
              placeholder="You react to videos like a real viewer in… one short line, no hashtags, never promotional, …"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          </div>
        )}
      </Section>

      {/* Per-platform lists */}
      <Section title="Lists">
        <Grid cols={2}>
          <div>
            <label>Follow-list (handles)</label>
            <textarea rows={3} placeholder="@modelhandle1, @modelhandle2"
              value={proto._followText || ''}
              onChange={(e) => onChange({ _followText: e.target.value })}
              disabled={!canManage}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Empty = follow anyone the rate allows. Filled = only follow these handles.
            </div>
          </div>
          <div>
            <label>Hashtags {supportsHashtags ? '(IG / TikTok land on one per session)' : '(N/A for this platform)'}</label>
            <textarea rows={3} disabled={!supportsHashtags || !canManage}
              value={proto._hashtagsText || ''}
              onChange={(e) => onChange({ _hashtagsText: e.target.value })}
              placeholder="#fitness, #cosplay"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: supportsHashtags ? 1 : 0.5 }} />
          </div>
        </Grid>
        {supportsTargetSubs && (
          <div style={{ marginTop: 10 }}>
            <label>Reddit target subreddits (for the API-comment path)</label>
            <textarea rows={3} placeholder="askreddit, casualconversation, …"
              value={proto._subsText || ''}
              onChange={(e) => onChange({ _subsText: e.target.value })}
              disabled={!canManage}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              When Comment % &gt; 0, one API-based comment runs after each engagement session, drawing from these subs.
            </div>
          </div>
        )}
      </Section>

      {canManage && (
        <div style={{
          position: 'sticky', bottom: 0, marginTop: 12, padding: '10px 0',
          background: 'linear-gradient(180deg, transparent, var(--bg-0) 30%)',
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <button className="primary" disabled={busy} onClick={onSave} style={{ minWidth: 120 }}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            Settings apply on the next tick (≤4 min for engagement, ≤30 min for posts). Use the buttons above to fire now.
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────── Per-account examples

function ExampleLibrary({ token, accountId }) {
  const [posts,    setPosts]    = useState([]);
  const [images,   setImages]   = useState([]);
  const [comments, setComments] = useState([]);
  const [draft,        setDraft]        = useState({ title: '', body: '', subreddit: '' });
  const [commentDraft, setCommentDraft] = useState({ parentTitle: '', parentBody: '', parentUrl: '', subreddit: '', commentBody: '' });
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [p, i, c] = await Promise.all([
      window.api.examples.listPosts({ token, accountId }),
      window.api.examples.listImages({ token, accountId }),
      window.api.examples.listComments({ token, accountId }),
    ]);
    if (p.ok) setPosts(p.posts || []);
    if (i.ok) setImages(i.images || []);
    if (c.ok) setComments(c.comments || []);
  }, [token, accountId]);
  useEffect(() => { load(); }, [load]);

  async function addPost() {
    if (!draft.title.trim()) { setErr('Title required'); return; }
    setBusy(true);
    const r = await window.api.examples.addPost({ token, accountId, ...draft });
    setBusy(false);
    if (r.ok) { setDraft({ title: '', body: '', subreddit: '' }); load(); }
    else setErr(r.error);
  }
  async function uploadImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataBase64 = reader.result.split(',')[1];
      const r = await window.api.examples.addImage({ token, accountId, fileName: file.name, dataBase64 });
      if (r.ok) load(); else setErr(r.error);
    };
    reader.readAsDataURL(file);
  }
  async function addComment() {
    if (!commentDraft.parentTitle.trim() || !commentDraft.commentBody.trim()) {
      setErr('Parent title + your reply are required.'); return;
    }
    setBusy(true);
    const r = await window.api.examples.addComment({ token, accountId, ...commentDraft });
    setBusy(false);
    if (r.ok) { setCommentDraft({ parentTitle: '', parentBody: '', parentUrl: '', subreddit: '', commentBody: '' }); load(); }
    else setErr(r.error);
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>This account's voice library</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          autopilot mirrors these when generating posts + comments for u/{accountId}
        </span>
      </div>
      {err && <Banner kind="err">{err}</Banner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        {/* Posts */}
        <div>
          <div style={subhead}>Example posts ({posts.length})</div>
          <Grid cols={2} gap={6}>
            <input placeholder="Title" value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <input placeholder="r/subreddit (optional)" value={draft.subreddit}
              onChange={(e) => setDraft({ ...draft, subreddit: e.target.value.replace(/^r\//i, '') })} />
          </Grid>
          <textarea placeholder="Body (optional)" value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            style={{ minHeight: 60, width: '100%', fontSize: 13, marginTop: 6 }} />
          <button className="primary" onClick={addPost} disabled={busy} style={{ marginTop: 6 }}>+ Add</button>
          <ItemList items={posts} render={(p) => (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                {p.subreddit && <span className="mono dim" style={{ fontSize: 11 }}>r/{p.subreddit}</span>}
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{p.title}</span>
                <button className="ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={async () => { await window.api.examples.deletePost({ token, id: p.id }); load(); }}>×</button>
              </div>
              {p.body && <div className="muted" style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{p.body}</div>}
            </>
          )} />
        </div>

        {/* Images */}
        <div>
          <div style={subhead}>Example images ({images.length})</div>
          <label style={{ display: 'inline-block', cursor: 'pointer' }}>
            <input type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={(e) => { for (const f of e.target.files || []) uploadImage(f); e.target.value = ''; }} />
            <span className="primary" style={{ display: 'inline-block', padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
              + Add image(s)
            </span>
          </label>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Pool autopilot draws from for image posts on this account.
          </div>
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
            {images.length === 0
              ? <div className="muted" style={{ fontSize: 12, gridColumn: '1 / -1' }}>No example images yet.</div>
              : images.map((img) => (
                  <div key={img.id} style={imageThumbBox}>
                    <ImageThumb token={token} id={img.id} />
                    <button onClick={async () => { await window.api.examples.deleteImage({ token, id: img.id }); load(); }}
                            style={imageThumbX}>×</button>
                  </div>
                ))}
          </div>
        </div>

        {/* Comments */}
        <div>
          <div style={subhead}>Example comments ({comments.length})</div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Paste the post + your reply. Autopilot reads both so it learns the angle this account takes.
          </div>
          <input placeholder="Parent post title" value={commentDraft.parentTitle}
            onChange={(e) => setCommentDraft({ ...commentDraft, parentTitle: e.target.value })} />
          <Grid cols={2} gap={6}>
            <input placeholder="r/subreddit (optional)" value={commentDraft.subreddit}
              onChange={(e) => setCommentDraft({ ...commentDraft, subreddit: e.target.value.replace(/^r\//i, '') })} />
            <input placeholder="Post URL (optional)" value={commentDraft.parentUrl}
              onChange={(e) => setCommentDraft({ ...commentDraft, parentUrl: e.target.value })} />
          </Grid>
          <textarea placeholder="Parent post body (optional)" value={commentDraft.parentBody}
            onChange={(e) => setCommentDraft({ ...commentDraft, parentBody: e.target.value })}
            style={{ minHeight: 50, width: '100%', fontSize: 12, marginTop: 6 }} />
          <textarea placeholder="Your reply (required)" value={commentDraft.commentBody}
            onChange={(e) => setCommentDraft({ ...commentDraft, commentBody: e.target.value })}
            style={{ minHeight: 60, width: '100%', fontSize: 13, marginTop: 6 }} />
          <button className="primary" onClick={addComment} disabled={busy} style={{ marginTop: 6 }}>+ Add</button>
          <ItemList items={comments} render={(c) => (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                {c.subreddit && <span className="mono dim" style={{ fontSize: 11 }}>r/{c.subreddit}</span>}
                <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{c.parent_title}</span>
                <button className="ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={async () => { await window.api.examples.deleteComment({ token, id: c.id }); load(); }}>×</button>
              </div>
              {c.parent_body && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{String(c.parent_body).slice(0, 140)}</div>}
              <div style={{ fontSize: 12, marginTop: 6, padding: '6px 8px', background: 'var(--bg-elev)', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                ↳ {c.comment_body}
              </div>
            </>
          )} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────── Activity feed

function RecentActivity({ events }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Recent activity</h3>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          Last {events.length} events for the current selection
        </div>
      </div>
      {events.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
          Nothing logged for this scope yet. Click "Preview" or "Run live now" above and it'll show up here.
        </div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {events.map((e) => (
            <div key={`${e.event_kind || 'post'}-${e.id}`} style={eventRow}>
              <span style={{ ...pill, ...statusPillStyle(e.status) }}>{e.status}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {e.event_kind === 'session' ? (
                  <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.platform || '?'} engagement: seen {e.posts_seen ?? 0} · liked {e.likes ?? 0} · followed {e.follows ?? 0} · commented {e.comments ?? 0}
                    {e.seconds ? ` · ${e.seconds}s` : ''}
                    {e.error ? ` · ${String(e.error).slice(0, 80)}` : ''}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.subreddit ? `r/${e.subreddit} · ` : ''}{e.title || e.error || '—'}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 11 }}>
                  {e.account_username ? `${e.platform === 'reddit' ? 'u/' : '@'}${e.account_username}` : `acct ${e.account_id}`}
                  {e.profile_name ? ` · ${e.profile_name}` : ''}
                  {' · '}{e.source}
                  {' · '}{e.created_at ? new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString() : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────── small helpers / styles

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
function Grid({ cols = 2, gap = 12, children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>{children}</div>;
}
function NumField({ label, value, onChange, min, max, step, placeholder, disabled }) {
  return (
    <div>
      <label>{label}</label>
      <input type="number" min={min} max={max} step={step}
        value={value === null || value === undefined ? '' : value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        disabled={disabled} />
    </div>
  );
}
function CheckLabel({ checked, onChange, disabled, children }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      {children}
    </label>
  );
}
function ItemList({ items, render }) {
  return (
    <div style={{ marginTop: 10, maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.length === 0
        ? <div className="muted" style={{ fontSize: 12 }}>Nothing yet.</div>
        : items.map((it) => (
            <div key={it.id} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
              {render(it)}
            </div>
          ))}
    </div>
  );
}

function ImageThumb({ token, id }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let active = true;
    window.api.examples.getImage({ token, id }).then((r) => {
      if (active && r.ok) setSrc(`data:${r.mime || 'image/jpeg'};base64,${r.dataBase64}`);
    });
    return () => { active = false; };
  }, [token, id]);
  if (!src) return <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 11 }}>…</div>;
  return <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

function formatRelative(isoLike) {
  try {
    const t = new Date(isoLike.replace(' ', 'T') + (isoLike.endsWith('Z') ? '' : 'Z')).getTime();
    const diff = Math.max(0, Date.now() - t);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return isoLike; }
}

function statusPillStyle(s) {
  if (s === 'posted' || s === 'engaged') return { background: 'rgba(122,154,90,0.15)', color: '#bdd5a3' };
  if (s === 'failed' || s === 'engaged-err') return { background: 'rgba(180,90,90,0.15)', color: '#e2a3a3' };
  if (s === 'dry-run') return { background: 'rgba(212,166,74,0.15)', color: 'var(--gold)' };
  return { background: 'rgba(255,255,255,0.06)', color: 'var(--text-3)' };
}

const statusDot = { width: 10, height: 10, borderRadius: '50%' };
const spinDot   = { width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', animation: 'pulse 1s ease-in-out infinite' };
const resultBox = (running) => ({
  marginTop: 12, padding: '8px 12px',
  background: running ? 'rgba(212,166,74,0.08)' : 'var(--bg-1)',
  border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 12, color: 'var(--text-1)',
});
const pill = { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', flexShrink: 0, marginTop: 2 };
const eventRow = { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 16px', borderBottom: '1px solid var(--border)' };
const subhead = { fontWeight: 600, fontSize: 13, marginBottom: 8 };
const imageThumbBox = { position: 'relative', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, aspectRatio: '1 / 1', overflow: 'hidden' };
const imageThumbX   = { position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 999, width: 22, height: 22, cursor: 'pointer', fontSize: 12 };
