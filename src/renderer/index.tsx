import React, { useEffect, useMemo, useRef, useState } from 'react';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import { createRoot } from 'react-dom/client';
import type { Command, ShowState, SongRequest, Version } from '../domain/index';
import { isVersionAllowed, singerAvailable, orderedFuture, remainingPauseSeconds, visibleVersions } from '../domain/index';
import { DEFAULT_SETTINGS, nextAccentColor, type Settings } from '../domain/settings';
import type { LibraryFilter, LibrarySort } from '../domain/library-view';
import { unifiedLibrary, type LibrarySearchVersion } from '../domain/unified-library';
import type { CatalogRequestTrack } from '../domain/catalog-request';
import { DEFAULT_SHORTCUTS, matchesShortcut, type Shortcuts } from '../domain/shortcuts';
import type { MissingSongRequest, MissingSongReview, MissingSongStatus } from '../domain/missing-request';
import type { CollectionsAction, CollectionsSnapshot } from '../domain/collections';
import { Icon } from './Icon';
import { CollectionsPanel } from './CollectionsPanel';
import { PlaybackTimeline } from './PlaybackTimeline';
import type { PlaybackTimelineState, PlaybackSeek, PlaybackSeekResult } from '../domain/playback-timeline';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';
import { SongRequestDialog } from './SongRequestDialog';
import { QueueEditDialog } from './QueueEditDialog';
import { SingerAvailabilityControl } from './SingerAvailabilityControl';
import { Tooltip } from './Tooltip';
import { SettingsDialog } from './SettingsDialog';
import { EditMetadataDialog } from './EditMetadataDialog';
import type { BumperInfo } from './BumperPanel';
import type { HostRemoteBridge } from '../remote/host-control';
import { ImportPanel, type ImportBridge } from './ImportPanel';
import { CdgImportPanel, type CdgBridge } from './CdgImportPanel';
import { YouTubeDownloadsPanel, type YouTubeDownloadBridge } from './YouTubeDownloadsPanel';
import { MissingSongReviewPanel } from './MissingSongReviewPanel';
import { CommunityCatalogPanel } from './CommunityCatalogPanel';
import { LibraryCatalogStatus } from './LibraryCatalogStatus';
import { useLibraryCatalogSearch } from './use-library-catalog-search';
import { requestWithSinger } from './request-singer';
import { requestLibrarySong } from './request-library-song';
import type { LocalCatalogResult } from '../main/karaokenerds-local-browser';
import type { CatalogConnectionStatus } from '../main/shared-catalog-connection';
import type { ImportProgress } from '../domain/import-job';
import type { BackupResult } from '../main/show-backup';
import type { HistoryExportResult } from '../main/history-export';
import '../styles/main.scss';
import '../styles/tooltip.scss';
import '../styles/import-panel.scss';

type Screen = 'library' | 'catalog' | 'requests' | 'singers' | 'playlists';
type Result = { ok: boolean; error?: string; cancelled?: boolean; notice?: string };
function formatShortcut(binding: string): string { return binding.split('+').map(part => part === 'Space' ? 'Spacebar' : part === 'Control' ? 'Ctrl' : part.replace(/^Key/, '').replace(/^Digit/, '')).join('+'); }
declare global {
  interface Window {
    tpv: {
      getAppVersion: () => Promise<string>;
      chooseSharedCatalogConfiguration: () => Promise<string | null>;
      getSharedCatalogStatus: (file?: string) => Promise<CatalogConnectionStatus>;
      getState: () => Promise<ShowState>;
      getTimeline: () => Promise<PlaybackTimelineState>;
      onTimeline: (callback: (value: PlaybackTimelineState) => void) => () => void;
      seek: (input: PlaybackSeek) => Promise<PlaybackSeekResult>;
      getLibraryFilenames: () => Promise<Record<string, string>>;
      backupShow: () => Promise<BackupResult>;
      retryBackupCleanup: () => Promise<BackupResult>;
      getCollections: () => Promise<CollectionsSnapshot>;
      exportHistory: (filter: { query: string; singerId: string }) => Promise<HistoryExportResult>;
      historyExportStatus: () => Promise<{ cleanupNeeded: boolean; published: boolean }>;
      retryHistoryExportCleanup: () => Promise<HistoryExportResult>;
      mutateCollections: (action: CollectionsAction) => Promise<CollectionsSnapshot>;
      getSettings: () => Promise<{ settings: Settings; path: string; created: boolean }>;
      searchCommunityCatalog: (query: string) => Promise<LocalCatalogResult>;
      requestCatalogTrack: (input: { track: CatalogRequestTrack; singerId: string; requestId: string }) => Promise<Result & { versionId?: string; notice?: string }>;
      addYouTube: (input: {url:string;title:string;artist:string;brandSlug?:string}) => Promise<Result & {versionId?:string;notice?:string}>;
      openCommunityVideo: (id: string) => Promise<Result>;
      getShortcuts: () => Promise<{ shortcuts: Shortcuts; path: string; error: string }>;
      saveSettings: (settings: Settings) => Promise<Settings>;
      cycleAccentColor: () => Promise<Settings['accentColor']>;
      subscribe: (callback: (state: ShowState) => void) => () => void;
      onFocusSearch: (callback: () => void) => () => void;
      importFiles: (kind?: 'files' | 'folder') => Promise<ImportProgress | null>;
      imports: ImportBridge;
      cdg: CdgBridge;
      youtubeDownloads: YouTubeDownloadBridge;
      chooseVideoCacheDirectory: () => Promise<string | null>;
      revealVideoCacheDirectory: () => Promise<void>;
      getMissingSongRequests: () => Promise<MissingSongRequest[]>;
      onMissingSongRequests: (callback: (requests: MissingSongRequest[]) => void) => () => void;
      getMissingSongReviews: () => Promise<MissingSongReview[]>;
      onMissingSongReviews: (callback: (requests: MissingSongReview[]) => void) => () => void;
      setMissingSongStatus: (id: string, expected: MissingSongStatus, next: MissingSongStatus) => Promise<boolean>;
      addMissingSongRequest: (request: { singer: string; title: string; artist: string }) => Promise<Result>;
      command: (payload: Command) => Promise<Result>;
      openDisplay: () => Promise<void>;
      toggleDisplayFullscreen: () => Promise<void>;
      revealConfigFile: (kind: 'settings' | 'shortcuts') => Promise<void>;
      chooseDisplayLogo: () => Promise<boolean>;
      clearDisplayLogo: () => Promise<void>;
      getBumpers: () => Promise<BumperInfo>;
      addBumpers: () => Promise<BumperInfo>;
      removeBumper: (id: string) => Promise<BumperInfo>;
      startBumper: (id: string) => Promise<BumperInfo>;
      stopBumper: () => Promise<BumperInfo>;
      onBumperState: (callback: (state: BumperInfo) => void) => () => void;
      revealMedia: (versionId: string) => Promise<void>;
      relinkMedia: (versionId: string) => Promise<Result>;
      remote: HostRemoteBridge;
    };
  }
}

