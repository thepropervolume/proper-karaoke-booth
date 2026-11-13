import React, { useEffect, useMemo, useRef, useState } from 'react';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import { createRoot } from 'react-dom/client';
import brandLogoDark from '../../assets/branding/logo-dark.svg';
import brandLogoLight from '../../assets/branding/logo-light.svg';
import type { Command, ShowState, SongRequest, Version } from '../domain/index';
import { isVersionAllowed, singerAvailable, orderedFuture, remainingPauseSeconds, visibleVersions } from '../domain/index';
import { DEFAULT_SETTINGS, nextAccentColor, type Settings } from '../domain/settings';
import type { LibraryFilter, LibrarySort } from '../domain/library-view';
import { unifiedLibrary, type LibrarySearchVersion } from '../domain/unified-library';
import type { CatalogRequestTrack } from '../domain/catalog-request';
import { recordingKeyFor, type RecordingKey, type SongRating } from '../domain/song-rating';
import type { SongRatingsLookup, SongRatingVote } from '../main/song-ratings-client';
import type { LocalControlUiStatus } from './LocalControlSettings';
import { SongRatingButton, SongRatingDialog } from './SongRating';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, formatShortcut, matchesShortcut, isTextEditingShortcut, type Shortcuts, type ShortcutAction } from '../domain/shortcuts';
import type { AppAction, SettingsSection } from '../domain/app-action';
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
import { InternetSessionPanel } from '../remote/InternetSessionPanel';
import type { InternetSessionBridge } from '../remote/internet-session-control';
import { ImportPanel, type ImportBridge } from './ImportPanel';
import { CdgImportPanel, type CdgBridge } from './CdgImportPanel';
import { YouTubeDownloadsPanel, type YouTubeDownloadBridge } from './YouTubeDownloadsPanel';
import { MissingSongReviewPanel } from './MissingSongReviewPanel';
import { CommunityCatalogPanel } from './CommunityCatalogPanel';
import { LibraryCatalogStatus } from './LibraryCatalogStatus';
import { useLibraryCatalogSearch } from './use-library-catalog-search';
import { requestWithSinger } from './request-singer';
import { requestLibrarySong } from './request-library-song';
import { downloadLibrarySong } from './download-library-song';
import type { LocalCatalogResult } from '../main/karaokenerds-local-browser';
import type { CatalogConnectionStatus } from '../main/shared-catalog-connection';
import type { ImportProgress } from '../domain/import-job';
import type { BackupResult } from '../main/show-backup';
import type { HistoryExportResult } from '../main/history-export';
import '../styles/main.scss';
import '../styles/tooltip.scss';
import '../styles/import-panel.scss';

