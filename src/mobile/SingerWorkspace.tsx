import React, { useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { albumsOutline, libraryOutline, peopleOutline, personCircleOutline } from 'ionicons/icons';
import { version as appVersion } from '../../package.json';
import type { SourceId } from '../domain/settings';
import { SingerClient, type GuestView, type Song } from '../remote/client';
import { internetGuestTransport, lookupInternetSingerRoom } from '../remote/internet-transport';
import { mobileFetch } from './api';
import { BROWSE_LABELS, BROWSE_SOURCES, browseCatalog, chooseBrowseSources, type BrowseSong, type BrowseSource } from './browse-catalog';
import { discoverRooms, roomSlug, type DiscoveredRoom } from './discovery';
import { SingerRoomActions, SingerRequests } from './SingerRoomActions';
import { SaveToSingerPlaylist, SingerPlaylistsPanel, SingerProfilePanel, SingerStarButton, useSingerProfile } from './SingerProfilePanel';
import type { SingerPlaylistRecording } from './singer-profile';
import '@fontsource/nunito-sans/latin-400.css';
import '@fontsource/nunito-sans/latin-700.css';
import './mobile.css';

const tabs = [
  { id: 'library', label: 'Library', icon: libraryOutline },
  { id: 'room', label: 'Room', icon: peopleOutline },
  { id: 'playlists', label: 'Playlists', icon: albumsOutline },
  { id: 'profile', label: 'Profile', icon: personCircleOutline },
] as const;
type Tab = typeof tabs[number]['id'];
const titles: Record<Tab, string> = { library: 'Song Library', room: 'Karaoke Room', playlists: 'Playlists', profile: 'Profile & Settings' };
const sourceNames: Record<SourceId, string> = { ...BROWSE_LABELS, local: 'Host Library', partytyme: 'Party Tyme', youtube: 'YouTube', sunfly: 'Sunfly', stingray: 'Stingray' };
const sourceKey = 'tpv-mobile-browse-sources-v1';
const roomKey = 'tpv-mobile-last-room';

function savedValue(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveValue(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Browsing still works without storage. */ }
}

function loadSources(): BrowseSource[] {
  try {
    const value: unknown = JSON.parse(savedValue(sourceKey) ?? 'null');
    if (Array.isArray(value)) return chooseBrowseSources(value);
  } catch { /* New profiles default to the catalog we can always offer. */ }
  return ['karaokenerds'];
}

function lanLink(input: string): string | null {
  try {
    const link = new URL(input.trim());
    const privateHost = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)\d+(?:\.\d+){1,2}$/.test(link.hostname) ||
      /^[a-z0-9][a-z0-9.-]*\.local$/i.test(link.hostname) || /^\[(?:f[cd]|fe[89ab])[a-f0-9:]+\]$/i.test(link.hostname);
    if (link.protocol !== 'https:' || !privateHost || link.username || link.password || link.search ||
      link.pathname !== '/singer/' || !/^#invite=[A-Za-z0-9_-]{43}$/.test(link.hash)) return null;
    return link.href;
  } catch { return null; }
}

type CurrentRoom = { slug: string; client: SingerClient; number: number; id: string };
type Results = { items: BrowseSong[]; next: string | null; status: 'loading' | 'ready' | 'error' };

function useBrowseResults(sources: BrowseSource[], query: string, active: boolean) {
  const [pages, setPages] = useState<Partial<Record<BrowseSource, Results>>>({});
  const [retry, setRetry] = useState(0);
  const current = useRef<AbortController | null>(null);
  useEffect(() => {
    setPages({});
    if (!active || query.length < 2 || !sources.length) return;
    const controller = new AbortController();
    current.current = controller;
    const timer = setTimeout(() => {
      for (const source of sources) {
        void browseCatalog(source, query, null, controller.signal).then(page => {
          if (!controller.signal.aborted) setPages(old => ({ ...old, [source]: { items: page.items, next: page.nextCursor, status: 'ready' } }));
        }).catch(() => {
          if (!controller.signal.aborted) setPages(old => ({ ...old, [source]: { items: [], next: null, status: 'error' } }));
        });
      }
    }, 330);
    return () => { controller.abort(); clearTimeout(timer); current.current = null; };
  }, [sources, query, active, retry]);

  function more(source: BrowseSource) {
    const page = pages[source], controller = current.current;
    if (!page?.next || page.status === 'loading' || !controller) return;
    setPages(old => ({ ...old, [source]: { ...page, status: 'loading' } }));
    void browseCatalog(source, query, page.next, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const ids = new Set(page.items.map(item => item.id));
      const items = [...page.items, ...result.items.filter(item => !ids.has(item.id))];
      setPages(old => ({ ...old, [source]: { items, next: result.nextCursor, status: 'ready' } }));
    }).catch(() => {
      if (!controller.signal.aborted) setPages(old => ({ ...old, [source]: { ...page, status: 'error' } }));
    });
  }
  return { pages, more, retry: () => setRetry(value => value + 1) };
}

