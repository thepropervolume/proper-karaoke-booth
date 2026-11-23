import React, { useEffect, useRef, useState } from 'react';
import {
  loadSingerProfile, parseSingerProfile, saveSingerProfile, singerRecordingIdentity, starredPlaylist, starredPlaylistName,
  type SingerPlaylist, type SingerPlaylistRecording, type SingerProfileAction,
} from './singer-profile';

const messageFrom = (error: unknown) => error instanceof Error ? error.message : 'That change could not be saved.';

export function useSingerProfile(guestName?: string) {
  const [profile, setProfile] = useState(() => parseSingerProfile(undefined));
  const [loaded, setLoaded] = useState<{ guestName?: string } | null>(null);
  const [storageError, setStorageError] = useState('');
  const currentGuest = useRef(guestName);
  currentGuest.current = guestName;
  const ready = loaded !== null && loaded.guestName === guestName;
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setStorageError('');
    void loadSingerProfile(guestName).then(saved => {
      if (active) { setProfile(saved); setLoaded({ guestName }); }
    }).catch(error => { if (active) setStorageError(messageFrom(error)); });
    return () => { active = false; };
  }, [guestName]);
  async function apply(action: SingerProfileAction): Promise<void> {
    if (!ready) throw new Error(storageError || 'Wait for your singer profile to load.');
    const next = await saveSingerProfile(action, guestName);
    if (currentGuest.current === guestName) setProfile(next);
  }
  return {
    profile, ready, storageError,
    saveIdentity: (displayName: string, email: string) => apply({ type: 'identity', displayName, email }),
    createPlaylist: (name: string, recording?: SingerPlaylistRecording) => apply({ type: 'create-playlist', playlistId: crypto.randomUUID(), name, recording }),
    renamePlaylist: (playlistId: string, name: string) => apply({ type: 'rename-playlist', playlistId, name }),
    removePlaylist: (playlistId: string) => apply({ type: 'remove-playlist', playlistId }),
    addRecording: (playlistId: string, recording: SingerPlaylistRecording) => apply({ type: 'add-recording', playlistId, recording }),
    removeRecording: (playlistId: string, key: string) => apply({ type: 'remove-recording', playlistId, key }),
    setStarred: (recording: SingerPlaylistRecording, selected: boolean, displayName?: string) => apply({
      type: 'set-starred', recording, selected,
      newPlaylistId: Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join(''),
      displayName: guestName ?? displayName,
    }),
  };
}

export type SingerProfileStore = ReturnType<typeof useSingerProfile>;

function useProfileAction() {
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  async function run(action: () => Promise<void>, success: string) {
    setWorking(true);
    setStatus(null);
    try { await action(); setStatus({ text: success, failed: false }); }
    catch (error) { setStatus({ text: messageFrom(error), failed: true }); }
    finally { setWorking(false); }
  }
  return { working, run, status: status && <p role={status.failed ? 'alert' : 'status'}>{status.text}</p> };
}

export function SingerProfilePanel({ store }: { store: SingerProfileStore }) {
  const [name, setName] = useState(store.profile.displayName);
  const [email, setEmail] = useState(store.profile.email);
  const { working, run, status } = useProfileAction();
  useEffect(() => { setName(store.profile.displayName); }, [store.profile.displayName]);
  useEffect(() => { setEmail(store.profile.email); }, [store.profile.email]);
  return <section className="mobile-singer-profile">
    <h2>Singer Profile</h2>
    <form onSubmit={event => { event.preventDefault(); void run(() => store.saveIdentity(name, email), 'Profile saved.'); }}>
      <label>Display name<input autoComplete="nickname" maxLength={100} value={name} disabled={!store.ready || working} onChange={event => setName(event.target.value)} /></label>
      <label>Email (optional)<input type="email" autoComplete="email" maxLength={254} value={email} disabled={!store.ready || working} onChange={event => setEmail(event.target.value)} /></label>
      <p className="mobile-quiet">Your email stays on this device. Rooms use your display name.</p>
      <button className="mobile-primary" disabled={!store.ready || working}>Save Profile</button>
      {status}
      {store.storageError && <p role="alert">{store.storageError}</p>}
    </form>
  </section>;
}