type Screen = 'library' | 'sources' | 'requests' | 'singers' | 'playlists' | 'remote';
type Result = { ok: boolean; error?: string; cancelled?: boolean; notice?: string };
declare global {
  interface Window {
    tpv: {
      getAppVersion: () => Promise<string>;
      appReady: () => Promise<void>;
      refreshMenu: () => Promise<void>;
      updateMenuContext: (value: { busy: boolean; modal: boolean }) => Promise<void>;
      getLocalControlStatus: () => Promise<LocalControlUiStatus>;
      showControlCli: () => Promise<void>;
      onAppAction: (callback: (action: AppAction) => void) => () => void;
      onSettings: (callback: (value: Settings) => void) => () => void;
      onShortcuts: (callback: (value: Shortcuts) => void) => () => void;
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
      ratingKeys: (ids: string[]) => Promise<Record<string, RecordingKey>>;
      lookupSongRatings: (keys: RecordingKey[]) => Promise<SongRatingsLookup>;
      rateSong: (key: RecordingKey, value: number | null) => Promise<SongRatingVote>;
      chooseRatingProfile: () => Promise<string | null>;
      ratingProfileStatus: (file?: string) => Promise<SongRatingsLookup>;
      requestCatalogTrack: (input: { track: CatalogRequestTrack; singerId: string; requestId: string }) => Promise<Result & { versionId?: string; notice?: string }>;
      addYouTube: (input: {url:string;title:string;artist:string;brandSlug?:string}) => Promise<Result & {versionId?:string;notice?:string}>;
      openCommunityVideo: (id: string) => Promise<Result>;
      getShortcuts: () => Promise<{ shortcuts: Shortcuts; path: string; error: string }>;
      saveShortcuts: (value: Shortcuts) => Promise<Shortcuts>;
      editShortcutsFile: () => Promise<void>;
      playPause: () => Promise<Result>;
      restartTrack: () => Promise<Result>;
      saveSettings: (settings: Partial<Settings>) => Promise<Settings>;
      chooseLyricBackdrop: () => Promise<string | null>;
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
      internetSessions: InternetSessionBridge;
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
  const songList = useRef<HTMLDivElement>(null);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const focusSearch = () => { pendingPreferences.current = null; ++ratingOpenSequence.current; setRatingDialog(null); setEditingRequest(null); setQueueMenu(null); setSettingsOpen(false); setEditingVersion(null); setQueueVersion(null); setPlaylistVersion(null); setContextMenu(null); setScreen('library'); setSearchFocusRequest(value => value + 1); };
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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(0);
  const actionHandler = useRef<(action: AppAction) => void>(() => {});
  const pendingPreferences = useRef<SettingsSection | null>(null);
  const openPreferences = (section: SettingsSection = 'general') => {
    if (busy) { pendingPreferences.current = section; setNotice('Preferences will open when the current action finishes.'); return; }
    pendingPreferences.current = null;
    ++ratingOpenSequence.current; setEditingRequest(null); setEditingVersion(null); setQueueVersion(null); setPlaylistVersion(null); setQueueMenu(null); setContextMenu(null); setRatingDialog(null);
    setSettingsSection(section); setSettingsFocusRequest(value => value + 1); setSettingsOpen(true);
  };
  useEffect(() => { if (!busy && pendingPreferences.current) openPreferences(pendingPreferences.current); }, [busy]);
  const [editingVersion, setEditingVersion] = useState<Version | null>(null);
  const [ratingKeys, setRatingKeys] = useState<Record<string, RecordingKey>>({});
  const [ratings, setRatings] = useState<Record<string, SongRating>>({});
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const [canRate, setCanRate] = useState(false);
  const [ratingDialog, setRatingDialog] = useState<{ title: string; key: RecordingKey } | null>(null);
  const ratingOpenSequence = useRef(0);
  const ratingWriteEpoch = useRef(0);
  const [ratingReload, setRatingReload] = useState(0);
  const [ratingWindowStart, setRatingWindowStart] = useState(0);
  useEffect(() => { setRatingWindowStart(0); songList.current?.scrollTo(0, 0); }, [search, librarySort, libraryFilter]);
  useEffect(() => { setRatings({}); setCanRate(false); setRatingDialog(null); ++ratingOpenSequence.current; }, [settings.ratingProfileConfigFile]);
  useEffect(() => {
    ++ratingOpenSequence.current;
    if (settingsOpen || queueVersion || editingRequest || editingVersion || playlistVersion) setRatingDialog(null);
  }, [screen, settingsOpen, !!queueVersion, !!editingRequest, !!editingVersion, !!playlistVersion]);
  useEffect(() => { void window.tpv.updateMenuContext({ busy, modal: !!(settingsOpen || queueVersion || editingRequest || editingVersion || playlistVersion || ratingDialog) }).catch(() => {}); }, [busy, settingsOpen, !!queueVersion, !!editingRequest, !!editingVersion, !!playlistVersion, !!ratingDialog]);

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
        loaded = await window.tpv.saveSettings({ appearance: previousTheme });
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
  useEffect(() => window.tpv.onAppAction(action => actionHandler.current(action)), []);
  useEffect(() => window.tpv.onSettings(setSettings), []);
  useEffect(() => window.tpv.onShortcuts(setShortcuts), []);
  useEffect(() => { if (settingsPath) void window.tpv.appReady(); }, [settingsPath]);
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
  const stagedBlocked = !!(state && staged && !isVersionAllowed(state, staged.versionId));
  const active = state?.requests.find(r => r.id === state.playback?.requestId);
  const ratingSelection = JSON.stringify([...new Set([...filtered.slice(ratingWindowStart, ratingWindowStart + 80).map(version => version.id), ...future.map(request => request.versionId), ...(active ? [active.versionId] : [])])].slice(0, 1000));
  useEffect(() => {
    let alive = true;
    const writeEpoch = ratingWriteEpoch.current;
    setRatingsLoading(true);
    void (async () => {
      const ids = JSON.parse(ratingSelection) as string[];
      const resolved = await window.tpv.ratingKeys(ids);
      for (const version of filtered) { const key = recordingKeyFor(version.source); if (key && ids.includes(version.id)) resolved[version.id] = key; }
      if (!alive) return;
      setRatingKeys(resolved);
      const keys = [...new Set(Object.values(resolved))];
      if (!keys.length) return;
      const loaded: Record<string, SongRating> = {};
      let allowed = false;
      for (let offset = 0; offset < keys.length; offset += 100) {
        const result = await window.tpv.lookupSongRatings(keys.slice(offset, offset + 100));
        if (!alive || writeEpoch !== ratingWriteEpoch.current) return;
        if (result.status !== 'ready') { setCanRate(false); setRatings({}); return; }
        allowed = result.canVote;
        for (const item of result.items) loaded[item.recordingKey] = item;
      }
      if (alive && writeEpoch === ratingWriteEpoch.current) { setRatings(current => ({ ...current, ...loaded })); setCanRate(allowed); }
    })().catch(() => { if (alive && writeEpoch === ratingWriteEpoch.current) { setRatings({}); setCanRate(false); } }).finally(() => { if (alive) setRatingsLoading(false); });
    return () => { alive = false; };
  }, [ratingSelection, settings.ratingProfileConfigFile, ratingReload, filenameRefresh]);
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
  const playPause = () => {
    if (!active && stagedBlocked) {
      setNotice('The staged song is unavailable under the current policy. Release it or change the policy before starting.');
      return Promise.resolve();
    }
    return run(() => window.tpv.playPause());
  };
  const mutateCollections = async (action: CollectionsAction): Promise<boolean> => {
    try { setCollections(await window.tpv.mutateCollections(action)); setNotice(''); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return false; }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.repeat || event.isComposing || target?.closest('[data-shortcut-capture]')) return;
      const input = { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
      const textEntry = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if (textEntry && isTextEditingShortcut(input)) return;
      const inQueue = !!target?.closest('[data-queue-list]');
      const action = SHORTCUT_ACTIONS.find(action => (action.scope === 'application' || action.scope === 'queue' && inQueue) && matchesShortcut(shortcuts, action.id, input))?.id;
      if (!action) return;
      const interactive = target?.closest('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])');
      if (interactive && !event.ctrlKey && !event.metaKey && !event.altKey && !/^F\d+$/.test(event.code)) return;
      const navigation = ['search', 'preferences', 'keybindings', 'appearance', 'accentColor'].includes(action);
      if (!navigation && (settingsOpen || editingRequest || editingVersion || queueVersion || playlistVersion || target?.closest('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])') || busy)) return;
      event.preventDefault();
      actionHandler.current(action);
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
  const shortcutHint = (label: string, action: ShortcutAction) => `${label}${shortcuts[action].length ? ` (${shortcuts[action].map(formatShortcut).join(', ')}${SHORTCUT_ACTIONS.find(item => item.id === action)?.scope === 'player' ? '; player window' : ''})` : ''}`;
  const showSongRating = async (version: Pick<Version, 'id' | 'title' | 'source'>) => {
    const sequence = ++ratingOpenSequence.current;
    try {
      const key = recordingKeyFor(version.source) ?? ratingKeys[version.id] ?? (await window.tpv.ratingKeys([version.id]))[version.id];
      if (!key) { setNotice('This recording needs an imported media fingerprint before it can be rated.'); return; }
      const result = await window.tpv.lookupSongRatings([key]);
      if (sequence !== ratingOpenSequence.current) return;
      if (result.status !== 'ready') { setNotice(`Shared ratings are unavailable (${result.status}). Your song and queue are unchanged.`); return; }
      setRatings(current => ({ ...current, ...Object.fromEntries(result.items.map(item => [item.recordingKey, item])) }));
      setCanRate(result.canVote); setRatingDialog({ title: version.title, key });
    } catch { if (sequence === ratingOpenSequence.current) setNotice('Shared ratings could not be reached. Your song and queue are unchanged.'); }
  };
  const ratingButton = (version: Version | LibrarySearchVersion | undefined) => {
    if (!version) return null;
    const key = recordingKeyFor(version.source) ?? ratingKeys[version.id];
    return <SongRatingButton title={version.title} rating={key ? ratings[key] ?? null : null} loading={ratingsLoading && !!key && !ratings[key]} onClick={() => void showSongRating(version)} />;
  };
  const savePreferencePatch = (patch: Partial<Settings>) => run(async () => { setSettings(await window.tpv.saveSettings(patch)); });
  const seekOffset = (seconds: number) => run(async () => {
    const timeline = await window.tpv.getTimeline();
    if (!timeline.generation || !timeline.seekable || timeline.seeking) return { ok: false, error: 'The current song is not ready to seek.' };
    return window.tpv.seek({ generation: timeline.generation, position: Math.max(0, Math.min(timeline.duration - .001, timeline.position + seconds)) });
  });
  actionHandler.current = action => {
    if (action === 'search') { focusSearch(); return; }
    if (action === 'preferences' || action === 'keybindings' || action === 'appearance' || action === 'accentColor') {
      openPreferences(action === 'keybindings' ? 'keyboard-shortcuts' : action === 'appearance' || action === 'accentColor' ? 'appearance' : 'general'); return;
    }
    if (action.startsWith('appearance:') || action.startsWith('accent:') || ['layoutStandard', 'layoutRotation', 'layoutLibrary'].includes(action)) {
      if (busy) { void window.tpv.refreshMenu(); return; }
      if (action.startsWith('appearance:')) void savePreferencePatch({ appearance: action.slice(11) as Settings['appearance'] });
      else if (action.startsWith('accent:')) void savePreferencePatch({ accentColor: action.slice(7) as Settings['accentColor'] });
      else void savePreferencePatch({ layout: action === 'layoutStandard' ? 'standard' : action === 'layoutRotation' ? 'rotation' : 'library' });
      return;
    }
    if (busy || settingsOpen || editingVersion || editingRequest || queueVersion || playlistVersion || ratingDialog) return;
    switch (action) {
      case 'playPause': void playPause(); break;
      case 'previous': void run(() => window.tpv.restartTrack()); break;
      case 'stop': void command({ type: 'stop' }); break;
      case 'skip': skip(); break;
      case 'seekBackward': void seekOffset(-10); break;
      case 'seekForward': void seekOffset(10); break;
      case 'singerDisplay': void run(() => window.tpv.openDisplay()); break;
      case 'toggleFullscreen': void run(() => window.tpv.toggleDisplayFullscreen()); break;
      case 'importVideo': setScreen('library'); void beginImport('files'); break;
      case 'importDirectory': setScreen('library'); void beginImport('folder'); break;
      case 'importCdg': setScreen('library'); void run(async () => { await window.tpv.cdg.start(); }); break;
      case 'backupShow': void backupShow(backupCleanup); break;
      case 'removeRequest': if (selectedRequestId) { void command({ type: 'removeRequest', requestId: selectedRequestId }); setSelectedRequestId(''); setQueueMenu(null); } break;
      case 'cycleAccent': void cycleAccent(); break;
      case 'cycleAppearance': void savePreferencePatch({ appearance: settings.appearance === 'system' ? 'night' : settings.appearance === 'night' ? 'day' : 'system' }); break;
      case 'layoutStandard': void savePreferencePatch({ layout: 'standard' }); break;
      case 'layoutRotation': void savePreferencePatch({ layout: 'rotation' }); break;
      case 'layoutLibrary': void savePreferencePatch({ layout: 'library' }); break;
    }
  };
  const current = describe(active);
  const stage = describe(staged);

  return <div className="app" data-layout={settings.layout}>
    <header className="topbar">
      <div className="brand">
        <img className="brand__logo brand__logo--dark" src={brandLogoDark} alt="The Proper Volume Karaoke Booth" width="220" height="52" />
        <img className="brand__logo brand__logo--light" src={brandLogoLight} alt="The Proper Volume Karaoke Booth" width="220" height="52" />
      </div>
      <h1>Local rehearsal{appVersion && <small style={{marginLeft:'0.6em'}} aria-label="Application version">v{appVersion}</small>}</h1>
      <Tooltip text={shortcutHint('Appearance', 'appearance')}><button className="icon-button accent-button" aria-label="Appearance" onClick={() => openPreferences('appearance')} disabled={!settingsPath || accentSaving}><Icon name="palette" /></button></Tooltip>
      <Tooltip text={`Search (${shortcuts.search.map(formatShortcut).join(', ')})`}><button className="icon-button" aria-label="Open library search" onClick={focusSearch}><Icon name="search" /></button></Tooltip>
      <Tooltip text={shortcutHint('Singer Display', 'singerDisplay')}><button className="icon-button" aria-label="Singer display" onClick={() => void run(() => window.tpv.openDisplay())}><Icon name="display" /></button></Tooltip>
      <Tooltip text={shortcutHint('Toggle singer display fullscreen', 'toggleFullscreen')}><button className="icon-button" aria-label="Toggle singer display fullscreen" onClick={() => void run(() => window.tpv.toggleDisplayFullscreen())}><Icon name="fullscreen" /></button></Tooltip>
      <Tooltip text={shortcutHint('Preferences', 'preferences')}><button className="icon-button" aria-label="Preferences" onClick={() => openPreferences()} disabled={!settingsPath || accentSaving}><Icon name="settings" /></button></Tooltip>
    </header>
    <nav className="sidebar" aria-label="Workspace">
      <div className="eyebrow">Workspace</div>
      {([['library', 'Library'], ['playlists', 'Playlists'], ['sources', 'Sources']] as const).map(([id, label]) =>
        <button key={id} className={`nav-item ${screen === id ? 'active' : ''}`} aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}>{label}</button>)}
      <div className="sidebar__host"><div className="eyebrow">Host Workspace</div>{([['requests', `Requests${pending.length ? ` (${pending.length})` : ''}`], ['singers', 'Singers'], ['remote', 'Remote Sessions']] as const).map(([id, label]) => <button key={id} className={`nav-item ${screen === id ? 'active' : ''}`} aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}>{label}</button>)}</div>
    </nav>
    <main className="main-panel">
      {screen==='remote' && <><InternetSessionPanel bridge={window.tpv.internetSessions} /><p className="muted">Singers open your link, enter their name and request songs from your library. Keep this app running. This internet link also works for guests on venue Wi-Fi.</p></>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <ImportPanel bridge={window.tpv.imports} onActiveChange={setImportActive} />
      <YouTubeDownloadsPanel bridge={window.tpv.youtubeDownloads} onCached={setCachedVideoIds} />
      <CdgImportPanel bridge={window.tpv.cdg} showStart={false} />
      {!state ? <p className="empty">Loading your show…</p> : <>
        {screen === 'library' && <>
          <div className="section-heading"><h2>Song Library</h2><div><Tooltip text={shortcutHint('Import Video File', 'importVideo')}><button className="icon-button" aria-label="Import Video File" disabled={busy || importActive || importPickerBusy} onClick={() => void beginImport('files')}><Icon name="file" /></button></Tooltip> <Tooltip text={shortcutHint('Import Custom Directory', 'importDirectory')}><button className="icon-button" aria-label="Import Custom Directory" disabled={busy || importActive || importPickerBusy} onClick={() => void beginImport('folder')}><Icon name="folder" /></button></Tooltip> <Tooltip text={shortcutHint('Import CD+G / ZIP', 'importCdg')}><button className="icon-button" aria-label="Import CD+G / ZIP…" disabled={busy || importPickerBusy} onClick={() => actionHandler.current('importCdg')}><Icon name="cdg" /></button></Tooltip></div></div>
          <div className="library-toolbar"><input ref={searchInput} type="search" aria-label="Search library" placeholder="Search your library and Karaoke Nerds" value={search} onChange={e => setSearch(e.target.value)} />
            <label>Sort<select aria-label="Sort songs" value={librarySort} onChange={event => setLibrarySort(event.target.value as LibrarySort)}>
              <option value="import-oldest">Import order</option><option value="import-newest">Newest imported</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option><option value="artist-asc">Artist A–Z</option><option value="artist-desc">Artist Z–A</option>
            </select></label>
            <label>Filter<select aria-label="Filter songs" value={libraryFilter} onChange={event => setLibraryFilter(event.target.value as LibraryFilter)}>
              <option value="all">All songs</option><option value="review">Needs metadata review</option><option value="missing-artist">Missing artist</option><option value="clean">Clean</option><option value="explicit">Explicit</option><option value="unrated">Unrated</option><option value="uncertain">Uncertain rating</option>
            </select></label></div>
          <LibraryCatalogStatus state={catalogSearch} />
          <div className="eyebrow">Title / artist <span className="muted"> · Local files and online recordings</span></div>
          <div ref={songList} role="listbox" aria-label="Songs" className="song-list" onScroll={event => {
            const rows = event.currentTarget.querySelectorAll<HTMLElement>('.song-option');
            const step = rows[1] && rows[0] ? rows[1].offsetTop - rows[0].offsetTop : rows[0]?.offsetHeight;
            if (step && step > 0) setRatingWindowStart(Math.max(0, Math.floor(event.currentTarget.scrollTop / step / 40) * 40));
          }}>
            {filtered.map((version, index) => <div className={`track-row song-option ${version.id === selectedVersionId ? 'selected' : ''}`} key={version.id} role="option" aria-selected={version.id === selectedVersionId} tabIndex={0}
              onClick={() => setSelectedVersionId(version.id)} onDoubleClick={() => { setSelectedVersionId(version.id); setQueueVersion(version); }}
              onContextMenu={event => { event.preventDefault(); setSelectedVersionId(version.id); setContextMenu({ version, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 230)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 250)) }); }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setSelectedVersionId(version.id); setQueueVersion(version); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="option"]'); const i = Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); next?.[i]?.focus(); setSelectedVersionId(filtered[i]?.id ?? ''); } }}>
              <div><strong>{version.title}</strong><small>{version.artist || 'Unknown artist'} · {version.source?.provider === 'youtube' ? `${cachedVideoIds.includes(version.id) ? 'Saved locally' : version.catalogTrack ? 'Downloads when queued · Found on Karaoke Nerds' : 'Download needed'}` : [version.djCode,version.trackNumber].filter(Boolean).join('-') || 'Local'}{version.metadataAmbiguous ? ' · Review metadata' : ''}</small></div>
              {version.source && <span className="badge">YouTube</span>}
              {ratingButton(version)}
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
        {screen === 'sources' && <div className="sources-panel"><h2>Sources</h2><CommunityCatalogPanel search={window.tpv.searchCommunityCatalog} openVideo={window.tpv.openCommunityVideo} addVideo={window.tpv.addYouTube} onAdded={(id, notice) => { setSelectedVersionId(id); setScreen('library'); setNotice(notice || 'YouTube song saved in the library. Choose a singer and add a request to queue its download.'); }} /><section><h2>Third-Party Services</h2><p>Connect approved catalog and playback services here as provider access becomes available.</p><ul><li>KaraFun — partnership/playback access pending</li><li>Party Tyme — developer access pending</li><li>Sunfly — developer access pending</li><li>Stingray — developer access pending</li></ul><p className="muted">An ordinary subscription or metadata API token does not currently enable in-app playback from these services.</p></section></div>}
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
      <div className="on-stage">{active ? <><strong>{current.singer}</strong><small>{current.title} · {state?.playback?.status === 'paused' ? 'Paused' : 'Playing'}</small>{ratingButton(state?.versions.find(version => version.id === active.versionId))}</> : <span className="muted">No singer on stage</span>}</div>
      <div className="section-heading"><span className="eyebrow">Up Next</span><button disabled={busy || !!staged || !eligibleFuture} onClick={() => void command({ type: 'stage' })}>Stage next</button></div>
      <button disabled={busy || !selectedFuture || selectedFuture.status !== 'accepted' || !state || !isVersionAllowed(state, selectedFuture.versionId) || state.promotedRequestId === selectedFuture.id} onClick={() => { if (selectedFuture) void command({ type: 'promoteRequest', requestId: selectedFuture.id }, 'Request promoted to the front of the waiting queue.'); }}>Promote selected</button>
      <div className="queue-actions"><button disabled={busy || !selectedFuture || selectedFuture.status !== 'accepted' || future.filter(r => r.status === 'accepted').findIndex(r => r.id === selectedFuture.id) < 1} onClick={() => { if (!selectedFuture) return; const waiting = future.filter(r => r.status === 'accepted'); const i = waiting.findIndex(r => r.id === selectedFuture.id); if (i > 0) void command({ type: 'moveRequest', requestId: selectedFuture.id, beforeRequestId: waiting[i - 1].id }); }}>Move up</button> <button disabled={busy || !selectedFuture || selectedFuture.status !== 'accepted' || future.filter(r => r.status === 'accepted').at(-1)?.id === selectedFuture.id} onClick={() => { if (!selectedFuture) return; const waiting = future.filter(r => r.status === 'accepted'); const i = waiting.findIndex(r => r.id === selectedFuture.id); if (i >= 0 && i < waiting.length - 1) void command({ type: 'moveRequest', requestId: selectedFuture.id, beforeRequestId: waiting[i + 2]?.id ?? null }); }}>Move down</button> <button disabled={busy || (!state?.manualQueueOrder?.length && !state?.promotedRequestId)} onClick={() => void command({ type: 'resetQueueOrder' }, 'Automatic queue order restored.')}>Automatic order</button></div>
      {state?.manualQueueOrder?.length ? <p className="muted">Manual order · new requests follow the arranged queue.</p> : null}
      <div role="listbox" aria-label="Singer Rotation" data-queue-list>{future.map((request, index) => { const item = describe(request); return <div className={`queue-row ${selectedRequestId === request.id ? 'selected' : ''}`} key={request.id} role="option" aria-selected={selectedRequestId === request.id} tabIndex={0} onClick={() => setSelectedRequestId(request.id)} onFocus={() => setSelectedRequestId(request.id)}
        draggable={!busy && request.status === 'accepted'} onDragStart={event => { draggedRequest.current = request.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', request.id); }} onDragEnd={() => { draggedRequest.current = ''; }}
        onDragOver={event => { if (!busy && request.status === 'accepted' && draggedRequest.current && draggedRequest.current !== request.id) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); const id = draggedRequest.current; draggedRequest.current = ''; if (!busy && id && id !== request.id && request.status === 'accepted') void command({ type: 'moveRequest', requestId: id, beforeRequestId: request.id }); }}
        onContextMenu={event => { event.preventDefault(); setSelectedRequestId(request.id); setQueueMenu({ request, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 230)) }); }}
        onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setQueueMenu({ request, x: Math.max(0, Math.min(rect.left, window.innerWidth - 240)), y: Math.max(0, Math.min(rect.top, window.innerHeight - 230)) }); } }}><div className="queue-row__head"><span className="queue-row__number">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.singer}</strong><small>{item.title}</small><small>{request.status === 'staged' ? (state && !isVersionAllowed(state, request.versionId) ? 'Staged · locked · unavailable under current policy' : 'Staged · locked') : state && !singerAvailable(state, request.singerId, clockMs) ? `Unavailable · back in ${Math.ceil(((state.singers.find(s => s.id === request.singerId)?.unavailableUntilMs ?? 0) - clockMs) / 60000)} min` : state && !isVersionAllowed(state, request.versionId) ? 'Unavailable under current policy' : state?.promotedRequestId === request.id ? (staged ? 'Promoted · next after staged' : 'Promoted · next') : settings.rotationMode === 'singer' ? `Round ${request.round}` : 'In request order'}</small></div>{ratingButton(state?.versions.find(version => version.id === request.versionId))}</div></div>; })}</div>
      {!future.length && <p className="empty">Accepted requests will appear here.</p>}
      {staged && <button disabled={busy} onClick={() => void command({ type: 'release' })}>Release staged song</button>}
    </aside>
    <footer className="transport" aria-label="Playback controls">
      <div className="transport__track"><span className="eyebrow">{active ? 'Now playing' : staged ? 'Staged' : 'Player ready'}</span><strong>{active ? current.title : staged ? stage.title : 'No song selected'}</strong><small>{active ? current.singer : staged ? stage.singer : 'Stage an accepted request to begin'}</small></div>
      <div className="transport__controls">
        <Tooltip text={shortcutHint('Previous — Restart Current Song', 'previous')}><button className="icon-button" aria-label="Previous — Restart Current Song" disabled={busy || !active} onClick={() => void run(() => window.tpv.restartTrack())}><Icon name="previous" /></button></Tooltip>
        <Tooltip text={!active && stagedBlocked ? 'The staged song is unavailable under the current policy. Release it or change the policy before starting.' : `Play/Pause (${shortcuts.playPause.map(formatShortcut).join(', ')})`}><button className="primary icon-button" aria-label="Play/Pause" disabled={busy || (!active && (stagedBlocked || pauseRemaining > 0 || (!staged && !eligibleFuture)))} onClick={() => void playPause()}><Icon name={state?.playback?.status === 'playing' ? 'pause' : 'play'} /></button></Tooltip>
        <Tooltip text={shortcutHint('Stop', 'stop')}><button className="icon-button" aria-label="Stop" disabled={busy || !active} onClick={() => void command({ type: 'stop' })}><Icon name="stop" /></button></Tooltip>
        <Tooltip text={shortcutHint('Skip', 'skip')}><button className="icon-button" aria-label="Skip" disabled={busy || !active} onClick={skip}><Icon name="skip" /></button></Tooltip>
        <label className="transport__volume">Volume <input type="range" aria-label="Global Volume" min="0" max="100" disabled={accentSaving} value={Math.round(settings.masterVolume * 100)} onChange={event => { if (accentSaveInFlight.current) return; const masterVolume = Number(event.target.value) / 100; setSettings(current => ({ ...current, masterVolume })); void window.tpv.saveSettings({ masterVolume }).catch(error => setNotice(`Could not save volume: ${String(error)}`)); }} /></label>
      </div>
      <PlaybackTimeline generation={state?.playback?.generationId ?? null} disabled={busy} shortcuts={shortcuts} />
      <div className="transport__status" role="status">{!active && stagedBlocked ? 'The staged song is unavailable under the current policy. Release it or change the policy before starting.' : !active && pauseRemaining > 0 ? `Pause interval: ${pauseRemaining}s remaining. Press Play when ready.` : 'Key and tempo controls are not yet available. Configure optional bumper music in Audio Controls.'}</div>
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
    {settingsOpen && <SettingsDialog value={settings} path={settingsPath} shortcutsPath={shortcutsPath} shortcuts={shortcuts} initialSection={settingsSection} focusRequest={settingsFocusRequest} onSaveShortcuts={async value => { setBusy(true); try { setShortcuts(await window.tpv.saveShortcuts(value)); } finally { setBusy(false); } }} onClose={() => setSettingsOpen(false)} onSave={async value => { setBusy(true); try { const saved = await window.tpv.saveSettings(value); setSettings(saved); } finally { setBusy(false); } }} />}
    {ratingDialog && <SongRatingDialog title={ratingDialog.title} recordingKey={ratingDialog.key} rating={ratings[ratingDialog.key] ?? null} canVote={canRate} onClose={() => setRatingDialog(null)} onOpenPreferences={() => { setRatingDialog(null); openPreferences('ratings'); }} onSave={async value => {
      ++ratingWriteEpoch.current;
      setBusy(true);
      try {
        const result = await window.tpv.rateSong(ratingDialog.key, value);
        if (result.status !== 'ready') throw new Error(`Your rating was not confirmed (${result.status}). Check the connection or rating profile and retry explicitly.`);
        setRatings(current => ({ ...current, [result.item.recordingKey]: result.item })); setRatingReload(current => current + 1); return result.item;
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Your rating was not confirmed.'); throw error; }
      finally { setBusy(false); }
    }} />}
    {editingVersion && <EditMetadataDialog version={editingVersion} onClose={() => setEditingVersion(null)} onSave={async (title, artist) => {
      const result = await window.tpv.command({ type: 'editVersion', id: editingVersion.id, title, artist });
      if (!result.ok) throw new Error(result.error || 'The song could not be updated.');
    }} />}
    {contextMenu && <div className="song-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
      <button role="menuitem" onClick={() => { setQueueVersion(contextMenu.version); setContextMenu(null); }}>Add to Queue</button>
      {!contextMenu.version.catalogTrack && <>
        <button role="menuitem" onClick={() => { setPlaylistVersion(contextMenu.version); setContextMenu(null); }}>Add to Playlist</button>
        <button role="menuitem" onClick={() => { setEditingVersion(contextMenu.version); setContextMenu(null); }}>Edit Metadata</button>
        {contextMenu.version.source && <button role="menuitem" onClick={() => { const version = contextMenu.version; setContextMenu(null); void run(async () => { const result = await downloadLibrarySong(version, window.tpv); if (result.ok && result.versionId) setSelectedVersionId(result.versionId); return result; }); }}>Download Video / Retry</button>}
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
