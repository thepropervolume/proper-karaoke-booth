import React, { useState } from 'react';
import type { MetadataProposal } from '../main/metadata-preview';

/** Explicit preview is necessary: older imports don't record whether metadata was manually edited. */
export function MetadataPreview() {
  const [items, setItems] = useState<MetadataProposal[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const preview = async () => {
    setBusy(true); setMessage(''); setSelected([]);
    try { setItems(await window.tpv.previewFilenameMetadata()); }
    catch (error) { setMessage(`Preview failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!items || !selected.length) return;
    setBusy(true); setMessage(''); let saved = 0; const failures: string[] = [], failedIds = new Set<string>();
    try {
      for (const item of items.filter(entry => selected.includes(entry.id))) {
        try {
          // Refuse a stale proposal if the song was edited while the preview was open.
          const version = (await window.tpv.getState()).versions.find(entry => entry.id === item.id);
          if (!version || version.artist !== item.oldArtist || version.title !== item.oldTitle) throw new Error('Changed since preview');
          const result = await window.tpv.command({ type: 'editVersion', id: item.id, title: item.title, artist: item.artist });
          if (!result.ok) throw new Error(result.error || 'Save failed');
          saved++;
        } catch (error) { failedIds.add(item.id); failures.push(`${item.filename}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      setMessage(`${saved} updated; ${failures.length} failed.${failures.length ? ` ${failures.join('; ')}` : ''}`);
      setItems(current => current?.filter(item => !selected.includes(item.id) || failedIds.has(item.id)) ?? null);
      setSelected([]);
    } finally { setBusy(false); }
  };
  return <div>
    <button type="button" disabled={busy} onClick={() => void preview()}>Preview filename metadata changes</button>
    {items && <div>
      <p>{items.length} proposed {items.length === 1 ? 'change' : 'changes'}. Review carefully: previous manual edits cannot be identified. Saved settings are used; file tags are unchanged.</p>
      {items.length > 0 && <>
        <button type="button" disabled={busy} onClick={() => setSelected(items.map(item => item.id))}>Select all</button>{' '}
        <button type="button" disabled={busy} onClick={() => setSelected([])}>Clear selection</button>
        <div style={{ maxHeight: '16rem', overflowY: 'auto' }}>
          {items.map(item => <label key={item.id} className="settings-check"><input type="checkbox" disabled={busy} checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
            <span><strong>{item.filename}</strong><br />{item.oldArtist || '(no artist)'} — {item.oldTitle} → {item.artist || '(no artist)'} — {item.title}{item.ambiguous ? ' (ambiguous)' : ''}</span></label>)}
        </div>
        <button type="button" disabled={busy || !selected.length} onClick={() => void apply()}>Apply {selected.length} selected</button>
      </>}
    </div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
