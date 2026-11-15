import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Singer, SongRequest, Version } from '../domain';

export function QueueEditDialog({ request, singers, versions, onSave, onClose }: {
  request: SongRequest; singers: Singer[]; versions: Version[];
  onSave: (singerId: string | null, versionId: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [singerId, setSingerId] = useState(request.singerId ?? '');
  const [versionId, setVersionId] = useState(request.versionId);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const choices = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return versions.filter(version => version.id === versionId || `${version.artist} ${version.title}`.toLocaleLowerCase().includes(text));
  }, [versions, query, versionId]);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError('');
    try { await onSave(singerId || null, versionId); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setSaving(false); }
  };
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="edit-request-title"
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="edit-request-title">Edit Queued Request</h2>
      <label>Singer (optional)<select aria-label="Singer" autoFocus value={singerId} disabled={saving} onChange={event => setSingerId(event.target.value)}>
        <option value="">No singer — assign later</option>
        {singers.map(singer => <option key={singer.id} value={singer.id}>{singer.name}</option>)}
      </select></label>
      <label>Find a replacement track<input type="search" value={query} disabled={saving} onChange={event => setQuery(event.target.value)} /></label>
      <label>Chosen track<select aria-label="Chosen track" required value={versionId} disabled={saving} onChange={event => setVersionId(event.target.value)}>
        {!versions.some(version => version.id === versionId) && <option value="">Choose an available track</option>}
        {choices.map(version => <option key={version.id} value={version.id}>{version.artist ? `${version.artist} — ` : ''}{version.title}</option>)}
      </select></label>
      {error && <p role="alert">Could not update request: {error}</p>}
      <div className="settings-actions"><button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button className="primary" type="submit" disabled={saving || !versions.some(version => version.id === versionId)}>Save request</button></div>
    </form>
  </dialog>;
}
