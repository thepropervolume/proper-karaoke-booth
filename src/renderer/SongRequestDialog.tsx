import React, { useEffect, useRef, useState } from 'react';
import type { Singer, Version } from '../domain/index';
import type { SingerChoice } from './request-singer';

export type { SingerChoice } from './request-singer';

export function SongRequestDialog({ version, singers, onSubmit, onClose }: {
  version: Version;
  singers: Singer[];
  onSubmit: (singer: SingerChoice, singerCreated: (id: string) => void) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [singerId, setSingerId] = useState('');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (saving || (singerId === '__new__' && !name)) return;
    setSaving(true); setError('');
    try {
      await onSubmit(singerId === '__new__' ? { newSingerName: name } : { singerId: singerId || null }, id => { setSingerId(id); setNewName(''); });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="request-song-title"
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="request-song-title">Add to Queue</h2>
      <p><strong>{version.title}</strong>{version.artist ? ` · ${version.artist}` : ''}</p>
      <label>Singer (optional)
        <select autoFocus value={singerId} onChange={event => setSingerId(event.target.value)}>
          <option value="">No singer — assign later</option>
          {singers.map(singer => <option key={singer.id} value={singer.id}>{singer.name}</option>)}
          <option value="__new__">Add a new singer…</option>
        </select>
      </label>
      {singerId === '__new__' && <label>New singer name
        <input autoFocus required maxLength={100} autoComplete="off" value={newName} onChange={event => setNewName(event.target.value)} />
      </label>}
      {error && <p role="alert">Could not add request: {error}</p>}
      <div className="settings-actions">
        <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="primary" type="submit" disabled={saving || (singerId === '__new__' && !newName.trim())}>Add to Queue</button>
      </div>
    </form>
  </dialog>;
}
