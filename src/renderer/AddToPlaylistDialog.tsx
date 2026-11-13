import React, { useEffect, useRef, useState } from 'react';
import type { Playlist } from '../domain/collections';
import type { Singer, Version } from '../domain/index';

export function AddToPlaylistDialog({ song, playlists, singers, onSave, onClose }: {
  song: Version; playlists: Playlist[]; singers: Singer[];
  onSave: (playlistId: string) => Promise<void>; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [playlistId, setPlaylistId] = useState(playlists[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave(playlistId); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <dialog ref={ref} className="settings-dialog" aria-labelledby="add-to-playlist-title" onCancel={onClose}>
    <form onSubmit={event => void submit(event)}>
      <h2 id="add-to-playlist-title">Add to Playlist</h2>
      <p>{song.title}{song.artist ? ` · ${song.artist}` : ''}</p>
      <label>Playlist<select value={playlistId} onChange={event => setPlaylistId(event.target.value)}>
        {playlists.map(playlist => <option value={playlist.id} key={playlist.id}>{playlist.name}{playlist.singerId ? ` · ${singers.find(s => s.id === playlist.singerId)?.name ?? 'Unknown singer'}` : ''}</option>)}
      </select></label>
      {!playlists.length && <p>Create a singer playlist in Playlists first.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="settings-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving || !playlistId}>Add Song</button></div>
    </form>
  </dialog>;
}
