import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { Banner, EmptyState, Modal } from '../components/ui.jsx';

// Scripts — named content "Sets" per model, made of ordered "Steps" (one
// photo/video + its message text each). Chatters send Steps in order during
// a chat so content stays consistent across chatters on the same model.
// This standalone page builds/manages Sets (Owner/Admin/Manager); a Chatter
// or VA with 'scripts.use' sees the same page read-only, scoped to models
// they're assigned to. The Browser side panel's mini version (separate
// phase) is a simpler click-through viewer for use mid-chat.

export default function ScriptsPage() {
  const { token, activeTeamId } = useAuth();
  const can = useCan();
  const canManage = can('scripts.manage');

  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [sets, setSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState(null);
  const [detail, setDetail] = useState(null); // { set, steps }
  const [err, setErr] = useState(null);
  const [newSetOpen, setNewSetOpen] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  useEffect(() => {
    window.api.profiles.list({ token, teamId: activeTeamId }).then((r) => {
      if (r.ok) {
        setProfiles(r.profiles);
        if (!profileId && r.profiles.length) setProfileId(String(r.profiles[0].id));
      }
    });
  }, [token, activeTeamId]);

  const loadSets = useCallback(async () => {
    if (!profileId) { setSets([]); return; }
    const r = await window.api.scripts.listSets({ token, profileId: Number(profileId) });
    if (r.ok) setSets(r.sets);
    else setErr(r.error);
  }, [token, profileId]);

  useEffect(() => { loadSets(); setSelectedSetId(null); setDetail(null); }, [loadSets]);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    const r = await window.api.scripts.getSet({ token, id });
    if (r.ok) setDetail(r); else setErr(r.error);
  }, [token]);

  useEffect(() => { loadDetail(selectedSetId); }, [selectedSetId, loadDetail]);

  async function createSet() {
    if (!newSetName.trim()) return;
    const r = await window.api.scripts.createSet({ token, profileId: Number(profileId), name: newSetName.trim() });
    if (r.ok) {
      setNewSetOpen(false); setNewSetName('');
      await loadSets();
      setSelectedSetId(r.id);
    } else setErr(r.error);
  }

  async function deleteSet(id) {
    if (!confirm('Delete this Set and all its Steps? This cannot be undone.')) return;
    const r = await window.api.scripts.deleteSet({ token, id });
    if (r.ok) { setSelectedSetId(null); setDetail(null); loadSets(); }
    else setErr(r.error);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Scripts"
        subtitle="Named content Sets per model — ordered Steps (media + message) that chatters send in sequence."
      />
      {err && <Banner kind="err" style={{ marginBottom: 12 }}>{err}</Banner>}

      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ fontSize: 12 }} className="muted">Model</label>
        <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={{ minWidth: 220 }}>
          {profiles.length === 0 && <option value="">No models available</option>}
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!profileId ? (
        <EmptyState icon="◫" title="No model selected" hint="You need a model assigned to you before you can see its Sets." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18, alignItems: 'start' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {canManage && (
              <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
                <button className="primary" style={{ width: '100%' }} onClick={() => setNewSetOpen(true)}>+ New Set</button>
              </div>
            )}
            {sets.length === 0 ? (
              <EmptyState icon="◫" title="No Sets yet" hint={canManage ? 'Create the first one.' : 'None built for this model yet.'} compact />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {sets.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSetId(s.id)}
                    style={{
                      textAlign: 'left', padding: '12px 14px',
                      background: selectedSetId === s.id ? 'var(--gradient-brand-soft)' : 'transparent',
                      border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0, color: 'var(--text-0)',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{s.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{s.step_count} step{s.step_count === 1 ? '' : 's'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            {detail ? (
              <SetEditor
                key={detail.set.id}
                token={token}
                detail={detail}
                canManage={canManage}
                onChanged={() => { loadDetail(selectedSetId); loadSets(); }}
                onDelete={() => deleteSet(detail.set.id)}
              />
            ) : (
              <EmptyState icon="◫" title="No Set selected" hint="Pick a Set on the left to view its Steps." />
            )}
          </div>
        </div>
      )}

      <Modal open={newSetOpen} onClose={() => setNewSetOpen(false)} title="New Set" width={420}
        footer={<button className="primary" onClick={createSet} disabled={!newSetName.trim()}>Create</button>}>
        <input autoFocus placeholder='e.g. "Bikini Undressing Set"' value={newSetName}
          onChange={(e) => setNewSetName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createSet(); }} style={{ width: '100%' }} />
      </Modal>
    </div>
  );
}

function SetEditor({ token, detail, canManage, onChanged, onDelete }) {
  const { set, steps } = detail;
  const [name, setName] = useState(set.name);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setName(set.name); }, [set.id, set.name]);

  async function saveName() {
    if (!name.trim() || name === set.name) return;
    const r = await window.api.scripts.renameSet({ token, id: set.id, name: name.trim() });
    if (r.ok) onChanged(); else setErr(r.error);
  }

  async function move(stepId, dir) {
    const ids = steps.map((s) => s.id);
    const i = ids.indexOf(stepId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const r = await window.api.scripts.reorderSteps({ token, setId: set.id, orderedIds: ids });
    if (r.ok) onChanged(); else setErr(r.error);
  }

  async function deleteStep(id) {
    if (!confirm('Delete this Step?')) return;
    const r = await window.api.scripts.deleteStep({ token, id });
    if (r.ok) onChanged(); else setErr(r.error);
  }

  async function updateStepText(id, messageText) {
    const r = await window.api.scripts.updateStep({ token, id, messageText });
    if (!r.ok) setErr(r.error);
  }

  return (
    <div className="card">
      {err && <Banner kind="err" style={{ marginBottom: 12 }}>{err}</Banner>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {canManage ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            style={{ fontSize: 20, fontFamily: 'var(--font-display)', background: 'transparent', border: 'none', flex: 1, padding: 0 }}
          />
        ) : (
          <h2 style={{ margin: 0, flex: 1 }}>{set.name}</h2>
        )}
        {canManage && <button className="danger" onClick={onDelete}>Delete Set</button>}
      </div>

      {steps.length === 0 ? (
        <EmptyState icon="◫" title="No Steps yet" hint={canManage ? 'Add the first Step below.' : 'Nothing built here yet.'} compact />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: canManage ? 20 : 0 }}>
          {steps.map((step, i) => (
            <StepRow
              key={step.id}
              token={token}
              step={step}
              index={i}
              total={steps.length}
              canManage={canManage}
              onMove={(dir) => move(step.id, dir)}
              onDelete={() => deleteStep(step.id)}
              onSaveText={(text) => updateStepText(step.id, text)}
            />
          ))}
        </div>
      )}

      {canManage && (
        <AddStepForm token={token} setId={set.id} busy={busy} setBusy={setBusy} setErr={setErr} onAdded={onChanged} />
      )}
    </div>
  );
}