function App() {
  const [appVersion, setAppVersion] = useState('');
  const [state, setState] = useState<ShowState | null>(null);
  useEffect(() => { let alive = true; void window.tpv.getAppVersion().then(value => {if(alive)setAppVersion(value);}).catch(() => {});return()=>{alive=false;}; }, []);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [screen, setScreen] = useState<Screen>('library');
  const [search, setSearch] = useState('');
  const [librarySort, setLibrarySort] = useState<LibrarySort>('import-oldest');
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [libraryFilenames, setLibraryFilenames] = useState<Record<string, string>>({});
  const [filenameRefresh, setFilenameRefresh] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const focusSearch = () => { setEditingRequest(null); setQueueMenu(null); setSettingsOpen(false); setEditingVersion(null); setQueueVersion(null); setPlaylistVersion(null); setContextMenu(null); setScreen('library'); setSearchFocusRequest(value => value + 1); };
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [cachedVideoIds, setCachedVideoIds] = useState<string[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [editingRequest, setEditingRequest] = useState<SongRequest | null>(null);
  const [queueMenu, setQueueMenu] = useState<{ request: SongRequest; x: number; y: number } | null>(null);
  const draggedRequest = useRef('');
  const [queueVersion, setQueueVersion] = useState<LibrarySearchVersion | null>(null);
  const [playlistVersion, setPlaylistVersion] = useState<Version | null>(null);
  const [contextMenu, setContextMenu] = useState<{ version: LibrarySearchVersion; x: number; y: number } | null>(null);
  const [collections, setCollections] = useState<CollectionsSnapshot>({ playlists: [], items: [], history: [] });
  const [selectedSingerId, setSelectedSingerId] = useState('');
  const [singerName, setSingerName] = useState('');
  const [newRequestSingerName, setNewRequestSingerName] = useState('');
  const [missingSinger, setMissingSinger] = useState('');
  const [missingTitle, setMissingTitle] = useState('');
  const [missingArtist, setMissingArtist] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [importActive, setImportActive] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupCleanup, setBackupCleanup] = useState(false);
  const [importPickerBusy, setImportPickerBusy] = useState(false);
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [accentSaving, setAccentSaving] = useState(false);
  const accentSaveInFlight = useRef(false);
  const [settingsPath, setSettingsPath] = useState('');
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  const [shortcutsPath, setShortcutsPath] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingVersion, setEditingVersion] = useState<Version | null>(null);

  useEffect(() => {
    let deadline = state?.nextStartAtMs ?? 0;
    for (const singer of state?.singers ?? []) deadline = Math.max(deadline, singer.unavailableUntilMs ?? 0);
    setClockMs(Date.now());
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now(); setClockMs(now);
      if (now >= deadline) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [state?.nextStartAtMs, state?.singers]);

  useEffect(() => {
    let alive = true;
    // Subscribe before the initial snapshot so an intervening update is not lost.
    const unsubscribe = window.tpv.subscribe(value => { if (alive) setState(current => !current || value.revision >= current.revision ? value : current); });
    window.tpv.getState().then(value => { if (alive) setState(current => !current || value.revision >= current.revision ? value : current); })
      .catch(error => { if (alive) setNotice(`Could not load the show: ${String(error)}`); });
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    let alive = true;
    void window.tpv.getCollections().then(value => { if (alive) setCollections(value); })
      .catch(error => { if (alive) setNotice(`Could not load playlists and history: ${String(error)}`); });
    return () => { alive = false; };
  }, [state?.revision]);

  useEffect(() => {
    let alive = true;
    void window.tpv.getLibraryFilenames().then(value => { if (alive) setLibraryFilenames(value); })
      .catch(() => { if (alive) setNotice('Filename search is unavailable.'); });
    return () => { alive = false; };
  }, [state?.revision, filenameRefresh]);

  useEffect(() => {
    let alive = true;
    void window.tpv.getShortcuts().then(result => {
      if (alive) { setShortcuts(result.shortcuts); setShortcutsPath(result.path); if (result.error) setNotice(`${result.error} Defaults are active until the file is fixed and the app restarted.`); }
    }).catch(error => { if (alive) setNotice(`Could not load keyboard shortcuts: ${String(error)}`); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void window.tpv.getSettings().then(async result => {
      let loaded = result.settings;
      const previousTheme = localStorage.getItem('tpv-theme');
      if (result.created && (previousTheme === 'day' || previousTheme === 'night'))
        loaded = await window.tpv.saveSettings({ ...loaded, appearance: previousTheme });
      if (alive) { setSettings(loaded); setSettingsPath(result.path); }
    }).catch(error => { if (alive) setNotice(`Could not load preferences: ${String(error)}`); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => { document.documentElement.dataset.theme = settings.appearance === 'system' ? (preference.matches ? 'day' : 'night') : settings.appearance; };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, [settings.appearance]);

  useEffect(() => { document.documentElement.dataset.accent = settings.accentColor; }, [settings.accentColor]);

  const cycleAccent = async () => {
    if (accentSaveInFlight.current || !settingsPath) return;
    accentSaveInFlight.current = true; setAccentSaving(true);
    try {
      const accentColor = await window.tpv.cycleAccentColor();
      setSettings(current => ({ ...current, accentColor }));
    } catch { setNotice('Could not save the accent color. Please try again.'); }
    finally { accentSaveInFlight.current = false; setAccentSaving(false); }
  };

  useEffect(() => window.tpv.onFocusSearch(focusSearch), []);
  useEffect(() => { if (searchFocusRequest) searchInput.current?.focus(); }, [searchFocusRequest, screen, !!state]);
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('.song-menu')) setContextMenu(null); };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [contextMenu]);

  useEffect(() => {
    if (!queueMenu) return;
    const dismiss = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('.queue-menu')) setQueueMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setQueueMenu(null); };
    window.addEventListener('mousedown', dismiss); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('mousedown', dismiss); window.removeEventListener('keydown', escape); };
  }, [queueMenu]);

  const versions = useMemo(() => state ? visibleVersions(state) : [], [state]);
  const catalogSearch = useLibraryCatalogSearch(search, screen === 'library', JSON.stringify([settings.sharedCatalogEnabled, settings.sharedCatalogConfigFile]), window.tpv.searchCommunityCatalog);
  const filtered = useMemo(() => state ? unifiedLibrary(state, search, libraryFilenames, librarySort, libraryFilter,
    catalogSearch.result?.status === 'ready' ? catalogSearch.result.tracks : [], versions) : [], [state, versions, search, libraryFilenames, librarySort, libraryFilter, catalogSearch.result]);
  const selectedVersion = filtered.find(v => v.id === selectedVersionId);
  const selectedSinger = state?.singers.find(s => s.id === selectedSingerId);
  const pending = state?.requests.filter(r => r.status === 'pending') ?? [];
  const future = state ? orderedFuture(state, settings.rotationMode, clockMs) : [];
  const selectedFuture = future.find(request => request.id === selectedRequestId);
  const eligibleFuture = state && future.some(r => r.status === 'accepted' && singerAvailable(state, r.singerId, clockMs) && isVersionAllowed(state, r.versionId));
  const staged = state?.requests.find(r => r.id === state.stagedRequestId);
  const active = state?.requests.find(r => r.id === state.playback?.requestId);
  const pauseRemaining = state ? remainingPauseSeconds(state, clockMs) : 0;
  const describe = (request?: SongRequest) => {
    const singer = state?.singers.find(s => s.id === request?.singerId)?.name ?? 'Unknown singer';
    const song = state?.versions.find(v => v.id === request?.versionId);
    return { singer, title: song?.title ?? 'Unknown song', artist: song?.artist ?? '' };
  };
  const run = async (operation: () => Promise<Result | void>, success?: string) => {
    setBusy(true);
    try {
      const result = await operation();
      if (result?.cancelled) return;
      if (result && !result.ok) setNotice(result.error || 'The action could not be completed.');
      else setNotice(result?.notice || success || '');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const command = (payload: Command, success?: string) => run(() => window.tpv.command(payload), success);
  const backupShow = async (retry = false) => {
    if (backupBusy) return;
    setBackupBusy(true); setNotice('');
    try {
      const result = await (retry ? window.tpv.retryBackupCleanup() : window.tpv.backupShow());
      setBackupCleanup(result.status === 'cleanup-needed');
      if (result.status === 'saved') setNotice('Show backup saved. Video files and preferences are not included. Protect the backup using your destination folder permissions.');
      else if (result.status === 'failed') setNotice('Backup could not be completed. Choose a new filename on a supported local drive and try again; existing files are never overwritten.');
      else if (result.status === 'cleanup-needed') setNotice(`${result.published ? 'The backup was saved' : 'The backup was not saved'}, but temporary backup cleanup needs attention. Retry cleanup before creating another backup.`);
    } catch { setNotice('Backup could not be completed. Please try again.'); }
    finally { setBackupBusy(false); }
  };
  const beginImport = async (kind: 'files' | 'folder') => {
    if (importPickerBusy || importActive) return;
    setImportPickerBusy(true); setNotice('');
    try { await window.tpv.importFiles(kind); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setImportPickerBusy(false); }
  };
  const relinkSong = async (id: string) => {
    if (relinkBusy) return;
    setRelinkBusy(true); setNotice('Checking the selected file…');
    try { const result = await window.tpv.relinkMedia(id); if (result.ok && !result.cancelled) setFilenameRefresh(value => value + 1); setNotice(result.cancelled ? '' : result.ok ? 'Song file relinked.' : result.error || 'The song could not be relinked.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setRelinkBusy(false); }
  };
  const playPause = () => run(async () => {
    if (state?.playback) return window.tpv.command({ type: state.playback.status === 'paused' ? 'resume' : 'pause' });
    const remaining = state ? remainingPauseSeconds(state, Date.now()) : 0;
    if (remaining) return { ok: false, error: `Wait ${remaining} seconds before starting the next song.` };
    if (!state?.stagedRequestId) {
      const staged = await window.tpv.command({ type: 'stage' });
      if (!staged.ok) return staged;
    }
    return window.tpv.command({ type: 'start', generationId: crypto.randomUUID() });
  });
  const mutateCollections = async (action: CollectionsAction): Promise<boolean> => {
    try { setCollections(await window.tpv.mutateCollections(action)); setNotice(''); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false; }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const input = { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
      if (!event.repeat && matchesShortcut(shortcuts, 'search', input)) {
        event.preventDefault();
        focusSearch();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (event.key === 'Delete' && !event.repeat && selectedRequestId && target?.closest('[data-queue-list]') && !target.closest('input, textarea, select, button, [contenteditable="true"]') && !busy && !settingsOpen && !editingRequest && !queueMenu && !editingVersion && !queueVersion && !playlistVersion && !contextMenu) {
        event.preventDefault(); void command({ type: 'removeRequest', requestId: selectedRequestId }); setSelectedRequestId(''); return;
      }
      if (!matchesShortcut(shortcuts, 'playPause', input) || event.repeat || settingsOpen || editingRequest || editingVersion || queueVersion || playlistVersion ||
          target?.closest('input, textarea, select, button, [contenteditable="true"]') || busy || (!state?.playback && !state?.stagedRequestId && !eligibleFuture)) return;
      event.preventDefault();
      void playPause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, busy, shortcuts, selectedRequestId, settingsOpen, editingVersion, queueVersion, playlistVersion, contextMenu, editingRequest, eligibleFuture]);
  const addSinger = (event: React.FormEvent) => {
    event.preventDefault();
    const name = singerName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    void run(async () => {
      const result = await window.tpv.command({ type: 'addSinger', singer: { id, name } });
      if (result.ok) { setSingerName(''); setSelectedSingerId(id); }
      return result;
    }, `${name} added.`);
  };
  const makeRequest = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedVersion) return;
    const name = newRequestSingerName.trim();
    if (!selectedSinger && (selectedSingerId !== '__new__' || !name)) return;
    void run(async () => {
      let singerId = selectedSinger?.id;
      if (!singerId) {
        singerId = crypto.randomUUID();
        const added = await window.tpv.command({ type: 'addSinger', singer: { id: singerId, name } });
        if (!added.ok) return added;
        // Retain the newly created singer even if the subsequent request fails.
        setSelectedSingerId(singerId);
        setNewRequestSingerName('');
      }
      const result = await requestLibrarySong(selectedVersion, singerId, crypto.randomUUID(), window.tpv);
      if (result.ok && result.versionId) setSelectedVersionId(result.versionId);
      return result;
    }, settings.autoApprove ? 'Request added to the queue.' : 'Request added for review.');
  };
  const requestMissingSong = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await window.tpv.addMissingSongRequest({ singer: missingSinger, title: missingTitle, artist: missingArtist });
      if (result.ok) {
        setMissingSinger(''); setMissingTitle(''); setMissingArtist('');
      }
      return result;
    }, 'Missing-song request saved.');
  };
  const setAvailability = (singerId: string, minutes: number) => {
    const stagedForSinger = state?.requests.some(request => request.id === state.stagedRequestId && request.singerId === singerId);
    const releaseStaged = !!stagedForSinger && minutes > 0;
    if (releaseStaged && !window.confirm('Release this singer’s staged song and mark them unavailable? The waiting song will return to the queue.')) return;
    void command({ type: 'setSingerAvailability', singerId, minutes, releaseStaged }, minutes ? `Singer unavailable for ${minutes} minutes. Existing requests stay saved; playback starts only when the host presses Play.` : 'Singer returned to the rotation.');
  };
  const skip = () => {
    if (state?.playback && window.confirm('Skip this performance? This consumes the singer’s turn.'))
      void command({ type: 'skip', generationId: state.playback.generationId, confirmed: true });
  };
  const current = describe(active);
  const stage = describe(staged);

  return <div className="app" data-layout={settings.layout}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">▥</span><span>The Proper Volume<small>Karaoke host</small></span></div>
      <h1>Local rehearsal{appVersion && <small style={{marginLeft:'0.6em'}} aria-label="Application version">v{appVersion}</small>}</h1>
      <Tooltip text={`Accent color: ${settings.accentColor}. Switch to ${nextAccentColor(settings.accentColor)}`}><button className="icon-button accent-button" aria-label={`Accent color: ${settings.accentColor}. Switch to ${nextAccentColor(settings.accentColor)}`} onClick={() => void cycleAccent()} disabled={!settingsPath || accentSaving}><Icon name="palette" /></button></Tooltip>
      <Tooltip text={`Search (${shortcuts.search.map(formatShortcut).join(', ')})`}><button className="icon-button" aria-label="Open library search" onClick={focusSearch}><Icon name="search" /></button></Tooltip>
      <Tooltip text="Singer Display"><button className="icon-button" aria-label="Singer display" onClick={() => void run(() => window.tpv.openDisplay())}><Icon name="display" /></button></Tooltip>
      <Tooltip text="Toggle singer display fullscreen"><button className="icon-button" aria-label="Toggle singer display fullscreen" onClick={() => void run(() => window.tpv.toggleDisplayFullscreen())}><Icon name="fullscreen" /></button></Tooltip>
      <Tooltip text="Preferences"><button className="icon-button" aria-label="Preferences" onClick={() => setSettingsOpen(true)} disabled={!settingsPath || accentSaving}><Icon name="settings" /></button></Tooltip>
    </header>
    <nav className="sidebar" aria-label="Workspace">
      <div className="eyebrow">Workspace</div>
      <button className="nav-item" disabled={backupBusy} onClick={() => void backupShow(backupCleanup)}>{backupBusy ? 'Backing up…' : backupCleanup ? 'Retry backup cleanup' : 'Back up show…'}</button>
      {([['library', 'Library'], ['catalog', 'Karaoke Nerds'], ['requests', `Requests${pending.length ? ` (${pending.length})` : ''}`], ['singers', 'Singers'], ['playlists', 'Playlists']] as const).map(([id, label]) =>
        <button key={id} className={`nav-item ${screen === id ? 'active' : ''}`} aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}>{label}</button>)}
    </nav>
    <main className="main-panel">
      {notice && <p className="notice" role="status">{notice}</p>}
      <ImportPanel bridge={window.tpv.imports} onActiveChange={setImportActive} />
      <YouTubeDownloadsPanel bridge={window.tpv.youtubeDownloads} onCached={setCachedVideoIds} />
      {screen === 'library' && <CdgImportPanel bridge={window.tpv.cdg} />}
      {!state ? <p className="empty">Loading your show…</p> : <>
        {screen === 'library' && <>
          <div className="section-heading"><h2>Song Library</h2><div><Tooltip text="Import Video File"><button className="icon-button" aria-label="Import Video File" disabled={busy || importActive || importPickerBusy} onClick={() => void beginImport('files')}><Icon name="file" /></button></Tooltip> <Tooltip text="Import Custom Directory"><button className="icon-button" aria-label="Import Custom Directory" disabled={busy || importActive || importPickerBusy} onClick={() => void beginImport('folder')}><Icon name="folder" /></button></Tooltip></div></div>
          <div className="library-toolbar"><input ref={searchInput} type="search" aria-label="Search library" placeholder="Search your library and Karaoke Nerds" value={search} onChange={e => setSearch(e.target.value)} />
            <label>Sort<select aria-label="Sort songs" value={librarySort} onChange={event => setLibrarySort(event.target.value as LibrarySort)}>
              <option value="import-oldest">Import order</option><option value="import-newest">Newest imported</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option><option value="artist-asc">Artist A–Z</option><option value="artist-desc">Artist Z–A</option>
            </select></label>
            <label>Filter<select aria-label="Filter songs" value={libraryFilter} onChange={event => setLibraryFilter(event.target.value as LibraryFilter)}>
              <option value="all">All songs</option><option value="review">Needs metadata review</option><option value="missing-artist">Missing artist</option><option value="clean">Clean</option><option value="explicit">Explicit</option><option value="unrated">Unrated</option><option value="uncertain">Uncertain rating</option>
            </select></label></div>
          <LibraryCatalogStatus state={catalogSearch} />
          <div className="eyebrow">Title / artist <span className="muted"> · Local files and online recordings</span></div>
          <div role="listbox" aria-label="Songs" className="song-list">
            {filtered.map((version, index) => <div className={`track-row song-option ${version.id === selectedVersionId ? 'selected' : ''}`} key={version.id} role="option" aria-selected={version.id === selectedVersionId} tabIndex={0}
              onClick={() => setSelectedVersionId(version.id)} onDoubleClick={() => { setSelectedVersionId(version.id); setQueueVersion(version); }}
              onContextMenu={event => { event.preventDefault(); setSelectedVersionId(version.id); setContextMenu({ version, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 230)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 250)) }); }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSelectedVersionId(version.id); setQueueVersion(version); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="option"]'); const i = Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); next?.[i]?.focus(); setSelectedVersionId(filtered[i]?.id ?? ''); } }}>
              <div><strong>{version.title}</strong><small>{version.artist || 'Unknown artist'} · {version.source?.provider === 'youtube' ? `${cachedVideoIds.includes(version.id) ? 'Saved locally' : version.catalogTrack ? 'Downloads when queued · Found on Karaoke Nerds' : 'Download needed'}` : [version.djCode,version.trackNumber].filter(Boolean).join('-') || 'Local'}{version.metadataAmbiguous ? ' · Review metadata' : ''}</small></div>
              {version.source && <span className="badge">YouTube</span>}
            </div>)}
            {!filtered.length && <p className="empty">{search.trim() || versions.length ? 'No songs match this search or filter.' : 'Search Karaoke Nerds or import a local video to begin. Your original file stays in place.'}</p>}
          </div>
          <form className="request-form" onSubmit={makeRequest}>
            <label>Singer for {selectedVersion ? `“${selectedVersion.title}”` : 'selected song'}<select value={selectedSingerId} onChange={e => setSelectedSingerId(e.target.value)}><option value="">Choose a singer</option>{state.singers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}<option value="__new__">Add a new singer…</option></select></label>
            {selectedSingerId === '__new__' && <label>New singer name<input autoComplete="off" value={newRequestSingerName} onChange={e => setNewRequestSingerName(e.target.value)} maxLength={100} /></label>}
            <button type="submit" disabled={busy || !selectedVersion || (!selectedSinger && !(selectedSingerId === '__new__' && newRequestSingerName.trim()))}>Add request</button>
          </form>
          <h3>Can't Find a Song?</h3>
          <p className="muted">Save a request for the host to review. This does not add it to the rotation.</p>
          <form className="request-form" onSubmit={requestMissingSong}>
            <label>Singer name<input value={missingSinger} onChange={e => setMissingSinger(e.target.value)} maxLength={100} required /></label>
            <label>Song title<input value={missingTitle} onChange={e => setMissingTitle(e.target.value)} maxLength={200} required /></label>
            <label>Artist (optional)<input value={missingArtist} onChange={e => setMissingArtist(e.target.value)} maxLength={200} /></label>
            <button type="submit" disabled={busy || !missingSinger.trim() || !missingTitle.trim()}>Save missing-song request</button>
          </form>
        </>}
        {screen === 'catalog' && <CommunityCatalogPanel search={window.tpv.searchCommunityCatalog} openVideo={window.tpv.openCommunityVideo} addVideo={window.tpv.addYouTube} onAdded={(id, notice) => { setSelectedVersionId(id); setScreen('library'); setNotice(notice || 'YouTube song saved in the library. Choose a singer and add a request to queue its download.'); }} />}
        {screen === 'requests' && <>
          <h2>Requests</h2><p className="muted">Review requests before they enter the rotation.</p>
          {pending.map(request => { const item = describe(request); return <div className="track-row" key={request.id}><div><strong>{item.singer}</strong><small>{item.title}{item.artist ? ` · ${item.artist}` : ''}</small></div><div><button disabled={busy} onClick={() => void command({ type: 'accept', requestId: request.id })}>Accept</button> <button disabled={busy} onClick={() => void command({ type: 'rejectRequest', requestId: request.id })}>Reject</button></div></div>; })}
          {!pending.length && <p className="empty">No requests waiting for review.</p>}
          <details><summary>Request history</summary>
            {state.requests.filter(request => ['rejected', 'withdrawn', 'removed', 'completed', 'skipped'].includes(request.status)).slice(-50).reverse().map(request => {
              const item = describe(request); return <div className="track-row" key={request.id}><div><strong>{item.singer}</strong><small>{item.title}{item.artist ? ` · ${item.artist}` : ''} · {request.status}</small></div></div>;
            })}
            {!state.requests.some(request => ['rejected', 'withdrawn', 'removed', 'completed', 'skipped'].includes(request.status)) && <p>No past requests yet.</p>}
            <p className="muted">Showing the 50 most recent past requests.</p>
          </details>
          <MissingSongReviewPanel bridge={window.tpv} />
        </>}
        {screen === 'singers' && <>
          <h2>Singers</h2><form className="inline-form" onSubmit={addSinger}><label>Singer name<input autoComplete="off" value={singerName} onChange={e => setSingerName(e.target.value)} placeholder="Enter a name" maxLength={100} /></label><button className="primary" disabled={busy || !singerName.trim()} type="submit">Add singer</button></form>
          <h3>In This Show</h3><p className="muted">Unavailable singers can have one upcoming request. Existing requests are kept. They rejoin after their return time without interrupting a staged or playing song.</p>{state.singers.map(s => <SingerAvailabilityControl key={s.id} singer={s} nowMs={clockMs} busy={busy} onChange={minutes => setAvailability(s.id, minutes)} />)}
          {!state.singers.length && <p className="empty">No singers yet.</p>}
        </>}
        {screen === 'playlists' && <CollectionsPanel data={collections} versions={versions} singers={state.singers} selectedVersionId={selectedVersionId} busy={busy} mutate={mutateCollections} selectVersion={id => { setSelectedVersionId(id); setScreen('library'); }} />}
      </>}
    </main>
    <aside className="rotation" aria-label="Singer rotation">
      <h2>{settings.rotationMode === 'singer' ? 'Singer Rotation' : 'Request Queue'}</h2><span className="badge">{settings.autoApprove ? 'Auto-approve' : 'Host moderated'}</span>
      <div className="eyebrow">On Stage</div>
      <div className="on-stage">{active ? <><strong>{current.singer}</strong><small>{current.title} · {state?.playback?.status === 'paused' ? 'Paused' : 'Playing'}</small></> : <span className="muted">No singer on stage</span>}</div>
      <div className="section-heading"><span className="eyebrow">Up Next</span><button disabled={busy || !!staged || !eligibleFuture} onClick={() => void command({ type: 'stage' })}>Stage next</button></div>
      <button disabled={busy || !selectedFuture || selectedFuture.status !== 'accepted' || !state || !isVersionAllowed(state, selectedFuture.versionId) || state.promotedRequestId === selectedFuture.id} onClick={() => { if (selectedFuture) void command({ type: 'promoteRequest', requestId: selectedFuture.id }, 'Request promoted to the front of the waiting queue.'); }}>Promote selected</button>
      <div className="queue-actions"><button disabled={busy || !selectedFuture || selectedFuture.status !== 'accepted' || future.filter(r => r.status === 'accepted').findIndex(r => r.id === selectedFuture.id) < 1} onClick={() => { if (!selectedFuture) return; const waiting = future.filter(r => r.status === 'accepted'); const i = waiting.findIndex(r => r.id === selectedFuture.id); if (i > 0) void command({ type: 'moveRequest', requestId: selectedFuture.id, beforeRequestId: waiting[i - 1].id }); }}>Move up</button> <button disabled={busy || !selectedFuture || selectedFuture.status !== 'accepted' || future.filter(r => r.status === 'accepted').at(-1)?.id === selectedFuture.id} onClick={() => { if (!selectedFuture) return; const waiting = future.filter(r => r.status === 'accepted'); const i = waiting.findIndex(r => r.id === selectedFuture.id); if (i >= 0 && i < waiting.length - 1) void command({ type: 'moveRequest', requestId: selectedFuture.id, beforeRequestId: waiting[i + 2]?.id ?? null }); }}>Move down</button> <button disabled={busy || (!state?.manualQueueOrder?.length && !state?.promotedRequestId)} onClick={() => void command({ type: 'resetQueueOrder' }, 'Automatic queue order restored.')}>Automatic order</button></div>
      {state?.manualQueueOrder?.length ? <p className="muted">Manual order · new requests follow the arranged queue.</p> : null}
      <div role="listbox" aria-label="Singer Rotation" data-queue-list>{future.map((request, index) => { const item = describe(request); return <div className={`queue-row ${selectedRequestId === request.id ? 'selected' : ''}`} key={request.id} role="option" aria-selected={selectedRequestId === request.id} tabIndex={0} onClick={() => setSelectedRequestId(request.id)} onFocus={() => setSelectedRequestId(request.id)}
        draggable={!busy && request.status === 'accepted'} onDragStart={event => { draggedRequest.current = request.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', request.id); }} onDragEnd={() => { draggedRequest.current = ''; }}
        onDragOver={event => { if (!busy && request.status === 'accepted' && draggedRequest.current && draggedRequest.current !== request.id) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); const id = draggedRequest.current; draggedRequest.current = ''; if (!busy && id && id !== request.id && request.status === 'accepted') void command({ type: 'moveRequest', requestId: id, beforeRequestId: request.id }); }}
        onContextMenu={event => { event.preventDefault(); setSelectedRequestId(request.id); setQueueMenu({ request, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 230)) }); }}
        onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setQueueMenu({ request, x: Math.max(0, Math.min(rect.left, window.innerWidth - 240)), y: Math.max(0, Math.min(rect.top, window.innerHeight - 230)) }); } }}><div className="queue-row__head"><span className="queue-row__number">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.singer}</strong><small>{item.title}</small><small>{request.status === 'staged' ? 'Staged · locked' : state && !singerAvailable(state, request.singerId, clockMs) ? `Unavailable · back in ${Math.ceil(((state.singers.find(s => s.id === request.singerId)?.unavailableUntilMs ?? 0) - clockMs) / 60000)} min` : state && !isVersionAllowed(state, request.versionId) ? 'Unavailable under current policy' : state?.promotedRequestId === request.id ? (staged ? 'Promoted · next after staged' : 'Promoted · next') : settings.rotationMode === 'singer' ? `Round ${request.round}` : 'In request order'}</small></div></div></div>; })}</div>
      {!future.length && <p className="empty">Accepted requests will appear here.</p>}
      {staged && <button disabled={busy} onClick={() => void command({ type: 'release' })}>Release staged song</button>}
    </aside>
    <footer className="transport" aria-label="Playback controls">
      <div className="transport__track"><span className="eyebrow">{active ? 'Now playing' : staged ? 'Staged' : 'Player ready'}</span><strong>{active ? current.title : staged ? stage.title : 'No song selected'}</strong><small>{active ? current.singer : staged ? stage.singer : 'Stage an accepted request to begin'}</small></div>
      <div className="transport__controls">
        <Tooltip text={`Play/Pause (${shortcuts.playPause.map(formatShortcut).join(', ')})`}><button className="primary icon-button" aria-label="Play/Pause" disabled={busy || (!active && (pauseRemaining > 0 || (!staged && !eligibleFuture)))} onClick={() => void playPause()}><Icon name={state?.playback?.status === 'playing' ? 'pause' : 'play'} /></button></Tooltip>
        <Tooltip text="Stop"><button className="icon-button" aria-label="Stop" disabled={busy || !active} onClick={() => void command({ type: 'stop' })}><Icon name="stop" /></button></Tooltip>
        <Tooltip text="Skip"><button className="icon-button" aria-label="Skip" disabled={busy || !active} onClick={skip}><Icon name="skip" /></button></Tooltip>
        <label className="transport__volume">Volume <input type="range" aria-label="Global Volume" min="0" max="100" disabled={accentSaving} value={Math.round(settings.masterVolume * 100)} onChange={event => { if (accentSaveInFlight.current) return; const next = { ...settings, masterVolume: Number(event.target.value) / 100 }; setSettings(next); void window.tpv.saveSettings(next).catch(error => setNotice(`Could not save volume: ${String(error)}`)); }} /></label>
      </div>
      <PlaybackTimeline generation={state?.playback?.generationId ?? null} disabled={busy} />
      <div className="transport__status" role="status">{!active && pauseRemaining > 0 ? `Pause interval: ${pauseRemaining}s remaining. Press Play when ready.` : 'Key, tempo and automatic filler are not yet available in this rehearsal build.'}</div>
    </footer>
    {queueMenu && <div className="song-menu queue-menu" role="menu" aria-label="Queued request actions" style={{ left: queueMenu.x, top: queueMenu.y }}>
      <button role="menuitem" disabled={busy || queueMenu.request.status !== 'accepted'} onClick={() => { setEditingRequest(queueMenu.request); setQueueMenu(null); }}>Edit track or singer…</button>
      <button role="menuitem" disabled={busy || queueMenu.request.status !== 'accepted'} onClick={() => { const waiting = future.filter(r => r.status === 'accepted' && r.id !== queueMenu.request.id); void command({ type: 'moveRequest', requestId: queueMenu.request.id, beforeRequestId: waiting[0]?.id ?? null }); setQueueMenu(null); }}>Move to first waiting</button>
      <button role="menuitem" disabled={busy || queueMenu.request.status !== 'accepted'} onClick={() => { void command({ type: 'moveRequest', requestId: queueMenu.request.id, beforeRequestId: null }); setQueueMenu(null); }}>Move to last waiting</button>
      <button role="menuitem" onClick={() => { setScreen('singers'); setQueueMenu(null); }}>Singer availability…</button>
      <button role="menuitem" disabled={busy} onClick={() => { void command({ type: 'removeRequest', requestId: queueMenu.request.id }); setQueueMenu(null); }}>Remove request</button>
    </div>}
    {editingRequest && state && <QueueEditDialog request={editingRequest} singers={state.singers} versions={versions} onClose={() => setEditingRequest(null)} onSave={async (singerId, versionId) => {
      const result = await window.tpv.command({ type: 'editRequest', requestId: editingRequest.id, singerId, versionId });
      if (!result.ok) throw new Error(result.error || 'The request could not be updated.');
      setNotice('Queued request updated.');
    }} />}
    {settingsOpen && <SettingsDialog value={settings} path={settingsPath} shortcutsPath={shortcutsPath} onClose={() => setSettingsOpen(false)} onSave={async value => { const saved = await window.tpv.saveSettings(value); setSettings(saved); }} />}
    {editingVersion && <EditMetadataDialog version={editingVersion} onClose={() => setEditingVersion(null)} onSave={async (title, artist) => {
      const result = await window.tpv.command({ type: 'editVersion', id: editingVersion.id, title, artist });
      if (!result.ok) throw new Error(result.error || 'The song could not be updated.');
    }} />}
    {contextMenu && <div className="song-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
      <button role="menuitem" onClick={() => { setQueueVersion(contextMenu.version); setContextMenu(null); }}>Add to Queue</button>
      {!contextMenu.version.catalogTrack && <>
        <button role="menuitem" onClick={() => { setPlaylistVersion(contextMenu.version); setContextMenu(null); }}>Add to Playlist</button>
        <button role="menuitem" onClick={() => { setEditingVersion(contextMenu.version); setContextMenu(null); }}>Edit Metadata</button>
        {contextMenu.version.source && <button role="menuitem" onClick={() => { const id = contextMenu.version.id; setContextMenu(null); void run(async () => { await window.tpv.youtubeDownloads.start(id); }); }}>Download Video / Retry</button>}
        <button role="menuitem" disabled={relinkBusy} onClick={() => { const id = contextMenu.version.id; setContextMenu(null); void relinkSong(id); }}>Relink File…</button>
        <button role="menuitem" disabled={!!contextMenu.version.source && !cachedVideoIds.includes(contextMenu.version.id)} onClick={() => { const id = contextMenu.version.id; setContextMenu(null); void run(() => window.tpv.revealMedia(id)); }}>Show in Files...</button>
      </>}
    </div>}
    {queueVersion && state && <SongRequestDialog version={queueVersion} singers={state.singers} onClose={() => setQueueVersion(null)} onSubmit={async (choice, singerCreated) => {
      let queueNotice = '';
      await requestWithSinger(choice, {
        createSingerId: () => crypto.randomUUID(),
        addSinger: singer => window.tpv.command({ type: 'addSinger', singer }),
        singerCreated,
        addRequest: async singerId => {
          const result = await requestLibrarySong(queueVersion, singerId, crypto.randomUUID(), window.tpv);
          if (result.ok && result.versionId) setSelectedVersionId(result.versionId);
          queueNotice = result.notice || ''; return result;
        },
      });
      setNotice(queueNotice || (settings.autoApprove ? 'Song added to the queue.' : 'Request submitted for review.'));
    }} />}
    {playlistVersion && state && <AddToPlaylistDialog song={playlistVersion} singers={state.singers} playlists={collections.playlists} onClose={() => setPlaylistVersion(null)} onSave={async playlistId => { if (!await mutateCollections({ type: 'add', playlistId, versionId: playlistVersion.id })) throw new Error('Could not add the song.'); }} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
