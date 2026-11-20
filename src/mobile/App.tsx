import { QueueDialog } from './QueueDialog';
import { DeviceStorage } from './DeviceStorage';
import { version as appVersion } from '../../package.json';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MobileShow, type MobileSong, type MobileShowState } from './show';
import { loadMobileShow, saveLocalMedia, saveMobileShow, acquireMobileHostLock, MobileHostLockUnsupported, preserveMobileRecovery, listMobileRecoveries, readMobileRecovery, deleteLocalMedia, relinkLocalMedia, listLocalVideoCopies, type LocalVideoCopy } from './storage';
import { Capacitor } from '@capacitor/core';
import { parseMobileCatalog, youtubeLink } from './catalog';
import { mobileFetch, mobileJson } from './api';
import { MobilePlayer, type PlayerHandle } from './Player';
import { createApplausePlayer } from '../display/applause-player';
import { applauseClips } from '../display/applause-clips';
import { MobileHostedRoom, type MobileRoomStatus } from './hosted-room';
import { MobileRoomAuthority } from './room-authority';
import { advertiseMobileRoom, discoverRooms, roomSlug, stopMobileDiscovery, type DiscoveredRoom } from './discovery';
import { SingerClient } from '../remote/client';
import { SingerPage } from '../remote/SingerPage';
import { internetGuestTransport, lookupInternetSingerRoom } from '../remote/internet-transport';
import '@fontsource/nunito-sans/latin-400.css';
import '@fontsource/nunito-sans/latin-700.css';
import './mobile.css';
const clock = (value: number) => Number.isFinite(value) && value >= 0 ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'That action could not be completed.';
export function MobileApp({ model, writable = true, pendingSaves }: { model: MobileShow; writable?: boolean; pendingSaves: React.RefObject<Promise<unknown>> }) {
  const [state, setState] = useState<MobileShowState>(() => model.state());
  const [mode, setMode] = useState<'choose' | 'host' | 'guest'>('choose'), [tab, setTab] = useState<'songs' | 'queue' | 'favorites' | 'history' | 'storage' | 'room'>('songs');
  const [client, setClient] = useState<SingerClient | null>(null), [query, setQuery] = useState(''), [results, setResults] = useState<MobileSong[]>([]), [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [nearby, setNearby] = useState<DiscoveredRoom[]>([]), [roomInput, setRoomInput] = useState(''), [joining, setJoining] = useState(false);
  const [queueSong, setQueueSong] = useState<MobileSong | null>(null), [youtubeUrl, setYoutubeUrl] = useState('');
  const [playing, setPlaying] = useState(false), [elapsed, setElapsed] = useState(state.positionSeconds), [duration, setDuration] = useState(0), [gapUntil, setGapUntil] = useState(0), [tick, setTick] = useState(Date.now());
  const [roomStatus, setRoomStatus] = useState<MobileRoomStatus>({ state: 'stopped', link: '', message: '' }), [roomBusy, setRoomBusy] = useState(false), [discoverable, setDiscoverable] = useState(true);
  const [roomName, setRoomName] = useState(state.name), [slug, setSlug] = useState(`karaoke-${crypto.randomUUID().slice(0, 8)}`);
  const [photo, setPhoto] = useState<{ id: string; dataUrl: string } | null>(null);
  const [deviceCopies, setDeviceCopies] = useState<LocalVideoCopy[] | null>(null);
  const [mediaLoadFailed, setMediaLoadFailed] = useState(false), [mediaScan, setMediaScan] = useState(0), [mediaBusy, setMediaBusy] = useState(false);
  const mediaWrite = useRef(false);
  const dismissedRooms = useRef(new Set<string>()), [mediaRevision, setMediaRevision] = useState(0);
  const joinEpoch = useRef(0), modeRef = useRef(mode); modeRef.current = mode;
  const alive = useRef(true), discoveryEnabled = useRef(discoverable); discoveryEnabled.current = discoverable;
  const player = useRef<PlayerHandle>(null), playRef = useRef(playing); playRef.current = playing;
  const lastCheckpointAt = useRef(0);
  const checkpointNow = useCallback(() => {
    if (modeRef.current !== 'host') return;
    const id = model.current()?.id, position = player.current?.position();
    if (id && position != null) { model.checkpoint(id, position); lastCheckpointAt.current = Date.now(); }
  }, [model]);
  const applausePlayer = useMemo(() => createApplausePlayer(applauseClips), []);
  const activePhoto = useRef<{ id: string; timer: ReturnType<typeof setTimeout>; resolve?: () => void; reject?: (error: Error) => void } | null>(null);
  const playApplause = useCallback(async () => {
    if (modeRef.current !== 'host') throw new Error('The host screen is not available.');
    const result = await applausePlayer.play({ id: crypto.randomUUID(), volume: model.state().volume, outputId: '' });
    if (!result.ok) throw new Error(result.error || 'Could not play applause.');
  }, [applausePlayer, model]);
  const displayPhoto = useCallback((dataUrl: string) => new Promise<void>((resolve, reject) => {
    if (!alive.current || modeRef.current !== 'host' || document.fullscreenElement) { reject(new Error('The host screen is not available for photos.')); return; }
    if (activePhoto.current) { reject(new Error('A photo is already being shown.')); return; }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (activePhoto.current?.id === id) { activePhoto.current = null; setPhoto(null); reject(new Error('Photo could not be displayed.')); }
    }, 8000);
    activePhoto.current = { id, timer, resolve, reject };
    setPhoto({ id, dataUrl });
  }), []);
  const authority = useMemo(() => new MobileRoomAuthority(model, () => setState(model.state()), playApplause, displayPhoto), [model, playApplause, displayPhoto]);
  const room = useMemo(() => new MobileHostedRoom(authority, status => { if (alive.current) setRoomStatus(status); }, () => discoveryEnabled.current, async () => { await pendingSaves.current; }), [authority]);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = model.subscribe(() => {
      const value = model.state(); setState(value);
      if (writable) { pendingSaves.current = pendingSaves.current.catch(() => {}).then(() => saveMobileShow(value)); void pendingSaves.current.catch(error => { if (alive.current) { setPlaying(false); setError(errorText(error)); } }); }
    });
    const pause = () => { if (document.hidden) { checkpointNow(); setPlaying(false); setNotice('Playback paused while the app is in the background.'); } };
    document.addEventListener('visibilitychange', pause);
    return () => { alive.current = false; unsubscribe(); document.removeEventListener('visibilitychange', pause); applausePlayer.stop(); const photo = activePhoto.current; activePhoto.current = null; if (photo) { clearTimeout(photo.timer); photo.reject?.(new Error('The host screen closed.')); } void room.stop().catch(() => {}); void stopMobileDiscovery().catch(() => {}); };
  }, [model, room, writable, pendingSaves, checkpointNow]);
  useEffect(() => { setElapsed(state.positionSeconds); setDuration(0); lastCheckpointAt.current = 0; }, [state.currentId]);
  useEffect(() => {
    if (!writable) return;
    let active = true;
    setMediaLoadFailed(false);
    void listLocalVideoCopies().then(copies => {
      if (!active) return;
      model.loadLocalCopies(copies.map(copy => copy.id));
      setDeviceCopies(copies);
    }).catch(() => { if (active) setMediaLoadFailed(true); });
    return () => { active = false; };
  }, [model, writable, mediaScan]);
  useEffect(() => {
    model.setPlaybackActive(mode === 'host' && playing && !gapUntil && !!state.currentId);
  }, [model, mode, playing, gapUntil, state.currentId]);
  useEffect(() => { applausePlayer.setVolume(state.volume); }, [applausePlayer, state.volume]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 8000); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (mode === 'guest') return;
    const controller = new AbortController();
    const scan = () => void discoverRooms(controller.signal).then(rooms => { if (!controller.signal.aborted) setNearby(rooms.filter(r => r.slug !== slug && !dismissedRooms.current.has(r.instance))); }).catch(() => {});
    scan(); const timer = setInterval(scan, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [mode, slug]);
  useEffect(() => {
    if (roomStatus.state === 'online' && roomStatus.link && discoverable) void advertiseMobileRoom(roomStatus.link, roomName).catch(() => {});
    else void stopMobileDiscovery().catch(() => {});
  }, [roomStatus.state, roomStatus.link, discoverable, roomName]);
  useEffect(() => {
    if (mode !== 'host' || tab !== 'songs' || query.trim().length < 2) { setResults([]); setSearching(false); return; }
    const controller = new AbortController(); setResults([]); setSearching(true);
    const timer = setTimeout(() => { void mobileJson('/v1/mobile/catalog', { query: query.trim() }, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setResults(parseMobileCatalog(value));
    }).catch(() => { if (!controller.signal.aborted) setNotice('Online catalog unavailable. Saved songs are still available.'); }).finally(() => { if (!controller.signal.aborted) setSearching(false); }); }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mode, tab, query]);
  useEffect(() => {
    if (!gapUntil || !playing || mode !== 'host') return;
    const timer = setInterval(() => {
      const now = Date.now(); setTick(now);
      // Re-read the model before starting, including settings changed during the gap.
      if (!model.state().autoAdvance) { setGapUntil(0); setPlaying(false); return; }
      if (now >= gapUntil) { setGapUntil(0); if (!model.start()) setPlaying(false); }
    }, 250);
    return () => clearInterval(timer);
  }, [gapUntil, playing, mode, model]);
  useEffect(() => {
    if (gapUntil && !state.autoAdvance) { setGapUntil(0); setPlaying(false); }
  }, [gapUntil, state.autoAdvance]);
  const current = state.queue.find(r => r.id === state.currentId), currentSong = state.songs.find(s => s.id === current?.songId) ?? null;
  const songs = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const local = state.songs.filter(s => terms.every(t => `${s.title} ${s.artist}`.toLocaleLowerCase().includes(t)));
    const known = new Set(local.map(s => s.id));
    return [...local, ...results.filter(s => !known.has(s.id))];
  }, [state.songs, query, results]);
  const run = async (work: () => void | Promise<void>) => { setError(''); try { await work(); } catch (error) { setError(errorText(error)); } };
  const writeMedia = (work: () => Promise<void>) => run(async () => {
    if (!writable || !deviceCopies || mediaWrite.current) return;
    mediaWrite.current = true; setMediaBusy(true);
    try { await work(); } finally { mediaWrite.current = false; setMediaBusy(false); }
  });
  const recordCopy = (id: string, file: File) => {
    model.setLocalCopy(id, true);
    setDeviceCopies(copies => copies && [...copies.filter(copy => copy.id !== id), { id, bytes: file.size, fileName: file.name }]);
  };
  const removeDeviceCopy = (id: string) => writeMedia(async () => {
    await model.removeLocalCopy(id, deleteLocalMedia);
    setDeviceCopies(copies => copies?.filter(copy => copy.id !== id) ?? null);
    setNotice('Device copy removed.');
  });
  const relinkDeviceCopy = (id: string, file: File) => writeMedia(async () => {
    await relinkLocalMedia(id, file);
    recordCopy(id, file);
    const active = model.current()?.songId === id;
    if (active) { checkpointNow(); setPlaying(false); setMediaRevision(value => value + 1); }
    setNotice(active ? 'Video relinked. Press Play to continue.' : 'Video relinked.');
  });
  const next = (skipped = false) => {
    if (!model.current()) return;
    model.finish(skipped); setElapsed(0); setDuration(0);
    if (playRef.current && state.autoAdvance) { setTick(Date.now()); setGapUntil(Date.now() + state.gapSeconds * 1000); }
    else setPlaying(false);
  };
  const togglePlay = () => {
    setError('');
    if (playing) { checkpointNow(); setPlaying(false); return; }
    if (gapUntil) { setGapUntil(0); }
    const active = model.current();
    if (active && currentSong && !model.canRequest(currentSong)) { setNotice('Relink the active video in Songs before playing it.'); return; }
    if (!active && !model.start()) {
      setNotice(state.queue.some(request => request.status === 'accepted') ? 'No queued song is ready. Check the queue for missing videos or unavailable singers.' : 'Add a song to the queue first.');
      return;
    }
    setPlaying(true);
  };
  const join = async (value: string) => {
    const target = roomSlug(value); if (!target || joining) { if (!target) setError('Enter a room name or a queue.thepropervolume.com link.'); return; }
    setJoining(true); setError('');
    const epoch = ++joinEpoch.current;
    try {
      const remote = await lookupInternetSingerRoom(target, mobileFetch); if (!remote.online) throw new Error('That host is offline. Try again when the room is connected.');
      await room.stop(); checkpointNow(); setPlaying(false); setGapUntil(0); setMode('guest');
      setClient(new SingerClient(internetGuestTransport(remote, { fetch: mobileFetch, onEnded: () => { if (joinEpoch.current === epoch && modeRef.current === 'guest') { setClient(null); setError('This room ended. Ask the host for a new link.'); } } }), ''));
    } catch (error) { setError(errorText(error)); } finally { setJoining(false); }
  };
  const importFiles = async (selection: File[]) => {
    if (!selection.length) return;
    const failures: string[] = []; let count = 0;
    for (const file of selection.slice(0, 20)) {
      if (!/\.(mp4|webm|m4v|mov)$/i.test(file.name)) { failures.push(`${file.name}: unsupported file type`); continue; }
      const song: MobileSong = { id: crypto.randomUUID(), provider: 'local', fileName: file.name, title: file.name.replace(/\.[^.]+$/, ''), artist: '' };
      try { await saveLocalMedia(song.id, file); }
      catch { failures.push(`${file.name}: could not save; check device storage`); continue; }
      try { model.add([song]); recordCopy(song.id, file); count++; }
      catch (error) {
        // If rollback fails, the unlinked copy is still visible in Device Storage and can be removed there.
        await deleteLocalMedia(song.id).catch(() => recordCopy(song.id, file));
        failures.push(`${file.name}: ${errorText(error)}`);
      }
    }
    setNotice(`${count} video${count === 1 ? '' : 's'} imported.${selection.length > 20 ? ` ${selection.length - 20} skipped; import up to 20 at a time.` : ''}`);
    if (failures.length) setError(failures.join(' · '));
  };
  const exportJson = (value: unknown, filename: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const renderSong = (song: MobileSong) => <li key={song.id} className={`mobile-song source-${song.provider}`}>
    <div><strong>{song.title}</strong><span>{song.artist || 'Unknown Artist'}</span><small>{song.provider === 'karaokenerds' ? `Karaoke Nerds${song.brand ? ` · ${song.brand}` : ''}` : song.provider === 'youtube' ? 'YouTube' : model.canRequest(song) ? 'On This Device' : deviceCopies ? 'Relink Video' : mediaLoadFailed ? 'Storage Unavailable' : 'Checking Device Copy'}</small></div>
    <button type="button" aria-label={`${state.favorites.includes(song.id) ? 'Unfavorite' : 'Favorite'} ${song.title}`} aria-pressed={state.favorites.includes(song.id)} onClick={() => void run(() => { model.add([song]); model.favorite(song.id); })}>{state.favorites.includes(song.id) ? '♥' : '♡'}</button>
    <button type="button" aria-label={`Queue ${song.title}`} disabled={!model.canRequest(song)} onClick={() => { setQueueSong(song); }}>＋</button>
    <details className="mobile-song-options"><summary aria-label={`Manage ${song.provider === 'local' ? 'local video ' : ''}${song.title}`}>⋯</summary><div>
      <button type="button" onClick={() => void run(() => { model.add([song]); model.setDuet(song.id, !song.isDuet); })}>{song.isDuet ? 'Mark as Solo' : 'Mark as Duet'}</button>
      {song.provider === 'local' && <><label>Relink Video<input type="file" accept="video/*" disabled={!deviceCopies || mediaBusy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void relinkDeviceCopy(song.id, file); event.currentTarget.value = ''; }} /></label>
      <button type="button" onClick={() => setTab('storage')}>Manage Device Copies</button></>}
    </div></details>
  </li>;
  return <div className="mobile-app">
    <header className="mobile-header"><a href="./" onClick={event => { event.preventDefault(); checkpointNow(); setMode('choose'); setPlaying(false); }} aria-label="The Proper Volume home"><img src="./icon-192.png" alt="" /><strong>TPV Karaoke</strong></a><span className="mobile-version">{appVersion}</span>
      {mode !== 'choose' && <button type="button" onClick={() => { checkpointNow(); setMode('choose'); setPlaying(false); }}>Switch Mode</button>}</header>
    {error && <div className="mobile-alert" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="mobile-notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {mode !== 'guest' && nearby.length > 0 && <section className="mobile-nearby" aria-label="Detected karaoke rooms"><h2>Join a Karaoke Room?</h2>
      <p>{nearby.some(r => r.method === 'bonjour') ? 'A host is advertising on your local network.' : 'These hosts share your internet connection; confirm the room with your host.'}</p>
      {nearby.map(found => <div key={found.instance}><strong>{found.name}</strong><button disabled={joining} onClick={() => void join(found.slug)}>Join Room</button><button aria-label={`Dismiss ${found.name}`} onClick={() => { dismissedRooms.current.add(found.instance); setNearby(rows => rows.filter(r => r.instance !== found.instance)); }}>×</button></div>)}</section>}
    {mode === 'choose' && <main className="mobile-welcome"><img className="mobile-welcome-icon" src="./icon-512.png" alt="" /><h1>Your Karaoke. Anywhere.</h1>{!writable && <p role="status">Full Host is open in another window, or this browser cannot protect saved shows. You can still join a room below.</p>}<p>Host your own show or join a room.</p>
      {roomStatus.link && <aside className="mobile-nearby"><strong>Your room is still open.</strong><p>Singers can keep requesting songs while playback is paused.</p><button onClick={() => { setMode('host'); setTab('room'); }}>Return to Room</button><button onClick={() => void run(() => room.stop())}>Close Room</button></aside>}
      <button disabled={!writable} className="mobile-primary mobile-mode" onClick={() => { setMode('host'); setTab('songs'); }}>Full Host Mode<span>Play, queue and invite singers.</span></button>
      <form className="mobile-join" onSubmit={event => { event.preventDefault(); void join(roomInput); }}><h2>Piggyback Mode</h2><label>Room name or link<input value={roomInput} maxLength={200} autoCapitalize="none" autoCorrect="off" autoComplete="off" onChange={event => setRoomInput(event.target.value)} placeholder="proper-volume" required /></label><button disabled={joining}>{joining ? 'Connecting…' : 'Join a Host’s Room'}</button></form>
      <p className="mobile-quiet">Install from your browser’s menu → Add to Home Screen.</p></main>}
    {mode === 'guest' && <><div className="mobile-mode-label">Piggyback Mode · Singers</div>{client ? <SingerPage client={client} /> : <main><p>Choose another room to continue.</p><button onClick={() => setMode('choose')}>Find a Room</button></main>}</>}
    {mode === 'host' && <>
      <main className="mobile-host-main"><div className="mobile-mode-label">Full Host Mode</div><h1>{state.name}</h1>
        <MobilePlayer onPlayback={active => { if (!active) checkpointNow(); setPlaying(active); }} ref={player} song={currentSong} playing={playing && !gapUntil} volume={state.volume} generation={`${current?.id ?? 'idle'}:${mediaRevision}`} startPosition={state.positionSeconds} onEnded={() => next(false)}
          onBlocked={() => { setPlaying(false); setNotice('Tap Play in the video to allow audio on this device.'); }}
          onError={message => { checkpointNow(); setPlaying(false); setError(message); }} onTime={(time, total) => { setElapsed(time); setDuration(Number.isFinite(total) ? total : 0); if (current?.id && Date.now() - lastCheckpointAt.current >= 1000) { model.checkpoint(current.id, time); lastCheckpointAt.current = Date.now(); } }} />
        {gapUntil > 0 && <p role="status">Next song in {Math.max(0, Math.ceil((gapUntil - tick) / 1000))}s{!playing ? ' · Paused' : ''}</p>}
        <nav className="mobile-tabs" aria-label="Host workspace">{(['songs', 'queue', 'favorites', 'history', 'storage', 'room'] as const).map(value => <button aria-current={tab === value ? 'page' : undefined} key={value} onClick={() => setTab(value)}>{value === 'queue' ? `Queue (${state.queue.filter(r => r.status === 'accepted').length})` : value[0].toUpperCase() + value.slice(1)}</button>)}</nav>
        {tab === 'songs' && <section><label className="mobile-search">Search Songs<input type="search" placeholder="Artist or song title" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label>
          {searching && <p role="status">Searching Karaoke Nerds…</p>}<ul className="mobile-songs">{songs.map(renderSong)}</ul>{!songs.length && !searching && <p className="mobile-empty">Search the catalog or import a video below.</p>}
          <details><summary>Add a Video</summary><label className="mobile-file">Import Local Video<input type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" disabled={!deviceCopies || mediaBusy} multiple onChange={event => { const files = Array.from(event.currentTarget.files ?? []); void writeMedia(() => importFiles(files)); event.currentTarget.value = ''; }} /></label>
            <form onSubmit={event => { event.preventDefault(); void run(() => { const song = youtubeLink(youtubeUrl); if (!song) throw new Error('Use an HTTPS YouTube watch or youtu.be link.'); setQueueSong(song); setYoutubeUrl(''); }); }}><label>YouTube karaoke link<input type="url" value={youtubeUrl} onChange={event => setYoutubeUrl(event.target.value)} required /></label><button>Add YouTube Video</button></form></details>
        </section>}
        {tab === 'queue' && <section><h2>Singer Queue</h2>{current && <p><strong>Now: {currentSong?.title}</strong> · {[current.singer, state.singers.find(s => s.id === current.coSingerId)?.name].filter(Boolean).join(' & ') || 'Unassigned'}</p>}
          <ol className="mobile-queue">{state.queue.filter(r => r.status === 'accepted').map((request, i, waiting) => { const song = state.songs.find(s => s.id === request.songId); return <li key={request.id}><div><strong>{song?.title}</strong><span>{[request.singer, state.singers.find(s => s.id === request.coSingerId)?.name].filter(Boolean).join(' & ') || 'Unassigned'}</span>{song && !model.canRequest(song) && <span>Waiting for a device copy</span>}</div>
            <button aria-label={`Move ${song?.title} up`} disabled={i === 0} onClick={() => model.move(request.id, -1)}>↑</button><button aria-label={`Move ${song?.title} down`} disabled={i === waiting.length - 1} onClick={() => model.move(request.id, 1)}>↓</button><button aria-label={`Remove ${song?.title}`} onClick={() => void run(() => model.remove(request.id))}>×</button></li>; })}</ol>
          {!state.queue.some(r => r.status === 'accepted') && <p>No songs waiting. Add one from Songs.</p>}
          {authority.missing.length > 0 && <details><summary>Unavailable Song Requests ({authority.missing.length})</summary><ul>{authority.missing.map((r, i) => <li key={i}>{r.singer}: {r.artist} — {r.title}</li>)}</ul></details>}</section>}
        {tab === 'favorites' && <section><h2>Your Favorites</h2><ul className="mobile-songs">{state.songs.filter(s => state.favorites.includes(s.id)).map(renderSong)}</ul>{!state.favorites.length && <p>Tap a heart beside a song to save it here.</p>}</section>}
        {tab === 'history' && <section><h2>Show History</h2><ol className="mobile-history">{state.history.map((entry, i) => <li key={i}><strong>{state.songs.find(s => s.id === entry.songId)?.title}</strong><span>{entry.singer || 'Unassigned'} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(entry.at)}</span></li>)}</ol>{!state.history.length && <p>Completed songs will appear here.</p>}</section>}
        {tab === 'storage' && <DeviceStorage copies={deviceCopies} songs={state.songs} queue={state.queue} loadFailed={mediaLoadFailed} busy={mediaBusy}
          onRetry={() => setMediaScan(value => value + 1)} onRemove={id => void removeDeviceCopy(id)} />}
        {tab === 'room' && <section className="mobile-room"><h2>Your Room</h2><label>Booth name<input value={roomName} maxLength={100} onChange={event => setRoomName(event.target.value)} onBlur={() => void run(() => model.settings({ name: roomName.trim() }))} /></label>
          <label>Room address<input value={slug} disabled={roomStatus.state === 'online' || roomStatus.state === 'reconnecting' || roomBusy || roomStatus.pending} maxLength={48} autoCapitalize="none" autoCorrect="off" onChange={event => setSlug(event.target.value)} /></label>
          <label className="mobile-check"><input type="checkbox" checked={discoverable} onChange={event => setDiscoverable(event.target.checked)} />Suggest this room to nearby singers</label>
          <p role="status">{roomStatus.message || 'Open your room to accept requests from other phones.'}</p>
          {roomStatus.link && <><label>Singer link<input readOnly value={roomStatus.link} onFocus={event => event.currentTarget.select()} /></label><button onClick={() => void run(async () => { await navigator.clipboard.writeText(roomStatus.link); setNotice('Singer link copied.'); })}>Copy Singer Link</button></>}
          <button className="mobile-primary" disabled={roomBusy} onClick={() => { setRoomBusy(true); void run(() => roomStatus.pendingAction === 'close' || roomStatus.state === 'online' || roomStatus.state === 'reconnecting' ? room.stop() : room.start(slug)).finally(() => setRoomBusy(false)); }}>{roomStatus.pendingAction === 'close' ? 'Retry Closing Room' : roomStatus.state === 'online' || roomStatus.state === 'reconnecting' ? 'Close Room' : roomStatus.pendingAction === 'open' ? 'Retry Open' : 'Open Room'}</button>{roomStatus.pendingAction === 'open' && <button disabled={roomBusy} onClick={() => void run(() => room.stop())}>Close Pending Room</button>}
          <p className="mobile-quiet">Keep the host app open. Room access ends when the session closes or expires. Anyone with your link can request published songs.</p>
          <h2>Playback</h2><label className="mobile-check"><input type="checkbox" checked={state.autoAdvance} onChange={event => model.settings({ autoAdvance: event.target.checked })} />Play the next song automatically</label>
          <label>Gap between songs (seconds)<input type="number" min={0} max={3600} value={state.gapSeconds} onChange={event => void run(() => model.settings({ gapSeconds: Number(event.target.value) }))} /></label>
          <label className="mobile-check"><input type="checkbox" checked={state.applauseEnabled} onChange={event => model.settings({ applauseEnabled: event.target.checked })} />Enable applause</label>
          <label className="mobile-check"><input type="checkbox" checked={state.pointsEnabled} onChange={event => model.settings({ pointsEnabled: event.target.checked })} />Enable singer points</label>
          {state.singers.length > 0 && <section><h2>Singers</h2><ul>{state.singers.map(singer => { const account = state.points?.accounts.find(item => item.singerId === singer.id); return <li key={singer.id}>{singer.name}{state.pointsEnabled ? ` · ${account?.points ?? 0} points` : ''}{state.applauseEnabled ? ` · ${account?.credits ?? 3} applause credits` : ''}</li>; })}</ul></section>}
          <h2>Your Data</h2><button onClick={() => exportJson(model.state(), 'tpv-mobile-show.json')}>Export Show and History</button><button onClick={() => void run(async () => { const latest = (await listMobileRecoveries()).at(-1); if (!latest) { setNotice('No recovery copies are saved.'); return; } const copy = await readMobileRecovery(latest.key); if (copy) exportJson(copy.value, 'tpv-mobile-recovery.json'); })}>Export Latest Recovery Copy</button>
          <p className="mobile-quiet">Online videos use YouTube. Tap inside the video if your device blocks audio.</p>
        </section>}
      </main>
      <footer className="mobile-transport"><div className="mobile-now"><strong>{currentSong?.title || 'Ready to Sing'}</strong><span>{current?.singer || currentSong?.artist || `${state.queue.filter(r => r.status === 'accepted').length} songs waiting`}</span></div>
        <div className="mobile-time"><span>{clock(elapsed)}</span><input aria-label="Track position" type="range" min={0} max={Math.max(duration, 1)} step={1} value={Math.min(elapsed, Math.max(duration, 1))} disabled={!currentSong || duration <= 0} onChange={event => { const time = Number(event.target.value); player.current?.seek(time); if (current) model.checkpoint(current.id, time); setElapsed(time); }} /><span>{clock(duration)}</span></div>
        <div className="mobile-play-buttons"><button aria-label="Restart song" disabled={!current} onClick={() => { player.current?.seek(0); model.checkpoint(current!.id, 0); setElapsed(0); }}>↶</button><button className="mobile-primary" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button><button aria-label="Skip song" disabled={!current} onClick={() => next(true)}>⏭</button><button aria-label="Fullscreen video" disabled={!currentSong} onClick={() => player.current?.fullscreen()}>⛶</button>
          <button aria-label="Applause" disabled={!state.applauseEnabled} onClick={() => void run(() => model.applaud({ role: 'host' }, crypto.randomUUID(), playApplause))}>👏</button>
          <label className="mobile-volume">Volume<input type="range" min={0} max={1} step={0.01} value={state.volume} onChange={event => model.settings({ volume: Number(event.target.value) })} /></label></div>
      </footer>
    </>}
    {queueSong && <QueueDialog song={queueSong} onClose={() => setQueueSong(null)} onSubmit={(name, coSinger, isDuet) => { void run(() => { model.add([queueSong]); model.setDuet(queueSong.id, isDuet); model.request(queueSong.id, name, null, undefined, coSinger); setQueueSong(null); setNotice('Added to queue.'); }); }} />}
    {mode === 'host' && photo && <div className="mobile-photo-overlay"><img src={photo.dataUrl} alt="A photo sent by a singer" onLoad={() => {
      const active = activePhoto.current; if (!active || active.id !== photo.id || !active.resolve) return;
      if (document.fullscreenElement || document.visibilityState !== 'visible') { clearTimeout(active.timer); activePhoto.current = null; setPhoto(null); active.reject?.(new Error('The host screen is not visible.')); return; }
      clearTimeout(active.timer); active.resolve(); active.resolve = undefined; active.reject = undefined;
      active.timer = setTimeout(() => { if (activePhoto.current?.id === photo.id) { activePhoto.current = null; setPhoto(null); } }, 10000);
    }} onError={() => { const active = activePhoto.current; if (!active || active.id !== photo.id) return; clearTimeout(active.timer); activePhoto.current = null; setPhoto(null); active.reject?.(new Error('Photo could not be displayed.')); }} /></div>}
  </div>;
}
export function MobileEntry() {
  const [model, setModel] = useState<MobileShow | null>(null), [error, setError] = useState(''), [writable, setWritable] = useState(false), [recovering, setRecovering] = useState(false);
  const pendingSaves = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let active = true, release: (() => void) | null = null;
    void (async () => {
      try { release = await acquireMobileHostLock(); }
      catch (error) { if (error instanceof MobileHostLockUnsupported && Capacitor.isNativePlatform()) release = () => {}; else if (!(error instanceof MobileHostLockUnsupported)) throw error; }
      if (!active) { release?.(); return; }
      setWritable(release !== null);
      // Read after ownership is known, so an old tab cannot replace a newer show.
      const state = await loadMobileShow(); if (active) setModel(new MobileShow(state));
    })().catch(error => { if (active) setError(errorText(error)); });
    return () => { active = false; void pendingSaves.current.catch(() => {}).finally(() => release?.()); };
  }, []);
  if (model) return <MobileApp model={model} writable={writable} pendingSaves={pendingSaves} />;
  return <main className="mobile-loading"><h1>TPV Karaoke</h1>{error ? <><p role="alert">{error} Your saved data has been preserved.</p><button disabled={recovering} onClick={() => { setRecovering(true); void (writable ? preserveMobileRecovery() : Promise.resolve('')).then(() => setModel(new MobileShow())).catch(error => setError(errorText(error))).finally(() => setRecovering(false)); }}>{writable ? 'Start New Show and Keep Recovery Copy' : 'Continue in Singer Mode'}</button></> : <p role="status">Opening your karaoke room…</p>}</main>;
}