function StepRow({ token, step, index, total, canManage, onMove, onDelete, onSaveText }) {
  const [text, setText] = useState(step.message_text || '');
  const [preview, setPreview] = useState(null); // { dataUrl }
  const [loadingPreview, setLoadingPreview] = useState(false);
  const dirty = text !== (step.message_text || '');

  useEffect(() => { setText(step.message_text || ''); }, [step.id, step.message_text]);

  async function loadPreview() {
    if (preview || loadingPreview) return;
    setLoadingPreview(true);
    const r = await window.api.scripts.readMedia({ token, stepId: step.id });
    setLoadingPreview(false);
    if (r.ok) setPreview({ dataUrl: `data:${r.mediaKind || 'application/octet-stream'};base64,${r.dataBase64}` });
  }

  return (
    <div style={{ display: 'flex', gap: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 12 }}>
      <div style={{ width: 26, textAlign: 'center', fontSize: 11 }} className="muted">#{index + 1}</div>

      <div style={{ width: 96, flexShrink: 0 }}>
        {step.media_path ? (
          preview ? (
            String(step.media_kind).startsWith('video/')
              ? <video src={preview.dataUrl} controls style={{ width: '100%', borderRadius: 8 }} />
              : <img src={preview.dataUrl} alt="" style={{ width: '100%', borderRadius: 8, objectFit: 'cover' }} />
          ) : (
            <button className="ghost" onClick={loadPreview} disabled={loadingPreview}
              style={{ width: '100%', height: 72, display: 'grid', placeItems: 'center', fontSize: 22 }}>
              {loadingPreview ? '…' : (String(step.media_kind).startsWith('video/') ? '🎬' : '🖼')}
            </button>
          )
        ) : (
          <div className="muted" style={{ width: '100%', height: 72, display: 'grid', placeItems: 'center', fontSize: 11, border: '1px dashed var(--border)', borderRadius: 8 }}>
            text only
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {canManage ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message text sent with this Step"
            style={{ minHeight: 56, fontSize: 13 }}
          />
        ) : (
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{text || <span className="muted">(no message text)</span>}</div>
        )}
        {canManage && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="ghost" style={{ fontSize: 11, padding: '2px 8px' }} disabled={!dirty} onClick={() => onSaveText(text)}>Save</button>
            <button className="ghost" style={{ fontSize: 11, padding: '2px 8px' }} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
            <button className="ghost" style={{ fontSize: 11, padding: '2px 8px' }} disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
            <button className="danger" style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }} onClick={onDelete}>Remove</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddStepForm({ token, setId, busy, setBusy, setErr, onAdded }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);

  async function submit() {
    if (!text.trim() && !file) { setErr('Add a message, media, or both.'); return; }
    setBusy(true);
    try {
      let fileName = null, dataBase64 = null, mediaKind = null;
      if (file) {
        fileName = file.name;
        mediaKind = file.type || 'application/octet-stream';
        dataBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      const r = await window.api.scripts.addStep({ token, setId, messageText: text, fileName, dataBase64, mediaKind });
      if (r.ok) { setText(''); setFile(null); onAdded(); } else setErr(r.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Add a Step</div>
      <textarea
        placeholder="Message text (optional if attaching media)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ minHeight: 56, fontSize: 13, width: '100%', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button className="primary" onClick={submit} disabled={busy}>{busy ? 'Adding…' : '+ Add Step'}</button>
      </div>
    </div>
  );
}
