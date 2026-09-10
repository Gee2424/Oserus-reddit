import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import AccountSelector from '../components/AccountSelector.jsx';
import { Banner, EmptyState, Modal, Tag } from '../components/ui.jsx';
import { Section, Grid, NumField, CheckLabel } from './Autopilot.jsx';

// Automation → "Runs" tab.
//
// A run is a named, reusable engagement preset (services/engagementRuns.js).
// Build them here on the full page; the Browser side panel only *picks* from
// saved runs. "Apply" writes a run's knobs into the (model, platform) autopilot
// protocol row so the background loop uses them; "Run now" fires one session.

const PERSONAS = [
  { v: 'curious', l: 'Curious' },
  { v: 'playful', l: 'Playful' },
  { v: 'flirty',  l: 'Flirty' },
  { v: 'dry',     l: 'Dry' },
  { v: 'custom',  l: 'Custom' },
];

function blankRun(profileId, platform) {
  return {
    name: '', profile_id: profileId || null, platform: platform || null,
    sessions_per_day: 3, session_minutes_min: 6, session_minutes_max: 14,
    like_rate_pct: 18, follow_rate_pct: 4, watch_full_rate_pct: 25,
    comment_rate_pct: 0, comment_videos_only: 1,
    comment_persona: 'curious', comment_prompt: '',
    ai_provider: 'claude',
    _hashtagsText: '', _followText: '', _excludeText: '',
    daily_cap_comments: 0,
  };
}

function toDraft(run) {
  const arr = (k) => { try { return JSON.parse(run[k] || '[]') || []; } catch { return []; } };
  let filter = {};
  try { filter = JSON.parse(run.target_filter_json || '{}') || {}; } catch {}
  return {
    ...run,
    comment_prompt: run.comment_prompt || '',
    _hashtagsText: arr('hashtags_json').join(', '),
    _followText: arr('follow_list_json').join(', '),
    _excludeText: (filter.exclude_keywords || []).join(', '),
  };
}

function summarise(r) {
  const bits = [`${r.sessions_per_day}/day`, `like ${r.like_rate_pct}%`, `follow ${r.follow_rate_pct}%`];
  if (r.comment_rate_pct > 0) bits.push(`comment ${r.comment_rate_pct}%`);
  return bits.join(' · ');
}

