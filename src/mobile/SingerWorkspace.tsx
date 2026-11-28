import React, { useEffect, useRef, useState } from 'react';
import { IonButton, IonIcon, IonLabel, IonSearchbar, IonTabBar, IonTabButton } from '@ionic/react';
import { albumsOutline, chevronBackOutline, chevronDownOutline, chevronForwardOutline, chevronUpOutline, ellipsisHorizontal,
  listOutline, musicalNotesOutline, personCircleOutline, addOutline, radioOutline, searchOutline, starOutline,
  sunnyOutline } from 'ionicons/icons';
import { version as appVersion } from '../../package.json';
import type { SourceId } from '../domain/settings';
import type { GuestNowPlaying } from '../domain/guest-stage';
import { SingerClient, type GuestView, type Song } from '../remote/client';
import { internetGuestTransport, lookupInternetSingerRoom } from '../remote/internet-transport';
import { mobileFetch } from './api';
import { BROWSE_LABELS, BROWSE_SOURCES, browseCatalog, chooseBrowseSources, type BrowseSong, type BrowseSource } from './browse-catalog';
import { discoverRooms, roomSlug, type DiscoveredRoom } from './discovery';
import { SingerPhotoSubmission, SingerRoomActions, SingerRequests } from './SingerRoomActions';
import { PlaylistDetails, SaveToSingerPlaylist, SingerStarButton, useSingerProfile } from './SingerProfilePanel';
import { starredPlaylist, type SingerPlaylistRecording } from './singer-profile';
import { SingerSheet } from './SingerSheet';
import { SingerInviteActions, CustomSongRequestAction } from './SingerInvite';
import { SingerHistory, useSingerHistory } from './SingerHistory';
import { SingerNotificationSettings, useSingerNotifications } from './SingerNotifications';
import { SingerLiveActivitySetting, useSingerLiveActivity } from './SingerLiveActivity';
import { SingerApplause, useSingerApplause } from './SingerApplause';
import { SingerProfileDetailsEditor } from './SingerProfileDetailsEditor';
import type { SignedInAccount } from './account';
import '@fontsource/nunito-sans/latin-400.css';
import '@fontsource/nunito-sans/latin-700.css';
import '@fontsource/nunito-sans/latin-800.css';
import '@fontsource/nunito-sans/latin-900.css';
import './mobile.css';

const tabs = [
  { id: 'room', label: 'Rooms', icon: radioOutline },
  { id: 'library', label: 'Search', icon: searchOutline },
  { id: 'queue', label: 'Queue', icon: listOutline },
  { id: 'playlists', label: 'Playlists', icon: albumsOutline },
  { id: 'profile', label: 'Account', icon: personCircleOutline },
] as const;
type Tab = typeof tabs[number]['id'];
type Screen = Tab | 'playing';
const titles: Record<Screen, string> = { library: 'Search', room: 'Rooms', queue: 'Queue', playlists: 'Playlists', profile: 'Account', playing: 'Now Playing' };
type WorkspaceProps = {
  accountSession?: SignedInAccount | null;
  onSignIn?: () => void;
  onSignOut?: () => void | Promise<void>;
  kioskRoom?: string;
  onKioskDone?: () => void;
};
type Sheet =
  | { kind: 'song'; song: Song; browseSong?: BrowseSong }
  | { kind: 'join'; slug: string; label: string }
  | { kind: 'playlist' }
  | { kind: 'name' };
const themeKey = 'tpv-mobile-theme';
const boothMark = new URL('../../assets/branding/mobile/adaptive-foreground.png', import.meta.url).href;
const elapsed = (seconds: number) => {
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
};

const sourceNames: Record<SourceId, string> = { ...BROWSE_LABELS, local: 'Host Library', partytyme: 'Party Tyme', youtube: 'YouTube', sunfly: 'Sunfly', stingray: 'Stingray' };
const sourceKey = 'tpv-mobile-browse-sources-v1';
const roomKey = 'tpv-mobile-last-room';
const inviteRoom = () => roomSlug(new URLSearchParams(location.search).get('room') ?? '');

function savedValue(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveValue(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Browsing still works without storage. */ }
}

