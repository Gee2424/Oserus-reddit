import React, { useEffect, useState, useMemo } from 'react';

const JOBS = [
  { id: 'post_sfw', label: 'Post · SFW (warm-up)', help: 'Used when autopilot generates posts for a WARMING account in mainstream subs.' },
  { id: 'post_nsfw', label: 'Post · NSFW (promo)', help: 'Used when autopilot generates posts for a READY account in promo subs.' },
  { id: 'comment', label: 'Auto-comment', help: 'Used by the auto-comment loop to draft replies in target subs.' },
];

const VARS_BY_JOB = {
  post_sfw: ['{{username}}', '{{model_name}}', '{{niche}}', '{{brand_voice}}', '{{target_subreddit}}', '{{subreddit_rule}}', '{{target_clause}}'],
  post_nsfw: ['{{username}}', '{{model_name}}', '{{niche}}', '{{brand_voice}}', '{{target_subreddit}}', '{{subreddit_rule}}', '{{target_clause}}'],
  comment: ['{{username}}', '{{brand_voice}}', '{{brand_voice_line}}', '{{model_name}}'],
};

export default function AutopilotAIPanel({ token }) {
  const [cfg, setCfg] = useState({ hasKey: false, model: 'claude-haiku-4-5' });
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('claude-haiku-4-5');
  const [msg, setMsg] = useState(null);

  const [prompts, setPrompts] = useState({ defaults: {}, overrides: [], profiles: [] });
  const [activeJob, setActiveJob] = useState('post_sfw');
  const [activeProfile, setActiveProfile] = useState(''); // '' = global
  const [draft, setDraft] = useState('');
  const [trainerOpen, setTrainerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadConfig() {
    const r = await window.api.autopilotAI.getConfig({ token });
    if (r.ok) { setCfg(r); setModelInput(r.model || 'claude-haiku-4-5'); }
  }
  async function loadPrompts() {
    const r = await window.api.autopilotAI.getPrompts({ token });
    if (r.ok) setPrompts(r);
  }
  useEffect(() => { loadConfig(); loadPrompts(); }, [token]);

  const activeOverride = useMemo(() => {
    const pid = activeProfile ? Number(activeProfile) : null;
    return prompts.overrides.find((o) => o.job === activeJob && ((o.profile_id || null) === pid));
  }, [prompts, activeJob, activeProfile]);

  const defaultPrompt = prompts.defaults?.[activeJob] || '';
  const currentPrompt = activeOverride?.prompt || defaultPrompt;

  useEffect(() => { setDraft(currentPrompt); }, [activeJob, activeProfile, prompts.overrides.length, currentPrompt]);

  async function saveKey(e) {
    e.preventDefault();
    setMsg(null);
    if (!keyInput.trim()) { setMsg({ kind: 'err', text: 'Paste a key first' }); return; }
    const r = await window.api.autopilotAI.setKey({ token, apiKey: keyInput.trim() });
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setKeyInput('');
    setMsg({ kind: 'ok', text: 'Autopilot key saved and encrypted.' });
    loadConfig();
  }
  async function clearKey() {
    if (!confirm('Remove the autopilot Anthropic key? Autopilot will stop generating until you set a new one.')) return;
    await window.api.autopilotAI.setKey({ token, apiKey: null });
    setMsg({ kind: 'ok', text: 'Autopilot key removed.' });
    loadConfig();
  }
  async function saveModel() {
    const r = await window.api.autopilotAI.setModel({ token, model: modelInput.trim() || 'claude-haiku-4-5' });
    if (r.ok) { setMsg({ kind: 'ok', text: 'Autopilot model updated.' }); loadConfig(); }
    else setMsg({ kind: 'err', text: r.error });
  }

  async function savePrompt() {
    setSaving(true);
    const pid = activeProfile ? Number(activeProfile) : null;
    const r = await window.api.autopilotAI.setPrompt({ token, job: activeJob, profileId: pid, prompt: draft });
    setSaving(false);
    if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
    setMsg({ kind: 'ok', text: pid ? 'Per-model override saved.' : 'Global default saved.' });
    loadPrompts();
  }
  async function resetPrompt() {
    if (!activeOverride) { setDraft(defaultPrompt); return; }
    if (!confirm('Delete this override and revert to the built-in default?')) return;
    const pid = activeProfile ? Number(activeProfile) : null;
    await window.api.autopilotAI.deletePrompt({ token, job: activeJob, profileId: pid });
    setMsg({ kind: 'ok', text: 'Override removed — falling back to default.' });
    loadPrompts();
  }
  function loadDefault() { setDraft(defaultPrompt); }

  return (
    <div className="card" style={{ marginBottom: 22, borderColor: cfg.hasKey ? 'var(--ok)' : 'var(--border)' }}>
      <h3 style={{ marginBottom: 6 }}>
        Autopilot AI {cfg.hasKey && <span className="mono" style={{ fontSize: 11, color: 'var(--ok)', marginLeft: 8 }}>✓ configured</span>}
        <span className="mono" style={{ fontSize: 10, marginLeft: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(180,140,80,0.15)', color: '#e0b070' }}>SEPARATE KEY</span>
      </h3>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Dedicated Anthropic key for autopilot only — keeps autopilot spend isolated from the composer / research API. If this key isn't set, autopilot will <strong>fail closed</strong> (no fallback to the main Anthropic key). Train the autopilot below by editing the system prompt per job, globally or per model.
      </div>

      {msg && (
        <div className={msg.kind === 'err' ? 'error-banner' : ''} style={msg.kind === 'ok' ? { color: 'var(--ok)', marginBottom: 10, fontSize: 13 } : {}}>
          {msg.text}
        </div>
      )}

      <form onSubmit={saveKey} style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          placeholder={cfg.hasKey ? '••••••••••••••••  (paste a new key to replace)' : 'sk-ant-…'}
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          style={{ flex: 1 }}
          autoComplete="off"
        />
        <button type="submit" className="primary">Save key</button>
        {cfg.hasKey && <button type="button" className="danger" onClick={clearKey}>Remove</button>}
      </form>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Model:</label>
        <input
          type="text"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          placeholder="claude-haiku-4-5"
          style={{ flex: 1 }}
        />
        <button type="button" onClick={saveModel}>Save model</button>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Suggested: <code>claude-haiku-4-5</code> (cheap + fast, default). Use <code>claude-sonnet-4-6</code> for sharper voice at higher cost.
      </div>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <button type="button" className="ghost" onClick={() => setTrainerOpen((v) => !v)} style={{ fontSize: 13 }}>
          {trainerOpen ? '▾' : '▸'} Train the autopilot · edit per-job system prompts
        </button>
      </div>

      {trainerOpen && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {JOBS.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setActiveJob(j.id)}
                className={activeJob === j.id ? 'primary' : 'ghost'}
                style={{ fontSize: 12 }}
              >{j.label}</button>
            ))}
          </div>

          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {JOBS.find((j) => j.id === activeJob)?.help}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Scope:</label>
            <select value={activeProfile} onChange={(e) => setActiveProfile(e.target.value)} style={{ flex: 1 }}>
              <option value="">Global default (all models)</option>
              {prompts.profiles.map((p) => (
                <option key={p.id} value={p.id}>Override for: {p.name}</option>
              ))}
            </select>
            {activeOverride && (
              <span className="mono" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(122,154,90,0.15)', color: '#bdd5a3' }}>OVERRIDE ACTIVE</span>
            )}
          </div>

          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Available variables: {VARS_BY_JOB[activeJob].map((v) => <code key={v} style={{ marginRight: 6 }}>{v}</code>)}
          </div>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            style={{ width: '100%', minHeight: 280, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.45, padding: 10, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', boxSizing: 'border-box' }}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="primary" onClick={savePrompt} disabled={saving || !draft.trim()}>
              {saving ? 'Saving…' : (activeProfile ? 'Save per-model override' : 'Save global default')}
            </button>
            <button type="button" onClick={loadDefault}>Load built-in default</button>
            {activeOverride && (
              <button type="button" className="danger" onClick={resetPrompt}>Delete override</button>
            )}
          </div>

          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            Resolution order at runtime: <strong>per-model override</strong> → <strong>global default</strong> → built-in. Dynamic blocks (example posts, example replies, persona, CTAs, trending topics) are appended automatically after your prompt — you don't need to include them.
          </div>
        </div>
      )}
    </div>
  );
}
