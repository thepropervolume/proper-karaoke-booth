import React, { useEffect, useRef, useState } from 'react';
import type { Version } from '../domain/index';
import type { EmbeddedMetadataResult } from '../main/embedded-metadata';

const inspectionMessage: Record<Exclude<EmbeddedMetadataResult['status'], 'ready'>, string> = {
  busy: 'A previous tag check is finishing. Try again shortly.',
  cancelled: 'Tag check cancelled.',
  unavailable: 'Could not read embedded tags from this file. Check its availability and try again.',
  changed: 'The source differs from the imported recording. Relink the original video to read its tags.',
  unsupported: 'Embedded tag preview is available for original local MP4 files.',
  'tool-missing': 'FFprobe is unavailable. Add FFprobe to PATH to read embedded tags.',
};

export function EditMetadataDialog({ version, onSave, onClose }: {
  version: Version; onSave: (title: string, artist: string, isDuet: boolean) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(version.title);
  const [artist, setArtist] = useState(version.artist);
  const [isDuet, setIsDuet] = useState(version.isDuet ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tags, setTags] = useState<EmbeddedMetadataResult | null>(null);
  const [reading, setReading] = useState(false);
  const readRequest = useRef<string | null>(null);
  const currentVersion = useRef(version.id);
  currentVersion.current = version.id;
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => {
    setTitle(version.title); setArtist(version.artist); setIsDuet(version.isDuet ?? false);
    setTags(null); setReading(false);
    return () => {
      const request = readRequest.current;
      readRequest.current = null;
      if (request) void window.tpv.cancelEmbeddedMetadata(request).catch(() => {});
    };
  }, [version.id]);

  const readTags = async () => {
    if (readRequest.current) return;
    const request = crypto.randomUUID();
    readRequest.current = request;
    setReading(true); setTags(null);
    try {
      const result = await window.tpv.readEmbeddedMetadata(version.id, request);
      if (readRequest.current === request && currentVersion.current === version.id) setTags(result);
    } catch { if (readRequest.current === request && currentVersion.current === version.id) setTags({ status: 'unavailable' }); }
    finally {
      if (readRequest.current === request) { readRequest.current = null; setReading(false); }
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave(title.trim(), artist.trim(), isDuet); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  const taggedTitle = tags?.status === 'ready' ? tags.title : null;
  const taggedArtist = tags?.status === 'ready' ? tags.artist : null;
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="edit-song-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="edit-song-title">Edit song details</h2>
      <label>Title<input required maxLength={500} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Artist<input maxLength={500} value={artist} onChange={event => setArtist(event.target.value)} /></label>
      {!version.source && <section aria-label="Embedded metadata preview">
        <button type="button" disabled={saving || reading} onClick={() => void readTags()}>Read Embedded Tags</button>
        {reading && <p role="status">Checking the original file…</p>}
        {tags?.status === 'ready' && (taggedTitle || taggedArtist ? <>
          <p role="status">Effective container tags reported by FFprobe. Choose the fields to copy into this edit.</p>
          {taggedTitle && <div className="track-row"><div><strong>Tagged Title</strong><small>{taggedTitle}</small></div>
            <button type="button" disabled={saving} onClick={() => setTitle(taggedTitle)}>Use Tagged Title</button></div>}
          {taggedArtist && <div className="track-row"><div><strong>Tagged Artist</strong><small>{taggedArtist}</small></div>
            <button type="button" disabled={saving} onClick={() => setArtist(taggedArtist)}>Use Tagged Artist</button></div>}
        </> : <p role="status">FFprobe found no usable title or artist tags.</p>)}
        {tags && tags.status !== 'ready' && <p role="status">{inspectionMessage[tags.status]}</p>}
      </section>}
      <label className="settings-check"><input type="checkbox" checked={isDuet} onChange={event => setIsDuet(event.target.checked)} /> Duet</label>
      <p className="muted">Saved in this app's local library. The original video file's tags are not changed.</p>
      {error && <p role="alert">Could not save song details: {error}</p>}
      <div className="settings-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving || !title.trim()}>Save details</button></div>
    </form>
  </dialog>;
}