export function SingerWorkspace() {
  const store = useSingerProfile();
  const [tab, setTab] = useState<Tab>('library');
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState(loadSources);
  const [sourceFilter, setSourceFilter] = useState<SourceId | 'all'>('all');
  const [lastRoom, setLastRoom] = useState(() => roomSlug(savedValue(roomKey) ?? '') ?? '');
  const [roomInput, setRoomInput] = useState(() => roomSlug(new URLSearchParams(location.search).get('room') ?? '') ?? '');
  const [name, setName] = useState<string | null>(null);
  const [nearby, setNearby] = useState<DiscoveredRoom[]>([]);
  const [room, setRoom] = useState<CurrentRoom | null>(null);
  const [guest, setGuest] = useState<GuestView | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const connection = useRef(0), workspace = useRef<HTMLElement>(null);
  const requestNames = useRef(new Map<string, Song>());
  const joined = !!room && !!guest?.joined;
  const snapshot = guest?.snapshot, singerId = snapshot?.singerId;
  const connectName = name ?? store.profile.displayName;
  const browse = useBrowseResults(sources, query.trim(), !joined);

  useEffect(() => { workspace.current?.scrollTo(0, 0); }, [tab]);
  useEffect(() => {
    if (joined) { setNearby([]); return; }
    const controller = new AbortController();
    const scan = () => void discoverRooms(controller.signal).then(found => {
      if (!controller.signal.aborted) setNearby(found);
    }).catch(() => {});
    scan();
    const timer = setInterval(scan, 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [joined]);

  useEffect(() => {
    if (!room || !singerId || !query.trim()) return;
    void room.client.search(query.trim(), view => updateRoom(room.number, view));
  // Different room identities must start a fresh search; ordinary queue revisions are handled by the singer client.
  }, [room, singerId]);
  useEffect(() => {
    if (!room || !joined || tab !== 'room') return;
    const timer = setInterval(() => {
      if (!document.hidden) void room.client.refresh(view => updateRoom(room.number, view));
    }, 15_000);
    return () => clearInterval(timer);
  }, [room, joined, tab]);

  function updateRoom(number: number, view: GuestView) {
    if (connection.current !== number) return;
    setGuest(view);
    for (const song of [...(view.snapshot?.catalog ?? []), ...view.songs]) requestNames.current.set(song.id, song);
    while (requestNames.current.size > 500) {
      const oldest = requestNames.current.keys().next().value;
      if (oldest === undefined) break;
      requestNames.current.delete(oldest);
    }
    if (view.snapshot?.sources) {
      const available = chooseBrowseSources(view.snapshot.sources);
      setSources(old => old.join() === available.join() ? old : available);
      saveValue(sourceKey, JSON.stringify(available));
    }
  }

  function closeRoom(message = '') {
    ++connection.current;
    requestNames.current.clear();
    setRoom(null);
    setGuest(null);
    setConnecting(false);
    setNotice(message);
  }

  function chooseRoom(slug: string) {
    setTab('room');
    setRoomInput(slug);
    setNotice('');
  }

  async function join() {
    const slug = roomSlug(roomInput);
    if (connecting || joined) return;
    if (!slug) { setNotice('Enter the room code or invitation link from your host.'); return; }
    if (!connectName.trim()) { setNotice('Enter a display name for the room.'); return; }
    const number = room?.slug === slug ? room.number : ++connection.current;
    setConnecting(true);
    setNotice('');
    try {
      let target = room?.slug === slug ? room : null;
      if (!target) {
        const live = await lookupInternetSingerRoom(slug, mobileFetch);
        if (connection.current !== number) return;
        if (!live.online) throw new Error('The host is offline. Try again when the room is open.');
        const client = new SingerClient(internetGuestTransport(live, { fetch: mobileFetch, onEnded: () => {
          if (connection.current === number) closeRoom('This room ended. You can still browse and save songs.');
        } }), '');
        target = { slug, client, number, id: live.roomId };
        requestNames.current.clear();
        setRoom(target);
      }
      await target.client.join(connectName, view => updateRoom(number, view));
      if (connection.current === number && target.client.state().joined) {
        setLastRoom(slug);
        saveValue(roomKey, slug);
        if (store.ready && !store.profile.displayName) void store.saveIdentity(connectName, store.profile.email).catch(() => {});
        setTab('library');
      }
    } catch (error) {
      if (connection.current === number) setNotice(error instanceof Error ? error.message : 'Could not connect to this room.');
    } finally {
      if (connection.current === number) setConnecting(false);
    }
  }

  function search(value: string) {
    setQuery(value);
    if (room && snapshot) void room.client.search(value.trim(), view => updateRoom(room.number, view));
  }

  function setSource(source: BrowseSource, enabled: boolean) {
    const selected = chooseBrowseSources(enabled ? [...sources, source] : sources.filter(item => item !== source));
    setSources(selected);
    saveValue(sourceKey, JSON.stringify(selected));
  }

  function saveRecording(song: Song, browseSong?: BrowseSong): SingerPlaylistRecording {
    return {
      title: song.title, artist: song.artist, source: song.source,
      recordingKey: song.recordingId, roomId: browseSong ? 'public-' + browseSong.source : room?.id, id: song.id,
    };
  }

  function songRow(song: Song, available: boolean, browseSong?: BrowseSong) {
    const source = song.source;
    const label = browseSong ? BROWSE_LABELS[browseSong.source] : source ? sourceNames[source] : 'Host Library';
    const recording = saveRecording(song, browseSong);
    return <li className={'mobile-song singer-song source-' + (source ?? 'local')} key={label + ':' + song.id}>
      <div className="singer-song-heading">
        <div><strong>{song.title}</strong><span>{song.artist || 'Unknown artist'}</span><small>{label}{browseSong?.brand ? ' · ' + browseSong.brand : ''}</small></div>
        {available && room && <button className="mobile-primary" type="button" disabled={guest?.busy || guest?.uncertain}
          aria-label={'Queue ' + song.title} onClick={() => void room.client.request(song.id, view => updateRoom(room.number, view))}>Queue</button>}
      </div>
      <div className="singer-inline-actions">
        <SingerStarButton store={store} recording={recording} displayName={snapshot?.singerName} />
        <SaveToSingerPlaylist store={store} recording={recording} />
      </div>
    </li>;
  }

  const manualLan = lanLink(roomInput);
  const roomStatus = joined ? room.slug : connecting ? 'Connecting…' : 'Browse Mode';
  const listener = (view: GuestView) => { if (room) updateRoom(room.number, view); };
  const availableSources: SourceId[] = joined ? snapshot?.sources ?? [] : sources;
  const activeFilter = sourceFilter !== 'all' && availableSources.includes(sourceFilter) ? sourceFilter : 'all';
  const liveSongs = guest?.songs.filter(song =>
    (!snapshot?.sources || !song.source || snapshot.sources.includes(song.source)) && (activeFilter === 'all' || song.source === activeFilter)) ?? [];
  return <div className="mobile-app singer-workspace" data-mode="singer">
    <header className="mobile-header">
      <span className="mobile-title"><img src="./icon-192.png" alt="" /><strong>TPV Karaoke</strong></span>
      <span className="mobile-version">{appVersion}</span>
      <button type="button" className="singer-room-badge" onClick={() => setTab('room')}>{roomStatus}</button>
    </header>
    <main className="mobile-host-main singer-workspace-main" ref={workspace}>
      <h1>{titles[tab]}</h1>
      {notice && <p role="status" className="singer-workspace-status">{notice}</p>}
      {guest?.message && <p role="status" className="singer-workspace-status">{guest.message}</p>}
      {tab === 'library' && <section>
        <label className="mobile-search">Search Songs<input type="search" placeholder="Artist or song title" maxLength={200}
          value={query} onChange={event => search(event.currentTarget.value)} /></label>
        {availableSources.length > 1 && <label className="singer-source-filter">Filter by source
          <select value={activeFilter} onChange={event => {
            const value = event.currentTarget.value;
            setSourceFilter(availableSources.find(source => source === value) ?? 'all');
          }}>
            <option value="all">All Sources</option>
            {availableSources.map(source => <option key={source} value={source}>
              {source === 'partytyme' && !joined ? BROWSE_LABELS.partytyme : sourceNames[source]}
            </option>)}
          </select>
        </label>}
        {joined ? <>
          <p className="mobile-quiet">{snapshot?.sources ? snapshot.sources.map(source => sourceNames[source]).join(' · ') || 'The host has no enabled sources.' : 'Searching the room’s library'}</p>
          {guest.searching && <p role="status">Searching the room…</p>}
          {liveSongs.length > 0 && <ul className="mobile-songs">{liveSongs.map(song => songRow(song, true))}</ul>}
          {!guest.searching && liveSongs.length === 0 && <p>No matching songs in this room.</p>}
          {guest.nextOffset !== null && <button type="button" disabled={guest.busy} onClick={() => void room.client.more(listener)}>Load More Songs</button>}
        </> : <>
          {nearby.length > 0 && <button className="mobile-primary" type="button" onClick={() => setTab('room')}>Nearby Karaoke Rooms</button>}
          <p className="mobile-quiet">Save songs for later. Join a room when you’re ready to queue.</p>
          {sources.length === 0 && <p>Choose a catalog in <button type="button" onClick={() => setTab('profile')}>Profile &amp; Settings</button>.</p>}
          {query.trim().length < 2 && sources.length > 0 && <p className="mobile-quiet">{sources.map(source => BROWSE_LABELS[source]).join(' · ')}</p>}
          {query.trim().length >= 2 && sources.filter(source => activeFilter === 'all' || source === activeFilter).map(source => {
            const page = browse.pages[source];
            return <section className="singer-catalog-group" key={source} aria-label={BROWSE_LABELS[source]}>
              <h2>{BROWSE_LABELS[source]}</h2>
              {!page && <p role="status">Searching…</p>}
              {page?.items.length ? <ul className="mobile-songs">{page.items.map(song => songRow(song, false, song))}</ul> : null}
              {page?.status === 'ready' && !page.items.length && <p>No matching songs.</p>}
              {page?.status === 'error' && <p role="status">Catalog unavailable. <button type="button" onClick={browse.retry}>{page.next ? 'Restart Search' : 'Try Again'}</button></p>}
              {page?.next && page.status !== 'error' && <button type="button" disabled={page.status === 'loading'} onClick={() => browse.more(source)}>
                {page.status === 'loading' ? 'Loading…' : 'More Karaoke Nerds Results'}
              </button>}
            </section>;
          })}
        </>}
      </section>}
      {tab === 'room' && <section>
        {joined ? <>
          <p>Joined as <strong>{snapshot?.singerName ?? connectName}</strong>.</p>
          <div className="singer-inline-actions">
            <button disabled={guest.busy} type="button" onClick={() => void room.client.refresh(listener)}>Refresh</button>
            <button disabled={guest.busy} type="button" onClick={() => void room.client.reconnect(listener)}>Reconnect</button>
            <button type="button" onClick={() => closeRoom('You left this room. Your playlists and catalog choices are saved.')}>Leave Room</button>
          </div>
          <SingerRequests client={room.client} view={guest} listen={listener} names={requestNames.current} />
          <SingerRoomActions client={room.client} view={guest} listen={listener} />
        </> : <>
          <form onSubmit={event => { event.preventDefault(); void join(); }}>
            <label>Room code or invitation link<input value={roomInput} maxLength={512} placeholder="your-hosts-room" autoCapitalize="none" autoCorrect="off"
              autoComplete="off" required disabled={connecting} onChange={event => { setRoomInput(event.currentTarget.value); if (room) closeRoom(); }} /></label>
            {!manualLan && <>
              <label>Display name<input autoComplete="nickname" maxLength={100} value={connectName} required disabled={connecting || guest?.joinUncertain}
                onChange={event => setName(event.currentTarget.value)} /></label>
              <button className="mobile-primary" disabled={connecting}>{connecting ? 'Connecting…' : guest?.joinUncertain ? 'Retry Joining' : 'Join Room'}</button>
            </>}
          </form>
          {manualLan && <p><a href={manualLan} target="_blank" rel="noopener noreferrer">Open Local Invitation</a> on the host’s Wi-Fi.</p>}
          {nearby.length > 0 && <section className="singer-catalog-group"><h2>Nearby Rooms</h2>
            {nearby.map(found => <button key={found.instance} className="singer-nearby-option" type="button" disabled={connecting} onClick={() => chooseRoom(found.slug)}>{found.name}</button>)}
          </section>}
          {lastRoom && <section className="singer-catalog-group"><h2>Last Room</h2>
            <button type="button" disabled={connecting} onClick={() => chooseRoom(lastRoom)}>{lastRoom}</button>
          </section>}
        </>}
      </section>}
      {tab === 'playlists' && <SingerPlaylistsPanel store={store} renderRecordingAction={recording => joined &&
        <button type="button" onClick={() => { search(recording.title.slice(0, 200)); setTab('library'); }}>Find in Room</button>} />}
      {tab === 'profile' && <>
        <SingerProfilePanel store={store} />
        <fieldset className="singer-sources"><legend>Browse Sources</legend>
          {joined ? <p className="mobile-quiet">The host chooses the sources available in this room.</p> :
            BROWSE_SOURCES.map(source => <label key={source}>
              <input type="checkbox" checked={sources.includes(source)} onChange={event => setSource(source, event.currentTarget.checked)} />{BROWSE_LABELS[source]}
            </label>)}
          <p className="mobile-quiet">Browse public catalogs without a provider account. Party Tyme Pro listings may differ from a host’s Party Tyme catalog.</p>
        </fieldset>
      </>}
    </main>
    <nav className="mobile-tabs" aria-label="Singer workspace">
      {tabs.map(item => <button key={item.id} type="button" aria-current={item.id === tab ? 'page' : undefined} onClick={() => setTab(item.id)}>
        <IonIcon icon={item.icon} aria-hidden="true" /><span>{item.label}</span>
      </button>)}
    </nav>
  </div>;
}