async function accountRoomKey(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  return roomKey + ':' + Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
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

type CurrentRoom = { slug: string; client: SingerClient; number: number; id: string; generation: string };
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

export function SingerWorkspace({ accountSession, onSignIn, onSignOut, kioskRoom, onKioskDone }: WorkspaceProps = {}) {
  const account = accountSession?.account;
  const store = useSingerProfile();
  const [tab, setTab] = useState<Screen>('room');
  const [returnFromPlayer, setReturnFromPlayer] = useState<Tab>('queue');
  const [sheet, setSheet] = useState<Sheet | null>(() => {
    const slug = inviteRoom();
    return slug && !kioskRoom ? { kind: 'join', slug, label: slug } : null;
  });
  const [sheetValue, setSheetValue] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [saving, setSaving] = useState(false);
  const [playlist, setPlaylist] = useState<string | null>(null);
  const [theme, setTheme] = useState(() => {
    const saved = savedValue(themeKey);
    return saved === 'day' || saved === 'system' ? saved : 'night';
  });
  const roomBox = useRef<HTMLInputElement>(null);
  const kiosk = roomSlug(kioskRoom ?? '');
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState(loadSources);
  const [sourceFilter, setSourceFilter] = useState<SourceId | 'all'>('all');
  const [lastRoom, setLastRoom] = useState(() => roomSlug(savedValue(roomKey) ?? '') ?? '');
  const [roomInput, setRoomInput] = useState(() => inviteRoom() ?? '');
  const [roomName, setRoomName] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [nearby, setNearby] = useState<DiscoveredRoom[]>([]);
  const [accountRoom, setAccountRoom] = useState<{ email: string; slug: string } | null>(null);
  const [room, setRoom] = useState<CurrentRoom | null>(null);
  const [guest, setGuest] = useState<GuestView | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const connection = useRef(0), workspace = useRef<HTMLElement>(null);
  const requestNames = useRef(new Map<string, Song>());
  const joined = !!room && !!guest?.joined;
  const snapshot = guest?.snapshot, singerId = snapshot?.singerId;
  const notifications = useSingerNotifications({ snapshot, nearby, joined, enabled: !kiosk });
  const history = useSingerHistory(kiosk ? null : snapshot, requestNames.current, kiosk ? '' : account?.email);
  const connectName = name ?? (store.profile.displayName || account?.name || '');
  const browse = useBrowseResults(sources, query.trim(), !joined);

  useEffect(() => { document.documentElement.dataset.mobileTheme = theme; }, [theme]);
  useEffect(() => { workspace.current?.scrollTo(0, 0); }, [tab, playlist]);
  useEffect(() => {
    if (joined || kiosk) { setNearby([]); return; }
    const controller = new AbortController();
    const scan = () => void discoverRooms(controller.signal).then(found => {
      if (!controller.signal.aborted) setNearby(found);
    }).catch(() => { if (!controller.signal.aborted) setNearby([]); });
    scan();
    const timer = setInterval(scan, 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [joined, kiosk]);
  useEffect(() => {
    const email = account?.email;
    setAccountRoom(null);
    if (!email || joined || kiosk) return;
    let active = true;
    void accountRoomKey(email).then(async key => {
      const saved = JSON.parse(savedValue(key) ?? 'null');
      const slug = typeof saved?.slug === 'string' ? roomSlug(saved.slug) : null;
      if (!slug || !active) return;
      const live = await lookupInternetSingerRoom(slug, mobileFetch);
      if (active && live.online && live.roomId === saved.id && live.generation === saved.generation) setAccountRoom({ email, slug });
    }).catch(() => {});
    return () => { active = false; };
  }, [account?.email, joined, kiosk, lastRoom]);

  useEffect(() => {
    if (!room || !singerId || !query.trim()) return;
    void room.client.search(query.trim(), view => updateRoom(room.number, view));
  // Different room identities must start a fresh search; ordinary queue revisions are handled by the singer client.
  }, [room, singerId]);
  useEffect(() => {
    if (!room || !joined) return;
    const timer = setInterval(() => {
      if (!document.hidden) void room.client.refresh(view => updateRoom(room.number, view));
    }, tab === 'playing' ? 5_000 : tab === 'queue' ? 10_000 : 15_000);
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

  function changeTab(value: Screen) {
    if (value === 'playing' && tab !== 'playing') setReturnFromPlayer(tab);
    if (value === 'playlists' && tab !== 'playlists') setPlaylist(null);
    setTab(value);
    setNotice('');
    setGuest(previous => previous?.message && !previous.uncertain ? { ...previous, message: '' } : previous);
  }

  function openSheet(next: Sheet, value = '') {
    setSheetError('');
    setSheetValue(value);
    setSheet(next);
  }

  function chooseRoom(value: string, label?: string) {
    const slug = roomSlug(value);
    if (!slug) { setNotice('Enter the room code or invitation link from your host.'); return; }
    if (room?.slug !== slug) closeRoom();
    setNotice('');
    openSheet({ kind: 'join', slug, label: label || slug }, kiosk && !guest?.joinUncertain ? '' : connectName);
  }

  async function join(slug: string, label: string, displayName: string) {
    if (connecting || joined) return;
    const value = displayName.trim();
    if (!value) { setSheetError('Enter the name you want the host to use.'); return; }
    const number = room?.slug === slug ? room.number : ++connection.current;
    setName(value);
    setConnecting(true);
    setNotice('');
    setSheetError('');
    try {
      let target = room?.slug === slug ? room : null;
      if (!target) {
        const live = await lookupInternetSingerRoom(slug, mobileFetch);
        if (connection.current !== number) return;
        if (!live.online) throw new Error('The host is offline. Try again when the room is open.');
        const client = new SingerClient(internetGuestTransport(live, { fetch: mobileFetch, rotation: true, onEnded: () => {
          if (connection.current === number) closeRoom('This room ended. You can still browse and save songs.');
        } }), '');
        target = { slug, client, number, id: live.roomId, generation: live.generation };
        requestNames.current.clear();
        setRoom(target);
      }
      await target.client.join(value, view => updateRoom(number, view));
      if (connection.current !== number) return;
      if (target.client.state().joined) {
        setRoomName(label);
        setSheet(null);
        if (!kiosk) {
          setLastRoom(slug);
          saveValue(roomKey, slug);
          if (account?.email) {
            const identifier = JSON.stringify({ slug, id: target.id, generation: target.generation });
            void accountRoomKey(account.email).then(key => saveValue(key, identifier)).catch(() => {});
          }
          if (store.ready && !store.profile.displayName) void store.saveIdentity(value, store.profile.email).catch(() => {});
        }
        setTab('library');
      } else setSheetError(target.client.state().message);
    } catch (error) {
      if (connection.current === number) setSheetError(error instanceof Error ? error.message : 'Could not connect to this room.');
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

  function songRow(song: Song, browseSong?: BrowseSong) {
    const source = song.source;
    const label = browseSong ? BROWSE_LABELS[browseSong.source] : source ? sourceNames[source] : 'Host Library';
    const select = () => openSheet({ kind: 'song', song, browseSong });
    return <li className="singer-result-row" key={label + ':' + song.id}>
      <button type="button" className="singer-song-link" onClick={select}>
        <SongArtwork source={source} />
        <span className="singer-copy"><strong>{song.title}</strong>
          <small>{song.artist || 'Unknown artist'} · {label}{browseSong?.brand ? ' · ' + browseSong.brand : ''}</small></span>
      </button>
      <button type="button" className="singer-icon-button singer-icon-quiet" aria-label={'Options for ' + song.title} onClick={select}>
        <IonIcon icon={ellipsisHorizontal} aria-hidden="true" />
      </button>
    </li>;
  }

  function dismissSheet() {
    if (connecting || saving) return;
    setSheet(null);
  }

  async function saveSheet() {
    const value = sheetValue.trim();
    if (!value || !sheet) return;
    setSaving(true);
    setSheetError('');
    try {
      if (sheet.kind === 'name') {
        await store.saveIdentity(value, store.profile.email);
        setName(value);
      } else if (sheet.kind === 'playlist') await store.createPlaylist(value);
      setSheet(null);
    } catch (error) { setSheetError(error instanceof Error ? error.message : 'Could not save the change.'); }
    finally { setSaving(false); }
  }

  function finishKiosk() {
    closeRoom();
    setName(null);
    setQuery('');
    setSheet(null);
    setTab('room');
    onKioskDone?.();
  }

  const manualLan = lanLink(roomInput);
  const listener = (view: GuestView) => { if (room) updateRoom(room.number, view); };
  const availableSources: SourceId[] = joined ? snapshot?.sources ?? [] : sources;
  const activeFilter = sourceFilter !== 'all' && availableSources.includes(sourceFilter) ? sourceFilter : 'all';
  const liveSongs = guest?.songs.filter(song =>
    (!snapshot?.sources || !song.source || snapshot.sources.includes(song.source)) &&
    (activeFilter === 'all' || song.source === activeFilter)) ?? [];
  const stage = snapshot?.stage;
  const rotation = stage?.queue ?? [];
  const playing = stage?.nowPlaying;
  const turn = rotation.find(entry => entry.ownRequestId);
  const next = rotation[0];
  const playingRecording: SingerPlaylistRecording | undefined = playing && room ? {
    title: playing.title, artist: playing.artist, source: playing.source, recordingKey: playing.recordingId, id: playing.versionId, roomId: room.id,
  } : undefined;
  const firstNearby = nearby[0];
  const returnRoom = accountRoom?.email === account?.email ? accountRoom?.slug : undefined;
  const currentPlaylist = store.profile.playlists.find(value => value.id === playlist);
  const stars = starredPlaylist(store.profile);
  const collections = store.profile.playlists.filter(value => value.kind !== 'starred');
  const accountName = connectName || 'Guest';
  const heading = tab === 'playlists' && currentPlaylist ? currentPlaylist.name : titles[tab];
  const label = roomName || room?.slug || 'Your Room';
  const lockScreen = useSingerLiveActivity(joined && !kiosk, label, playing);
  const applause = useSingerApplause(stage?.applause, snapshot?.serverNowMs);

  return <div className={"mobile-app singer-workspace" + (tab === 'playing' ? ' singer-player-open' : '')} data-mode="singer">
    <main className="singer-workspace-main" ref={workspace}>
      <header className="singer-screen-heading">
        {tab === 'playing'
          ? <IonButton type="button" className="singer-ion-icon" fill="clear" shape="round" aria-label="Close Now Playing"
            onClick={() => changeTab(returnFromPlayer)}><IonIcon icon={chevronDownOutline} aria-hidden="true" /></IonButton>
          : tab === 'playlists' && currentPlaylist
            ? <IonButton type="button" className="singer-ion-icon" fill="clear" shape="round" aria-label="Back to Playlists"
              onClick={() => setPlaylist(null)}><IonIcon icon={chevronBackOutline} aria-hidden="true" /></IonButton>
            : null}
        <h1 className={tab === 'playing' ? 'singer-player-label' : undefined}>{heading}</h1>
        {(tab === 'room' && !kiosk || tab === 'profile') && <img src={boothMark} alt="" />}
        {tab === 'library' && joined && <span className="singer-badge singer-badge-live">In Room</span>}
        {tab === 'queue' && joined && <span className="singer-badge singer-badge-live">Live</span>}
        {tab === 'playlists' && !currentPlaylist && <IonButton type="button" className="singer-ion-icon" fill="clear" shape="round" aria-label="New playlist" disabled={!store.ready}
          onClick={() => openSheet({ kind: 'playlist' })}><IonIcon icon={addOutline} aria-hidden="true" /></IonButton>}
        {kiosk && joined && <button type="button" onClick={finishKiosk}>Done</button>}
      </header>
      {notice && <p role="status" className="singer-workspace-status">{notice}</p>}
      {guest?.message && !sheet && <p role="status" className="singer-workspace-status">{guest.message}</p>}

      {tab === 'room' && <section>
        <div className="singer-room-hero">
          {(joined || firstNearby || returnRoom) && <span className="singer-badge singer-badge-live">{joined ? 'Connected' : returnRoom ? 'Recent Room · Live' : 'Nearby · Live'}</span>}
          <div><h2>{joined ? label : (kiosk || returnRoom || firstNearby?.name || 'Find Your Room')}</h2>
            <p>{joined ? 'Joined as ' + (snapshot?.singerName || connectName) : returnRoom ? 'The room you joined on this device is still open.' :
              firstNearby?.method === 'same-egress' ? 'Confirm the room with your host.' : firstNearby ? 'Available to join' : 'Find the show you want to sing in.'}</p>
            <IonButton type="button" className="singer-ion-action" fill="solid" shape="round" disabled={connecting} onClick={() => {
              if (joined) changeTab('queue');
              else if (kiosk || returnRoom || firstNearby) chooseRoom(kiosk || returnRoom || firstNearby!.slug, returnRoom || firstNearby?.name);
              else roomBox.current?.focus();
            }}>{joined ? 'Open Queue' : kiosk ? 'Continue as Guest' : returnRoom ? 'Return to Room' : firstNearby ? 'Join Room' : 'Enter Room Code'}</IonButton>
          </div>
        </div>
        {joined && room && guest ? <>
          <h2 className="singer-subheading">Room Options</h2>
          {!kiosk && <SingerInviteActions slug={room.slug} name={label} />}
          <div className="singer-inline-actions">
            <button disabled={guest.busy} type="button" onClick={() => void room.client.refresh(listener)}>Refresh</button>
            <button disabled={guest.busy} type="button" onClick={() => void room.client.reconnect(listener)}>Reconnect</button>
            <button type="button" onClick={() => closeRoom('You left this room. Your playlists and catalog choices are saved.')}>Leave Room</button>
          </div>
          <SingerRoomActions client={room.client} view={guest} listen={listener} />
        </> : !kiosk && <>
          <h2 className="singer-subheading">Join With a Code</h2>
          <form className="singer-room-code" onSubmit={event => { event.preventDefault(); chooseRoom(roomInput); }}>
            <input aria-label="Room code or invitation link" ref={roomBox} value={roomInput} maxLength={512}
              placeholder="Room code or invitation link" autoCapitalize="none" autoCorrect="off" autoComplete="off" required disabled={connecting}
              onChange={event => { setRoomInput(event.currentTarget.value); if (room) closeRoom(); }} />
            {!manualLan && <IonButton className="singer-ion-action" fill="solid" shape="round" type="submit" disabled={connecting}>Go</IonButton>}
          </form>
          {manualLan && <p><a href={manualLan} target="_blank" rel="noopener noreferrer">Open Local Invitation</a> on the host’s Wi-Fi.</p>}
          {(returnRoom ? nearby.some(found => found.slug !== returnRoom) : nearby.length > 1) && <section><h2 className="singer-subheading">More Nearby Rooms</h2>
            {(returnRoom ? nearby.filter(found => found.slug !== returnRoom) : nearby.slice(1)).map(found => <ListLink key={found.instance} icon={radioOutline} title={found.name}
              subtitle="Nearby" onClick={() => chooseRoom(found.slug, found.name)} />)}
          </section>}
          {lastRoom && <section><h2 className="singer-subheading">Recently Joined</h2>
            <ListLink icon={radioOutline} title={lastRoom} onClick={() => chooseRoom(lastRoom)} />
          </section>}
        </>}
      </section>}

      {tab === 'library' && <section>
        <IonSearchbar className="singer-searchbar" aria-label="Search songs" type="search" inputmode="search"
          placeholder="Song or artist" maxlength={200} value={query} showClearButton="always"
          onIonInput={event => search(event.detail.value ?? '')} />
        {availableSources.length > 1 && <div className="singer-source-chips" role="group" aria-label="Filter by source">
          <button type="button" aria-pressed={activeFilter === 'all'} onClick={() => setSourceFilter('all')}>All</button>
          {availableSources.map(source => <button type="button" key={source} aria-pressed={activeFilter === source}
            onClick={() => setSourceFilter(source)}>{source === 'partytyme' && !joined ? BROWSE_LABELS.partytyme : sourceNames[source]}</button>)}
        </div>}
        {joined ? <>
          {guest.searching ? <p role="status">Searching the room…</p> : liveSongs.length > 0
            ? <p className="singer-result-count">{liveSongs.length} {liveSongs.length === 1 ? 'result' : 'results'}</p>
            : <p>No matching songs in this room.</p>}
          {liveSongs.length > 0 && <ul className="singer-result-list">{liveSongs.map(song => songRow(song))}</ul>}
          {guest.nextOffset !== null && <button type="button" disabled={guest.busy} onClick={() => void room.client.more(listener)}>Load More Songs</button>}
        </> : <>
          {sources.length === 0 && <p>Choose a catalog in <button type="button" onClick={() => changeTab('profile')}>Account</button>.</p>}
          {query.trim().length < 2 && sources.length > 0 && <p className="mobile-quiet">Search by title or artist. Join a room to request a song.</p>}
          {!kiosk && <CustomSongRequestAction />}
          {query.trim().length >= 2 && sources.filter(source => activeFilter === 'all' || source === activeFilter).map(source => {
            const page = browse.pages[source];
            return <section className="singer-catalog-group" key={source} aria-label={BROWSE_LABELS[source]}>
              {sources.length > 1 && activeFilter === 'all' && <h2>{BROWSE_LABELS[source]}</h2>}
              {!page && <p role="status">Searching…</p>}
              {page?.items.length ? <ul className="singer-result-list">{page.items.map(song => songRow(song, song))}</ul> : null}
              {page?.status === 'ready' && !page.items.length && <p>No matching songs.</p>}
              {page?.status === 'error' && <p role="status">Catalog unavailable. <button type="button" onClick={browse.retry}>{page.next ? 'Restart Search' : 'Try Again'}</button></p>}
              {page?.next && page.status !== 'error' && <button type="button" disabled={page.status === 'loading'} onClick={() => browse.more(source)}>
                {page.status === 'loading' ? 'Loading…' : 'More ' + BROWSE_LABELS[source] + ' Results'}
              </button>}
            </section>;
          })}
        </>}
      </section>}

      {tab === 'queue' && <section>
        {joined && room && guest ? <>
          <p className="mobile-quiet">{label}</p>
          {stage && <>
            <h2 className="singer-subheading">Now Playing</h2>
            {playing ? <NowButton playing={playing} onClick={() => changeTab('playing')} /> : <p className="mobile-quiet">The stage is between songs.</p>}
            {turn && <div className="singer-queue-turn"><strong>Your turn · #{turn.position}</strong><p>{turn.title} · {turn.status === 'preparing' ? 'Preparing' : 'Queued'}</p></div>}
            <h2 className="singer-subheading">Coming Up</h2>
            {rotation.length > 0 ? <ol className="singer-result-list">
              {rotation.map(row => <li className="singer-queue-row" key={row.position}>
                <span className="singer-queue-position">{String(row.position).padStart(2, '0')}</span>
                <div className="singer-copy"><strong>{row.title}</strong><small>{row.singer || row.artist}</small></div>
                <span className={'singer-badge' + (row.ownRequestId ? ' singer-badge-mine' : '')}>{row.status === 'preparing' ? 'Preparing' : row.position === 1 ? 'Up Next' : 'Queued'}</span>
              </li>)}
            </ol> : <p className="mobile-quiet">No songs are queued yet.</p>}
            {stage.queueTruncated && <p className="mobile-quiet">Showing the next {rotation.length} requests.</p>}
          </>}
          {!stage && <p className="mobile-quiet">This host shares your requests. Live room rotation requires a compatible host and relay.</p>}
          <SingerRequests client={room.client} view={guest} listen={listener} names={requestNames.current} />
        </> : <><p className="mobile-quiet">Join a room to see the queue and request songs.</p>
          <IonButton className="singer-ion-action" expand="block" fill="solid" shape="round" type="button" onClick={() => changeTab('room')}>Find a Room</IonButton></>}
      </section>}

      {tab === 'playing' && <section className="singer-player-view" aria-label="Now Playing">
        {playing && playingRecording && joined && room && guest ? <>
          <div className="singer-stage-art">
            <SingerApplause animationId={applause} />
            <span className={'singer-badge' + (playing.status === 'playing' ? ' singer-badge-live' : '')}>{playing.status === 'paused' ? 'Paused' : 'On Stage'}</span>
            <span className="singer-playing-room">{label}</span>
          </div>
          <div className="singer-playing-details">
            <h2 className="singer-playing-title">{playing.title}</h2>
            <p className="singer-playing-identity">{[playing.artist, playing.singer ? 'Sung by ' + playing.singer : ''].filter(Boolean).join(' · ')}</p>
            {playing.timing && <div className="singer-playing-timing">
              <progress aria-label="Song progress" value={playing.timing.position} max={playing.timing.duration} />
              <span>{elapsed(playing.timing.position)}</span><span>{elapsed(playing.timing.duration)}</span>
            </div>}
            <div className="singer-playing-actions">
              {snapshot?.applauseEnabled && <IonButton type="button" className="singer-ion-action" fill="solid" shape="round"
                disabled={guest.busy || guest.uncertain || (snapshot.applauseCredits ?? 3) === 0}
                onClick={() => void room.client.applaud(listener)}>Applaud ({snapshot.applauseCredits ?? 3})</IonButton>}
              {!kiosk && <SingerStarButton store={store} recording={playingRecording} displayName={snapshot?.singerName} showLabel />}
            </div>
            {!kiosk && <SaveToSingerPlaylist key={playing.versionId} store={store} recording={playingRecording} />}
            {!kiosk && <SingerPhotoSubmission client={room.client} view={guest} listen={listener} />}
          </div>
          {next && <section className="singer-playing-next"><h2 className="singer-subheading">Up Next</h2>
            <ListLink icon={listOutline} title={next.title} subtitle={next.singer || next.artist} onClick={() => changeTab('queue')} />
          </section>}
        </> : <p className="mobile-quiet">No song is playing right now.</p>}
      </section>}

      {tab === 'playlists' && (currentPlaylist
        ? <section className="mobile-singer-playlists">
          <p className="mobile-quiet">{currentPlaylist.recordings.length} {currentPlaylist.recordings.length === 1 ? 'song' : 'songs'}</p>
          <PlaylistDetails key={currentPlaylist.id} playlist={currentPlaylist} store={store} renderRecordingAction={recording => joined &&
            <button type="button" onClick={() => { search(recording.title.slice(0, 200)); changeTab('library'); }}>Find in Room</button>} />
        </section>
        : <section>
          <button className="singer-playlist-hero" type="button" disabled={!stars} onClick={() => stars && setPlaylist(stars.id)}>
            <IonIcon icon={starOutline} aria-hidden="true" /><span><strong>Starred Songs</strong><small>{stars?.recordings.length ?? 0} {stars?.recordings.length === 1 ? 'song' : 'songs'}</small></span>
          </button>
          <h2 className="singer-subheading">My Playlists</h2>
          {collections.map(item => <ListLink key={item.id} icon={musicalNotesOutline} title={item.name}
            subtitle={item.recordings.length + (item.recordings.length === 1 ? ' song' : ' songs')} onClick={() => setPlaylist(item.id)} />)}
          {store.ready && !collections.length && <p className="mobile-quiet">Save songs from search or create a playlist.</p>}
          {store.storageError && <p role="alert">{store.storageError}</p>}
          <SingerHistory history={history} signedIn={!!account} />
        </section>)}

      {tab === 'profile' && <section>
        <div className="singer-account-card">
          <span className="singer-avatar" aria-hidden="true">{accountName.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase()}</span>
          <div className="singer-copy"><strong>{accountName}</strong><small>{account?.email ?? 'Guest profile'}</small></div>
        </div>
        {!account && onSignIn && <IonButton type="button" className="singer-ion-action" expand="block" shape="round" onClick={onSignIn}>Sign In / Create Account</IonButton>}
        <h2 className="singer-subheading">Profile &amp; Settings</h2>
        {accountSession && <SingerProfileDetailsEditor key={accountSession.token} token={accountSession.token} />}
        <details><summary>Notifications</summary>
          <SingerNotificationSettings controller={notifications} />
          <SingerLiveActivitySetting controller={lockScreen} />
        </details>
        <ListLink icon={personCircleOutline} title="Display Name" subtitle="Shown to hosts"
          onClick={() => openSheet({ kind: 'name' }, connectName)} disabled={!store.ready} />
        <details><summary><IonIcon icon={sunnyOutline} aria-hidden="true" /> Appearance</summary>
          <label>Theme<select value={theme} onChange={event => {
            const value = event.currentTarget.value;
            if (value === 'day' || value === 'night' || value === 'system') { setTheme(value); saveValue(themeKey, value); }
          }}><option value="system">Match Device</option><option value="day">Day</option><option value="night">Night</option></select></label>
        </details>
        <ListLink icon={albumsOutline} title="Playlists" subtitle="Saved on this device" onClick={() => changeTab('playlists')} />
        <details><summary>Browse Sources</summary>
          {joined ? <p className="mobile-quiet">The host chooses the sources in this room.</p> :
            BROWSE_SOURCES.map(source => <label className="mobile-check" key={source}>
              <input type="checkbox" checked={sources.includes(source)} onChange={event => setSource(source, event.currentTarget.checked)} />{BROWSE_LABELS[source]}
            </label>)}
        </details>
        {account && onSignOut && <IonButton type="button" className="singer-ion-action" fill="outline" expand="block" shape="round" onClick={() => void onSignOut()}>Sign Out</IonButton>}
        {store.storageError && <p role="alert">{store.storageError}</p>}
        <p className="singer-version-label">The Proper Volume Karaoke Booth <span className="mobile-version">{appVersion}</span></p>
      </section>}
    </main>

    {!kiosk && tab !== 'playing' && <footer className="singer-workspace-dock">
      {playing && tab !== 'queue' && <NowButton playing={playing} onClick={() => changeTab('playing')} compact />}
      <SingerTabs tab={tab} navigate={changeTab} />
    </footer>}

    {sheet && <SingerSheet title={sheet.kind === 'song' ? sheet.song.title : sheet.kind === 'join' ? 'Join Room'
      : sheet.kind === 'playlist' ? 'New Playlist' : 'Display Name'} dismiss={dismissSheet} busy={connecting || saving}>
      {sheet.kind === 'song' ? <>
        <p>{[sheet.song.artist, sheet.song.source ? sourceNames[sheet.song.source] : 'Host Library'].filter(Boolean).join(' · ')}</p>
        {joined && room && guest && guest.songs.some(song => song.id === sheet.song.id) ?
          <IonButton type="button" className="singer-ion-action" expand="block" shape="round" disabled={guest.busy || guest.uncertain}
            onClick={() => {
              setSheet(null);
              if (!kiosk) changeTab('queue');
              void room.client.request(sheet.song.id, listener);
            }}>Add to Queue</IonButton> :
          <IonButton type="button" className="singer-ion-action" expand="block" fill="outline" shape="round"
            onClick={() => { setSheet(null); changeTab('room'); }}>Join a Room to Queue</IonButton>}
        {!kiosk && <div className="singer-inline-actions singer-sheet-song-actions">
          <SingerStarButton store={store} recording={saveRecording(sheet.song, sheet.browseSong)} displayName={snapshot?.singerName} />
          <SaveToSingerPlaylist store={store} recording={saveRecording(sheet.song, sheet.browseSong)} />
        </div>}
      </> : <form onSubmit={event => {
        event.preventDefault();
        if (sheet.kind === 'join') void join(sheet.slug, sheet.label, sheetValue);
        else void saveSheet();
      }}>
        {sheet.kind === 'join' && <p className="mobile-quiet">{sheet.label}</p>}
        <label>{sheet.kind === 'playlist' ? 'Playlist name' : sheet.kind === 'join' ? 'Singer name' : 'Display name'}
          <input value={sheetValue} maxLength={100} autoComplete={sheet.kind === 'playlist' || kiosk ? 'off' : 'nickname'} required
            disabled={connecting || saving || (sheet.kind === 'join' && guest?.joinUncertain)}
            onChange={event => setSheetValue(event.currentTarget.value)} />
        </label>
        {sheet.kind === 'join' && <p className="mobile-quiet">The host uses this name to call you up.</p>}
        <IonButton type="submit" className="singer-ion-action" expand="block" shape="round"
          disabled={connecting || saving || !sheetValue.trim()}>{sheet.kind === 'join'
          ? connecting ? 'Connecting…' : guest?.joinUncertain ? 'Retry Joining' : 'Join Room' : 'Save'}</IonButton>
        {sheetError && <p role="alert">{sheetError}</p>}
      </form>}
    </SingerSheet>}
  </div>;
}

function SingerTabs({ tab, navigate }: { tab: Tab; navigate: (tab: Tab) => void }) {
  return <nav aria-label="Singer workspace">
    <IonTabBar className="singer-tab-bar" translucent>
      {tabs.map(item => <IonTabButton key={item.id} tab={item.id} aria-label={item.label}
        selected={item.id === tab} onClick={() => navigate(item.id)}>
        <IonIcon icon={item.icon} aria-hidden="true" /><IonLabel>{item.label}</IonLabel>
      </IonTabButton>)}
    </IonTabBar>
  </nav>;
}

function SongArtwork({ source }: { source?: SourceId }) {
  return <span aria-hidden="true" className={'singer-artwork source-' + (source ?? 'local')}>
    <IonIcon icon={musicalNotesOutline} />
  </span>;
}

function ListLink({ icon, title, subtitle, onClick, disabled }: {
  icon: string; title: string; subtitle?: string; onClick: () => void; disabled?: boolean;
}) {
  return <button className="singer-list-link" type="button" onClick={onClick} disabled={disabled}>
    <span className="singer-list-icon"><IonIcon icon={icon} aria-hidden="true" /></span>
    <span className="singer-copy"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
    <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
  </button>;
}

function NowButton({ playing, compact, onClick }: { playing: GuestNowPlaying; compact?: boolean; onClick: () => void }) {
  const detail = [playing.artist, playing.singer].filter(Boolean).join(' · ');
  return <button type="button" className={'singer-now-button' + (compact ? ' singer-now-mini' : '')}
    aria-label={compact ? 'Open Now Playing' : 'Now Playing: ' + playing.title} onClick={onClick}>
    <SongArtwork source={playing.source} />
    <span className="singer-copy"><strong>{playing.title}</strong><small>{detail || 'Now Playing'}</small></span>
    <span className={'singer-badge' + (playing.status === 'playing' ? ' singer-badge-live' : '')}>
      {playing.status === 'paused' ? 'Paused' : 'Live'}
    </span>
    <IonIcon icon={compact ? chevronUpOutline : chevronForwardOutline} aria-hidden="true" />
    {compact && playing.timing && <progress className="singer-now-progress" aria-hidden="true"
      value={playing.timing.position} max={playing.timing.duration} />}
  </button>;
}
