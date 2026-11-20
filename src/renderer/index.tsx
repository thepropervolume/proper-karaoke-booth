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
import type { HostRatingsLookup, HostRatingVote } from '../main/host-song-ratings';
import type { SongRatingsLookup } from '../main/song-ratings-client';
import { compileSongBlacklist, normalizeBlacklistIdentity } from '../domain/song-blacklist';
import { DEFAULT_HOST_PANEL_SIZES, fittedHostPanels, HOST_PANEL_LIMITS, type HostPanelSizes } from '../domain/host-layout';
import type { LocalControlUiStatus } from './LocalControlSettings';
import { SongRatingButton, SongRatingDialog } from './SongRating';
import { DEFAULT_SHORTCUTS, KARAOKE_PAIR_IMPORT_LABEL, SHORTCUT_ACTIONS, formatShortcut, matchesShortcut, isTextEditingShortcut, type Shortcuts, type ShortcutAction } from '../domain/shortcuts';
import type { AppAction, SettingsSection } from '../domain/app-action';
import type { MissingSongRequest, MissingSongReview, MissingSongStatus } from '../domain/missing-request';
import type { CollectionsAction, CollectionsSnapshot } from '../domain/collections';
import { Icon } from './Icon';
import { CollectionsPanel } from './CollectionsPanel';
import { PlaybackTimeline } from './PlaybackTimeline';
import { KaraFunMixControl } from './KaraFunMixControl';
import type { KaraFunMixBridge } from '../domain/karafun-mix';
import type { PlaybackTimelineState, PlaybackSeek, PlaybackSeekResult } from '../domain/playback-timeline';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';
import { SongRequestDialog } from './SongRequestDialog';
import { QueueEditDialog } from './QueueEditDialog';
import { SingerAvailabilityControl } from './SingerAvailabilityControl';
import { Tooltip } from './Tooltip';
import { SettingsDialog } from './SettingsDialog';
import { PanelSeparator } from './PanelSeparator';
import { SingerPreview, type SingerScreenBridge } from './SingerPreview';
import { SingerScreensPanel } from './SingerScreensPanel';
import type { YouTubeSearchBridge } from '../domain/youtube-search';
import { EditMetadataDialog } from './EditMetadataDialog';
import type { BumperInfo } from './BumperPanel';
import type { HostRemoteBridge } from '../remote/host-control';
import { InternetSessionPanel } from '../remote/InternetSessionPanel';
import type { InternetSessionBridge } from '../remote/internet-session-control';
import { ImportPanel, type ImportBridge } from './ImportPanel';
import { CdgImportPanel, type CdgBridge } from './CdgImportPanel';
import { YouTubeDownloadsPanel, type YouTubeDownloadBridge, type YouTubeDownloadStatus } from './YouTubeDownloadsPanel';
import { queuePreparation, useQueuePreparations } from './use-queue-preparation';
import { useQueueTimeline } from './use-queue-timeline';
import { estimateQueueWaits, formatQueueWait } from '../domain/queue-wait';
import { MissingSongReviewPanel } from './MissingSongReviewPanel';
import { CommunityCatalogPanel } from './CommunityCatalogPanel';
import { SongResults } from './SongResults';
import { unifiedSongResults, type SongResult } from './unified-song-results';
import { useKaraFunSearch, useYouTubeSearch, usePartyTymeSearch } from './use-streaming-search';
import { useLibraryCatalogSearch } from './use-library-catalog-search';
import { ProviderCatalogPanel } from './ProviderCatalogPanel';
import { KHostBridgePanel } from './KHostBridgePanel';
import { KaraFunPanel, useKaraFunAccount } from './KaraFunPanel';
import type { KaraFunBridge } from '../domain/karafun';
import { PartyTymePanel, usePartyTymeAccount } from './PartyTymePanel';
import { SourceToggles } from './SourceToggles';
import type { PartyTymeBridge } from '../domain/partytyme';

import type { KHostBridgeApi } from '../domain/khost-bridge';
import { useProviderCatalogSearch } from './use-provider-catalog-search';
import type { ProviderCatalogId, ProviderCatalogSearchResult, ProviderCatalogStatus } from '../domain/provider-catalog';
import { requestWithSinger } from './request-singer';
import { requestLibrarySong } from './request-library-song';
import { downloadLibrarySong } from './download-library-song';
import type { LocalCatalogResult } from '../main/karaokenerds-local-browser';
import type { CatalogConnectionStatus } from '../main/shared-catalog-connection';
import type { ImportProgress } from '../domain/import-job';
import type { BackupResult } from '../main/show-backup';
import type { RestoreResult } from '../main/show-restore';
import type { HistoryExportResult } from '../main/history-export';
import '../styles/main.scss';
import '../styles/tooltip.scss';
import '../styles/import-panel.scss';
import '../styles/provider-catalog.scss';
import '../styles/host-panels.scss';
import '../styles/search-workspace.scss';

type Screen = 'library' | 'sources' | 'requests' | 'singers' | 'playlists' | 'remote';
type NoticeTone = 'info' | 'success' | 'error';
type Result = { ok: boolean; error?: string; cancelled?: boolean; notice?: string };
type QueueSelection = LibrarySearchVersion & { youtubeSearchReceipt?: { searchId: string; videoId: string }; partyTymeReceipt?: { searchId: string; videoId: string }; karaFunReceipt?: { searchId: string; songId: string; catalog: 'catalog' | 'community' } };
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
      previewFilenameMetadata: () => Promise<import('../main/metadata-preview').MetadataProposal[]>;
      backupShow: () => Promise<BackupResult>;
      restoreShow: () => Promise<RestoreResult>;
      retryBackupCleanup: () => Promise<BackupResult>;
      getCollections: () => Promise<CollectionsSnapshot>;
      exportHistory: (filter: { query: string; singerId: string }) => Promise<HistoryExportResult>;
      historyExportStatus: () => Promise<{ cleanupNeeded: boolean; published: boolean }>;
      retryHistoryExportCleanup: () => Promise<HistoryExportResult>;
      mutateCollections: (action: CollectionsAction) => Promise<CollectionsSnapshot>;
      getSettings: () => Promise<{ settings: Settings; path: string; created: boolean }>;
      searchCommunityCatalog: (query: string) => Promise<LocalCatalogResult>;
      getProviderCatalogStatus: () => Promise<ProviderCatalogStatus[]>;
      searchProviderCatalog: (query: string) => Promise<ProviderCatalogSearchResult[]>;
      chooseProviderCatalogProfile: (provider: ProviderCatalogId) => Promise<ProviderCatalogStatus[]>;
      clearProviderCatalogProfile: (provider: ProviderCatalogId) => Promise<ProviderCatalogStatus[]>;
      openProviderCatalogSong: (input: { provider: ProviderCatalogId; id: string }) => Promise<void>;
      ratingKeys: (ids: string[]) => Promise<Record<string, RecordingKey>>;
      lookupSongRatings: (keys: RecordingKey[]) => Promise<HostRatingsLookup>;
      rateSong: (key: RecordingKey, value: number | null) => Promise<HostRatingVote>;
      singerScreens: SingerScreenBridge;
      youtubeSearch: YouTubeSearchBridge;
      karaFun: KaraFunBridge;
      partyTyme: PartyTymeBridge;
      karaFunMix: KaraFunMixBridge;
      khostBridge: KHostBridgeApi;
      chooseRatingProfile: () => Promise<string | null>;
      ratingProfileStatus: (file?: string) => Promise<SongRatingsLookup>;
      requestCatalogTrack: (input: { track: CatalogRequestTrack; singerId: string | null; requestId: string }) => Promise<Result & { versionId?: string; notice?: string }>;
      addYouTube: (input: {url:string;title:string;artist:string;brandSlug?:string;discoveryOrigin?:'karaokenerds'}) => Promise<Result & {versionId?:string;notice?:string}>;
      openCommunityVideo: (id: string) => Promise<Result>;
      getShortcuts: () => Promise<{ shortcuts: Shortcuts; path: string; error: string }>;
      saveShortcuts: (value: Shortcuts) => Promise<Shortcuts>;
      editShortcutsFile: () => Promise<void>;
      playPause: () => Promise<Result>;
      installControlCli: () => Promise<{ ok: boolean; command?: string; message: string; files?: string[] }>;
      applause?: { trigger: () => Promise<Result> };
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
      getDisplayLogo: () => Promise<string | null>;
      onDisplayLogo: (callback: (logo: string | null) => void) => () => void;
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