function PlaylistDetails({ playlist, store, renderRecordingAction }: {
  playlist: SingerPlaylist;
  store: SingerProfileStore;
  renderRecordingAction?: (recording: SingerPlaylistRecording) => React.ReactNode;
}) {
  const [name, setName] = useState(playlist.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { working, run, status } = useProfileAction();
  useEffect(() => { setName(playlist.name); }, [playlist.name]);
  return <div className="mobile-playlist-details">
    {!playlist.kind && <form onSubmit={event => { event.preventDefault(); void run(() => store.renamePlaylist(playlist.id, name), 'Playlist renamed.'); }}>
      <label>Playlist name<input maxLength={100} required value={name} disabled={working} onChange={event => setName(event.target.value)} /></label>
      <button disabled={working || name.trim() === playlist.name}>Rename</button>
    </form>}
    {playlist.recordings.length ? <ul className="mobile-songs">{playlist.recordings.map(recording => {
      const key = singerRecordingIdentity(recording);
      if (!key) return null;
      return <li key={key}>
        <span><strong>{recording.title}</strong><br />{recording.artist}</span>
        {renderRecordingAction?.(recording)}
        <button type="button" aria-label={`Remove ${recording.title}`} disabled={working} onClick={() => void run(() => store.removeRecording(playlist.id, key), 'Song removed.')}>Remove</button>
      </li>;
    })}</ul> : <p>No songs saved here yet.</p>}
    {confirmDelete ? <div>
      <button type="button" disabled={working} onClick={() => setConfirmDelete(false)}>Cancel</button>
      <button type="button" disabled={working} onClick={() => void run(() => store.removePlaylist(playlist.id), 'Playlist deleted.')}>Confirm Delete</button>
    </div> : <button type="button" disabled={working} onClick={() => setConfirmDelete(true)}>Delete Playlist</button>}
    {status}
  </div>;
}

export function SingerPlaylistsPanel({ store, renderRecordingAction }: {
  store: SingerProfileStore;
  renderRecordingAction?: (recording: SingerPlaylistRecording) => React.ReactNode;
}) {
  const [name, setName] = useState('');
  const { working, run, status } = useProfileAction();
  return <section className="mobile-singer-playlists">
    <h2>My Playlists</h2>
    <form onSubmit={event => {
      event.preventDefault();
      void run(async () => { await store.createPlaylist(name); setName(''); }, 'Playlist created.');
    }}>
      <label>New playlist<input required maxLength={100} value={name} disabled={!store.ready || working} onChange={event => setName(event.target.value)} /></label>
      <button className="mobile-primary" disabled={!store.ready || working}>Create Playlist</button>
    </form>
    {status}
    {store.storageError && <p role="alert">{store.storageError}</p>}
    {store.ready && !store.profile.playlists.length && <p>Save songs from search to plan your next show.</p>}
    {store.profile.playlists.map(playlist => <details key={playlist.id}>
      <summary>{playlist.name} ({playlist.recordings.length})</summary>
      <PlaylistDetails playlist={playlist} store={store} renderRecordingAction={renderRecordingAction} />
    </details>)}
  </section>;
}

export function SaveToSingerPlaylist({ store, recording }: { store: SingerProfileStore; recording: SingerPlaylistRecording }) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [name, setName] = useState('');
  const { working, run, status } = useProfileAction();
  if (!store.ready || !singerRecordingIdentity(recording)) return null;
  const playlists = store.profile.playlists;
  const selected = destination === 'new' || playlists.some(playlist => playlist.id === destination) ? destination : playlists[0]?.id || 'new';
  return <div className="mobile-save-playlist">
    <button type="button" aria-expanded={open} aria-label={`Save to Playlist for ${recording.title}`} onClick={() => setOpen(!open)}>Save to Playlist</button>
    {open && <div>
      <label>Playlist<select value={selected} disabled={working} onChange={event => setDestination(event.target.value)}>
        {playlists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
        <option value="new">New playlist…</option>
      </select></label>
      {selected === 'new' && <label>New playlist name<input maxLength={100} value={name} disabled={working} onChange={event => setName(event.target.value)} /></label>}
      <button type="button" disabled={working || selected === 'new' && !name.trim()} onClick={() => void run(async () => {
        if (selected === 'new') await store.createPlaylist(name, recording);
        else await store.addRecording(selected, recording);
        setName(''); setOpen(false);
      }, 'Song saved.')}>Save Song</button>
    </div>}
    {status}
  </div>;
}

export function SingerStarButton({ store, recording, displayName }: {
  store: SingerProfileStore; recording: SingerPlaylistRecording; displayName?: string;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const key = singerRecordingIdentity(recording);
  if (!key) return null;
  const playlist = store.ready ? starredPlaylist(store.profile) : undefined;
  const selected = playlist?.recordings.some(item => singerRecordingIdentity(item) === key) ?? false;
  const label = selected ? `Remove ${recording.title} from starred songs` : `Star ${recording.title}`;
  const toggle = async () => {
    setWorking(true);
    setError('');
    try { await store.setStarred(recording, !selected, displayName); }
    catch (failure) { setError(messageFrom(failure)); }
    finally { setWorking(false); }
  };
  return <>
    <button type="button" className="singer-song-star" aria-label={label} aria-pressed={selected}
      title={selected ? label : `Save to ${playlist?.name ?? starredPlaylistName(store.profile.displayName || displayName || '')}`}
      disabled={!store.ready || working} onClick={() => void toggle()}>
      <span aria-hidden="true">{selected ? '★' : '☆'}</span>
    </button>
    {error && <span role="alert">{error}</span>}
  </>;
}
