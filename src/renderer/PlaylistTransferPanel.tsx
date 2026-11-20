import React, { useEffect, useRef, useState } from 'react';
import type { Singer } from '../domain';
import type { PlaylistApplyResult, PlaylistDestination, PlaylistExportResult, PlaylistMatchStatus, PlaylistPreviewResult } from '../domain/playlist-transfer';
import '../styles/playlist-transfer.scss';

type TransferBridge = {
  exportPlaylist(id: string): Promise<PlaylistExportResult>;
  previewPlaylist(): Promise<PlaylistPreviewResult>;
  discardPlaylistPreview(token: string): Promise<void>;
  applyPlaylist(token: string, destination: PlaylistDestination): Promise<PlaylistApplyResult>;
  retryPlaylistExportCleanup(): Promise<PlaylistExportResult>;
};
const matchLabel: Record<PlaylistMatchStatus, string> = {
  matched: 'Exact match', unavailable: 'Unavailable in this library', ambiguous: 'Multiple exact matches',
  unidentified: 'No recording identity', duplicate: 'Duplicate entry',
};

export function PlaylistTransferPanel({ bridge, busy, selected, singers, onImported }: {
  bridge: TransferBridge;
  busy: boolean;
  selected?: string;
  singers: readonly Singer[];
  onImported(id: string): Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const [cleanup, setCleanup] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Extract<PlaylistPreviewResult, { status: 'ready' }> | null>(null);
  const [destination, setDestination] = useState<'singer' | 'kj'>('singer');
  const [singer, setSinger] = useState('');
  const [name, setName] = useState('');
  const [page, setPage] = useState(0);
  const alive = useRef(true), token = useRef<string | null>(null);
  const choices = singers.filter(item => !item.archived);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (token.current) void bridge.discardPlaylistPreview(token.current).catch(() => {});
    };
  }, [bridge]);

  const discard = () => {
    if (token.current) void bridge.discardPlaylistPreview(token.current).catch(() => {});
    token.current = null;
    setPreview(null);
  };

  const exporting = async (retry: boolean) => {
    if (running || !retry && !selected) return;
    setRunning(true); setMessage(''); setError('');
    try {
      const result = retry ? await bridge.retryPlaylistExportCleanup() : await bridge.exportPlaylist(selected!);
      if (!alive.current) return;
      setCleanup(result.status === 'cleanup-needed');
      switch (result.status) {
        case 'saved': setMessage(`Exported ${result.count} ${result.count === 1 ? 'song' : 'songs'}.${result.omitted ? ` ${result.omitted} omitted by library policy or unavailable.` : ''}`); break;
        case 'cleanup-needed': setError(result.published ? 'Playlist saved. Temporary export cleanup needs attention.' : 'Playlist could not be saved. Temporary export cleanup needs attention.'); break;
        case 'already-exists': setError('That file already exists. Choose a new filename.'); break;
        case 'too-large': setError('That playlist is too large to export. Use up to 1,000 entries in a 1 MiB file.'); break;
        case 'busy': setError('Finish the current playlist transfer first.'); break;
        case 'cancelled': break;
        default: setError('Could not export this playlist. Choose a new JSON filename on storage that supports hard links.');
      }
    } catch { if (alive.current) setError('Could not export this playlist. Try again.'); }
    finally { if (alive.current) setRunning(false); }
  };

  const openPreview = async () => {
    if (running) return;
    discard(); setRunning(true); setMessage(''); setError('');
    try {
      const result = await bridge.previewPlaylist();
      if (!alive.current) {
        if (result.status === 'ready') await bridge.discardPlaylistPreview(result.token);
        return;
      }
      if (result.status === 'ready') {
        token.current = result.token;
        setPreview(result); setName(result.name); setPage(0); setDestination('singer'); setSinger('');
      } else if (result.status !== 'cancelled') setError(result.status === 'busy'
        ? 'Finish the current playlist transfer first.' : 'Choose a valid Booth playlist JSON file that is no larger than 1 MiB.');
    } catch { if (alive.current) setError('Could not read this playlist. Try again.'); }
    finally { if (alive.current) setRunning(false); }
  };

  const apply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview || running) return;
    setRunning(true); setMessage(''); setError('');
    try {
      const target: PlaylistDestination = destination === 'kj' ? { kind: 'kj' } : { kind: 'singer', singerId: singer, name };
      const result = await bridge.applyPlaylist(preview.token, target);
      if (result.status === 'imported') {
        if (alive.current) { discard(); setMessage(`Added ${result.added} ${result.added === 1 ? 'song' : 'songs'}. ${result.skipped} skipped.`); }
        try { await onImported(result.playlistId); }
        catch { if (alive.current) setError('The playlist was saved. Reopen Collections to refresh the list.'); }
        return;
      }
      if (!alive.current) return;
      if (result.status === 'stale' || result.status === 'failed') {
        discard();
        setError(result.status === 'stale' ? 'The library or preview changed. Choose the file again to review current matches.' : 'Could not apply this preview. Reopen Collections and check the list before trying again.');
      } else setError(result.status === 'no-matches' ? 'There are no exact matches to add.' : result.status === 'busy' ? 'Finish the current playlist transfer first.' : 'Choose an active singer and a playlist name.');
    } catch { if (alive.current) setError('Could not import this playlist. Reopen Collections and check the list before trying again.'); }
    finally { if (alive.current) setRunning(false); }
  };

  const matches = preview?.songs.filter(song => song.status === 'matched').length ?? 0;
  const pages = Math.ceil((preview?.songs.length ?? 0) / 30);
  const songSelectionValid = matches > 0 || (!preview?.songs.length && destination === 'singer');
  const destinationValid = destination === 'kj' || (choices.some(item => item.id === singer) && !!name.trim());
  return <section className="playlist-transfer" aria-label="Playlist transfer">
    <div className="settings-inline-help">
      <button type="button" disabled={busy || running} onClick={() => void openPreview()}>Import Playlist…</button>
      <button type="button" disabled={busy || running || !selected || cleanup} onClick={() => void exporting(false)}>Export Playlist…</button>
      {cleanup && <button type="button" disabled={running} onClick={() => void exporting(true)}>Retry export cleanup</button>}
    </div>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <form onSubmit={event => void apply(event)}>
      <h3>Preview {preview.name}</h3>
      <p role="status">{matches} exact {matches === 1 ? 'match' : 'matches'}. {preview.songs.length - matches} will be skipped. Only recordings saved in this library can match.</p>
      {preview.songs.length > 0 && <ul className="playlist-transfer__matches">
        {preview.songs.slice(page * 30, (page + 1) * 30).map((song, index) => <li className="track-row" key={page * 30 + index}>
          <div><strong>{song.title}</strong>{song.artist && <small>{song.artist}</small>}</div><small>{matchLabel[song.status]}</small>
        </li>)}
      </ul>}
      {pages > 1 && <div className="settings-inline-help">
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous Page</button>
        <span>Page {page + 1} of {pages}</span>
        <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next Page</button>
      </div>}
      <label>Import destination<select aria-label="Import destination" value={destination} onChange={event => setDestination(event.target.value === 'kj' ? 'kj' : 'singer')}>
        <option value="singer">New singer playlist</option><option value="kj">Add to KJ Picks</option>
      </select></label>
      {destination === 'singer' && <>
        <label>Singer<select aria-label="Destination singer" required value={singer} onChange={event => setSinger(event.target.value)}>
          <option value="">Choose a singer</option>{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Playlist name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
      </>}
      <div className="settings-inline-help">
        <button type="button" onClick={() => { discard(); setError(''); }} disabled={running}>Cancel Preview</button>
        <button className="primary" type="submit" disabled={busy || running || !songSelectionValid || !destinationValid}>Import matched songs</button>
      </div>
    </form>}
  </section>;
}
