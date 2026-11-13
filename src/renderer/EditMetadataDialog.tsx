import React, { useEffect, useRef, useState } from 'react';
import type { Version } from '../domain/index';

export function EditMetadataDialog({ version, onSave, onClose }: {
  version: Version; onSave: (title: string, artist: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(version.title);
  const [artist, setArtist] = useState(version.artist);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave(title.trim(), artist.trim()); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="edit-song-title" onCancel={onClose}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="edit-song-title">Edit song details</h2>
      <label>Title<input required maxLength={500} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Artist<input maxLength={500} value={artist} onChange={event => setArtist(event.target.value)} /></label>
      <p className="muted">Saved in this app's local library. The original video file's tags are not changed.</p>
      {error && <p role="alert">Could not save song details: {error}</p>}
      <div className="settings-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving || !title.trim()}>Save details</button></div>
    </form>
  </dialog>;
}