// ShowState is a projection from the authority, while selections, open dialogs
// and search text are local UI state. Never write SQLite or infer a committed
// queue change merely because a button was clicked.
function App() {
  const karaFunAccount = useKaraFunAccount(window.tpv.karaFun);
  const partyTymeAccount = usePartyTymeAccount(window.tpv.partyTyme);
  const [appVersion, setAppVersion] = useState('');
  const [state, setState] = useState<ShowState | null>(null);
  useEffect(() => { let alive = true; void window.tpv.getAppVersion().then(value => {if(alive)setAppVersion(value);}).catch(() => {});return()=>{alive=false;}; }, []);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [screen, setScreen] = useState<Screen>('library');
  const [search, setSearch] = useState('');
  const [providerCatalogRevision, setProviderCatalogRevision] = useState(0);
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
  const [downloadStatus, setDownloadStatus] = useState<YouTubeDownloadStatus | null>(null);
  const providerPreparations = useQueuePreparations(window.tpv.karaFun, window.tpv.partyTyme);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [editingRequest, setEditingRequest] = useState<SongRequest | null>(null);
  const [queueMenu, setQueueMenu] = useState<{ request: SongRequest; x: number; y: number } | null>(null);
  const draggedRequest = useRef('');
  const [queueVersion, setQueueVersion] = useState<QueueSelection | null>(null);
  const [playlistVersion, setPlaylistVersion] = useState<Version | null>(null);
  const [contextMenu, setContextMenu] = useState<{ version: SongResult; x: number; y: number } | null>(null);
  const [collections, setCollections] = useState<CollectionsSnapshot>({ playlists: [], items: [], history: [] });

  const [singerName, setSingerName] = useState('');

  const [missingSinger, setMissingSinger] = useState('');
  const [missingTitle, setMissingTitle] = useState('');
  const [missingArtist, setMissingArtist] = useState('');
  const [notice, setNoticeState] = useState('');
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info');
  const noticeTimer = useRef<number | null>(null);
  const setNotice = (message: string, tone: NoticeTone = 'info') => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNoticeState(message); setNoticeTone(tone);
    if (message && tone !== 'error') noticeTimer.current = window.setTimeout(() => setNoticeState(current => current === message ? '' : current), 8000);
  };
  const dismissNotice = () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null; setNoticeState('');
  };
  useEffect(() => () => { if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current); }, []);
  const [busy, setBusy] = useState(false);
  const [importActive, setImportActive] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupCleanup, setBackupCleanup] = useState(false);
  const [importPickerBusy, setImportPickerBusy] = useState(false);
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [panelSizes, setPanelSizes] = useState<HostPanelSizes>({ ...DEFAULT_HOST_PANEL_SIZES });
  const panelSizesRef = useRef(panelSizes), panelSaveSequence = useRef(0), panelSavePending = useRef(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => { const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => { if (!panelSavePending.current) { panelSizesRef.current = { ...settings.hostPanelSizes }; setPanelSizes(panelSizesRef.current); } }, [JSON.stringify(settings.hostPanelSizes)]);
  const fittedPanels = fittedHostPanels(panelSizes, viewport.width, viewport.height);
  const libraryLayout = settings.layout === 'library' && viewport.width > 850;
  const changePanelSize = (key: keyof HostPanelSizes, value: number) => {
    panelSizesRef.current = { ...panelSizesRef.current, [key]: value }; setPanelSizes(panelSizesRef.current);
  };
  const commitPanelSize = (key: keyof HostPanelSizes, value: number) => {
    changePanelSize(key, value); const sequence = ++panelSaveSequence.current; panelSavePending.current = true;
    void window.tpv.saveSettings({ hostPanelSizes: { ...panelSizesRef.current } }).then(saved => { if (sequence === panelSaveSequence.current) { panelSavePending.current = false; setSettings(saved); } })
      .catch(() => { if (sequence === panelSaveSequence.current) { panelSavePending.current = false; setNotice('Could not save panel sizes. Try moving the separator again.', 'error'); } });
  };
  const [accentSaving, setAccentSaving] = useState(false);
  const [transportBusy, setTransportBusy] = useState(false);
  const transportBusyRef = useRef(false);
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
  const [canRateByKey, setCanRateByKey] = useState<Record<string, boolean>>({});
  const [ratingDialog, setRatingDialog] = useState<{ title: string; key: RecordingKey } | null>(null);
  const ratingOpenSequence = useRef(0);
  const ratingWriteEpoch = useRef(0);
  const [ratingReload, setRatingReload] = useState(0);
  const [ratingWindowStart, setRatingWindowStart] = useState(0);
  useEffect(() => { setRatingWindowStart(0); songList.current?.scrollTo(0, 0); }, [search, librarySort, libraryFilter]);
  useEffect(() => { setRatings({}); setCanRateByKey({}); setRatingDialog(null); ++ratingOpenSequence.current; }, [settings.ratingProfileConfigFile]);
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
      .catch(error => { if (alive) setNotice(`Could not load the show: ${String(error)}`, 'error'); });
    return () => { alive = false; unsubscribe(); };
  }, []);


  useEffect(() => {
    let alive = true;
    void window.tpv.getCollections().then(value => { if (alive) setCollections(value); })
      .catch(error => { if (alive) setNotice(`Could not load playlists and history: ${String(error)}`, 'error'); });
    return () => { alive = false; };
  }, [state?.revision]);

  useEffect(() => {
    let alive = true;
    void window.tpv.getLibraryFilenames().then(value => { if (alive) setLibraryFilenames(value); })
      .catch(() => { if (alive) setNotice('Filename search is unavailable.', 'error'); });
    return () => { alive = false; };
  }, [state?.revision, filenameRefresh]);

  useEffect(() => {
    let alive = true;
    void window.tpv.getShortcuts().then(result => {
      if (alive) { setShortcuts(result.shortcuts); setShortcutsPath(result.path); if (result.error) setNotice(`${result.error} Defaults are active until the file is fixed and the app restarted.`, 'error'); }
    }).catch(error => { if (alive) setNotice(`Could not load keyboard shortcuts: ${String(error)}`, 'error'); });
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
    }).catch(error => { if (alive) setNotice(`Could not load preferences: ${String(error)}`, 'error'); });
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
    } catch { setNotice('Could not save the accent color. Please try again.', 'error'); }
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

  const blacklist = useMemo(() => compileSongBlacklist(settings), [settings.songBlacklist, settings.artistBlacklist]);
  const versions = useMemo(() => state ? visibleVersions(state).filter(version => !blacklist.isBlocked(version)) : [], [state, blacklist]);
  const hostVersionAllowed = (versionId: string) => !!(state && isVersionAllowed(state, versionId) && !blacklist.isBlocked(state.versions.find(version => version.id === versionId) ?? {}));
  const catalogSearch = useLibraryCatalogSearch(search, screen === 'library' && settings.sourceVisibility.karaokenerds, JSON.stringify([settings.sharedCatalogEnabled, settings.sharedCatalogConfigFile, settings.songBlacklist, settings.artistBlacklist, settings.sourceVisibility]), window.tpv.searchCommunityCatalog);
  const providerCatalogScope = JSON.stringify([providerCatalogRevision, settings.providerCatalogEnabled, settings.providerCatalogProfiles, state?.policy, settings.songBlacklist, settings.artistBlacklist, settings.sourceVisibility, karaFunAccount.state, karaFunAccount.revision, partyTymeAccount.state, partyTymeAccount.revision]);
  const providerSearch = useProviderCatalogSearch(search, settings.providerCatalogEnabled && screen === 'library' && libraryFilter === 'all', providerCatalogScope, window.tpv.searchProviderCatalog);
  const libraryRows = useMemo(() => state ? unifiedLibrary(state, search, libraryFilenames, librarySort, libraryFilter,
    catalogSearch.result?.status === 'ready' ? catalogSearch.result.tracks : [], versions).filter(version => !blacklist.isBlocked(version)) : [], [state, versions, search, libraryFilenames, librarySort, libraryFilter, catalogSearch.result, blacklist]);
  const karaFunSearch = useKaraFunSearch(window.tpv.karaFun, karaFunAccount, search, settings.sourceVisibility.karafun && screen === 'library' && libraryFilter === 'all', providerCatalogScope);
  const partyTymeSearch = usePartyTymeSearch(window.tpv.partyTyme, partyTymeAccount, search, settings.sourceVisibility.partytyme && screen === 'library' && libraryFilter === 'all', providerCatalogScope);
  const youtubeSearch = useYouTubeSearch(window.tpv.youtubeSearch, search, settings.sourceVisibility.youtube && settings.youtubeSearchEnabled && screen === 'library' && libraryFilter === 'all' && !state?.policy.ageRestricted && state?.policy.includeVersionIds === null,
    JSON.stringify([providerCatalogScope, settings.youtubeSearchMode, settings.youtubeApprovedChannels, settings.youtubeBlockedChannels, settings.ytDlpExecutable]));
  const filtered = useMemo(() => unifiedSongResults(libraryRows, new Set(state?.versions.map(row => row.id)), {
    karaFun: karaFunSearch.result, partyTyme:partyTymeSearch.result, partyTymeConnected:partyTymeAccount.state==='connected', youtube: youtubeSearch.result, catalogs: providerSearch.results, karaFunConnected: karaFunAccount.state === 'connected', sort: librarySort, sourceVisibility: settings.sourceVisibility,
  }).filter(row => !blacklist.isBlocked(row)), [libraryRows, state, karaFunSearch.result, partyTymeSearch.result, partyTymeAccount.state, youtubeSearch.result, providerSearch.results, karaFunAccount.state, librarySort, blacklist, settings.sourceVisibility]);

  const pending = state?.requests.filter(r => r.status === 'pending') ?? [];
  const future = state ? orderedFuture(state, settings.rotationMode, clockMs) : [];
  const queueTimeline = useQueueTimeline(state?.playback?.generationId ?? null);
  const queueWaits = estimateQueueWaits({ generation: state?.playback?.generationId ?? null,
    playing: state?.playback?.status === 'playing', autoAdvance: settings.autoAdvance, timeline: queueTimeline,
    intervalSeconds: settings.pauseIntervalSeconds, items: future.map(request => ({ id: request.id,
      ready: !!state && singerAvailable(state, request.singerId, clockMs) && singerAvailable(state, request.coSingerId ?? null, clockMs) && hostVersionAllowed(request.versionId) &&
        !queuePreparation(state.versions.find(version => version.id === request.versionId), downloadStatus, providerPreparations)?.pending })) });
  const selectedFuture = future.find(request => request.id === selectedRequestId);
  const eligibleFuture = state && future.some(r => r.status === 'accepted' && singerAvailable(state, r.singerId, clockMs) && singerAvailable(state, r.coSingerId ?? null, clockMs) && hostVersionAllowed(r.versionId));
  const staged = state?.requests.find(r => r.id === state.stagedRequestId);
  const stagedBlocked = !!(state && staged && !hostVersionAllowed(staged.versionId));
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
      const allowed: Record<string, boolean> = {}, failed = new Set<string>();
      for (let offset = 0; offset < keys.length; offset += 100) {
        const batch = keys.slice(offset, offset + 100), result = await window.tpv.lookupSongRatings(batch);
        if (!alive || writeEpoch !== ratingWriteEpoch.current) return;
        if (result.status !== 'ready') { for (const key of batch) { allowed[key] = false; failed.add(key); } continue; }
        for (const key of batch) { allowed[key] = result.canVoteByKey[key] === true; if (!result.items.some(item => item.recordingKey === key)) failed.add(key); }
        for (const item of result.items) loaded[item.recordingKey] = item;
      }
      if (alive && writeEpoch === ratingWriteEpoch.current) { setRatings(current => { const next = { ...current, ...loaded }; for (const key of failed) delete next[key]; return next; }); setCanRateByKey(current => ({ ...current, ...allowed })); }
    })().catch(() => { if (alive && writeEpoch === ratingWriteEpoch.current) { setRatings({}); setCanRateByKey({}); } }).finally(() => { if (alive) setRatingsLoading(false); });
    return () => { alive = false; };
  }, [ratingSelection, settings.ratingProfileConfigFile, ratingReload, filenameRefresh]);
  const pauseRemaining = state ? remainingPauseSeconds(state, clockMs) : 0;
  const describe = (request?: SongRequest) => {
    const lead = request?.singerId == null ? 'Unassigned' : state?.singers.find(s => s.id === request.singerId)?.name ?? 'Unknown singer';
    const partner = request?.coSingerId ? state?.singers.find(s => s.id === request.coSingerId)?.name ?? 'Unknown singer' : '';
    const singer = partner ? `${lead} & ${partner}` : lead;
    const song = state?.versions.find(v => v.id === request?.versionId);
    return { singer, title: song?.title ?? 'Unknown song', artist: song?.artist ?? '' };
  };
  const run = async (operation: () => Promise<Result | void>, success?: string) => {
    setBusy(true);
    try {
      const result = await operation();
      if (result?.cancelled) return;
      if (result && !result.ok) setNotice(result.error || 'The action could not be completed.', 'error');
      else setNotice(result?.notice || success || '', success ? 'success' : 'info');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setBusy(false); }
  };
  const command = (payload: Command, success?: string) => run(() => window.tpv.command(payload), success);
  const backupShow = async (retry = false) => {
    if (backupBusy) return;
    setBackupBusy(true); setNotice('');
    try {
      const result = await (retry ? window.tpv.retryBackupCleanup() : window.tpv.backupShow());
      setBackupCleanup(result.status === 'cleanup-needed');
      if (result.status === 'saved') setNotice('Show backup saved. Video files and preferences are not included. Protect the backup using your destination folder permissions.', 'success');
      else if (result.status === 'failed') setNotice('Backup could not be completed. Choose a new filename on a supported local drive and try again; existing files are never overwritten.', 'error');
      else if (result.status === 'cleanup-needed') setNotice(`${result.published ? 'The backup was saved' : 'The backup was not saved'}, but temporary backup cleanup needs attention. Retry cleanup before creating another backup.`, 'error');
    } catch { setNotice('Backup could not be completed. Please try again.', 'error'); }
    finally { setBackupBusy(false); }
  };
  const restoreShow = () => run(async () => {
    const result = await window.tpv.restoreShow();
    switch (result.status) {
      case 'cancelled': return { ok: false, cancelled: true };
      case 'busy': return { ok: false, error: 'Stop playback and finish the active import, relink or backup before restoring a show.' };
      case 'invalid-backup': return { ok: false, error: 'Choose a complete, compatible Booth show backup. The selected file could not be verified.' };
      case 'restarting': return { ok: true, notice: 'Restarting Booth to restore the checked backup…' };
      default: return { ok: false, error: 'Show restore could not start. Check app data permissions and available space, then try again.' };
    }
  });
  const beginImport = async (kind: 'files' | 'folder') => {
    if (importPickerBusy || importActive) return;
    setImportPickerBusy(true); setNotice('');
    try { await window.tpv.importFiles(kind); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setImportPickerBusy(false); }
  };
  const relinkSong = async (id: string) => {
    if (relinkBusy) return;
    setRelinkBusy(true); setNotice('Checking the selected file…');
    try { const result = await window.tpv.relinkMedia(id); if (result.ok && !result.cancelled) setFilenameRefresh(value => value + 1); setNotice(result.cancelled ? '' : result.ok ? 'Song file relinked.' : result.error || 'The song could not be relinked.', result.ok ? 'success' : 'error'); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
    finally { setRelinkBusy(false); }
  };
  const playPause = async () => {
    if (transportBusyRef.current) return;
    if (!active && stagedBlocked) {
      setNotice('The next song is unavailable under the current policy. Change the queue or policy before starting.', 'error');
      return;
    }
    transportBusyRef.current = true; setTransportBusy(true);
    try { const result = await window.tpv.playPause(); if (!result.ok) setNotice(result.error || 'The action could not be completed.', 'error'); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
    finally { transportBusyRef.current = false; setTransportBusy(false); }
  };
  const mutateCollections = async (action: CollectionsAction): Promise<boolean> => {
    try { setCollections(await window.tpv.mutateCollections(action)); setNotice(''); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); return false; }
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
      if (!navigation && (settingsOpen || editingRequest || editingVersion || queueVersion || playlistVersion || target?.closest('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])') || busy && action !== 'stop')) return;
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
      if (result.ok) { setSingerName(''); }
      return result;
    }, `${name} added.`);
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
    void command({ type: 'setSingerAvailability', singerId, minutes }, minutes ? `Singer unavailable for ${minutes} minutes. Existing requests stay saved.` : 'Singer returned to the rotation.');
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
      if (!key) { setNotice('This recording needs an imported media fingerprint before it can be rated.', 'error'); return; }
      const result = await window.tpv.lookupSongRatings([key]);
      if (sequence !== ratingOpenSequence.current) return;
      if (result.status !== 'ready') { setNotice(`Ratings are unavailable (${result.status}). Your song and queue are unchanged.`, 'error'); return; }
      setRatings(current => ({ ...current, ...Object.fromEntries(result.items.map(item => [item.recordingKey, item])) }));
      setCanRateByKey(current => ({ ...current, ...result.canVoteByKey })); setRatingDialog({ title: version.title, key });
    } catch { if (sequence === ratingOpenSequence.current) setNotice('Ratings could not be loaded. Your song and queue are unchanged.', 'error'); }
  };
  const ratingButton = (version: Version | LibrarySearchVersion | undefined) => {
    if (!version) return null;
    const key = recordingKeyFor(version.source) ?? ratingKeys[version.id];
    return <SongRatingButton title={version.title} rating={key ? ratings[key] ?? null : null} loading={ratingsLoading && !!key && !ratings[key]} onClick={() => void showSongRating(version)} />;
  };
  const savePreferencePatch = (patch: Partial<Settings>) => run(async () => {
    if (patch.layout === 'rotation') patch = { ...patch, hostPanelSizes: { ...panelSizesRef.current, queue: Math.max(360, Math.min(1000, Math.round(window.innerWidth * .4))) } };
    else if (patch.layout === 'standard') patch = { ...patch, hostPanelSizes: { ...panelSizesRef.current, queue: DEFAULT_HOST_PANEL_SIZES.queue } };
    setSettings(await window.tpv.saveSettings(patch));
  });
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
    if (action === 'stop') { void command({ type: 'stop' }); return; }
    if (busy || settingsOpen || editingVersion || editingRequest || queueVersion || playlistVersion || ratingDialog) return;
    switch (action) {
      case 'playPause': void playPause(); break;
      case 'previous': void run(() => window.tpv.restartTrack()); break;
      case 'skip': skip(); break;
      case 'seekBackward': void seekOffset(-10); break;
      case 'seekForward': void seekOffset(10); break;
      case 'singerDisplay': void run(() => window.tpv.openDisplay()); break;
      case 'toggleFullscreen': void run(() => window.tpv.toggleDisplayFullscreen()); break;
      case 'importVideo': setScreen('library'); void beginImport('files'); break;
      case 'importDirectory': setScreen('library'); void beginImport('folder'); break;
      case 'importCdg': setScreen('library'); void run(async () => { await window.tpv.cdg.start(); }); break;
      case 'backupShow': void backupShow(backupCleanup); break;
      case 'restoreShow': void restoreShow(); break;
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
  const sidebarMaximum = Math.max(140, Math.min(HOST_PANEL_LIMITS.sidebar[1], viewport.width * .24));
  const queueMaximum = Math.max(260, Math.min(HOST_PANEL_LIMITS.queue[1], viewport.width - fittedPanels.sidebar - 324));
  const libraryQueueMaximum = Math.max(100, Math.min(HOST_PANEL_LIMITS.libraryQueue[1], viewport.height * .45));
  const previewMaximum = Math.max(90, Math.min(HOST_PANEL_LIMITS.preview[1], libraryLayout ? fittedPanels.libraryQueue - 100 : viewport.height * .4));
  const previewSize = Math.min(fittedPanels.preview, previewMaximum);
  const panelStyle = { '--sidebar-width': `${fittedPanels.sidebar}px`, '--queue-width': `${Math.min(fittedPanels.queue, queueMaximum)}px`, '--preview-height': `${previewSize}px`, '--library-queue-height': `${fittedPanels.libraryQueue}px` } as React.CSSProperties;
  const preview = settings.hostPreviewPosition !== 'hidden' ? <SingerPreview bridge={window.tpv.singerScreens} onOpen={() => void run(() => window.tpv.openDisplay())} /> : null;
  const previewSeparator = preview ? <PanelSeparator className="preview-separator" label="Resize Singer Preview" orientation="horizontal" value={previewSize} minimum={90} maximum={previewMaximum} defaultValue={DEFAULT_HOST_PANEL_SIZES.preview} reverse={settings.hostPreviewPosition === 'below'} onChange={value => changePanelSize('preview', value)} onCommit={value => commitPanelSize('preview', value)} /> : null;
  const blacklistSelection = (kind: 'song' | 'artist', version: LibrarySearchVersion) => {
    setContextMenu(null);
    void run(async () => {
      if (kind === 'artist') {
        const artist = version.artist?.trim() || '';
        if (!artist) return { ok: false, error: 'This song has no artist. Add a song rule or edit its metadata first.' };
        if (settings.artistBlacklist.some(item => normalizeBlacklistIdentity(item) === normalizeBlacklistIdentity(artist))) return;
        setSettings(await window.tpv.saveSettings({ artistBlacklist: [...settings.artistBlacklist, artist] }));
      } else {
        if (blacklist.isBlocked(version)) return;
        setSettings(await window.tpv.saveSettings({ songBlacklist: [...settings.songBlacklist, { artist: version.artist || '', title: version.title }] }));
      }
    }, kind === 'artist' ? 'Artist blacklisted across this host’s sources.' : 'Song blacklisted across this host’s sources and recording versions.');
  };

  return <div className="app" data-layout={settings.layout} style={panelStyle}>
    <header className="topbar">
      <div className="brand">
        <img className="brand__logo brand__logo--dark" src={brandLogoDark} alt="The Proper Volume Karaoke Booth" width="220" height="52" />
        <img className="brand__logo brand__logo--light" src={brandLogoLight} alt="The Proper Volume Karaoke Booth" width="220" height="52" />
      </div>
      <div className="topbar__identity">
        <h1>{settings.boothName}</h1>
        {appVersion && <span className="topbar__version" aria-label="Application version">v{appVersion}</span>}
      </div>
      <div className="topbar__status" role="status" aria-live="polite">
        <span className={`status-dot ${state?.playback?.status === 'playing' ? 'is-live' : state?.playback?.status === 'paused' ? 'is-paused' : ''}`} aria-hidden="true" />
        <span>{state?.playback?.status === 'playing' ? `On stage · ${current.singer}` : state?.playback?.status === 'paused' ? `Paused · ${current.singer}` : staged ? `Next · ${stage.singer}` : 'Player ready'}</span>
      </div>
      {busy && <span className="topbar__busy" role="status"><span className="spinner" aria-hidden="true" />Working…</span>}
      <div className="topbar__actions">
        <Tooltip text={shortcutHint('Appearance', 'appearance')}><button className="icon-button accent-button" aria-label="Appearance" onClick={() => openPreferences('appearance')} disabled={!settingsPath || accentSaving}><Icon name="palette" /></button></Tooltip>
        <Tooltip text={`Search (${shortcuts.search.map(formatShortcut).join(', ')})`}><button className="icon-button" aria-label="Open library search" onClick={focusSearch}><Icon name="search" /></button></Tooltip>
        <Tooltip text={shortcutHint('Singer Display', 'singerDisplay')}><button className="icon-button" aria-label="Singer display" onClick={() => void run(() => window.tpv.openDisplay())}><Icon name="display" /></button></Tooltip>
        <Tooltip text={shortcutHint('Toggle singer display fullscreen', 'toggleFullscreen')}><button className="icon-button" aria-label="Toggle singer display fullscreen" onClick={() => void run(() => window.tpv.toggleDisplayFullscreen())}><Icon name="fullscreen" /></button></Tooltip>
        <Tooltip text={shortcutHint('Preferences', 'preferences')}><button className="icon-button" aria-label="Preferences" onClick={() => openPreferences()} disabled={!settingsPath || accentSaving}><Icon name="settings" /></button></Tooltip>
      </div>
    </header>
    <nav className="sidebar" aria-label="Workspace">
      <div className="global-search"><div className="search-field"><Icon name="search" /><input ref={searchInput} type="search" aria-label="Search library" placeholder="Search songs" value={search} onChange={event => { setSearch(event.target.value); setScreen('library'); }} /></div></div>
      <div className="eyebrow">Workspace</div>
      {([['library', 'Library', 'library'], ['playlists', 'Playlists', 'playlist'], ['sources', 'Sources', 'globe']] as const).map(([id, label, icon]) =>
        <button key={id} className={`nav-item ${screen === id ? 'active' : ''}`} aria-label={label} aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}><Icon name={icon} /><span>{label}</span></button>)}
      <div className="sidebar__host"><div className="eyebrow">Host Workspace</div>{([['requests', 'Requests', 'inbox'], ['singers', 'Singers', 'singers'], ['remote', 'Remote Sessions', 'remote']] as const).map(([id, label, icon]) => <button key={id} className={`nav-item ${screen === id ? 'active' : ''}`} aria-label={label} aria-current={screen === id ? 'page' : undefined} onClick={() => setScreen(id)}><Icon name={icon} /><span>{label}</span>{id === 'requests' && pending.length > 0 && <span className="nav-item__count" aria-hidden="true">{pending.length}</span>}</button>)}</div>
    </nav>
    <PanelSeparator className="sidebar-separator" label="Resize Workspace Sidebar" orientation="vertical" value={fittedPanels.sidebar} minimum={140} maximum={sidebarMaximum} defaultValue={DEFAULT_HOST_PANEL_SIZES.sidebar} onChange={value => changePanelSize('sidebar', value)} onCommit={value => commitPanelSize('sidebar', value)} />
    <main className={`main-panel ${screen === 'library' ? 'search-workspace' : ''}`}>
      {screen==='remote' && <><SingerScreensPanel bridge={window.tpv.singerScreens} settings={settings} onSave={async patch => setSettings(await window.tpv.saveSettings(patch))} /><InternetSessionPanel bridge={window.tpv.internetSessions} /><p className="muted">Singers open your link, enter their name and request songs from your library. Keep this app running. This internet link also works for guests on venue Wi-Fi.</p></>}
      {notice && <div className={`notice notice--${noticeTone}`} role={noticeTone === 'error' ? 'alert' : 'status'} aria-live={noticeTone === 'error' ? 'assertive' : 'polite'}>
        <Icon name={noticeTone === 'error' ? 'warning' : noticeTone === 'success' ? 'check' : 'info'} />
        <p>{notice}</p>
        <button type="button" className="notice__dismiss" aria-label="Dismiss message" onClick={dismissNotice}><Icon name="close" /></button>
      </div>}
      <ImportPanel bridge={window.tpv.imports} onActiveChange={setImportActive} />
      <YouTubeDownloadsPanel bridge={window.tpv.youtubeDownloads} onCached={setCachedVideoIds} onStatus={setDownloadStatus} />
      <CdgImportPanel bridge={window.tpv.cdg} showStart={false} />
      {!state ? <p className="empty">Loading your show…</p> : <>
        {screen === 'library' && <>
          <div className="page-heading">
            <div>
              <h2>Song Library <Tooltip text="Double-click or press Enter to choose a singer and queue. Right-click for more actions."><button type="button" className="help-button" aria-label="Song library help">?</button></Tooltip></h2>
            </div>
          <div className="library-toolbar">
            <label>Sort<select aria-label="Sort songs" value={librarySort} onChange={event => setLibrarySort(event.target.value as LibrarySort)}>
              <option value="import-oldest">Import order</option><option value="import-newest">Newest imported</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option><option value="artist-asc">Artist A–Z</option><option value="artist-desc">Artist Z–A</option>
            </select></label>
            <label>Filter<select aria-label="Filter songs" value={libraryFilter} onChange={event => setLibraryFilter(event.target.value as LibraryFilter)}>
              <option value="all">All songs</option><option value="review">Needs metadata review</option><option value="missing-artist">Missing artist</option><option value="clean">Clean</option><option value="explicit">Explicit</option><option value="unrated">Unrated</option><option value="uncertain">Uncertain rating</option>
            </select></label>
          </div>
            <div className="page-heading__actions"><Tooltip text={shortcutHint('Import Video File', 'importVideo')}><button className="icon-button" aria-label="Import Video File" disabled={busy || importActive || importPickerBusy} onClick={() => void beginImport('files')}><Icon name="file" /></button></Tooltip> <Tooltip text={shortcutHint('Import Custom Directory', 'importDirectory')}><button className="icon-button" aria-label="Import Custom Directory" disabled={busy || importActive || importPickerBusy} onClick={() => void beginImport('folder')}><Icon name="folder" /></button></Tooltip> <Tooltip text={shortcutHint(KARAOKE_PAIR_IMPORT_LABEL, 'importCdg')}><button className="icon-button" aria-label={`${KARAOKE_PAIR_IMPORT_LABEL}…`} disabled={busy || importPickerBusy} onClick={() => actionHandler.current('importCdg')}><Icon name="cdg" /></button></Tooltip></div>
          </div>
          <div className="library-meta">
            <span role="status" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'result' : 'results'}</span>
            {(search.trim() || libraryFilter !== 'all') && <button type="button" className="link" onClick={() => { setSearch(''); setLibraryFilter('all'); }}>Clear search and filters</button>}
          </div>
          <div className="search-service-status" role="status">
            {(catalogSearch.phase === 'searching' || providerSearch.phase === 'searching' || karaFunSearch.loading || partyTymeSearch.loading || youtubeSearch.loading) && <span>Searching…</span>}
            {catalogSearch.result && catalogSearch.result.status !== 'ready' && <Tooltip text="Karaoke Nerds is unavailable. Check Sources or retry when connected."><span tabIndex={0}>Karaoke Nerds unavailable ⓘ</span></Tooltip>}
            {karaFunSearch.result && karaFunSearch.result.status !== 'ok' && <Tooltip text={karaFunSearch.result.message || 'Check your account in Sources.'}><span tabIndex={0}>KaraFun unavailable ⓘ</span></Tooltip>}
            {settings.sourceVisibility.partytyme && partyTymeAccount.state === 'expired' && <Tooltip text="The Party Tyme session expired. Reconnect it in Sources."><span tabIndex={0}>Party Tyme sign-in expired ⓘ</span></Tooltip>}
            {partyTymeSearch.result && partyTymeSearch.result.status !== 'ok' && <Tooltip text={partyTymeSearch.result.message || 'Check your Party Tyme account in Sources and try again.'}><span tabIndex={0}>Party Tyme unavailable ⓘ</span></Tooltip>}
            {partyTymeSearch.result?.status === 'ok' && (state.policy.ageRestricted || state.policy.includeVersionIds !== null) && <Tooltip text="The show's age or approved-song policy limits Party Tyme discovery."><span tabIndex={0}>Party Tyme limited by show policy ⓘ</span></Tooltip>}
            {partyTymeSearch.result?.status === 'ok' && partyTymeSearch.result.searchId && !partyTymeSearch.result.songs.length && !state.policy.ageRestricted && state.policy.includeVersionIds === null && <Tooltip text="Party Tyme returned no matches for this search. Its catalog and availability can differ from other sources."><span tabIndex={0}>No Party Tyme matches ⓘ</span></Tooltip>}
            {youtubeSearch.result && !['ok', 'disabled', 'cancelled'].includes(youtubeSearch.result.status) && <Tooltip text={youtubeSearch.result.message}><span tabIndex={0}>YouTube unavailable ⓘ</span></Tooltip>}
            {providerSearch.failed && <Tooltip text="Some service catalogs could not be reached. Try again or check Sources."><span tabIndex={0}>Some sources unavailable ⓘ</span></Tooltip>}
          </div>
          <SongResults rows={filtered} selected={selectedVersionId} listRef={songList} onSelect={setSelectedVersionId}
            onQueue={row => { if (busy) return; if (row.catalogOnly) { setNotice('Playback is not connected for this service.'); return; } setQueueVersion(row); }}
            onContext={(version, x, y) => setContextMenu({ version, x: Math.max(0, Math.min(x, window.innerWidth - 240)), y: Math.max(0, Math.min(y, window.innerHeight - 330)) })}
            rating={ratingButton} onScroll={event => {
              const rows = event.currentTarget.querySelectorAll<HTMLElement>('.song-option');
              const step = rows[1] && rows[0] ? rows[1].offsetTop - rows[0].offsetTop : rows[0]?.offsetHeight;
              if (step && step > 0) setRatingWindowStart(Math.max(0, Math.floor(event.currentTarget.scrollTop / step / 40) * 40));
            }} />
          <details className="missing-song-request"><summary>Request a missing song</summary>
            <form className="request-form" onSubmit={requestMissingSong}>
              <label>Singer name<input value={missingSinger} onChange={e => setMissingSinger(e.target.value)} maxLength={100} required /></label>
              <label>Song title<input value={missingTitle} onChange={e => setMissingTitle(e.target.value)} maxLength={200} required /></label>
              <label>Artist (optional)<input value={missingArtist} onChange={e => setMissingArtist(e.target.value)} maxLength={200} /></label>
              <button type="submit" disabled={busy || !missingSinger.trim() || !missingTitle.trim()}>Save missing-song request</button>
            </form>
          </details>
        </>}
        {screen === 'sources' && <div className="sources-panel"><h2>Sources</h2><SourceToggles value={settings.sourceVisibility} onSave={async value => setSettings(await window.tpv.saveSettings({ sourceVisibility: value }))} /><KaraFunPanel bridge={window.tpv.karaFun} status={karaFunAccount} versions={state.versions} /><PartyTymePanel bridge={window.tpv.partyTyme} status={partyTymeAccount} versions={state.versions} /><CommunityCatalogPanel search={window.tpv.searchCommunityCatalog} openVideo={window.tpv.openCommunityVideo} addVideo={window.tpv.addYouTube} onAdded={(id, notice) => { setSelectedVersionId(id); setScreen('library'); setNotice(notice || 'YouTube song saved in the library. Choose a singer and add a request to queue its download.', 'success'); }} /><ProviderCatalogPanel bridge={window.tpv} enabled={settings.providerCatalogEnabled} sourceVisibility={settings.sourceVisibility} karaFunConnected={karaFunAccount.state === 'connected'} partyTymeConnected={partyTymeAccount.state === 'connected'} partyTymePremium={partyTymeAccount.premium} scope={providerCatalogScope} onConfigurationChanged={() => setProviderCatalogRevision(value => value + 1)} /><KHostBridgePanel bridge={window.tpv.khostBridge} scope={JSON.stringify([settings.khostBridgeConfigFile, state?.policy, settings.songBlacklist, settings.artistBlacklist])} enabled={settings.sourceVisibility.karafun} /></div>}
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
          <h3>In This Show</h3><p className="muted">Unavailable singers can have one upcoming request. Existing requests are kept. They rejoin after their return time without interrupting a playing song.</p>{state.singers.filter(s => !s.archived).map(s => <SingerAvailabilityControl key={s.id} singer={s} nowMs={clockMs} busy={busy} points={settings.pointsEnabled ? state.points?.accounts.find(account => account.singerId === s.id)?.points ?? 0 : undefined} credits={settings.applauseEnabled ? state.points?.accounts.find(account => account.singerId === s.id)?.credits ?? 3 : undefined} onChange={minutes => setAvailability(s.id, minutes)} removeBlocked={state.requests.some(r => ['pending', 'accepted', 'staged', 'playing'].includes(r.status) && (r.singerId === s.id || r.coSingerId === s.id))} onRemove={() => { if (window.confirm(`Remove ${s.name} from this show? Their history, playlists and points will be kept, and their remote access will end.`)) void command({ type: 'removeSinger', singerId: s.id }, 'Singer removed from this show.'); }} />)}
          {!state.singers.some(s => !s.archived) && <p className="empty">No singers yet.</p>}
        </>}
        {screen === 'playlists' && <CollectionsPanel data={collections} versions={versions} singers={state.singers} selectedVersionId={selectedVersionId} busy={busy} mutate={mutateCollections} selectVersion={id => { setSelectedVersionId(id); setScreen('library'); }} />}
      </>}
    </main>
    <PanelSeparator className="queue-separator" label={libraryLayout ? 'Resize Host Queue Height' : 'Resize Host Queue Width'} orientation={libraryLayout ? 'horizontal' : 'vertical'} reverse value={libraryLayout ? fittedPanels.libraryQueue : Math.min(fittedPanels.queue, queueMaximum)} minimum={libraryLayout ? 100 : 260} maximum={libraryLayout ? libraryQueueMaximum : queueMaximum} defaultValue={libraryLayout ? DEFAULT_HOST_PANEL_SIZES.libraryQueue : DEFAULT_HOST_PANEL_SIZES.queue} onChange={value => changePanelSize(libraryLayout ? 'libraryQueue' : 'queue', value)} onCommit={value => commitPanelSize(libraryLayout ? 'libraryQueue' : 'queue', value)} />
    <aside className="host-queue-panel" aria-label="Singer rotation" data-preview-position={settings.hostPreviewPosition}>
      {settings.hostPreviewPosition === 'above' && <>{preview}{previewSeparator}</>}
      <div className="rotation">
      <div className="rotation__heading">
        <div><span className="eyebrow">Host queue</span><h2>{settings.rotationMode === 'singer' ? 'Singer Rotation' : 'Request Queue'}</h2></div>
        <span className="badge">{settings.autoApprove ? 'Auto-approve' : 'Host moderated'}</span>
      </div>
      <div className="on-stage">
        <div className="on-stage__status"><span className={`status-dot ${active ? 'is-live' : ''}`} aria-hidden="true" /><span className="eyebrow">{active ? (state?.playback?.status === 'paused' ? 'Paused' : 'Playing now') : 'On stage'}</span></div>
        {active ? <><strong>{current.singer}</strong><small>{current.title} · {state?.playback?.status === 'paused' ? 'Paused' : 'Playing'}</small>{ratingButton(state?.versions.find(version => version.id === active.versionId))}</> : <span className="muted">No singer on stage</span>}
      </div>
      <div className="rotation__section-heading"><span className="eyebrow">Up next · {future.length} waiting</span>{future.some(request => queueWaits.get(request.id) == null) && <Tooltip text="Waits are unavailable when playback is stopped or paused, automatic advance is off, the current timing is unknown, or a song or singer is not ready."><span tabIndex={0}>Some waits unavailable ⓘ</span></Tooltip>}</div>
      <div className="rotation__actions">
        <button disabled={busy || !selectedFuture || selectedFuture.status !== 'accepted' || !state || !hostVersionAllowed(selectedFuture.versionId) || state.promotedRequestId === selectedFuture.id} onClick={() => { if (selectedFuture) void command({ type: 'promoteRequest', requestId: selectedFuture.id }, 'Request promoted to the front of the waiting queue.'); }}>Promote selected</button>
        <div className="queue-actions"><button disabled={busy || !selectedFuture || future.findIndex(r => r.id === selectedFuture.id) < 1} onClick={() => { if (!selectedFuture) return; const i = future.findIndex(r => r.id === selectedFuture.id); if (i > 0) void command({ type: 'moveRequest', requestId: selectedFuture.id, beforeRequestId: future[i - 1].id }); }}>Move up</button> <button disabled={busy || !selectedFuture || future.at(-1)?.id === selectedFuture.id} onClick={() => { if (!selectedFuture) return; const i = future.findIndex(r => r.id === selectedFuture.id); if (i >= 0 && i < future.length - 1) void command({ type: 'moveRequest', requestId: selectedFuture.id, beforeRequestId: future[i + 2]?.id ?? null }); }}>Move down</button> <button disabled={busy || (!state?.manualQueueOrder?.length && !state?.promotedRequestId)} onClick={() => void command({ type: 'resetQueueOrder' }, 'Automatic queue order restored.')}>Automatic order</button></div>
      </div>
      {state?.manualQueueOrder?.length ? <p className="muted rotation__hint">Manual order · new requests follow the arranged queue.</p> : null}
      <div role="listbox" aria-label="Singer Rotation" data-queue-list>{future.map((request, index) => { const item = describe(request); const preparation = queuePreparation(state?.versions.find(version => version.id === request.versionId), downloadStatus, providerPreparations); const returnAt = Math.max(0, ...(state?.singers.filter(s => s.id === request.singerId || s.id === request.coSingerId).map(s => s.unavailableUntilMs ?? 0) ?? [])); return <div className={`queue-row ${preparation?.pending ? 'queue-row--preparing' : ''} ${selectedRequestId === request.id ? 'selected' : ''}`} key={request.id} role="option" aria-selected={selectedRequestId === request.id} tabIndex={0} onClick={() => setSelectedRequestId(request.id)} onFocus={() => setSelectedRequestId(request.id)}
        draggable={!busy && ['accepted', 'staged'].includes(request.status)} onDragStart={event => { draggedRequest.current = request.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', request.id); }} onDragEnd={() => { draggedRequest.current = ''; }}
        onDragOver={event => { if (!busy && ['accepted', 'staged'].includes(request.status) && draggedRequest.current && draggedRequest.current !== request.id) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); const id = draggedRequest.current; draggedRequest.current = ''; if (!busy && id && id !== request.id && ['accepted', 'staged'].includes(request.status)) void command({ type: 'moveRequest', requestId: id, beforeRequestId: request.id }); }}
        onContextMenu={event => { event.preventDefault(); setSelectedRequestId(request.id); setQueueMenu({ request, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 230)) }); }}
        onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setQueueMenu({ request, x: Math.max(0, Math.min(rect.left, window.innerWidth - 240)), y: Math.max(0, Math.min(rect.top, window.innerHeight - 230)) }); } }}><div className="queue-row__head"><span className="queue-row__number">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.singer}</strong><small>{item.title}</small><small>{request.status === 'staged' ? (state && !hostVersionAllowed(request.versionId) ? 'Next · unavailable under current policy' : 'Next in queue') : returnAt > clockMs ? `Unavailable · back in ${Math.ceil((returnAt - clockMs) / 60000)} min` : state && !hostVersionAllowed(request.versionId) ? 'Unavailable under current policy' : state?.promotedRequestId === request.id ? 'Promoted · next' : settings.rotationMode === 'singer' ? `Round ${request.round}` : 'In request order'}</small>{preparation && <small className={preparation.failed ? 'queue-row__preparation is-failed' : 'queue-row__preparation'}>{preparation.label}</small>}{queueWaits.get(request.id) != null && <Tooltip text="Approximate wait assumes four minutes per queued song, the configured gap, uninterrupted playback, and playable files. Actual wait can change."><small tabIndex={0} aria-label={`Approximate wait ${formatQueueWait(queueWaits.get(request.id)!)}`}>{formatQueueWait(queueWaits.get(request.id)!)}</small></Tooltip>}</div>{ratingButton(state?.versions.find(version => version.id === request.versionId))}</div></div>; })}</div>
      {!future.length && <p className="empty">Accepted requests will appear here.</p>}
      </div>
      {settings.hostPreviewPosition === 'below' && <>{previewSeparator}{preview}</>}
    </aside>
    <footer className="transport" aria-label="Playback controls">
      <div className="transport__track"><span className="eyebrow">{active ? 'Now playing' : staged ? 'Next in queue' : 'Player ready'}</span><strong>{active ? current.title : staged ? stage.title : 'No song selected'}</strong><small>{active ? current.singer : staged ? stage.singer : 'Add a song to begin'}</small></div>
      <div className="transport__controls">
        <KaraFunMixControl bridge={window.tpv.karaFunMix} generation={state?.playback?.generationId ?? null} />
        <Tooltip text={shortcutHint('Previous — Restart Current Song', 'previous')}><button className="icon-button" aria-label="Previous — Restart Current Song" disabled={busy || !active} onClick={() => void run(() => window.tpv.restartTrack())}><Icon name="previous" /></button></Tooltip>
        <Tooltip text={!active && stagedBlocked ? 'The next song is unavailable under the current policy. Change the queue or policy before starting.' : `Play/Pause (${shortcuts.playPause.map(formatShortcut).join(', ')})`}><button className="primary icon-button" aria-label="Play/Pause" disabled={busy || transportBusy || (!active && (stagedBlocked || pauseRemaining > 0 || (!staged && !eligibleFuture)))} onClick={() => void playPause()}><Icon name={state?.playback?.status === 'playing' ? 'pause' : 'play'} /></button></Tooltip>
        <Tooltip text={shortcutHint('Stop', 'stop')}><button className="icon-button" aria-label="Stop" disabled={!state} onClick={() => void command({ type: 'stop' })}><Icon name="stop" /></button></Tooltip>
        <Tooltip text={shortcutHint('Skip', 'skip')}><button className="icon-button" aria-label="Skip" disabled={busy || !active} onClick={skip}><Icon name="skip" /></button></Tooltip>
        <Tooltip text={settings.applauseEnabled ? 'Play applause' : 'Enable applause in Preferences'}><button className="icon-button" aria-label="Applause" disabled={!settings.applauseEnabled || !window.tpv.applause} onClick={() => { void window.tpv.applause?.trigger().then(result => { if (!result.ok) setNotice(result.error || 'Could not play applause.', 'error'); }).catch(() => setNotice('Could not play applause.', 'error')); }}><Icon name="applause" /></button></Tooltip>
      </div>
      <PlaybackTimeline generation={state?.playback?.generationId ?? null} disabled={busy} shortcuts={shortcuts} />
      <label className="transport__volume">Volume <input type="range" aria-label="Global Volume" min="0" max="100" disabled={accentSaving} value={Math.round(settings.masterVolume * 100)} onChange={event => { if (accentSaveInFlight.current) return; const masterVolume = Number(event.target.value) / 100; setSettings(current => ({ ...current, masterVolume })); void window.tpv.saveSettings({ masterVolume }).catch(error => setNotice(`Could not save volume: ${String(error)}`, 'error')); }} /></label>
      <div className="transport__status" role="status">{!active && stagedBlocked ? 'The next song is unavailable under the current policy. Change the queue or policy before starting.' : !active && pauseRemaining > 0 ? `Next song in ${pauseRemaining}s` : ''}</div>
    </footer>
    {queueMenu && <div className="song-menu queue-menu" role="menu" aria-label="Queued request actions" style={{ left: queueMenu.x, top: queueMenu.y, maxHeight: `calc(100vh - ${queueMenu.y + 8}px)` }}>
      {(() => {
        const version = state?.versions.find(item => item.id === queueMenu.request.versionId);
        const preparation = queuePreparation(version, downloadStatus, providerPreparations);
        if (!version?.source || !preparation?.failed) return null;
        return <button role="menuitem" disabled={busy} onClick={() => {
          setQueueMenu(null);
          void run(async () => {
            if (version.source?.provider === 'youtube') await window.tpv.youtubeDownloads.start(version.id);
            else if (version.source?.provider === 'karafun') await window.tpv.karaFun.retry(version.id);
            else if (version.source?.provider === 'partytyme') await window.tpv.partyTyme.retry(version.id);
            return { ok: true };
          });
        }}>Retry song preparation</button>;
      })()}
      <button role="menuitem" disabled={busy || !['accepted', 'pending', 'staged'].includes(queueMenu.request.status)} onClick={() => { setEditingRequest(queueMenu.request); setQueueMenu(null); }}>Edit track or singer…</button>
      <button role="menuitem" disabled={busy || !['accepted', 'staged'].includes(queueMenu.request.status)} onClick={() => { const waiting = future.filter(r => r.id !== queueMenu.request.id); void command({ type: 'moveRequest', requestId: queueMenu.request.id, beforeRequestId: waiting[0]?.id ?? null }); setQueueMenu(null); }}>Move to first waiting</button>
      <button role="menuitem" disabled={busy || !['accepted', 'staged'].includes(queueMenu.request.status)} onClick={() => { void command({ type: 'moveRequest', requestId: queueMenu.request.id, beforeRequestId: null }); setQueueMenu(null); }}>Move to last waiting</button>
      <button role="menuitem" disabled={queueMenu.request.singerId === null} onClick={() => { setScreen('singers'); setQueueMenu(null); }}>Singer availability…</button>
      <button role="menuitem" disabled={busy} onClick={() => { void command({ type: 'removeRequest', requestId: queueMenu.request.id }); setQueueMenu(null); }}>Remove request</button>
    </div>}
    {editingRequest && state && <QueueEditDialog request={editingRequest} singers={state.singers.filter(s => !s.archived)} versions={versions} onClose={() => setEditingRequest(null)} onSave={async (singerId, versionId, coSingerId) => {
      const result = await window.tpv.command({ type: 'editRequest', requestId: editingRequest.id, singerId, versionId, coSingerId });
      if (!result.ok) throw new Error(result.error || 'The request could not be updated.');
      setNotice('Queued request updated.', 'success');
    }} />}
    {settingsOpen && <SettingsDialog value={settings} path={settingsPath} shortcutsPath={shortcutsPath} shortcuts={shortcuts} initialSection={settingsSection} focusRequest={settingsFocusRequest} onSaveShortcuts={async value => { setBusy(true); try { setShortcuts(await window.tpv.saveShortcuts(value)); } finally { setBusy(false); } }} onClose={() => setSettingsOpen(false)} onSave={async value => { setBusy(true); try { const saved = await window.tpv.saveSettings(value); setSettings(saved); } finally { setBusy(false); } }} />}
    {ratingDialog && <SongRatingDialog title={ratingDialog.title} recordingKey={ratingDialog.key} rating={ratings[ratingDialog.key] ?? null} canVote={canRateByKey[ratingDialog.key] === true} onClose={() => setRatingDialog(null)} onOpenPreferences={() => { setRatingDialog(null); openPreferences('ratings'); }} onSave={async value => {
      ++ratingWriteEpoch.current;
      setBusy(true);
      try {
        const result = await window.tpv.rateSong(ratingDialog.key, value);
        if (result.status !== 'ready') throw new Error(`Your rating was not confirmed (${result.status}). Check the connection or rating profile and retry explicitly.`);
        setRatings(current => ({ ...current, [result.item.recordingKey]: result.item })); setRatingReload(current => current + 1); return result.item;
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Your rating was not confirmed.', 'error'); throw error; }
      finally { setBusy(false); }
    }} />}
    {editingVersion && <EditMetadataDialog version={editingVersion} onClose={() => setEditingVersion(null)} onSave={async (title, artist, isDuet) => {
      const result = await window.tpv.command({ type: 'editVersion', id: editingVersion.id, title, artist, isDuet });
      if (!result.ok) throw new Error(result.error || 'The song could not be updated.');
    }} />}
    {contextMenu && <div className="song-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y, maxHeight: `calc(100vh - ${contextMenu.y + 8}px)` }}>
      <button role="menuitem" disabled={busy || !!contextMenu.version.catalogOnly} onClick={() => { setQueueVersion(contextMenu.version); setContextMenu(null); }}>Add to Queue</button>
      <button role="menuitem" disabled={busy || !contextMenu.version.persisted} onClick={() => { setPlaylistVersion(contextMenu.version); setContextMenu(null); }}>Add to Playlist</button>
      <button role="menuitem" disabled={busy || !contextMenu.version.persisted} onClick={() => { setEditingVersion(contextMenu.version); setContextMenu(null); }}>Edit Metadata</button>
      <button role="menuitem" disabled={busy} onClick={() => blacklistSelection('song', contextMenu.version)}>Blacklist Song</button>
      <button role="menuitem" disabled={busy || !contextMenu.version.artist?.trim()} onClick={() => blacklistSelection('artist', contextMenu.version)}>Blacklist Artist</button>
      {contextMenu.version.catalogOnly && <button role="menuitem" onClick={() => { const song = contextMenu.version.catalogOnly!; setContextMenu(null); void run(() => window.tpv.openProviderCatalogSong({ provider: song.provider, id: song.id })); }}>Open Provider Page</button>}
      {contextMenu.version.source?.provider === 'karafun' && <button role="menuitem" disabled={busy || !contextMenu.version.persisted} onClick={() => { const id = contextMenu.version.id; setContextMenu(null); void run(async () => { await window.tpv.karaFun.retry(id); return { ok: true }; }); }}>Prepare Song / Retry</button>}
      {contextMenu.version.source?.provider === 'partytyme' && <button role="menuitem" disabled={busy || !contextMenu.version.persisted} onClick={() => { const id=contextMenu.version.id;setContextMenu(null);void run(async()=>{await window.tpv.partyTyme.retry(id);return{ok:true};}); }}>Prepare Song / Retry</button>}
      {contextMenu.version.source?.provider === 'youtube' && <button role="menuitem" disabled={busy || !!contextMenu.version.youtubeSearchReceipt} onClick={() => { const version = contextMenu.version; setContextMenu(null); void run(async () => { const result = await downloadLibrarySong(version, window.tpv); if (result.ok && result.versionId) setSelectedVersionId(result.versionId); return result; }); }}>Download Video / Retry</button>}
      <button role="menuitem" disabled={relinkBusy || !contextMenu.version.persisted || !!contextMenu.version.source} onClick={() => { const id = contextMenu.version.id; setContextMenu(null); void relinkSong(id); }}>Relink File…</button>
      <button role="menuitem" disabled={!contextMenu.version.persisted || !!contextMenu.version.source && !cachedVideoIds.includes(contextMenu.version.id)} onClick={() => { const id = contextMenu.version.id; setContextMenu(null); void run(() => window.tpv.revealMedia(id)); }}>Show in Files…</button>
      <button role="menuitem" onClick={() => { setContextMenu(null); openPreferences('blacklist'); }}>Manage Blacklist…</button>
    </div>}
    {queueVersion && state && <SongRequestDialog version={queueVersion} singers={state.singers.filter(s => !s.archived)} onClose={() => setQueueVersion(null)} onSubmit={async (choice, singerCreated, coSingerId) => {
      let queueNotice = '';
      await requestWithSinger(choice, {
        createSingerId: () => crypto.randomUUID(),
        addSinger: singer => window.tpv.command({ type: 'addSinger', singer }),
        singerCreated,
        addRequest: async singerId => {
          if (coSingerId && (queueVersion.partyTymeReceipt || queueVersion.karaFunReceipt || queueVersion.youtubeSearchReceipt)) throw new Error('Save this song and mark it as a duet before selecting a partner.');
          const result = queueVersion.partyTymeReceipt
            ? await window.tpv.partyTyme.request({...queueVersion.partyTymeReceipt,singerId,requestId:crypto.randomUUID()})
            : queueVersion.karaFunReceipt
            ? await window.tpv.karaFun.request({ ...queueVersion.karaFunReceipt, singerId, requestId: crypto.randomUUID() })
            : queueVersion.youtubeSearchReceipt
            ? await window.tpv.youtubeSearch.request({ ...queueVersion.youtubeSearchReceipt, singerId, requestId: crypto.randomUUID() })
            : await requestLibrarySong(queueVersion, singerId, crypto.randomUUID(), window.tpv, coSingerId);
          if (result.ok && result.versionId) setSelectedVersionId(result.versionId);
          queueNotice = result.notice || ''; return result;
        },
      });
      setNotice(queueNotice || (settings.autoApprove ? 'Song added to the queue.' : 'Request submitted for review.'), 'success');
    }} />}
    {playlistVersion && state && <AddToPlaylistDialog song={playlistVersion} singers={state.singers.filter(s => !s.archived)} playlists={collections.playlists} onClose={() => setPlaylistVersion(null)} onSave={async playlistId => { if (!await mutateCollections({ type: 'add', playlistId, versionId: playlistVersion.id })) throw new Error('Could not add the song.'); }} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
