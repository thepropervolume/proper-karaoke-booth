import React, { useEffect, useRef, useState } from 'react';
import type { Settings } from '../domain/settings';
import '../styles/settings.scss';

export function SettingsDialog({ value, path, shortcutsPath, onSave, onClose }: {
  value: Settings; path: string; shortcutsPath: string; onSave: (value: Settings) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave(draft); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="settings-title">Preferences</h2>
      <label>Appearance<select value={draft.appearance} onChange={event => setDraft({ ...draft, appearance: event.target.value as Settings['appearance'] })}>
        <option value="system">Follow system</option><option value="night">Night</option><option value="day">Day</option>
      </select></label>
      <label>Workspace layout<select value={draft.layout} onChange={event => setDraft({ ...draft, layout: event.target.value as Settings['layout'] })}>
        <option value="standard">Standard</option><option value="rotation">Wider singer rotation</option><option value="library">Wide song library</option>
      </select></label>
      <label>New song filename format<select value={draft.metadataFormat} onChange={event => setDraft({ ...draft, metadataFormat: event.target.value as Settings['metadataFormat'] })}>
        <option value="artist-title">Artist - Title</option><option value="title-artist">Title - Artist</option><option value="filename">Full filename as title</option>
      </select></label>
      <p className="muted">Used when importing new songs. Existing songs keep their current metadata.</p>
      <label>Queue order<select value={draft.rotationMode} onChange={event => setDraft({ ...draft, rotationMode: event.target.value as Settings['rotationMode'] })}>
        <option value="singer">Singer rotation</option><option value="fifo">First requested, first played</option>
      </select></label>
      <p className="muted">Singer rotation gives each singer a turn before their next song. A staged song stays locked when you change modes.</p>
      <label className="settings-check"><input type="checkbox" checked={draft.autoApprove} onChange={event => setDraft({ ...draft, autoApprove: event.target.checked })} /> Automatically approve new requests</label>
      <p className="muted">Changing this affects new requests; requests already awaiting review remain pending.</p>
      <p className="muted settings-path">Settings file: {path}</p>
      <p className="muted settings-path">Keyboard shortcuts: {shortcutsPath}. Edit the file and restart to apply changes.</p>
      {error && <p role="alert">Could not save preferences: {error}</p>}
      <div className="settings-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving}>Save preferences</button></div>
    </form>
  </dialog>;
}
