import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

export default function DocsPage() {
  const { token } = useAuth();
  const can = useCan();
  const [docs, setDocs] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ title: '', body: '', profile_id: '' });
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState(null);

  const canDelete = can('docs.manage');

  async function loadAll() {
    const [d, p] = await Promise.all([
      window.api.docs.list({ token }),
      window.api.profiles.list({ token }),
    ]);
    if (d.ok) setDocs(d.docs);
    if (p.ok) setProfiles(p.profiles);
  }

  useEffect(() => { loadAll(); }, [token]);

  function openDoc(doc) {
    setSelected(doc);
    setDraft({ title: doc.title, body: doc.body, profile_id: doc.profile_id || '' });
    setDirty(false);
    setErr(null);
  }

  function newDoc() {
    setSelected(null);
    setDraft({ title: 'Untitled', body: '', profile_id: '' });
    setDirty(true);
    setErr(null);
  }

  async function save() {
    setErr(null);
    if (!draft.title.trim()) { setErr('Title required'); return; }
    if (selected) {
      const res = await window.api.docs.update({ token, id: selected.id, title: draft.title, body: draft.body });
      if (!res.ok) { setErr(res.error); return; }
    } else {
      const res = await window.api.docs.create({
        token, title: draft.title, body: draft.body,
        profileId: draft.profile_id ? Number(draft.profile_id) : null,
      });
      if (!res.ok) { setErr(res.error); return; }
    }
    await loadAll();
    setDirty(false);
    if (!selected) {
      const refreshed = await window.api.docs.list({ token });
      if (refreshed.ok && refreshed.docs.length) openDoc(refreshed.docs[0]);
    }
  }

  async function del() {
    if (!selected) return;
    if (!confirm(`Delete "${selected.title}"?`)) return;
    const res = await window.api.docs.delete({ token, id: selected.id });
    if (res.ok) {
      setSelected(null);
      setDraft({ title: '', body: '', profile_id: '' });
      loadAll();
    } else setErr(res.error);
  }

  return (
    <div>
      <div className="title-block" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="eyebrow">Knowledge base</div>
          <h1>Documentation</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Team notes — playbooks, SOPs, per-model strategy, anything the VAs need to read.
          </div>
        </div>
        <button className="primary" onClick={newDoc}>+ New doc</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18, alignItems: 'start' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {docs.length === 0 ? (
            <div className="empty-state" style={{ padding: 22, fontSize: 13, border: 'none' }}>
              No docs yet. Create the first one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {docs.map(d => (
                <button
                  key={d.id}
                  onClick={() => openDoc(d)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    background: selected?.id === d.id ? 'var(--gradient-brand-soft)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    borderRadius: 0,
                    color: 'var(--text-0)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{d.title}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {d.profile_name ? `${d.profile_name} · ` : ''}
                    {d.author_name || 'unknown'} · {new Date(d.updated_at + 'Z').toLocaleDateString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {(selected || dirty) ? (
            <div className="card">
              {err && <div className="error-banner">{err}</div>}
              <input
                value={draft.title}
                onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true); }}
                placeholder="Doc title"
                style={{ fontSize: 22, fontFamily: 'var(--font-display)', background: 'transparent', border: 'none', marginBottom: 12, padding: 0 }}
              />
              {!selected && (
                <div style={{ marginBottom: 12 }}>
                  <label>Attach to a model (optional)</label>
                  <select
                    value={draft.profile_id}
                    onChange={(e) => { setDraft({ ...draft, profile_id: e.target.value }); setDirty(true); }}
                  >
                    <option value="">— general / team-wide —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <textarea
                value={draft.body}
                onChange={(e) => { setDraft({ ...draft, body: e.target.value }); setDirty(true); }}
                placeholder="Write whatever the team needs — markdown supported (headings with #, lists with -, etc.)"
                style={{ minHeight: 360, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7 }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="primary" onClick={save} disabled={!dirty}>
                  {selected ? 'Save changes' : 'Create doc'}
                </button>
                {selected && canDelete && <button className="danger" onClick={del}>Delete</button>}
                {dirty && <button className="ghost" onClick={() => selected ? openDoc(selected) : (setDraft({ title: '', body: '', profile_id: '' }), setDirty(false))}>Discard</button>}
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 60 }}>
              Pick a doc on the left, or click <strong>+ New doc</strong> to write one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