export default function EngagementRunsPanel() {
  const { token, activeTeamId } = useAuth();
  const can = useCan();
  const canManage = can('protocols.manage');
  const canRun = can('protocols.run');

  const [profiles, setProfiles] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [sel, setSel] = useState({ profileId: null, platform: null, accountId: null });
  const [runs, setRuns] = useState([]);
  const [editing, setEditing] = useState(null); // draft object or null
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null); // { runId, stats, error }

  useEffect(() => {
    window.api.profiles.list({ token, teamId: activeTeamId }).then((r) => { if (r.ok) setProfiles(r.profiles || []); });
    window.api.accounts.listForUser({ token, teamId: activeTeamId }).then((r) => { if (r.ok) setAccounts(r.accounts || []); });
  }, [token, activeTeamId]);

  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 5000);
    return () => clearTimeout(t);
  }, [msg, err]);

  const loadRuns = useCallback(async () => {
    const r = await window.api.engagementRuns.list({ token, teamId: activeTeamId, profileId: sel.profileId || undefined });
    if (r.ok) setRuns(r.runs || []);
    else setErr(r.error);
  }, [token, activeTeamId, sel.profileId]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const visibleRuns = useMemo(() => {
    if (!sel.platform) return runs;
    return runs.filter((r) => !r.platform || r.platform === sel.platform);
  }, [runs, sel.platform]);

  async function save() {
    if (!editing) return;
    if (!editing.name.trim()) { setErr('Give the run a name.'); return; }
    setBusy(true);
    const d = editing;
    const patch = {
      name: d.name.trim(),
      profile_id: d.profile_id || null,
      platform: d.platform || null,
      sessions_per_day: d.sessions_per_day, session_minutes_min: d.session_minutes_min, session_minutes_max: d.session_minutes_max,
      like_rate_pct: d.like_rate_pct, follow_rate_pct: d.follow_rate_pct, watch_full_rate_pct: d.watch_full_rate_pct,
      comment_rate_pct: d.comment_rate_pct, comment_videos_only: d.comment_videos_only ? 1 : 0,
      comment_persona: d.comment_persona, comment_prompt: d.comment_prompt || null,
      ai_provider: d.ai_provider,
      daily_cap_comments: d.daily_cap_comments,
      hashtags: splitList(d._hashtagsText),
      follow_list: splitList(d._followText),
      target_filter: { exclude_keywords: splitList(d._excludeText) },
    };
    const r = await window.api.engagementRuns.upsert({ token, id: d.id || null, patch, teamId: activeTeamId });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setEditing(null);
    setMsg('Run saved.');
    loadRuns();
  }

  async function del(run) {
    if (!window.confirm(`Delete run "${run.name}"?`)) return;
    const r = await window.api.engagementRuns.delete({ token, id: run.id });
    if (!r.ok) { setErr(r.error); return; }
    setMsg('Run deleted.');
    loadRuns();
  }

  async function apply(run) {
    if (!sel.profileId || !sel.platform) { setErr('Pick a model + platform above to apply a run to.'); return; }
    const r = await window.api.engagementRuns.apply({ token, id: run.id, profileId: sel.profileId, platform: sel.platform });
    if (!r.ok) { setErr(r.error); return; }
    setMsg(`Applied "${run.name}" to this model's ${sel.platform} autopilot protocol.`);
  }

  async function fire(run, dryRun) {
    if (!sel.accountId) { setErr('Pick an account above to run against.'); return; }
    setBusy(true);
    setResult(null);
    const r = await window.api.engagementRuns.runNow({ token, id: run.id, accountId: sel.accountId, dryRun });
    setBusy(false);
    setResult({ runId: run.id, ...r });
    if (!r.ok) setErr(r.error);
    else setMsg(dryRun ? 'Dry run complete.' : 'Run complete.');
  }

  return (
    <div>
      <AccountSelector profiles={profiles} accounts={accounts} value={sel} onChange={setSel} requireAccount={false} />

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Saved runs</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            Named engagement presets. Apply one to a model's background protocol, or run it against one account now.
          </span>
          <div style={{ flex: 1 }} />
          {canManage && (
            <button className="primary" onClick={() => setEditing(blankRun(sel.profileId, sel.platform))}>+ New run</button>
          )}
        </div>

        {visibleRuns.length === 0 ? (
          <EmptyState icon="⟳" title="No saved runs" hint={canManage ? 'Create one to reuse the same engagement mix across accounts.' : 'Ask an owner or manager to set some up.'} compact />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleRuns.map((run) => (
              <div key={run.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', background: 'var(--bg-elev)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>{run.name}</strong>
                  {run.platform ? <Tag tone="blue">{run.platform}</Tag> : <Tag>any platform</Tag>}
                  {run.ai_provider && run.ai_provider !== 'claude' && <Tag tone="gold">{run.ai_provider}</Tag>}
                  <span className="muted mono" style={{ fontSize: 11 }}>{summarise(run)}</span>
                  <div style={{ flex: 1 }} />
                  {canRun && <button className="ghost" disabled={busy} onClick={() => fire(run, true)} style={{ fontSize: 12 }}>Dry run</button>}
                  {canRun && <button className="ghost" disabled={busy} onClick={() => fire(run, false)} style={{ fontSize: 12 }}>Run now</button>}
                  {canManage && <button className="ghost" onClick={() => apply(run)} style={{ fontSize: 12 }}>Apply</button>}
                  {canManage && <button className="ghost" onClick={() => setEditing(toDraft(run))} style={{ fontSize: 12 }}>Edit</button>}
                  {canManage && <button className="ghost danger" onClick={() => del(run)} style={{ fontSize: 12 }}>Delete</button>}
                </div>
                {result && result.runId === run.id && (
                  <div className="mono" style={{ fontSize: 11, marginTop: 6, color: result.ok ? 'var(--success-fg)' : 'var(--danger-fg)' }}>
                    {result.ok
                      ? `seen ${result.stats?.posts_seen ?? 0} · liked ${result.stats?.likes ?? 0} · followed ${result.stats?.follows ?? 0} · commented ${result.stats?.comments ?? result.stats?.would_comment ?? 0}`
                      : result.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? `Edit run` : 'New run'} width={560}
          footer={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save run'}</button>
              <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          }>
          <RunForm draft={editing} onChange={(p) => setEditing((d) => ({ ...d, ...p }))} profiles={profiles} />
        </Modal>
      )}
    </div>
  );
}

function RunForm({ draft, onChange, profiles }) {
  return (
    <div>
      <Section title="Name & scope">
        <Grid cols={1}>
          <div>
            <label>Run name</label>
            <input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Light warmup" />
          </div>
        </Grid>
        <Grid cols={2}>
          <div>
            <label>Model (optional)</label>
            <select value={draft.profile_id || ''} onChange={(e) => onChange({ profile_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— reusable across all models —</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label>Platform (optional)</label>
            <select value={draft.platform || ''} onChange={(e) => onChange({ platform: e.target.value || null })}>
              <option value="">— any platform —</option>
              {['reddit', 'x', 'instagram', 'tiktok'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </Grid>
      </Section>

      <Section title="Pacing">
        <Grid cols={3}>
          <NumField label="Sessions per day" value={draft.sessions_per_day} min={1} onChange={(v) => onChange({ sessions_per_day: v })} />
          <NumField label="Session min (min)" value={draft.session_minutes_min} min={1} onChange={(v) => onChange({ session_minutes_min: v })} />
          <NumField label="Session max (min)" value={draft.session_minutes_max} min={1} onChange={(v) => onChange({ session_minutes_max: v })} />
        </Grid>
        <Grid cols={1}>
          <NumField label="Daily cap · comments (0 = unlimited)" value={draft.daily_cap_comments} min={0} onChange={(v) => onChange({ daily_cap_comments: v })} />
        </Grid>
      </Section>

      <Section title="Engagement rates (%)">
        <Grid cols={4}>
          <NumField label="Like" value={draft.like_rate_pct} min={0} max={100} onChange={(v) => onChange({ like_rate_pct: v })} />
          <NumField label="Follow" value={draft.follow_rate_pct} min={0} max={100} onChange={(v) => onChange({ follow_rate_pct: v })} />
          <NumField label="Watch fully" value={draft.watch_full_rate_pct} min={0} max={100} onChange={(v) => onChange({ watch_full_rate_pct: v })} />
          <NumField label="Comment" value={draft.comment_rate_pct} min={0} max={100} onChange={(v) => onChange({ comment_rate_pct: v })} />
        </Grid>
        <div style={{ marginTop: 8 }}>
          <CheckLabel checked={!!draft.comment_videos_only} onChange={(v) => onChange({ comment_videos_only: v ? 1 : 0 })}>
            Only comment on videos
          </CheckLabel>
        </div>
      </Section>

      <Section title="AI comments">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <label style={{ margin: 0, fontSize: 11 }}>Provider</label>
          <select value={draft.ai_provider || 'claude'} onChange={(e) => onChange({ ai_provider: e.target.value })} style={{ fontSize: 12 }}>
            <option value="cupid">Cupid AI</option>
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
            <option value="grok">Grok (xAI)</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {PERSONAS.map((p) => {
            const active = (draft.comment_persona || 'curious') === p.v;
            return (
              <button key={p.v} type="button" onClick={() => onChange({ comment_persona: p.v })}
                style={{
                  background: active ? 'rgba(212,166,74,0.18)' : 'transparent',
                  borderWidth: 1, borderStyle: 'solid', borderColor: active ? 'var(--gold)' : 'var(--border)',
                  borderRadius: 'var(--radius-pill)', padding: '4px 11px',
                  color: active ? 'var(--gold)' : 'var(--text-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}>{p.l}</button>
            );
          })}
        </div>
        {draft.comment_persona === 'custom' && (
          <div>
            <label>Custom system prompt</label>
            <textarea rows={4} value={draft.comment_prompt || ''} onChange={(e) => onChange({ comment_prompt: e.target.value })}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          </div>
        )}
      </Section>

      <Section title="Lists" collapsible defaultOpen={false}>
        <div>
          <label>Follow-list (handles) — empty = follow anyone the rate allows</label>
          <textarea rows={2} value={draft._followText} onChange={(e) => onChange({ _followText: e.target.value })}
            placeholder="@handle1, @handle2" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <label>Hashtags (IG / TikTok land on one per session)</label>
          <textarea rows={2} value={draft._hashtagsText} onChange={(e) => onChange({ _hashtagsText: e.target.value })}
            placeholder="#fitness, #cosplay" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <label>Exclude caption keywords (skip posts containing these)</label>
          <textarea rows={2} value={draft._excludeText} onChange={(e) => onChange({ _excludeText: e.target.value })}
            placeholder="onlyfans, fansly" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
        </div>
      </Section>
    </div>
  );
}

function splitList(s) {
  return String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}
