import React, { useState } from 'react';
import type { CollectionsAction, CollectionsSnapshot } from '../domain/collections';
import type { Singer, Version } from '../domain/index';

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
  const [ownerId, setOwnerId] = useState('');
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [historySinger, setHistorySinger] = useState('');
  const currentPlaylistId = view === 'kj' ? 'kj-picks' : playlistId;
  const playlist = data.playlists.find(p => p.id === currentPlaylistId);
  const songs = data.items.filter(i => i.playlistId === currentPlaylistId).map(i => versions.find(v => v.id === i.versionId)).filter((v): v is Version => !!v);
  const artists = [...new Set(versions.map(v => v.artist.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const history = data.history.filter(h => !historySinger || h.singerId === historySinger);
  const make = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !ownerId) return;
    const id = crypto.randomUUID();
    if (await mutate({ type: 'create', id, name: name.trim(), singerId: ownerId })) { setPlaylistId(id); setName(''); }
  };
  return <section aria-label="Library collections">
    <h2>Collections</h2>
    <nav aria-label="Collection views">
      {([['playlists', 'Singer Playlists'], ['kj', 'KJ Picks'], ['genres', 'Genres'], ['artists', 'Artists'], ['history', 'History']] as const).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
    </nav>
    {(view === 'playlists' || view === 'kj') && <>
      {view === 'playlists' && <form className="inline-form" onSubmit={make}>
        <label>Singer<select value={ownerId} onChange={e => setOwnerId(e.target.value)}><option value="">Choose a singer</option>{singers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <label>New playlist name<input value={name} onChange={e => setName(e.target.value)} maxLength={100} /></label>
        <button type="submit" disabled={busy || !ownerId || !name.trim()}>Create playlist</button>
      </form>}
      {view === 'playlists' ? <label>Playlist<select value={playlistId} onChange={e => setPlaylistId(e.target.value)}>
        <option value="">Choose a playlist</option>{data.playlists.filter(p => p.singerId !== null).map(p => <option key={p.id} value={p.id}>{p.name} · {singers.find(s => s.id === p.singerId)?.name ?? 'Unknown singer'}</option>)}
      </select></label> : <h3>KJ Picks</h3>}
      <p className="muted">Select a song in the library, then add it here. Select a listed song to request it.</p>
      <button disabled={busy || !playlist || !selectedVersionId || !versions.some(v => v.id === selectedVersionId)} onClick={() => void mutate({ type: 'add', playlistId: currentPlaylistId, versionId: selectedVersionId })}>Add selected song</button>
      {songs.map(song => <div className="track-row" key={song.id}><div><strong>{song.title}</strong><small>{song.artist || 'Unknown artist'}</small></div><div><button onClick={() => selectVersion(song.id)}>Select</button> <button disabled={busy} onClick={() => void mutate({ type: 'remove', playlistId: currentPlaylistId, versionId: song.id })} aria-label={`Remove ${song.title} from ${playlist?.name ?? 'playlist'}`}>Remove</button></div></div>)}
      {playlist && !songs.length && <p className="empty">This playlist has no available songs.</p>}
    </>}
    {view === 'artists' && <><label>Artist<select value={artist} onChange={e => setArtist(e.target.value)}><option value="">Choose an artist</option>{artists.map(a => <option value={a} key={a}>{a}</option>)}</select></label>
      {versions.filter(v => artist && v.artist.trim() === artist).map(song => <div className="track-row" key={song.id}><strong>{song.title}</strong><button onClick={() => selectVersion(song.id)}>Select</button></div>)}
      {!artists.length && <p className="empty">No artist metadata is available.</p>}
    </>}
    {view === 'genres' && <p className="empty">Genre metadata is not available in this library yet.</p>}
    {view === 'history' && <><label>Filter by singer<select value={historySinger} onChange={e => setHistorySinger(e.target.value)}><option value="">All singers</option>{singers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      {history.map(item => <div className="track-row" key={item.generationId}><div><strong>{item.title}</strong><small>{item.singer}{item.artist ? ` · ${item.artist}` : ''} · {item.outcome} · {new Date(item.at).toLocaleString()}</small></div></div>)}
      {!history.length && <p className="empty">No completed or skipped performances yet.</p>}
    </>}
  </section>;
}
