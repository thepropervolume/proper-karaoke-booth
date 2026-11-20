import React, { useEffect, useMemo, useState } from 'react';
import type { CollectionsAction, CollectionsSnapshot } from '../domain/collections';
import type { Singer, Version } from '../domain/index';
import { historyView } from '../domain/history-view';
import type { HistoryExportResult } from '../main/history-export';

type Props = {
  data: CollectionsSnapshot;
  singers: Singer[];
  versions: Version[];
  selectedVersionId: string;
  busy: boolean;
  mutate: (action: CollectionsAction) => Promise<boolean>;
  selectVersion: (versionId: string) => void;
};

/** Host-managed lists are tied to local singer IDs. No account or sharing is implied. */
export function CollectionsPanel({ data, singers, versions, selectedVersionId, busy, mutate, selectVersion }: Props) {
  const [view, setView] = useState<'playlists' | 'kj' | 'artists' | 'genres' | 'history'>('playlists');
  const [playlistId, setPlaylistId] = useState('');
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [historySinger, setHistorySinger] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportCleanup, setExportCleanup] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const currentPlaylistId = view === 'kj' ? 'kj-picks' : playlistId;
  const playlist = data.playlists.find(p => p.id === currentPlaylistId);
  const songs = data.items.filter(i => i.playlistId === currentPlaylistId).map(i => versions.find(v => v.id === i.versionId)).filter((v): v is Version => !!v);
  const playlists = data.playlists.filter(p => p.singerId !== null).map(p => ({ playlist: p,
    singer: singers.find(s => s.id === p.singerId)?.name ?? 'Unknown singer',
    count: data.items.filter(item => item.playlistId === p.id).length,
  })).filter(({ playlist: item, singer }) => `${item.name} ${singer}`.toLocaleLowerCase().includes(playlistSearch.trim().toLocaleLowerCase()))
    .sort((a, b) => a.playlist.name.localeCompare(b.playlist.name) || a.singer.localeCompare(b.singer));
  const artists = [...new Set(versions.map(v => v.artist.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const history = useMemo(() => view === 'history' ? historyView(data.history, historySearch, historySinger) : [], [view, data.history, historySearch, historySinger]);
  const applyExportResult = (result: HistoryExportResult) => {
    setExportCleanup(result.status === 'cleanup-needed');
    switch (result.status) {
      case 'saved': setExportMessage(`Exported ${result.count} ${result.count === 1 ? 'performance' : 'performances'} to CSV.`); break;
      case 'cleanup-needed': setExportMessage(result.published ? 'CSV saved, but temporary export cleanup needs attention.' : 'CSV not saved; temporary export cleanup needs attention.'); break;
      case 'already-exists': setExportMessage('That file already exists. Choose a new filename; existing files are never replaced.'); break;
      case 'no-results': setExportMessage('No performances match the current search and singer filter.'); break;
      case 'cancelled': setExportMessage(''); break;
      case 'busy': setExportMessage('Another history export is in progress.'); break;
      default: setExportMessage('Could not export history. Check the destination, free space and hard-link support, then choose a new filename.');
    }
  };
  useEffect(() => {
    if (view !== 'history') return;
    let alive = true;
    void window.tpv.historyExportStatus().then(status => {
      if (alive && status.cleanupNeeded) applyExportResult({ status: 'cleanup-needed', published: status.published });
    }).catch(() => { if (alive) setExportMessage('Could not check the history export status.'); });
    return () => { alive = false; };
  }, [view]);
  const exportHistory = async () => {
    if (exportBusy) return;
    setExportBusy(true); setExportMessage('');
    try { applyExportResult(await window.tpv.exportHistory({ query: historySearch, singerId: historySinger })); }
    catch { setExportMessage('Could not export history. Please try again.'); }
    finally { setExportBusy(false); }
  };
  const retryExportCleanup = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try { applyExportResult(await window.tpv.retryHistoryExportCleanup()); }
    catch { setExportMessage('Could not complete history export cleanup. Please try again.'); }
    finally { setExportBusy(false); }
  };
  const make = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !ownerId) return;
    const id = crypto.randomUUID();
    if (await mutate({ type: 'create', id, name: name.trim(), singerId: ownerId })) { setPlaylistId(id); setName(''); }
  };
  return <section aria-label="Library collections">
    <h2>Collections</h2>
    <nav className="collections-nav" aria-label="Collection views">
      {([['playlists', 'Singer Playlists'], ['kj', 'KJ Picks'], ['genres', 'Genres'], ['artists', 'Artists'], ['history', 'History']] as const).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
    </nav>
    {(view === 'playlists' || view === 'kj') && <>
      {view === 'playlists' && <details><summary>Create a playlist</summary><form className="inline-form" onSubmit={make}>
        <label>Singer<select value={ownerId} onChange={e => setOwnerId(e.target.value)}><option value="">Choose a singer</option>{singers.filter(s => !s.archived).map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <label>New playlist name<input value={name} onChange={e => setName(e.target.value)} maxLength={100} /></label>
        <button type="submit" disabled={busy || !ownerId || !name.trim()}>Create playlist</button>
      </form></details>}
      {view === 'playlists' ? <div className="playlist-browser">
        <label>Find a playlist<input type="search" value={playlistSearch} onChange={e => setPlaylistSearch(e.target.value)} placeholder="Playlist or singer" /></label>
        <div className="playlist-browser__list" aria-label="Singer playlists">{playlists.map(({ playlist: item, singer, count }) =>
          <button type="button" className="playlist-browser__item" key={item.id} aria-pressed={playlistId === item.id} onClick={() => setPlaylistId(item.id)}>
            <strong>{item.name}</strong><small>{singer} · {count} {count === 1 ? 'song' : 'songs'}</small>
          </button>)}</div>
        {!playlists.length && <p className="empty">{playlistSearch.trim() ? 'No playlists match.' : 'No singer playlists yet.'}</p>}
        {playlist && <h3>{playlist.name}</h3>}
      </div> : <h3>KJ Picks</h3>}
      <p className="muted">Select a song in the library to add it here.</p>
      <button disabled={busy || !playlist || !selectedVersionId || !versions.some(v => v.id === selectedVersionId)} onClick={() => void mutate({ type: 'add', playlistId: currentPlaylistId, versionId: selectedVersionId })}>Add selected song</button>
      {songs.map(song => <div className="track-row" key={song.id}><div><strong>{song.title}</strong><small>{song.artist || 'Unknown artist'}</small></div><div><button onClick={() => selectVersion(song.id)}>Select</button> <button disabled={busy} onClick={() => void mutate({ type: 'remove', playlistId: currentPlaylistId, versionId: song.id })} aria-label={`Remove ${song.title} from ${playlist?.name ?? 'playlist'}`}>Remove</button></div></div>)}
      {playlist && !songs.length && <p className="empty">This playlist has no available songs.</p>}
    </>}
    {view === 'artists' && <><label>Artist<select value={artist} onChange={e => setArtist(e.target.value)}><option value="">Choose an artist</option>{artists.map(a => <option value={a} key={a}>{a}</option>)}</select></label>
      {versions.filter(v => artist && v.artist.trim() === artist).map(song => <div className="track-row" key={song.id}><strong>{song.title}</strong><button onClick={() => selectVersion(song.id)}>Select</button></div>)}
      {!artists.length && <p className="empty">No artist metadata is available.</p>}
    </>}
    {view === 'genres' && <p className="empty">Genre metadata is not available in this library yet.</p>}
    {view === 'history' && <><p className="muted">Shows completed and skipped performances recorded since history became available; earlier performances are not included.</p>
      <label>Search history<input type="search" value={historySearch} maxLength={200} placeholder="Singer, artist or title" onChange={e => setHistorySearch(e.target.value)} /></label>
      <label>Filter by singer<select value={historySinger} onChange={e => setHistorySinger(e.target.value)}><option value="">All singers</option>{singers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <p className="muted">Export the matching saved history to a new CSV file. Formula-like text is prefixed with an apostrophe to reduce spreadsheet risk; saving or reopening it may remove that protection.</p>
      <button type="button" onClick={() => void exportHistory()} disabled={busy || exportBusy || exportCleanup || !history.length}>Export matching history…</button>
      {exportCleanup && <button type="button" onClick={() => void retryExportCleanup()} disabled={exportBusy}>Retry export cleanup</button>}
      {exportMessage && <p role="status">{exportMessage}</p>}
      {history.map(item => <div className="track-row" key={item.generationId}><div><strong>{item.title}</strong><small>{item.singer || 'Unassigned'}{item.artist ? ` · ${item.artist}` : ''} · {item.outcome} · {new Date(item.at).toLocaleString()}</small></div></div>)}
      {!history.length && <p className="empty">{data.history.length ? 'No performances match the current search and singer filter.' : 'No completed or skipped performances yet.'}</p>}
    </>}
  </section>;
}
