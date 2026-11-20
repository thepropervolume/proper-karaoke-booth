import { MobileRoomBeacon } from './mobile-room-beacon';
// Application composition root: the host owns durable state; renderers ask for
// actions and report playback facts. Provider credentials and media paths stay here.
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, protocol, screen, shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { unlink, readFile, lstat, open } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { userInfo } from 'node:os';
import { Readable } from 'node:stream';
import { applyCommand, createInitialState, isVersionAllowed, orderedFuture, singerAvailable, remainingPauseSeconds, visibleVersions, type Actor, type Command, type Outcome, type ShowState } from '../domain';
import { nextSingerReturnAt } from '../domain/singer-availability';
import type { HistoryEntry } from '../domain/collections';
import { isMissingSongStatus, normalizeMissingRequest } from '../domain/missing-request';
import { metadataFromPath } from '../domain/metadata';
import { previewMetadata } from './metadata-preview';
import { readEmbeddedMp4, type EmbeddedMetadataResult } from './embedded-metadata';
import { Store, type StoredMedia } from './store';
import { readSettings, writeSettings } from './settings';
import { nextAccentColor, type Settings } from '../domain/settings';
import { SettingsUpdateQueue } from './settings-update-queue';
import { installControlCli } from './cli-installer';
import { applySettingsPatch } from './settings-patch';
import { saveWithDiscoveryRevision } from './source-settings';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, type Shortcuts } from '../domain/shortcuts';
import { readShortcuts, writeShortcuts } from './shortcuts';
import type { AppAction } from '../domain/app-action';
import { applicationMenu, INITIAL_WORKSPACE_MENU_CONTEXT, type ApplicationMenuAction, type WorkspaceMenuContext } from './application-menu';
import { openDocumentationWindow } from './documentation-window';
import { LocalControlServer } from '../control/server';
import { projectControlQueue, type ControlQueueEnvelope } from '../control/queue';
import { projectControlLibrary } from '../control/library';
import { sourceIsVisible } from '../domain/source-visibility';
import type { LocalControlUiStatus } from '../renderer/LocalControlSettings';
import { parseLaunchIntent } from './launch-intent';
import { loadLogo, saveLogo } from './logo';
import { BumperCatalog } from './bumper-catalog';
import { BumperController, type BumperTrack } from './bumper-controller';
import { BumperDisplayOutput } from './bumper-display-output';
import { ApplauseOutput } from './applause-output';
import { applauseGenerationUnchanged, captureApplauseGeneration } from './applause-generation';
import { PhotoDisplayOutput } from './photo-display-output';
import { builtInBumperTracks } from './bumper-builtins';
import { serveBumper } from './bumper-media';
import { HostRemoteLifecycle } from './remote-host-lifecycle';
import { createLanHostProvider } from './remote-provider';
import { RemoteAuthorityCoordinator } from './remote-authority-coordinator';
import { InternetQueueClient } from './internet-queue-client';
import { createSingerStaticHandler } from './remote-static';
import { fingerprintMedia, mediaIdentityMatches, verifyAndRelinkMedia, type MediaIdentity } from './media-verification';
import { MediaReview } from './media-review';
import { startPolicyError } from './playback-policy';
import { openVerifiedMediaFile, VerifiedMediaFileError } from './verified-media-file';
import { cachedVideoIdentityMatches, inspectCachedVideo, sameStoredMedia } from './cached-video-integrity';
import { mediaErrorDetail, mediaVerificationDetail } from './media-error-message';
import { mediaRange } from './media-range';
import { ImportJob } from './import-job';
import { CdgImport } from './cdg-import';
import { LYRIC_FILE_EXTENSIONS } from './lrc-import';
import { lyricBackdropPath, validateLyricBackdropFile } from './lyric-backdrop';
import { ShowBackup } from './show-backup';
import { InvalidShowBackupError, prepareShowRestore, type PreparedShowRestore, type RestoreResult } from './show-restore';
import { HistoryExport } from './history-export';
import { PlaylistTransfer } from './playlist-transfer';
import { DisplayFullscreen } from './display-fullscreen';
import { selectSingerDisplay } from './display-placement';
import { readSingerDisplayId, writeSingerDisplayId } from './display-placement-store';
import { HostTransport, type TransportResult } from './host-transport';
import { LocalCommunityBrowser, type LocalCatalogResult } from './karaokenerds-local-browser';
import { SharedCatalogConnection } from './shared-catalog-connection';
import { SongRatingsConnection } from './song-ratings-connection';
import { HostSongRatings } from './host-song-ratings';
import { compileSongBlacklist } from '../domain/song-blacklist';
import { YouTubeSearchService } from './youtube-search';
import { parseYouTubeSubscriptions } from '../domain/youtube-search';
import { SingerScreenFrameHub, SingerScreenServer } from './singer-screen-server';
import { SingerScreenCapture } from './singer-screen-capture';
import type { SingerScreenUiStatus, SingerPreviewFrame } from '../renderer/SingerPreview';
import { recordingKeyFor, type RecordingKey } from '../domain/song-rating';
import { isYouTubePlayerActive, openYouTubePlayer } from './youtube-player-window';
import { YouTubeAudioGate } from './youtube-audio-gate';
import { YouTubeDownloads } from './youtube-download';
import { QueuedVideoDownloads } from './queued-video-downloads';
import { catalogRequest } from '../domain/catalog-request';
import { AutomaticBumper } from './automatic-bumper';
import { ShowAdvance } from './show-advance';
import { stageNextApproved } from './stage-next';
import { StartIntentFence } from './start-intent';
import { resolveYtDlpExecutable } from './youtube-tools';
import { youtubeIdentity } from '../domain/streaming-source';
import { PlaybackTimeline } from './playback-timeline';
import { applicationUserData } from './user-data-path';
import { ProviderCatalogService } from './provider-catalog-service';
import { KHostBridgeConnection } from './khost-connection';
import { readKHostBridgeProfile } from './khost-client';
import { isProviderCatalogId } from '../domain/provider-catalog';
import { parseHostPolicy } from './host-policy';
import { KaraFunAccount } from './karafun-account';
import { KaraFunSessionVault } from './karafun-session-vault';
import { KaraFunHost } from './karafun-host';
import { PartyTymeAccount, partyTymeCredentials } from './partytyme-account';
import { PartyTymeHost } from './partytyme-host';
import { PartyTymeMediaCache, type PartyTymePrepared } from './partytyme-media';
import { KaraFunMediaCache, type KaraFunPreparedMedia } from './karafun-media';
import { KaraFunMixer } from './karafun-mixer';

protocol.registerSchemesAsPrivileged([{ scheme: 'tpv-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
let host: BrowserWindow | null = null;
let display: BrowserWindow | null = null;
const applauseOutput = new ApplauseOutput(request => {
  if (!display || display.isDestroyed() || !displayReady) throw new Error('The singer player is unavailable.');
  display.webContents.send('display:applause', request);
});
const photoOutput = new PhotoDisplayOutput(request => {
  if (!display || display.isDestroyed() || !displayReady) throw new Error('The singer player is unavailable.');
  display.webContents.send('display:photo', request);
});
let displayFullscreen: DisplayFullscreen | null = null;
let displayId: number | null = null;
let displayOutputIds = new Set<number>();
let store: Store<ShowState>;
let karaFunAccount: KaraFunAccount;
let partyTymeAccount: PartyTymeAccount;
let partyTymeHost: PartyTymeHost;
let partyTymePickerOpen = false;
let activePartyTyme: { generation: string; versionId: string; media: PartyTymePrepared; revision: number } | null = null;
const mobileRoomBeacon = new MobileRoomBeacon();
let karaFunHost: KaraFunHost;
let activeKaraFun: { generation: string; versionId: string; media: KaraFunPreparedMedia; revision: number } | null = null;
let hostRatings: HostSongRatings;
let communityBrowser: LocalCommunityBrowser | null = null;
let sharedCatalog: SharedCatalogConnection | null = null;
function filteredCatalogResult(result: LocalCatalogResult): LocalCatalogResult {
  if (result.status !== 'ready') return result;
  const blacklist = compileSongBlacklist(settings);
  return { ...result, tracks: result.tracks.filter(track => !blacklist.isBlocked(track)) };
}
function catalogConfigFile(): string { return settings.sharedCatalogConfigFile || join(app.getPath('userData'), 'catalog-connection.json'); }
function ratingConfigFile(): string { return settings.ratingProfileConfigFile || join(app.getPath('userData'), 'rating-connection.json'); }
let activeRatingPath = '';
let activeRatings: SongRatingsConnection | null = null;
function ratingsConnection(): SongRatingsConnection {
  const path = ratingConfigFile();
  if (!activeRatings || path !== activeRatingPath) { activeRatingPath = path; activeRatings = new SongRatingsConnection(path, { requireConfig: !!settings.ratingProfileConfigFile }); }
  return activeRatings;
}
let state: ShowState;
let settings: Settings;
const startIntentFence = new StartIntentFence();
// Every durable authority install records the selected turn before callbacks or
// notifications, even if later work fails. This catches selection ABA changes.
function installShowState(next: ShowState): void {
  state = next;
  if (settings) startIntentFence.observe(state, settings, Date.now());
}
const providerCatalog = new ProviderCatalogService(() => ({ providerCatalogEnabled: settings.providerCatalogEnabled, providerCatalogProfiles: settings.providerCatalogProfiles, sourceVisibility: settings.sourceVisibility, policy: state.policy, songBlacklist: settings.songBlacklist, artistBlacklist: settings.artistBlacklist, karaFunConnected: karaFunAccount?.status().state === 'connected' }));
const youtubeSearch = new YouTubeSearchService(() => ({ ...settings, youtubeSearchEnabled: settings.youtubeSearchEnabled && settings.sourceVisibility.youtube, policy: state.policy }));
// In-flight discovery replies must not reappear after a source is toggled.
let sourceVisibilityRevision = 0;
const khostBridge = new KHostBridgeConnection(() => ({ ...settings, policy: state.policy }));
let choosingKHostProfile = false;
const singerFrames = new SingerScreenFrameHub();
const singerScreenServer = new SingerScreenServer(singerFrames);
let singerScreenError = '';
let outputRecovery: { generation: string; revision: number } | null = null;
function previewFrame(): SingerPreviewFrame {
  const frame = singerFrames.current;
  return frame ? { image: `data:image/jpeg;base64,${frame.jpeg.toString('base64')}`, width: frame.width, height: frame.height } : null;
}
singerFrames.subscribe(() => { if (host && !host.isDestroyed()) host.webContents.send('host:singer-preview', previewFrame()); });
const singerCapture = new SingerScreenCapture(singerFrames, {
  hasDemand: () => !shuttingDown && (!!settings && settings.hostPreviewPosition !== 'hidden' && !!host && !host.isDestroyed() && host.isVisible() || singerScreenServer.status().viewers > 0 || !!internetQueue?.screenSharing),
  capture: async () => {
    const window = display;
    if (!window || window.isDestroyed() || !displayReady) return null;
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    if (window !== display || window.isDestroyed() || !displayReady || image.isEmpty()) return null;
    const size = image.getSize(), scale = Math.min(1, 1600 / size.width, 1000 / size.height);
    const scaled = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' });
    return { jpeg: scaled.toJPEG(80), ...scaled.getSize() };
  },
});
function singerScreenStatus(): SingerScreenUiStatus {
  const value = singerScreenServer.status();
  const error = singerScreenError || (value.state === 'failed' ? 'The singer-screen listener stopped unexpectedly. Retry sharing or choose another port.' : '');
  return { status: error ? 'error' : value.state === 'listening' ? 'running' : 'stopped', port: value.port,
    urls: value.urls, viewers: value.viewers, maximumViewers: value.maxViewers, ...(error ? { message: error } : {}) };
}
async function reconcileSingerScreen(): Promise<void> {
  singerScreenError = '';
  try {
    if (shuttingDown || !settings.singerScreenEnabled) await singerScreenServer.stop();
    else await singerScreenServer.start({ port: settings.singerScreenPort });
  } catch { singerScreenError = 'The singer-screen port could not be opened. Check whether another app uses it, or choose a different port in Preferences → Singer Display.'; }
}
let choosingProviderProfile = false;
const settingsUpdates = new SettingsUpdateQueue();
let settingsPath: string;
let settingsCreated = false;
let shortcuts: Shortcuts = DEFAULT_SHORTCUTS;
let shortcutsPath: string;
let logoPath: string;
let logoData: string | null = null;
let choosingLogo = false;
let shortcutError = '';
let displayReady = false;
let shuttingDown = false;
let importPickerOpen = false;
let bumperCatalog: BumperCatalog | null = null;
let bumperOutput: BumperDisplayOutput | null = null;
let bumper: BumperController | null = null;
let builtInBumpers: BumperTrack[] = [];
let bumperError = '';
let playbackTransition = false;
let autoStageSuspended = false;
const restoreRestartSwitch = 'after-show-restore';
let startupBumperPending = !app.commandLine.hasSwitch(restoreRestartSwitch);
let startingLaunchBumper = false;
const youtubeAudioGate = new YouTubeAudioGate(isYouTubePlayerActive);
let importJob: ImportJob | null = null;
let cdgImport: CdgImport | null = null;
let cdgPickerOpen = false;
let cdgImportParsing: Pick<Settings, 'metadataFormat' | 'metadataTemplates'> | null = null;
let importParsing: Pick<Settings, 'metadataFormat' | 'metadataTemplates'> | null = null;
let relinking = false;
const showBackup = new ShowBackup(async () => {
  if (!host || host.isDestroyed() || shuttingDown) return null;
  const result = await dialog.showSaveDialog(host, { title: 'Back up show to a new file', defaultPath: 'karaoke-show-backup.sqlite',
    filters: [{ name: 'Show backup', extensions: ['sqlite'] }], properties: ['showOverwriteConfirmation'] });
  return result.canceled ? null : result.filePath ?? null;
}, destination => store.backup(destination));
let restoreRequest: Promise<RestoreResult> | null = null;
let restorePending: PreparedShowRestore | null = null;
function restoreBusy(): boolean {
  const phase = importJob?.snapshot()?.phase;
  return !!state.playback || playbackTransition || importPickerOpen || cdgPickerOpen || !!cdgImport?.active() ||
    phase === 'scanning' || phase === 'hashing' || phase === 'cancelling' || relinking || showBackup.needsShutdownWait();
}

function chooseShowRestore(): Promise<RestoreResult> {
  const window = host;
  if (!window || window.isDestroyed() || shuttingDown) return Promise.resolve({ status: 'unavailable' });
  if (restoreRequest || restorePending || restoreBusy()) return Promise.resolve({ status: 'busy' });
  const operation = async (): Promise<RestoreResult> => {
    let candidate: PreparedShowRestore | undefined;
    try {
      const chosen = await dialog.showOpenDialog(window, { title: 'Choose a show backup', properties: ['openFile'],
        filters: [{ name: 'Show backup', extensions: ['sqlite'] }] });
      const snapshot = chosen.filePaths[0];
      if (chosen.canceled || !snapshot || shuttingDown || window.isDestroyed()) return { status: 'cancelled' };
      candidate = await prepareShowRestore(snapshot, app.getPath('userData'));
      if (shuttingDown || window.isDestroyed()) return { status: 'cancelled' };
      if (restoreBusy()) return { status: 'busy' };
      const { singers, songs, requests } = candidate.summary;
      const count = (value: number, label: string) => `${value.toLocaleString()} ${label}${value === 1 ? '' : 's'}`;
      const review = await dialog.showMessageBox(window, { type: 'warning', title: 'Restore Show Backup',
        message: 'Replace the current show with this backup?',
        detail: `This backup contains ${count(singers, 'singer')}, ${count(songs, 'song')} and ${count(requests, 'request')}. Booth will save your current show in the app data folder under show-restore-backups, end remote sessions and restart silently. Media files and preferences stay in place.`,
        buttons: ['Cancel', 'Restore and Restart'], defaultId: 0, cancelId: 0, noLink: true });
      if (review.response !== 1 || shuttingDown || window.isDestroyed()) return { status: 'cancelled' };
      if (restoreBusy()) return { status: 'busy' };
      restorePending = candidate;
      setImmediate(() => app.quit());
      return { status: 'restarting' };
    } catch (error) {
      return { status: error instanceof InvalidShowBackupError ? 'invalid-backup' : 'failed' };
    } finally {
      if (candidate && candidate !== restorePending) await candidate.discard().catch(() => {});
    }
  };
  restoreRequest = operation().finally(() => { restoreRequest = null; });
  return restoreRequest;
}
const historyExport = new HistoryExport(() => store.collections.snapshot().history, async () => {
  if (!host || host.isDestroyed() || shuttingDown) return null;
  const result = await dialog.showSaveDialog(host, { title: 'Export shown history to a new CSV file', defaultPath: 'karaoke-history.csv',
    filters: [{ name: 'CSV file', extensions: ['csv'] }], properties: ['showOverwriteConfirmation'] });
  return shuttingDown || !host || host.isDestroyed() || result.canceled ? null : result.filePath ?? null;
});
const playlistTransfer = new PlaylistTransfer({
  async pickExport() {
    if (!host || host.isDestroyed() || shuttingDown || restorePending) return null;
    const result = await dialog.showSaveDialog(host, { title: 'Export playlist to a new file', defaultPath: 'karaoke-playlist.tpv.json',
      filters: [{ name: 'Booth playlist JSON', extensions: ['json'] }], properties: ['showOverwriteConfirmation'] });
    return shuttingDown || restorePending || result.canceled ? null : result.filePath ?? null;
  },
  async pickImport() {
    if (!host || host.isDestroyed() || shuttingDown || restorePending) return null;
    const result = await dialog.showOpenDialog(host, { title: 'Preview a Booth playlist', properties: ['openFile'],
      filters: [{ name: 'Booth playlist JSON', extensions: ['json'] }] });
    return shuttingDown || restorePending || result.canceled ? null : result.filePaths[0] ?? null;
  },
  snapshot(playlistId) {
    const playlist = store.collections.playlistForTransfer(playlistId);
    if (!playlist) return null;
    const visible = new Map(visibleVersions(state, settings).map(song => [song.id, song]));
    const songs = playlist.versionIds.flatMap(id => {
      const song = visible.get(id);
      return song ? [{ title: song.title, artist: song.artist, recording: recordingKeyFor(song.source, store.media(id)?.fingerprint) }] : [];
    });
    return { file: { format: 'tpv-playlist', version: 1, name: playlist.name, songs }, omitted: playlist.versionIds.length - songs.length };
  },
  candidates() {
    const fingerprints = store.mediaFingerprints();
    const allowed = new Set(visibleVersions(state, settings).map(version => version.id));
    return state.versions.flatMap(version => {
      const recording = recordingKeyFor(version.source, fingerprints.get(version.id));
      return recording ? [{ versionId: version.id, recording, allowed: allowed.has(version.id) }] : [];
    });
  },
  apply(destination, versionIds) {
    return store.importPlaylist(destination, versionIds, state.singers.filter(singer => !singer.archived), visibleVersions(state, settings));
  },
});
const mediaChecks = new Set<AbortController>();
let metadataRead: { id: string; controller: AbortController } | null = null;
const mediaReview = new MediaReview();
let verifiedPlayback: { generation: string; id: string; path: string; fingerprint: string; identity: MediaIdentity } | null = null;
let reportedMediaError = '';
let youtubeDownloads: YouTubeDownloads | null = null;
let youtubeDownloadConfig = '';
let preparingDownload = false;
const pendingSeeks = new Map<string, { generation: string; resolve: (position: number) => void; reject: () => void }>();
function seekDisplay(generation: string, position: number): Promise<number> {
  if (!display || display.isDestroyed() || !displayReady || state.playback?.generationId !== generation) return Promise.reject(new Error('Player unavailable.'));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingSeeks.delete(id); reject(new Error('Seek timed out.')); }, 5000);
    pendingSeeks.set(id, { generation, resolve: actual => { clearTimeout(timer); pendingSeeks.delete(id); resolve(actual); },
      reject: () => { clearTimeout(timer); pendingSeeks.delete(id); reject(new Error('Seek failed.')); } });
    display!.webContents.send('display:seek', { id, generation, position });
  });
}
const playbackTimeline = new PlaybackTimeline(seekDisplay,
  (generation, position) => { if (state.playback?.generationId !== generation) throw new Error('Track changed.'); store.checkpoint(generation, position); }, publishTimeline);
function timelineState() {
  playbackTimeline.sync(state.playback?.generationId ?? null, state.playback ? store.position(state.playback.generationId) : 0);
  return playbackTimeline.snapshot();
}
function publishTimeline(): void {
  const value = timelineState();
  if (host && !host.isDestroyed()) host.webContents.send('host:timeline', value);
}

function videoCacheDirectory(): string {
  return settings.karaokeNerdsCacheDirectory || join(app.getPath('videos'), 'The Proper Volume Karaoke');
}
function queueMediaReady(versionId: string): boolean {
  const provider = state.versions.find(version => version.id === versionId)?.source?.provider;
  if (provider !== 'youtube' && provider !== 'karafun' && provider !== 'partytyme') return true;
  const media = store.media(versionId);
  return !!media && existsSync(media.path);
}
function downloadStatus() {
  const sources = new Set(state.versions.filter(version => version.source?.provider === 'youtube').map(version => version.id));
  const queue=queuedDownloads.snapshot();
  return { job: youtubeDownloads?.snapshot() ?? null, preparing: preparingDownload, queue:{...queue,
    waitingVideos:queue.pendingVersionIds.map(versionId=>({versionId,title:state.versions.find(version=>version.id===versionId)?.title ?? 'Video'})),
    failures:queue.failures.map(failure=>({...failure,title:state.versions.find(version=>version.id===failure.versionId)?.title ?? 'Video'}))},
    cachedVersionIds: Object.keys(store.mediaFilenames()).filter(id => sources.has(id) && existsSync(store.media(id)!.path)),
    readyVersionIds: [...new Set(state.requests.filter(request => ['accepted', 'staged', 'pending'].includes(request.status))
      .map(request => request.versionId))].filter(queueMediaReady) };
}
const queuedDownloads = new QueuedVideoDownloads(async versionId => {
  const job = await startYouTubeDownload(versionId);
  return job && youtubeDownloads ? youtubeDownloads.wait() : null;
});
function syncQueuedDownloads(): void {
  if (shuttingDown || !store || !settings) return;
  karaFunHost?.sync();
  partyTymeHost?.sync();
  const active=youtubeDownloads?.snapshot();
  if(active && !isVersionAllowed(state, active.versionId, settings))youtubeDownloads?.cancel(active.id);
  queuedDownloads.reconcile(orderedFuture(state,settings.rotationMode,Date.now()).filter(request => ['accepted','staged'].includes(request.status) && isVersionAllowed(state, request.versionId, settings))
    .map(request=>request.versionId).filter(id=>state.versions.find(version=>version.id===id)?.source?.provider==='youtube' && (!store.media(id) || !existsSync(store.media(id)!.path))));
}
function automaticBumperEligible(): boolean {
  const launch = startingLaunchBumper && settings?.bumperOnLaunch && state.playback?.status !== 'playing';
  const interlude = settings?.autoBumper && !state.playback && (!settings.autoAdvance || settings.pauseIntervalSeconds > 0 || !state.stagedRequestId);
  return !!(launch || interlude) && !shuttingDown && !playbackTransition && displayReady && !!bumper &&
    bumper.isOutputAvailable() && !youtubeAudioGate.playbackBlocked() &&
    [...builtInBumpers,...(bumperCatalog?.forPlayback() ?? [])].some(track=>track.id===settings.autoBumperTrackId);
}
const automaticBumper = new AutomaticBumper(automaticBumperEligible, stillEligible => youtubeAudioGate.startBumper(async()=>{
  if(!stillEligible() || !bumper)return false;
  bumperError='';
  const started=await bumper.start(settings.autoBumperTrackId);
  if(started&&!stillEligible())await bumper.stop();
  return started&&stillEligible();
}),message=>{bumperError=message;publishBumper();});
const showAdvance = new ShowAdvance(() => {
  const request = state?.requests.find(item => item.id === state.stagedRequestId);
  const version = state?.versions.find(item => item.id === request?.versionId);
  const media = request && store?.media(request.versionId);
  const mediaPresent = !!media && existsSync(media.path);
  let error: string | undefined;
  if (request && !isVersionAllowed(state, request.versionId, settings)) error = 'The next song is blocked by the show policy. Review the queue and press Play.';
  if (version?.source?.provider === 'karafun') {
    const failed = karaFunHost?.status().find(item => item.versionId === version.id && item.phase === 'failed');
    if (karaFunAccount?.status().state !== 'connected') error = 'Sign in to KaraFun in Sources, then press Play to continue.';
    else if (failed) error = failed.message || 'The next KaraFun song could not be prepared. Retry it in Sources.';
    else if (media && !mediaPresent) error = 'The prepared KaraFun recording is missing. Retry its preparation in Sources, then press Play.';
  } else if (version?.source?.provider === 'partytyme') {
    const failed = partyTymeHost?.status().find(item=>item.versionId===version.id&&item.phase==='failed');
    if(partyTymeAccount?.status().state!=='connected'||!partyTymeAccount.status().premium)error='Connect Party Tyme Premium in Sources, then press Play.';
    else if(failed)error=failed.message||'Party Tyme preparation failed. Retry in Sources.';
    else if(media&&!mediaPresent)error='The prepared Party Tyme video is missing. Retry in Sources.';
  } else if (version?.source?.provider === 'youtube') {
    const failed = queuedDownloads.snapshot().failures.find(item => item.versionId === version.id);
    if (failed) error = 'The next video could not download. Retry it from the song menu, then press Play.';
    else if (media && !mediaPresent) error = 'The saved video is missing. Use Download Video / Retry from its song menu, then press Play.';
  } else if (request && (!media || !existsSync(media.path))) error = 'The next song file is missing. Relink it from the song menu, then press Play.';
  return { enabled: !!settings?.autoAdvance && !shuttingDown && !outputRecovery,
    playing: !!state?.playback, requestId: request?.id ?? null, notBeforeMs: state?.nextStartAtMs ?? 0,
    ready: !!request && mediaPresent && singerAvailable(state, request.singerId, Date.now()) && singerAvailable(state, request.coSingerId ?? null, Date.now()) && !error,
    ...(error ? { error } : {}) };
}, async (requestId, current) => {
  const intent = startIntentFence.capture(state, settings, Date.now());
  await ensureSingerDisplayReady(false);
  if (!current() || intent?.requestId !== requestId || !startIntentFence.current(state, settings, Date.now(), intent)) return { ok: false, error: 'The next song changed. Review the queue and press Play.' };
  return executeHostCommand({ type: 'start', generationId: randomUUID() }, false, null, current);
}, message => {
  bumperError = message; publishBumper();
  if (!shuttingDown && host && !host.isDestroyed()) void dialog.showMessageBox(host, { type: 'warning', message: 'Show needs attention', detail: message });
});
async function startLaunchBumper(): Promise<void> {
  if (!startupBumperPending || !displayReady || shuttingDown) return;
  startupBumperPending = false;
  if (!settings.bumperOnLaunch || state.playback?.status === 'playing') return;
  startingLaunchBumper = true;
  try { await automaticBumper.startIdle(); } finally { startingLaunchBumper = false; }
}
type ExplicitVideoRetry = { videoId: string; media: StoredMedia; identity: MediaIdentity };
type DownloadBaseline = { videoId: string; media: StoredMedia | undefined; retry: ExplicitVideoRetry | undefined };
const explicitVideoRetries = new Map<string, ExplicitVideoRetry>();
const activeDownloadBaselines = new Map<string, DownloadBaseline>();
async function startYouTubeDownload(versionId: string) {
  if (shuttingDown || preparingDownload) throw new Error('A video download is being prepared. Try again shortly.');
  const version = state.versions.find(item => item.id === versionId);
  if (version?.source?.provider !== 'youtube' || !isVersionAllowed(state, versionId, settings)) throw new Error('This video is unavailable.');
  const existingJob = youtubeDownloads?.snapshot();
  if (youtubeDownloads?.active()) {
    if (existingJob?.versionId === versionId) return existingJob;
    throw new Error('Another video is downloading. Wait or cancel it before downloading this song.');
  }
  const retry = explicitVideoRetries.get(versionId); explicitVideoRetries.delete(versionId);
  const originalMedia = store.media(versionId);
  if (retry && (retry.videoId !== version.source.videoId || !sameStoredMedia(retry.media, originalMedia)))
    throw new Error('The saved video link changed before retrying. Review the song and try again.');
  if (!retry && originalMedia && existsSync(originalMedia.path)) return null;
  const baseline: DownloadBaseline = { videoId: version.source.videoId, media: originalMedia, retry };
  preparingDownload = true;
  try {
    const executable = await resolveYtDlpExecutable(settings.ytDlpExecutable);
    if (shuttingDown) throw new Error('The application is closing.');
    const current=state.versions.find(item=>item.id===versionId);
    if(current?.source?.provider !== 'youtube' || current.source.videoId!==version.source.videoId || !isVersionAllowed(state, versionId, settings))throw new Error('This video selection is no longer available.');
    const currentMedia = store.media(versionId);
    if (!sameStoredMedia(originalMedia, currentMedia)) throw new Error('The saved video link changed while preparing this download.');
    if (retry && !cachedVideoIdentityMatches(retry.media.path, retry.identity)) throw new Error('The saved video changed after it was checked. Retry after file changes finish.');
    if (!retry && currentMedia && existsSync(currentMedia.path)) return null;
    const directory = videoCacheDirectory(), config = JSON.stringify([directory, executable]);
    if (!youtubeDownloads || config !== youtubeDownloadConfig) {
      youtubeDownloads = new YouTubeDownloads(directory, executable, asset => {
        const current = state.versions.find(item => item.id === asset.versionId);
        if (shuttingDown || current?.source?.provider !== 'youtube' || current.source.videoId !== asset.videoId || !isVersionAllowed(state, asset.versionId, settings)) throw new Error('The video selection changed or is no longer available under the show policy.');
        const previous = store.media(asset.versionId);
        const active = state.requests.find(request => request.id === state.playback?.requestId);
        if (active?.versionId === asset.versionId) throw new Error('Stop this performance first, then Retry and Play. Your request stays in the queue.');
        const expected = activeDownloadBaselines.get(asset.versionId);
        if (!expected || expected.videoId !== asset.videoId || !sameStoredMedia(expected.media, previous) ||
            expected.retry && !cachedVideoIdentityMatches(expected.retry.media.path, expected.retry.identity))
          throw new Error('The saved video link or source changed during the download. Review the song before retrying.');
        store.save(state, [{ id: asset.versionId, path: asset.path, fingerprint: asset.fingerprint }]);
        // The current Version and queued request IDs stay unchanged.
        try { broadcast(); } catch { /* A committed download must not be reported as failed by a view. */ }
      });
      youtubeDownloadConfig = config;
    }
    activeDownloadBaselines.set(version.id, baseline);
    try {
      const job = youtubeDownloads.start({ versionId: version.id, videoId: version.source.videoId, title: version.title, artist: version.artist,
        ...(version.source.brandSlug ? {brandSlug: version.source.brandSlug} : {}) });
      const clearBaseline = () => { if (activeDownloadBaselines.get(version.id) === baseline) activeDownloadBaselines.delete(version.id); };
      void youtubeDownloads.wait().then(clearBaseline, clearBaseline);
      return job;
    } catch (error) { if (activeDownloadBaselines.get(version.id) === baseline) activeDownloadBaselines.delete(version.id); throw error; }
  } finally { preparingDownload = false; }
}

const publishRemoteStatus = (value: ReturnType<HostRemoteLifecycle['status']>) => {
  if (host && !host.isDestroyed()) host.webContents.send('host:remote-status', value);
};
const publishMissingRequests = () => {
  if (!shuttingDown && host && !host.isDestroyed()) {
    try { host.webContents.send('host:missing-song-requests', store.missingSongRequests());
      host.webContents.send('host:missing-song-reviews', store.missingSongReviews()); } catch { /* State already committed; refresh on next view load. */ }
  }
};
let remoteHost = new HostRemoteLifecycle(null, publishRemoteStatus, publishMissingRequests);
let remoteAuthority: RemoteAuthorityCoordinator | null = null;
let internetQueue: InternetQueueClient | null = null;
const preload = join(__dirname, '../preload/index.cjs');
const uiRoot = join(__dirname, '../ui/src');
const applicationIcon = join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'assets'),
  'branding', process.platform === 'win32' ? 'app.ico' : 'app.png');

function senderIsHost(id: number): boolean { return !!host && !host.isDestroyed() && host.webContents.id === id; }
function senderIsDisplay(id: number): boolean { return !!display && !display.isDestroyed() && display.webContents.id === id; }
// A method name in preload is not authorization: check the actual sender again
// at the service boundary, including calls from the singer renderer.
function guardHost(id: number): void { if (!senderIsHost(id)) throw new Error('Operation unavailable'); }
function bumperInfo() {
  return { tracks: [...builtInBumpers.map(({ id, name }) => ({ id, name, builtIn: true })), ...(bumperCatalog?.list() ?? []).map(track => ({ ...track, builtIn: false }))],
    status: bumper?.getState() ?? { status: 'stopped', trackId: null, generation: null },
    outputReady: !!bumper && bumper.isOutputAvailable() && displayReady,
    karaokeActive: !!state.playback || playbackTransition, error: bumperError };
}
function publishBumper(): void { if (!shuttingDown && host && !host.isDestroyed()) host.webContents.send('host:bumper-state', bumperInfo()); }
let availabilityTimer: NodeJS.Timeout | undefined;
function refreshAvailabilityDeadline(): void {
  if (availabilityTimer) clearTimeout(availabilityTimer);
  availabilityTimer = undefined;
  const now = Date.now();
  const next = nextSingerReturnAt(state.singers, now);
  if (next !== null) { availabilityTimer = setTimeout(() => { if (!shuttingDown) broadcast(); }, Math.min(2147483647, Math.max(1, next - now))); availabilityTimer.unref(); }
}
// Publishing may prepare the next approved turn, but it never arms a new show.
// Only an existing show's completion/Skip can arm automatic playback.
function broadcast(): void {
  if (shuttingDown) return;
  startIntentFence.observe(state, settings, Date.now());
  if (!autoStageSuspended) {
    const prepared = stageNextApproved(state, settings, Date.now(), queueMediaReady);
    if (prepared !== state) { store.save(prepared); installShowState(prepared); }
  }
  refreshAvailabilityDeadline();
  publishTimeline();
  if (host && !host.isDestroyed()) host.webContents.send('host:state', state);
  publishDisplay();
  publishBumper();
  showAdvance.changed();
}
// This projection is for our trusted singer renderer, not the guest network API.
// Local protocol URLs bind media to a playback generation without exposing the
// provider URL or account session to the host UI or remote singers.
function currentNativeKaraFun(): typeof activeKaraFun {
  const playback = state.playback;
  const request = state.requests.find(item => item.id === playback?.requestId);
  const version = state.versions.find(item => item.id === request?.versionId);
  return activeKaraFun?.generation === playback?.generationId && activeKaraFun?.versionId === version?.id &&
    activeKaraFun?.revision === karaFunAccount?.revision() && version?.source?.provider === 'karafun' &&
    version.source.catalog === activeKaraFun.media.source.catalog && version.source.songId === activeKaraFun.media.source.songId ? activeKaraFun : null;
}
const karaFunMixer = new KaraFunMixer(() => {
  const native = currentNativeKaraFun();
  return native ? { generation: native.generation, versionId: native.versionId, stems: native.media.kit.stems } : null;
});
function publishDisplay(): void {
  // Mix publications update gains only. They never arm playback or advance a turn.
  const mix = karaFunMixer.status();
  if (host && !host.isDestroyed()) host.webContents.send('host:karafun-mix', mix);
  if (shuttingDown || !display || display.isDestroyed() || !displayReady) return;
  const playback = state.playback;
  const request = state.requests.find(r => r.id === playback?.requestId);
  const version = state.versions.find(v => v.id === request?.versionId);
  const singerNames = (ids: (string | null | undefined)[]) =>
    ids.map(id => state.singers.find(s => s.id === id)?.name).filter((name): name is string => !!name).join(' & ');
  const next = settings.showNextSingers ? orderedFuture(state, settings.rotationMode, Date.now())
    .filter(r => r.singerId !== null && singerAvailable(state, r.singerId, Date.now()) && singerAvailable(state, r.coSingerId ?? null, Date.now()) && isVersionAllowed(state, r.versionId, settings)).slice(0, 3)
    .map(r => singerNames([r.singerId, r.coSingerId]) || 'Unknown singer') : [];
  const native = currentNativeKaraFun();
  const backdrop = native ? lyricBackdropPath(settings, { packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath }) : undefined;
  const partyReady = playback && activePartyTyme?.generation === playback.generationId && activePartyTyme.versionId === version?.id && activePartyTyme.revision === partyTymeAccount?.revision() && partyTymeAccount.status().state === 'connected';
  const current = playback && request && version && store.media(version.id) && (version.source?.provider !== 'karafun' || native) && (version.source?.provider !== 'partytyme' || partyReady) ? { generation: playback.generationId, status: playback.status,
    kind: native ? 'karafun' : 'video',
    ...(native ? { karaFun: { timing: native.media.kit.timing, durationSeconds: native.media.kit.timing.durationSeconds,
      stemVolumes: Object.fromEntries(mix?.stems.map(stem => [stem.id, stem.volume]) ?? []),
      stems: native.media.kit.stems.map(stem => ({ id: stem.id, role: stem.role, voice: stem.voice, src: `tpv-media://karafun-stem/${encodeURIComponent(playback.generationId)}/${stem.id}` })) },
      backdropSrc: backdrop ? `tpv-media://lyric-backdrop/${encodeURIComponent(playback.generationId)}` : null } : {}),
    src: `tpv-media://play/${encodeURIComponent(playback.generationId)}`,
    position: store.position(playback.generationId), title: version.title, singer: singerNames([request.singerId, request.coSingerId]), volume: settings.masterVolume, outputId: settings.audioOutputId } : null;
  display.webContents.send('display:state', { playback: current, next, logo: settings.showDisplayLogo ? logoData : null, shortcuts, bumperVolume: settings.masterVolume, fontFamily: settings.fontFamily,
    branding: { boothName: settings.boothName, displayLogoSize: settings.displayLogoSize, bannerEnabled: settings.bannerEnabled,
      bannerText: settings.bannerText, bannerPosition: settings.bannerPosition, bannerExpiresAt: settings.bannerExpiresAt, bannerOnLaunch: settings.bannerOnLaunch } });
}
// The state transition and completion history are committed together. A renderer
// callback from an older generation must never consume the current singer's turn.
function perform(command: Command, actor: 'host' | 'engine' = 'host', control?: ControlQueueEnvelope): ReturnType<typeof applyCommand>['outcome'] {
  const previousGeneration = state.playback?.generationId;
  const expected = control ?? { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision };
  const result = applyCommand(state, { ...expected, actor: { role: actor, id: control ? 'local-cli' : actor }, command }, settings, Date.now(),
    { songSeenBefore: version => store.songSeenBefore(version) });
  // Returning a saved CLI receipt must not repeat any post-commit effects.
  if (result.state === state) return result.outcome;
  let history: HistoryEntry | undefined;
  if (result.outcome.ok && (command.type === 'complete' || command.type === 'skip') && state.playback) {
    const request = state.requests.find(r => r.id === state.playback?.requestId);
    if (request) {
      const singer = state.singers.find(s => s.id === request.singerId);
      const version = state.versions.find(v => v.id === request.versionId);
      const coSinger = state.singers.find(s => s.id === request.coSingerId);
      history = { generationId: state.playback.generationId, singerId: request.singerId, singer: [singer?.name, coSinger?.name].filter(Boolean).join(' & '),
        versionId: request.versionId, title: version?.title ?? 'Unknown song', artist: version?.artist ?? '',
        outcome: command.type === 'complete' ? 'completed' : 'skipped', at: new Date().toISOString() };
    }
  }
  store.save(result.state, [], history);
  installShowState(result.state);
  if (result.outcome.ok && (command.type === 'pause' || command.type === 'stop' || command.type === 'release')) { showAdvance.cancel(); cancelPendingPlayback(); }
  if (result.outcome.ok && command.type === 'release') autoStageSuspended = true;
  if (result.outcome.ok && command.type === 'setPolicy') youtubeSearch.cancel();
  if (result.outcome.ok && (command.type === 'complete' || command.type === 'skip' || command.type === 'stop')) { verifiedPlayback = null; activeKaraFun = null; activePartyTyme = null; outputRecovery = null; }
  if (result.outcome.ok && (command.type === 'complete' || command.type === 'skip' || command.type === 'stop')) bumper?.karaokeEnded();
  if (result.outcome.ok && previousGeneration && (command.type === 'complete' || command.type === 'skip')) { automaticBumper.arm(previousGeneration); showAdvance.arm(); }
  if (result.outcome.ok && ['request','accept','editRequest','moveRequest','promoteRequest','removeRequest','rejectRequest','setPolicy'].includes(command.type)) syncQueuedDownloads();
  try{broadcast();}catch{/* A closed view must not turn a durable command into a failure. */}
  return result.outcome;
}

function commitCatalogRequest(input: unknown, discoveryOrigin: 'karaokenerds' | 'youtube' = 'karaokenerds') {
    if(shuttingDown)return {ok:false,error:'The application is closing.'};
    const planned=catalogRequest(state,input,settings,{versionId:randomUUID(),commandId:randomUUID()},Date.now(),
      { songSeenBefore: version => store.songSeenBefore(version) }, discoveryOrigin);
    if(!planned.result.ok)return planned.result;
    store.save(planned.state);installShowState(planned.state);
    let notice:string|undefined;
    try{syncQueuedDownloads();}catch{notice='Queued successfully. Use Download Video / Retry if its download does not appear.';}
    try{broadcast();}catch{/* A committed request remains successful even if a view closes. */}
    return {...planned.result,...(notice?{notice}:{})};
}
function pauseForOutputLoss(): boolean {
  if (!shuttingDown && state.playback?.status === 'playing') return perform({ type: 'pause' }).ok;
  return false;
}
function warnDisplayLoss(): void {
  if (host && !host.isDestroyed()) void dialog.showMessageBox(host, { type: 'warning', message: 'Singer display closed', detail: 'Playback was paused. Reopen the Singer display and resume when you are ready.' });
}
function restrictWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
let hostActionsReady = false;
const launchIntent = parseLaunchIntent(process.argv);
let pendingHostActions: AppAction[] = launchIntent ? [launchIntent === 'keybindings' ? 'keybindings' : 'preferences'] : [];
function showHostWindow(): BrowserWindow | null {
  if (!host || host.isDestroyed()) return null;
  if (host.isMinimized()) host.restore();
  host.show(); host.focus();
  return host;
}
function dispatchHostAction(action: AppAction): void {
  const window = showHostWindow();
  if (window && hostActionsReady) { window.webContents.send('host:app-action', action); return; }
  if (pendingHostActions.length < 16) pendingHostActions.push(action);
}
let hostFullscreen: DisplayFullscreen | null = null;
function dispatchApplicationMenuAction(action: ApplicationMenuAction): void {
  if (shuttingDown) return;
  if (action === 'documentation') { openDocumentationWindow(host); return; }
  if (action === 'showHostWindow') { showHostWindow(); return; }
  if (action === 'toggleHostFullscreen') { if (showHostWindow()) hostFullscreen?.toggle(); return; }
  dispatchHostAction(action);
}
const workspaceMenuContextKeys = Object.keys(INITIAL_WORKSPACE_MENU_CONTEXT) as (keyof WorkspaceMenuContext)[];
let workspaceMenuContext = INITIAL_WORKSPACE_MENU_CONTEXT;
let lastMenuSignature = '';
function refreshApplicationMenu(): void {
  const singerDisplayVisible = !!display && !display.isDestroyed() && display.isVisible();
  const signature = JSON.stringify([settings.appearance, settings.accentColor, settings.fontFamily, settings.layout, workspaceMenuContext, singerDisplayVisible]);
  if (signature === lastMenuSignature) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu(settings, dispatchApplicationMenuAction, process.platform, workspaceMenuContext, singerDisplayVisible)));
  lastMenuSignature = signature;
}
function publishSettings(): void {
  refreshApplicationMenu();
  if (host && !host.isDestroyed()) host.webContents.send('host:settings', settings);
}
let localControl: LocalControlServer | null = null;
let localControlError = '';
function localControlStatus(): LocalControlUiStatus {
  const status = localControl?.status();
  return { enabled: settings.localControlEnabled, status: localControlError ? 'failed' : status?.status ?? (settings.localControlEnabled ? 'stopped' : 'disabled'),
    ...(status?.status === 'ready' ? { port: status.port } : {}), ...(localControlError ? { message: localControlError } : {}) };
}
async function reconcileLocalControl(): Promise<void> {
  if (!settings.localControlEnabled || shuttingDown) {
    if (localControl) { await localControl.stop(); localControl = null; }
    localControlError = ''; return;
  }
  if (localControl?.status().status === 'ready') return;
  if (localControl) { await localControl.stop(); localControl = null; }
  const available = (signal: AbortSignal) => { signal.throwIfAborted(); if (shuttingDown) throw new Error('The host is closing.'); };
  const service = new LocalControlServer({ enabled: true, profileDirectory: app.getPath('userData'), applicationVersion: app.getVersion(), adapter: {
    getState: signal => { available(signal); return state; },
    getQueue: signal => { available(signal); return projectControlQueue(state, settings.rotationMode, Date.now()); },
    getLibrary: (query, signal) => {
      available(signal);
      const saved = visibleVersions(state, settings).filter(version => sourceIsVisible(version, settings.sourceVisibility) &&
        (version.source?.provider !== 'karafun' || karaFunAccount?.status().state === 'connected') &&
        (version.source?.provider !== 'partytyme' || partyTymeAccount?.status().state === 'connected'));
      return projectControlLibrary(state, saved, query);
    },
    isQueueControlEnabled: () => settings.localControlEnabled && settings.localQueueControlEnabled && !shuttingDown,
    applyQueueCommand: (envelope, signal) => { available(signal); return perform(envelope.command, 'host', envelope); },
    getSettings: signal => { available(signal); return settings; },
    getShortcuts: signal => { available(signal); return shortcuts; },
    openSettings: signal => { available(signal); dispatchHostAction('preferences'); },
    openKeybindings: signal => { available(signal); dispatchHostAction('keybindings'); },
  } });
  localControl = service;
  try { await service.start(); localControlError = ''; }
  catch {
    localControlError = 'The local API could not start. Check private app-data permissions or a stale connection file, then retry Save Preferences.';
    try { await service.stop(); if (localControl === service) localControl = null; } catch { /* Keep the authority tracked until shutdown. */ }
    throw new Error(localControlError);
  }
}
function createHost(): void {
  hostActionsReady = false;
  host = new BrowserWindow({ width: 1440, height: 900, minWidth: 780, minHeight: 600, title: 'The Proper Volume Karaoke', icon: applicationIcon,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  const window = host;
  restrictWindow(window);
  const fullscreen = new DisplayFullscreen(value => window.setFullScreen(value), () => window.isFullScreen(), () => {
    if (!shuttingDown && !window.isDestroyed()) void dialog.showMessageBox(window, { type: 'warning', message: 'Could not change host fullscreen.' });
  });
  hostFullscreen = fullscreen;
  window.on('enter-full-screen', () => fullscreen.changed(true));
  window.on('leave-full-screen', () => fullscreen.changed(false));
  publishSettings();
  void window.loadFile(join(uiRoot, 'renderer/index.html'));
  window.on('closed', () => { fullscreen.close(); hostFullscreen = null; host = null; app.quit(); });
}
let displayCreation: Promise<void> | null = null;
let lastSingerDisplayId: number | null | undefined;
const hostTransport = new HostTransport();
function cancelPendingPlayback(): void { hostTransport.cancel(); for (const check of mediaChecks) check.abort(); }
function singerDisplayPlacementPath(): string { return join(app.getPath('userData'), 'singer-display-placement.json'); }
function rememberSingerDisplay(id: number): void {
  lastSingerDisplayId = id;
  try { writeSingerDisplayId(singerDisplayPlacementPath(), id); }
  catch { console.warn('Could not save singer display placement. The current display is still available.'); }
}
async function createDisplay(automatic = false, hidden = false): Promise<void> {
  if (display && !display.isDestroyed()) {
    if (hidden) return;
    if (!display.isVisible()) {
      const target = host && selectSingerDisplay(screen.getAllDisplays(), host.getBounds(), lastSingerDisplayId);
      if (target) {
        display.setBounds({ ...target.workArea, width: Math.min(1280, target.workArea.width), height: Math.min(800, target.workArea.height) });
        displayId = target.id; displayOutputIds = new Set([target.id]); rememberSingerDisplay(target.id);
      }
    }
    if (automatic) display.showInactive(); else { display.show(); display.focus(); }
    if (settings.singerDisplayFullscreen) displayFullscreen?.set(true);
    return;
  }
  if (displayCreation) { await displayCreation; return createDisplay(automatic, hidden); }
  const creation = createDisplayWindow(automatic, hidden);
  displayCreation = creation;
  try { await creation; } finally { if (displayCreation === creation) displayCreation = null; }
}
async function createDisplayWindow(automatic: boolean, hidden: boolean): Promise<void> {
  if (!host || host.isDestroyed() || shuttingDown) return;
  let selectedId: number | undefined;
  if (automatic) {
    if (lastSingerDisplayId === undefined) lastSingerDisplayId = readSingerDisplayId(singerDisplayPlacementPath());
    selectedId = selectSingerDisplay(screen.getAllDisplays(), host.getBounds(), lastSingerDisplayId)?.id;
    if (selectedId === undefined) throw new Error('No connected screen is available for the singer display. Check your displays and press Play again.');
  } else {
    const monitors = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;
    const buttons = monitors.map((m, i) => `${m.id === primaryId ? 'Primary' : `Display ${i + 1}`} (${m.bounds.width} × ${m.bounds.height})`);
    buttons.push('Cancel');
    const result = await dialog.showMessageBox(host, { type: 'question', title: 'Choose singer display',
      message: 'Choose the display for singers', detail: 'Playback will pause if this display is disconnected.',
      buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1, noLink: true });
    selectedId = monitors[result.response]?.id;
  }
  if (selectedId === undefined || shuttingDown || !host || host.isDestroyed()) return;
  const target = screen.getAllDisplays().find(m => m.id === selectedId);
  if (!target) {
    if (automatic) throw new Error('The selected screen disconnected. Check your displays and press Play again.');
    await dialog.showMessageBox(host, { type: 'warning', message: 'That display is no longer available. Choose another display.' });
    return;
  }
  displayId = target.id;
  displayOutputIds = new Set([target.id]);
  displayReady = false;
  display = new BrowserWindow({ x: target.workArea.x, y: target.workArea.y,
    width: Math.min(1280, target.workArea.width), height: Math.min(800, target.workArea.height), title: 'Singer Display',
    show: !automatic && !hidden, paintWhenInitiallyHidden: true, backgroundColor: '#000000', icon: applicationIcon,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
  restrictWindow(display);
  const window = display;
  window.on('show', refreshApplicationMenu);
  window.on('hide', refreshApplicationMenu);
  refreshApplicationMenu();
  rememberSingerDisplay(target.id);
  const fullscreen = new DisplayFullscreen(
    value => { if (window.isDestroyed()) throw new Error('Singer display closed.'); window.setFullScreen(value); },
    () => { if (window.isDestroyed()) throw new Error('Singer display closed.'); return window.isFullScreen(); },
    () => { if (!shuttingDown && host && !host.isDestroyed() && !window.isDestroyed())
      void dialog.showMessageBox(host, { type: 'warning', message: 'Could not change singer display fullscreen',
        detail: 'The singer display is still open. Try the fullscreen button again or use the window controls.' }); });
  displayFullscreen = fullscreen;
  window.on('enter-full-screen', () => { try { fullscreen.changed(true); } catch { /* Window manager rejected the transition. */ } });
  window.on('leave-full-screen', () => { try { fullscreen.changed(false); } catch { /* Window manager rejected the transition. */ } });
  const loseDisplay = () => {
    if (display !== window) return;
    displayReady = false;
    if (pauseForOutputLoss()) warnDisplayLoss();
    if (!window.isDestroyed()) window.destroy();
  };
  display.webContents.on('render-process-gone', loseDisplay);
  display.on('move', () => {
    if (display !== window || window.isDestroyed() || displayId === null) return;
    // The window manager can move a window before display-removed arrives.
    if (!screen.getAllDisplays().some(m => m.id === displayId)) { if (window.isVisible()) loseDisplay(); return; }
    const previous = displayId;
    displayId = screen.getDisplayMatching(window.getBounds()).id;
    displayOutputIds.add(displayId);
    if (displayId !== previous) rememberSingerDisplay(displayId);
  });
  // The singer renderer is also the preview/audio authority. Hiding the window
  // keeps a single player alive instead of duplicating sound in a preview.
  display.on('close', event => {
    if (shuttingDown) return;
    event.preventDefault(); window.hide();
  });
  display.on('closed', () => {
    singerCapture.invalidate(); outputRecovery = null;
    fullscreen.close(); if (displayFullscreen === fullscreen) displayFullscreen = null;
    if (display !== window) return;
    display = null; displayReady = false; displayId = null; displayOutputIds.clear(); applauseOutput.clear(); photoOutput.clear();
    if (!shuttingDown) refreshApplicationMenu();
    automaticBumper.cancel(); showAdvance.cancel(); bumperOutput?.displayDestroyed(); void bumper?.setOutputAvailable(false).catch(error => { bumperError = String(error); publishBumper(); });
    if (pauseForOutputLoss()) warnDisplayLoss(); publishBumper();
  });
  void window.loadFile(join(uiRoot, 'display/index.html')).catch(loseDisplay);
  if (automatic && !hidden) window.showInactive();
  if (!hidden && settings.singerDisplayFullscreen) fullscreen.set(true);
}
async function ensureSingerDisplayReady(showVisible = true): Promise<void> {
  await createDisplay(true, !showVisible);
  const window = display;
  const deadline = performance.now() + 8000;
  for (;;) {
    if (shuttingDown) throw new Error('The application is closing.');
    if (!window || display !== window || window.isDestroyed()) throw new Error('The singer display closed before it was ready. Press Play to reopen it.');
    if (displayReady) return;
    if (performance.now() >= deadline) throw new Error('The singer display did not become ready. Close it and press Play to retry.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// Serialize credit checks through audio acknowledgement. Concurrent claps can
// still overlap after they start, while the same singer cannot spend a credit twice.
let applauseTurn: Promise<void> = Promise.resolve();
const applauseInFlight = new Map<string, { fingerprint: string; work: Promise<Outcome> }>();
function requestApplause(actor: Actor, commandId: string, showId: string, hostEpoch: string, expectedRevision: number,
  stillAuthorized: () => boolean = () => true): Promise<Outcome> {
  const fingerprint = JSON.stringify([actor.role, actor.id, showId, hostEpoch, expectedRevision]);
  const existing = applauseInFlight.get(commandId);
  if (existing) return existing.fingerprint === fingerprint ? existing.work :
    Promise.resolve({ ok: false, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: state.revision });
  const envelope = { commandId, showId, hostEpoch, expectedRevision, actor, command: { type: 'applause' as const } };
  const preview = applyCommand(state, envelope, settings, Date.now());
  if (!preview.outcome.ok || state.receipts.some(receipt => receipt.id === commandId)) return Promise.resolve(preview.outcome);
  const generation = captureApplauseGeneration(state.playback);
  const run = async (): Promise<Outcome> => {
    if (shuttingDown || !stillAuthorized()) return { ok: false, code: 'UNAVAILABLE', message: 'Applause is unavailable.', revision: state.revision };
    try {
      await ensureSingerDisplayReady(false);
      if (!stillAuthorized() || state.showId !== showId || state.hostEpoch !== hostEpoch || !settings.applauseEnabled)
        return { ok: false, code: 'UNAVAILABLE', message: 'The show or applause setting changed.', revision: state.revision };
      if (!applauseGenerationUnchanged(generation, state.playback))
        return { ok: false, code: 'STALE_GENERATION', message: 'The song changed before applause started.', revision: state.revision };
      const ready = applyCommand(state, { ...envelope, expectedRevision: state.revision }, settings, Date.now());
      if (!ready.outcome.ok) return ready.outcome;
      await applauseOutput.play(settings.masterVolume, settings.audioOutputId);
      if (!stillAuthorized() || state.showId !== showId || state.hostEpoch !== hostEpoch || !settings.applauseEnabled)
        return { ok: false, code: 'UNAVAILABLE', message: 'The show or applause setting changed.', revision: state.revision };
      if (!applauseGenerationUnchanged(generation, state.playback))
        return { ok: false, code: 'STALE_GENERATION', message: 'The song changed during applause; no points or credits were recorded.', revision: state.revision };
      const result = applyCommand(state, { ...envelope, expectedRevision: state.revision }, settings, Date.now());
      if (!result.outcome.ok) return result.outcome;
      // Preserve the original request fingerprint for a retry after a lost reply,
      // even if another host action changed the revision while audio was starting.
      const receipt = result.state.receipts.find(item => item.id === commandId);
      const originalReceipt = preview.state.receipts.find(item => item.id === commandId);
      if (!receipt || !originalReceipt) throw new Error('Could not record applause.');
      receipt.fingerprint = originalReceipt.fingerprint;
      store.save(result.state);
      installShowState(result.state);
      try { broadcast(); } catch { /* Committed applause remains recorded. */ }
      return result.outcome;
    } catch (error) {
      return { ok: false, code: 'AUDIO', message: error instanceof Error ? error.message : 'Could not play applause.', revision: state.revision };
    }
  };
  const work = applauseTurn.then(run);
  applauseTurn = work.then(() => {}, () => {});
  applauseInFlight.set(commandId, { fingerprint, work });
  void work.finally(() => applauseInFlight.delete(commandId)).catch(() => {});
  return work;
}

const photoInFlight = new Map<string, { fingerprint: string; work: Promise<Outcome> }>();
function requestPhoto(singerId: string, commandId: string, showId: string, hostEpoch: string, expectedRevision: number,
  dataUrl: string, stillAuthorized: () => boolean): Promise<Outcome> {
  const photoHash = createHash('sha256').update(dataUrl).digest('hex');
  const fingerprint = JSON.stringify([singerId, showId, hostEpoch, expectedRevision, photoHash]);
  const existing = photoInFlight.get(commandId);
  if (existing) return existing.fingerprint === fingerprint ? existing.work :
    Promise.resolve({ ok: false, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: state.revision });
  const envelope = { commandId, showId, hostEpoch, expectedRevision, actor: { role: 'singer' as const, id: singerId },
    command: { type: 'photo' as const, photoHash } };
  const preview = applyCommand(state, envelope, settings, Date.now());
  if (!preview.outcome.ok || state.receipts.some(receipt => receipt.id === commandId)) return Promise.resolve(preview.outcome);
  const work = (async (): Promise<Outcome> => {
    try {
      if (shuttingDown || !stillAuthorized()) return { ok: false, code: 'UNAVAILABLE', message: 'Photo sharing is unavailable.', revision: state.revision };
      // A photo earns points only when it is sent to an actual visible display.
      await ensureSingerDisplayReady();
      if (!stillAuthorized() || state.showId !== showId || state.hostEpoch !== hostEpoch)
        return { ok: false, code: 'UNAVAILABLE', message: 'The show is no longer available.', revision: state.revision };
      const ready = applyCommand(state, { ...envelope, expectedRevision: state.revision }, settings, Date.now());
      if (!ready.outcome.ok) return ready.outcome;
      await photoOutput.show(dataUrl);
      if (!stillAuthorized() || state.showId !== showId || state.hostEpoch !== hostEpoch)
        return { ok: false, code: 'UNAVAILABLE', message: 'The show is no longer available.', revision: state.revision };
      const result = applyCommand(state, { ...envelope, expectedRevision: state.revision }, settings, Date.now());
      if (!result.outcome.ok) return result.outcome;
      const receipt = result.state.receipts.find(item => item.id === commandId);
      const originalReceipt = preview.state.receipts.find(item => item.id === commandId);
      if (!receipt || !originalReceipt) throw new Error('Could not record the photo.');
      receipt.fingerprint = originalReceipt.fingerprint;
      store.save(result.state);
      installShowState(result.state);
      try { broadcast(); } catch { /* The photo award is already committed. */ }
      return result.outcome;
    } catch (error) {
      return { ok: false, code: 'PHOTO', message: error instanceof Error ? error.message : 'Could not show the photo.', revision: state.revision };
    }
  })();
  photoInFlight.set(commandId, { fingerprint, work });
  void work.finally(() => photoInFlight.delete(commandId)).catch(() => {});
  return work;
}
function hostPlayPause(): Promise<TransportResult> {
  showAdvance.cancel(); automaticBumper.cancel(); startupBumperPending = false; autoStageSuspended = false;
  const recoveryIntent = outputRecovery ? { ...outputRecovery } : null;
  const playbackIntent = state.playback ? { ...state.playback } : null;
  return hostTransport.run('playPause', async current => {
    if (shuttingDown) return { ok: false, error: 'The application is closing.' };
    if (playbackTimeline.snapshot().seeking) return { ok: false, error: 'Wait for the current seek to finish.' };
    if (playbackIntent?.status === 'playing') {
      if (state.playback?.generationId !== playbackIntent.generationId) return { ok: false, error: 'The active song changed. Review the player and try again.' };
      return state.playback.status === 'paused' ? { ok: true } : executeHostCommand({ type: 'pause' }, true);
    }
    if (state.playback?.status === 'playing') return { ok: true };
    if (!state.playback && !state.stagedRequestId) {
      const staged = await executeHostCommand({ type: 'stage' }, true);
      if (!staged.ok) return staged;
      if (!current()) return { ok: false, error: 'Playback was cancelled.' };
    }
    const generation = state.playback?.generationId ?? null;
    const stagedId = state.stagedRequestId;
    const startIntent = generation ? null : startIntentFence.capture(state, settings, Date.now());
    const policyError = startPolicyError(state, { type: generation ? 'resume' : 'start' }, stagedId, settings);
    if (policyError) return { ok: false, error: policyError };
    await ensureSingerDisplayReady();
    if (!current()) return { ok: false, error: 'Playback was cancelled.' };
    if (generation ? state.playback?.generationId !== generation || state.playback.status !== 'paused' : !startIntentFence.current(state, settings, Date.now(), startIntent))
      return { ok: false, error: 'The selected track changed while opening the player. Review the queue and press Play again.' };
    return executeHostCommand(generation ? { type: 'resume' } : { type: 'start', generationId: randomUUID() }, true, recoveryIntent, undefined, current);
  });
}
function restartCurrentTrack(): Promise<TransportResult> {
  const recoveryIntent = outputRecovery ? { ...outputRecovery } : null;
  return hostTransport.run('restart', async current => {
    if (shuttingDown || playbackTransition || !displayReady || !display || display.isDestroyed()) return { ok: false, error: 'The singer player is not ready. Open it and resume the song before restarting.' };
    const generation = state.playback?.generationId;
    if (!generation) return { ok: false, error: 'There is no active song to restart.' };
    timelineState();
    const result = await playbackTimeline.seek({ generation, position: 0 });
    if (!current()) return { ok: false, error: 'Playback was cancelled.' };
    if (!result.ok) return result;
    if (state.playback?.generationId !== generation) return { ok: false, error: 'The active song changed. Review the player before restarting.' };
    return state.playback.status === 'paused' ? executeHostCommand({ type: 'resume' }, true, recoveryIntent, undefined, current) : { ok: true };
  });
}
function isRecord(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function shortString(x: unknown): x is string { return typeof x === 'string' && x.trim().length > 0 && x.length <= 500; }
function validateCommand(value: unknown): Command | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'setPolicy': {
      const policy = parseHostPolicy(value.policy);
      return policy ? { type: 'setPolicy', policy } : null;
    }
    case 'editVersion':
      return shortString(value.id) && shortString(value.title) && typeof value.artist === 'string' && value.artist.length <= 500 &&
        (value.isDuet === undefined || typeof value.isDuet === 'boolean')
        ? { type: 'editVersion', id: value.id, title: value.title, artist: value.artist, ...(value.isDuet !== undefined ? { isDuet: value.isDuet as boolean } : {}) } : null;
    case 'addSinger':
      return isRecord(value.singer) && shortString(value.singer.id) && shortString(value.singer.name) ? { type: 'addSinger', singer: { id: value.singer.id, name: value.singer.name } } : null;
    case 'removeSinger':
      return shortString(value.singerId) ? { type: 'removeSinger', singerId: value.singerId } : null;
    case 'request':
      return shortString(value.requestId) && (value.singerId === null || shortString(value.singerId)) && shortString(value.versionId) &&
        (value.coSingerId === undefined || value.coSingerId === null || shortString(value.coSingerId))
        ? { type: 'request', requestId: value.requestId, singerId: value.singerId, versionId: value.versionId, ...(value.coSingerId !== undefined ? { coSingerId: value.coSingerId as string | null } : {}) } : null;
    case 'accept': return shortString(value.requestId) ? { type: 'accept', requestId: value.requestId } : null;
    case 'removeRequest': return shortString(value.requestId) ? { type: 'removeRequest', requestId: value.requestId } : null;
    case 'holdSinger': return shortString(value.singerId) ? { type: 'holdSinger', singerId: value.singerId } : null;
    case 'setSingerAvailability': return shortString(value.singerId) && Number.isInteger(value.minutes) && (value.minutes as number) >= 0 && (value.minutes as number) <= 60 && (value.releaseStaged === undefined || typeof value.releaseStaged === 'boolean') ? { type: 'setSingerAvailability', singerId: value.singerId, minutes: value.minutes as number, releaseStaged: value.releaseStaged as boolean | undefined } : null;
    case 'moveRequest': return shortString(value.requestId) && (value.beforeRequestId === null || shortString(value.beforeRequestId)) ? { type: 'moveRequest', requestId: value.requestId, beforeRequestId: value.beforeRequestId } : null;
    case 'editRequest': return shortString(value.requestId) && (value.singerId === null || shortString(value.singerId)) && shortString(value.versionId) &&
      (value.coSingerId === undefined || value.coSingerId === null || shortString(value.coSingerId))
      ? { type: 'editRequest', requestId: value.requestId, singerId: value.singerId, versionId: value.versionId, ...(value.coSingerId !== undefined ? { coSingerId: value.coSingerId as string | null } : {}) } : null;
    case 'resetQueueOrder': return { type: 'resetQueueOrder' };
    case 'promoteRequest': return shortString(value.requestId) ? { type: 'promoteRequest', requestId: value.requestId } : null;
    case 'rejectRequest': return shortString(value.requestId) ? { type: 'rejectRequest', requestId: value.requestId } : null;
    case 'start': return { type: 'start', generationId: randomUUID() };
    case 'skip': return shortString(value.generationId) && value.confirmed === true ? { type: 'skip', generationId: value.generationId, confirmed: true } : null;
    case 'stage': case 'release': case 'pause': case 'resume': case 'stop': return { type: value.type };
    default: return null;
  }
}
function playable(command: Command): string | null {
  if (command.type !== 'start' && command.type !== 'resume') return null;
  if (youtubeAudioGate.playbackBlocked()) return 'Close the YouTube player before starting or resuming karaoke.';
  if (youtubeAudioGate.bumperStartPending()) return 'Wait for bumper music to finish starting before starting karaoke.';
  const remaining = remainingPauseSeconds(state, Date.now());
  if (command.type === 'start' && remaining) return `Wait ${remaining} seconds before starting the next song.`;
  if (!display || display.isDestroyed() || !displayReady) return 'Open the singer display before starting or resuming.';
  const requestId = command.type === 'start' ? state.stagedRequestId : state.playback?.requestId;
  const request = state.requests.find(r => r.id === requestId);
  const streaming = state.versions.find(version => version.id === request?.versionId)?.source;
  const media = request && store.media(request.versionId);
  if (streaming?.provider === 'partytyme' && partyTymeAccount?.status().state !== 'connected') return 'Sign in to Party Tyme in Sources before playing this recording.';
  if (streaming?.provider === 'youtube' && !media) return null;
  if (streaming?.provider === 'youtube' && media && !existsSync(media.path)) return 'The saved video is missing. Right-click the library song and choose Download Video / Retry, or relink the original file.';
  if (!media || streaming && !existsSync(media.path)) return 'The source file is unavailable. Right-click the song in Song Library and choose Relink File.';
  return null;
}
async function executeHostCommand(command: Command, transportOwned = false, observedRecovery?: { generation: string; revision: number } | null, automaticCurrent?: () => boolean, transportCurrent?: () => boolean): Promise<{ ok: boolean; error?: string }> {
  // Invalidate delayed work at the host's intent, including while an async file
  // check is busy, so Stop can never be followed by a late automatic start.
  if (!automaticCurrent && ['pause', 'stop', 'release', 'start', 'resume'].includes(command.type)) { showAdvance.cancel(); automaticBumper.cancel(); startupBumperPending = false; }
  if (['pause', 'stop', 'release'].includes(command.type)) cancelPendingPlayback();
  const intentCurrent = transportCurrent ?? hostTransport.capture();
  const startIntent = command.type === 'start' ? startIntentFence.capture(state, settings, Date.now()) : null;
  const current = () => intentCurrent() && (!automaticCurrent || automaticCurrent()) && (command.type !== 'start' || startIntentFence.current(state, settings, Date.now(), startIntent));
  if ((command.type === 'start' || command.type === 'resume') && !current()) return { ok: false, error: 'Playback was cancelled.' };
  if (command.type === 'stop' && !state.playback) {
    try { await bumper?.stop(); publishBumper(); return { ok: true }; }
    catch { return { ok: false, error: 'Bumper audio did not confirm stopping. Check the audio output.' }; }
  }
  const recoveryAtIntent = observedRecovery === undefined ? command.type === 'resume' && outputRecovery ? { ...outputRecovery } : null : observedRecovery;
  if ((playbackTransition || hostTransport.busy() && !transportOwned) && ['start', 'resume', 'skip', 'stage', 'release'].includes(command.type))
    return { ok: false, error: 'Wait for the current playback transition to finish.' };
  const initialPolicyError = startPolicyError(state, command, undefined, settings);
  if (initialPolicyError) return { ok: false, error: initialPolicyError };
  if (command.type === 'start' || command.type === 'resume') {
    const requestId = command.type === 'start' ? state.stagedRequestId : state.playback?.requestId;
    const version = state.versions.find(item => item.id === state.requests.find(request => request.id === requestId)?.versionId);
    if (version?.source?.provider === 'partytyme' && (!store.media(version.id) || !existsSync(store.media(version.id)!.path))) {
      try { partyTymeHost.retry(version.id); return {ok:false,error:'Preparing this Party Tyme video. Follow progress in Sources, then press Play when ready.'}; }
      catch(error){return{ok:false,error:error instanceof Error?error.message:'Connect Party Tyme in Sources.'};}
    }
    if (version?.source?.provider === 'karafun' && !store.media(version.id)) {
      try { karaFunHost.retry(version.id); return { ok: false, error: 'Preparing this KaraFun recording. Follow progress in Sources, then press Play when ready.' }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Sign in to KaraFun in Sources.' }; }
    }
    if (version?.source?.provider === 'youtube' && !store.media(version.id)) {
      try {
        queuedDownloads.enqueue(version.id,true);
        return { ok: false, error: 'Preparing this video on your drive. Follow download progress, then press Play when ready.' };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not download this video.' }; }
    }
  }
  const initial = playable(command);
  if (initial) return { ok: false, error: initial };
  if (command.type === 'start' || command.type === 'resume') {
    automaticBumper.cancel();
    playbackTransition = true; publishBumper();
    try {
      const requestId = command.type === 'start' ? state.stagedRequestId : state.playback?.requestId;
      const versionId = state.requests.find(item => item.id === requestId)?.versionId;
      const media = versionId && store.media(versionId);
      if (!media) return { ok: false, error: 'The source file is unavailable. Relink the song in Song Library.' };
      const nativeVersion = state.versions.find(version => version.id === versionId)?.source?.provider === 'karafun';
      const nativeRevision = karaFunAccount.revision();
      const pinned = command.type === 'resume' && activeKaraFun?.generation === state.playback?.generationId && activeKaraFun?.versionId === versionId ? activeKaraFun.media : undefined;
      const nativeMedia = nativeVersion ? await karaFunHost.authorizeStart(versionId!, pinned) : null;
      const partyVersion = state.versions.find(version=>version.id===versionId)?.source?.provider === 'partytyme';
      const partyRevision = partyTymeAccount.revision();
      const partyMedia = partyVersion ? await partyTymeHost.authorizeStart(versionId!) : null;
      if (!current()) return { ok: false, error: 'Playback was cancelled.' };
      const check = new AbortController(); mediaChecks.add(check);
      let sourceIdentity: MediaIdentity;
      try {
        if (command.type === 'resume' && state.playback && verifiedPlayback?.generation === state.playback.generationId &&
            verifiedPlayback.id === media.id && verifiedPlayback.path === media.path && verifiedPlayback.fingerprint === media.fingerprint &&
            await mediaIdentityMatches(media.path, verifiedPlayback.identity)) sourceIdentity = verifiedPlayback.identity;
        else {
          const checked = await fingerprintMedia(media.path, check.signal);
          if (checked.fingerprint !== media.fingerprint) return { ok: false, error: 'The song file has changed since import. Relink the original file before playing.' };
          sourceIdentity = checked.identity;
        }
      } catch (error) { return { ok: false, error: current() ? mediaVerificationDetail(error, command.type === 'resume') : 'Playback was cancelled.' }; }
      finally { mediaChecks.delete(check); }
      if (shuttingDown || !await mediaIdentityMatches(media.path, sourceIdentity)) return { ok: false, error: 'The song file changed during verification. Check or relink the original file.' };
      if (!current()) return { ok: false, error: 'Playback was cancelled.' };
      if (state.requests.find(item => item.id === requestId)?.versionId !== versionId) return { ok: false, error: 'The selected recording changed. Review the queue and press Play.' };
      const policyBeforeBumper = startPolicyError(state, command, requestId, settings);
      if (policyBeforeBumper) return { ok: false, error: policyBeforeBumper };
      // A deliberate Play/Resume is also the recovery action after checking the
      // output. Automatic advancement never re-enables a lost device itself.
      if (!automaticCurrent) await bumper?.setOutputAvailable(true);
      if (!current()) return { ok: false, error: 'Playback was cancelled.' };
      await bumper?.karaokeStarting();
      if (shuttingDown) return { ok: false, error: 'The application is closing.' };
      const stillMatches = await mediaIdentityMatches(media.path, sourceIdentity);
      if (shuttingDown) return { ok: false, error: 'The application is closing.' };
      const reason = startPolicyError(state, command, requestId, settings) || playable(command);
      const currentMedia = versionId && store.media(versionId);
      if (reason || !currentMedia || currentMedia.path !== media.path || currentMedia.fingerprint !== media.fingerprint || !stillMatches ||
          state.requests.find(item => item.id === requestId)?.versionId !== versionId || !current()) {
        if (!state.playback) bumper?.karaokeEnded();
        return { ok: false, error: !current() ? 'Playback was cancelled.' : reason || 'The song file changed during verification. Check or relink the original file.' };
      }
      if (command.type === 'resume' && outputRecovery) {
        if (!recoveryAtIntent || recoveryAtIntent.generation !== outputRecovery.generation || recoveryAtIntent.revision !== outputRecovery.revision)
          return { ok: false, error: 'The audio output changed while checking the song. Check the output and press Play again.' };
        display?.webContents.send('display:output-recovery', recoveryAtIntent);
      }
      if (nativeMedia && (nativeRevision !== karaFunAccount.revision() || karaFunAccount.accountScope() !== nativeMedia.accountScope))
        return { ok: false, error: 'The KaraFun account changed. Sign in and press Play again.' };
      const previousNative = activeKaraFun;
      if (partyMedia && (partyRevision !== partyTymeAccount.revision() || partyMedia.accountScope !== partyTymeAccount.accountScope())) return {ok:false,error:'The Party Tyme account changed. Sign in and press Play again.'};
      const previousParty = activePartyTyme;
      if(partyMedia)activePartyTyme={generation:command.type==='start'?command.generationId:state.playback!.generationId,versionId:versionId!,media:partyMedia,revision:partyRevision};
      if (nativeMedia) activeKaraFun = { generation: command.type === 'start' ? command.generationId : state.playback!.generationId,
        versionId: versionId!, media: nativeMedia, revision: nativeRevision };
      const result = perform(command);
      if (!result.ok) activeKaraFun = previousNative;
      if (!result.ok) activePartyTyme = previousParty;
      if (result.ok && state.playback) { verifiedPlayback = { ...media, generation: state.playback.generationId, identity: sourceIdentity }; reportedMediaError = ''; outputRecovery = null; }
      if (!result.ok && !state.playback) bumper?.karaokeEnded();
      return result.ok ? { ok: true } : { ok: false, error: result.message };
    } catch (error) {
      if (!state.playback) bumper?.karaokeEnded();
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally { playbackTransition = false; publishBumper(); }
  }
  const result = perform(command);
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}
async function importFiles(kind: 'files' | 'folder') {
  if (!host || host.isDestroyed() || shuttingDown || !importJob) throw new Error('Import is unavailable.');
  const current = importJob.snapshot();
  if (importPickerOpen || (current && ['scanning', 'hashing', 'cancelling'].includes(current.phase))) throw new Error('An import is already in progress.');
  importPickerOpen = true;
  try {
    const selection = await dialog.showOpenDialog(host, kind === 'folder'
      ? { title: 'Import MP4 folder', properties: ['openDirectory'] }
      : { title: 'Import local MP4 files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (selection.canceled || shuttingDown || !selection.filePaths.length) return null;
    importParsing = { metadataFormat: settings.metadataFormat, metadataTemplates: [...settings.metadataTemplates] };
    return importJob.start(kind, selection.filePaths);
  } finally { importPickerOpen = false; }
}
type PlaybackCertificate = { generation: string; id: string; path: string; fingerprint: string; identity: MediaIdentity };
const pendingMediaCertificates = new Map<string, Promise<PlaybackCertificate>>();
async function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === 'bumper') return bumper ? serveBumper(request, bumper.getState(), [...builtInBumpers, ...(bumperCatalog?.forPlayback() ?? [])]) : new Response(null, { status: 404 });
  if (url.hostname === 'karafun-stem' || url.hostname === 'lyric-backdrop') {
    const native = activeKaraFun, parts = url.pathname.split('/');
    const origin = request.headers.get('origin');
    if (origin && origin !== 'null' && origin !== 'file://') return new Response(null, { status: 403 });
    const source = state.versions.find(version => version.id === native?.versionId)?.source;
    if (request.method !== 'GET' || !native || shuttingDown || native.generation !== state.playback?.generationId ||
        native.revision !== karaFunAccount.revision() || karaFunAccount.status().state !== 'connected' ||
        source?.provider !== 'karafun' || source.catalog !== native.media.source.catalog || source.songId !== native.media.source.songId ||
        parts[1] !== encodeURIComponent(native.generation)) return new Response(null, { status: 404 });
    if (url.hostname === 'karafun-stem') {
      const stem = parts.length === 3 && /^\d+$/.test(parts[2]) ? native.media.kit.stems.find(stem => String(stem.id) === parts[2]) : null;
      if (!stem) return new Response(null, { status: 404 });
      return new Response(stem.data.slice() as BodyInit, { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': String(stem.data.length), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
    }
    const path = parts.length === 2 && lyricBackdropPath(settings, { packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath });
    if (!path) return new Response(null, { status: 404 });
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(path, 'r'); const info = await file.stat();
      if (!info.isFile() || info.size <= 0 || info.size > 512 * 1024 * 1024) return new Response(null, { status: 404 });
      const range = mediaRange(request.headers.get('range'), info.size);
      if (!range) return new Response(null, { status: 416 });
      const { start, end, partial } = range;
      const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      const stream = file.createReadStream({ start, end, autoClose: true }); file = undefined;
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: partial ? 206 : 200, headers });
    } catch { return new Response(null, { status: 404 }); } finally { await file?.close().catch(() => {}); }
  }
  const playback = state.playback;
  if (request.method !== 'GET' || url.hostname !== 'play' || !playback || url.pathname !== `/${encodeURIComponent(playback.generationId)}`) return new Response(null, { status: 404 });
  const song = state.requests.find(r => r.id === playback.requestId);
  if (state.versions.find(version => version.id === song?.versionId)?.source?.provider === 'karafun') return new Response(null, { status: 404 });
  const partySource = state.versions.find(version=>version.id===song?.versionId)?.source?.provider === 'partytyme';
  const partyAuthorized = () => !partySource || !!activePartyTyme && activePartyTyme.generation===playback.generationId && activePartyTyme.versionId===song?.versionId && activePartyTyme.revision===partyTymeAccount.revision() && activePartyTyme.media.accountScope===partyTymeAccount.accountScope() && partyTymeAccount.status().state==='connected';
  if (!partyAuthorized()) return new Response(null,{status:404});
  const media = song && store.media(song.versionId);
  if (!media) return new Response(null, { status: 404 });
  const currentMediaMatches = () => {
    if (shuttingDown || state.playback?.generationId !== playback.generationId || !partyAuthorized()) return false;
    const currentRequest = state.requests.find(item => item.id === state.playback?.requestId);
    const currentMedia = currentRequest?.versionId === media.id && store.media(media.id);
    return !!currentMedia && currentMedia.id === media.id && currentMedia.path === media.path && currentMedia.fingerprint === media.fingerprint;
  };
  let file: Awaited<ReturnType<typeof openVerifiedMediaFile>> | undefined;
  let servingCertificate: PlaybackCertificate | null = null;
  try {
    let certificate = verifiedPlayback;
    if (!certificate || certificate.generation !== playback.generationId || certificate.id !== media.id || certificate.path !== media.path || certificate.fingerprint !== media.fingerprint) {
      // A restored paused generation can open its display before an explicit
      // resume verifies it. Verify once here as well, without starting audio.
      const key = JSON.stringify([playback.generationId, media.id, media.path, media.fingerprint]);
      let pending = pendingMediaCertificates.get(key);
      if (!pending) {
        pending = (async () => {
          const check = new AbortController(); mediaChecks.add(check);
          try {
            const checked = await fingerprintMedia(media.path, check.signal);
            if (checked.fingerprint !== media.fingerprint) throw new VerifiedMediaFileError();
            if (!currentMediaMatches()) throw new Error('The playing track changed.');
            const checkedCertificate = { ...media, generation: playback.generationId, identity: checked.identity };
            verifiedPlayback = checkedCertificate;
            return checkedCertificate;
          } finally { mediaChecks.delete(check); }
        })();
        pendingMediaCertificates.set(key, pending);
      }
      try { certificate = await pending; }
      finally { if (pendingMediaCertificates.get(key) === pending) pendingMediaCertificates.delete(key); }
    }
    servingCertificate = certificate;
    if (!currentMediaMatches()) return new Response(null, { status: 404 });
    file = await openVerifiedMediaFile(media.path, certificate.identity);
    if (!currentMediaMatches()) return new Response(null, { status: 404 });
    const size = certificate.identity.size;
    const range = mediaRange(request.headers.get('range'), size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const { start, end, partial } = range;
    const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store' };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    const stream = file.createReadStream({ start, end, autoClose: true });
    file = undefined; // The stream now owns this exact verified handle.
    try { return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: partial ? 206 : 200, headers }); }
    catch (error) { stream.destroy(); throw error; }
  } catch {
    if (currentMediaMatches()) {
      if (verifiedPlayback === servingCertificate) verifiedPlayback = null;
      try { pauseForOutputLoss(); } catch { /* A faulted authority already requires a restart. */ }
      if (reportedMediaError !== playback.generationId && host && !host.isDestroyed()) {
        reportedMediaError = playback.generationId;
        void dialog.showMessageBox(host, { type: 'warning', message: 'Song source changed or became unavailable',
          detail: 'Playback was paused without advancing the turn. Restore access to the original file and press Play. To relink a moved file, Stop to return the request to the queue, then choose Relink File in Song Library.' }).catch(() => {});
      }
      return new Response(null, { status: 409 });
    }
    return new Response(null, { status: 404 });
  } finally { await file?.close().catch(() => {}); }
}

// Only one process can own the show and audible player at a time.
const selectedUserData = applicationUserData({ appData: app.getPath('appData'), current: app.getPath('userData'), appName: app.getName(),
  packaged: app.isPackaged, explicit: app.commandLine.getSwitchValue('user-data-dir') || undefined });
app.setPath('userData', selectedUserData);
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    const intent = parseLaunchIntent(argv);
    if (intent) { dispatchHostAction(intent === 'keybindings' ? 'keybindings' : 'preferences'); return; }
    showHostWindow();
  });
  // Playback still requires a host Start; the singer window receives no input gesture.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.whenReady().then(async () => {
  app.setName('The Proper Volume Karaoke');
  settingsPath = join(app.getPath('userData'), 'settings.json');
  logoPath = join(app.getPath('userData'), 'singer-display-logo');
  shortcutsPath = join(app.getPath('userData'), 'keybindings.json');
  try { shortcuts = readShortcuts(shortcutsPath); }
  catch (error) { shortcutError = error instanceof Error ? error.message : String(error); shortcuts = DEFAULT_SHORTCUTS; }
  settingsCreated = !existsSync(settingsPath);
  settings = readSettings(settingsPath);
  if (!settings.bannerOnLaunch) settings.bannerEnabled = false;
  const localData = process.platform === 'win32' ? process.env.LOCALAPPDATA : process.env.XDG_DATA_HOME || join(app.getPath('home'), '.local', 'share');
  communityBrowser = new LocalCommunityBrowser(join(localData || app.getPath('userData'), 'ProperKaraokeBooth', 'karaokenerds', 'community.sqlite'));
  sharedCatalog = new SharedCatalogConnection(join(app.getPath('userData'), 'shared-catalog-cache', 'queries.json'));
  logoData = await loadLogo(logoPath);
  store = await Store.openForHost(join(app.getPath('userData'), 'show.sqlite'));
  hostRatings = new HostSongRatings(store, () => {
    const connection = ratingsConnection(), path = ratingConfigFile();
    return {
      lookup: async keys => { const result = await connection.lookup(keys); return path === ratingConfigFile() && connection === activeRatings ? result : { status: 'unavailable' as const }; },
      vote: async (key, value) => { const result = await connection.vote(key, value); return path === ratingConfigFile() && connection === activeRatings ? result : { status: 'unavailable' as const }; },
    };
  });
  installShowState(store.load() ?? createInitialState(randomUUID(), randomUUID()));
  // A restarted host is a new authority; an interrupted performance is never resumed automatically.
  state.hostEpoch = randomUUID();
  if (state.playback) state.playback.status = 'paused';
  store.save(state);
  startIntentFence.observe(state, settings, Date.now());
  karaFunAccount = new KaraFunAccount({ sessionStore: new KaraFunSessionVault(join(app.getPath('userData'), 'karafun-session.bin')) });
  karaFunHost = new KaraFunHost(karaFunAccount, new KaraFunMediaCache(join(app.getPath('userData'), 'karafun-cache')), {
    state: () => state, settings: () => settings, media: id => store.media(id), songSeenBefore: version => store.songSeenBefore(version),
    commit: (next, media = []) => { if (shuttingDown) throw new Error('The application is closing.'); store.save(next, media); installShowState(next); try { broadcast(); } catch { /* Durable success survives a closing view. */ } },
    changed: () => { if (host && !host.isDestroyed() && !shuttingDown) host.webContents.send('host:karafun-preparations', karaFunHost.status()); showAdvance.changed(); },
  });
  karaFunAccount.subscribe(value => {
    if (activeKaraFun) { pauseForOutputLoss(); activeKaraFun = null; publishDisplay(); }
    karaFunHost.accountChanged();
    if (host && !host.isDestroyed() && !shuttingDown) host.webContents.send('host:karafun-account', value);
  });
  partyTymeAccount = new PartyTymeAccount({vault:new KaraFunSessionVault(join(app.getPath('userData'),'partytyme-session.bin'))});
  partyTymeHost = new PartyTymeHost(partyTymeAccount,new PartyTymeMediaCache(join(app.getPath('userData'),'partytyme-cache')),{
    state:()=>state,settings:()=>settings,media:id=>store.media(id),songSeenBefore:version=>store.songSeenBefore(version),
    commit:(next,media=[])=>{if(shuttingDown)throw new Error('The application is closing.');store.save(next,media);installShowState(next);try{broadcast();}catch{}},
    changed:()=>showAdvance.changed(),
  });
  partyTymeAccount.subscribe(value=>{
    if(activePartyTyme){pauseForOutputLoss();activePartyTyme=null;publishDisplay();}
    partyTymeHost.accountChanged();
    if(host&&!host.isDestroyed()&&!shuttingDown)host.webContents.send('host:partytyme-account',value);
  });
  const commitImported = (path: string, fingerprint: string, metadataPath = path, parsing = importParsing ?? settings) => {
    if (shuttingDown) throw new Error('Import is unavailable.');
    if (store.byFingerprint(fingerprint)) return { outcome: 'duplicate' as const };
    const id = randomUUID(), parsed = metadataFromPath(metadataPath, parsing.metadataTemplates, parsing.metadataFormat);
    const { artist, title, djCode, trackNumber, matchedTemplate } = parsed;
    const result = applyCommand(state, { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision,
      actor: { role: 'host', id: 'host' }, command: { type: 'addVersion', version: { id, title, artist, rating: 'unrated',
        ...(djCode ? { djCode } : {}), ...(trackNumber ? { trackNumber } : {}),
        ...(matchedTemplate ? { metadataTemplate: matchedTemplate } : {}), metadataAmbiguous: parsed.ambiguous } } }, settings, Date.now());
    if (!result.outcome.ok) throw new Error('The song metadata could not be added.');
    store.save(result.state, [{ id, path, fingerprint }]);
    installShowState(result.state);
    // A UI notification must not make a successful durable import look failed.
    try { broadcast(); } catch { /* The host can reload the persisted show. */ }
    return { outcome: 'imported' as const, needsReview: parsed.ambiguous };
  };
  importJob = new ImportJob(commitImported, progress => { if (host && !host.isDestroyed() && !shuttingDown) host.webContents.send('host:import-progress', progress); });
  cdgImport = new CdgImport(join(app.getPath('userData'), 'cdg-library'), (path, fingerprint, metadataPath) =>
    commitImported(path, fingerprint, metadataPath.slice(0, -extname(metadataPath).length) + '.mp4', cdgImportParsing ?? settings).outcome);
  try {
    const staticHandler = createSingerStaticHandler(join(__dirname, '../ui'));
    const installCommitted = (committed: ShowState) => { if (shuttingDown) throw new Error('Show is shutting down.'); installShowState(committed); syncQueuedDownloads(); broadcast(); };
    remoteAuthority = new RemoteAuthorityCoordinator(store, () => settings, installCommitted,
      (singerId, commandId, showId, hostEpoch, revision, authorized) => requestApplause({ role: 'singer', id: singerId }, commandId, showId, hostEpoch, revision, authorized),
      requestPhoto);
    internetQueue = new InternetQueueClient({coordinator:remoteAuthority,configurationFile:join(app.getPath('userData'),'remote-queue-connection.json'),
      publish:value=>{mobileRoomBeacon.update(value,settings.boothName,settings.mobileRoomDiscovery);if(host&&!host.isDestroyed())host.webContents.send('host:internet-state',value);},onMissingRequest:publishMissingRequests,writeClipboard:value=>clipboard.writeText(value),
      screenFrame: () => { const frame = singerFrames.current; if (!frame) return null; const image = nativeImage.createFromBuffer(frame.jpeg); if (image.isEmpty()) return null;
        const width = Math.min(960, frame.width); return image.resize({ width, quality: 'good' }).toJPEG(55); },
      fetch:(url,init)=>fetch(url,{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),'X-TPV-Room-Discovery':settings.mobileRoomDiscovery?'yes':'no'}})});
    const provider = createLanHostProvider({ store, settings: () => settings, staticHandler,
      installCommitted, coordinator: remoteAuthority,
      pickFile: async kind => {
        if (!host || host.isDestroyed() || shuttingDown) return null;
        const certificate = kind === 'certificate';
        const result = await dialog.showOpenDialog(host, { title: certificate ? 'Choose TLS certificate' : 'Choose TLS private key',
          properties: ['openFile'], filters: [{ name: certificate ? 'TLS certificate' : 'TLS private key', extensions: certificate ? ['pem', 'crt', 'cer'] : ['pem', 'key'] }] });
        return !result.canceled && !shuttingDown ? result.filePaths[0] ?? null : null;
      } });
    remoteHost = new HostRemoteLifecycle(provider, publishRemoteStatus, publishMissingRequests);
  } catch {
    // A missing or invalid singer build disables remote access without affecting hosting.
    remoteAuthority = null;
    remoteHost = new HostRemoteLifecycle(null, publishRemoteStatus, publishMissingRequests);
  }
  try {
    bumperCatalog = new BumperCatalog(join(app.getPath('userData'), 'bumper-tracks.json'));
    builtInBumpers = builtInBumperTracks(join(app.getPath('userData'), 'bumper-builtins'));
    bumperOutput = new BumperDisplayOutput(request => {
      if (!display || display.isDestroyed() || !displayReady) throw new Error('Open the singer display first.');
      display.webContents.send('display:bumper-command', request);
    }, () => settings.masterVolume, () => settings.audioOutputId, 5000, () => settings.bumperFadeMs);
    bumper = new BumperController(bumperOutput, () => [...builtInBumpers, ...(bumperCatalog?.forPlayback() ?? [])], publishBumper);
  } catch (error) { bumper = null; bumperOutput = null; bumperError = error instanceof Error ? error.message : String(error); }
  protocol.handle('tpv-media', serveMedia);
  ipcMain.handle('host:cdg-status', event => { guardHost(event.sender.id); return cdgImport?.snapshot() ?? null; });
  ipcMain.handle('host:cdg-cancel', (event, id: unknown) => { guardHost(event.sender.id); return typeof id === 'string' && !!cdgImport?.cancel(id); });
  ipcMain.handle('host:cdg-import', async event => {
    guardHost(event.sender.id);
    if (!host || shuttingDown || cdgPickerOpen || cdgImport?.active()) throw new Error('Finish the current karaoke pair import first.');
    cdgPickerOpen = true;
    try {
      const picked = await dialog.showOpenDialog(host, { title: 'Import CD+G, LRC or ZIP', properties: ['openFile'], filters: [{ name: 'Karaoke lyrics, audio and ZIP', extensions: LYRIC_FILE_EXTENSIONS }] });
      if (picked.canceled || !picked.filePaths[0] || shuttingDown) return null;
      const importSettings = structuredClone(settings);
      const backdrop = lyricBackdropPath(importSettings, { packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath });
      if (backdrop) await validateLyricBackdropFile(backdrop);
      if (shuttingDown) return null;
      cdgImportParsing = { metadataFormat: importSettings.metadataFormat, metadataTemplates: importSettings.metadataTemplates };
      return cdgImport!.start(picked.filePaths[0], backdrop);
    } finally { cdgPickerOpen = false; }
  });
  ipcMain.handle('host:backup-show', event => { guardHost(event.sender.id); return showBackup.start(); });
  ipcMain.handle('host:restore-show', event => { guardHost(event.sender.id); return chooseShowRestore(); });
  ipcMain.handle('host:backup-cleanup', event => { guardHost(event.sender.id); return showBackup.retryCleanup(); });
  const reviewableMedia = () => new Set(settings.sourceVisibility.local ? visibleVersions(state, settings).filter(version => !version.source).map(version => version.id) : []);
  ipcMain.handle('host:review-media', async (event, id: unknown) => {
    guardHost(event.sender.id);
    if (shuttingDown || typeof id !== 'string' || id.length !== 36) return { status: 'cancelled' };
    const result = await mediaReview.scan(id, () => {
      const permitted = reviewableMedia();
      return store.mediaLocations().filter(file => permitted.has(file.id));
    });
    if (result.status !== 'completed') return result;
    const permitted = reviewableMedia();
    return { ...result, issues: result.issues.filter(issue => permitted.has(issue.versionId)) };
  });
  ipcMain.handle('host:cancel-media-review', (event, id: unknown) => {
    guardHost(event.sender.id);
    if (typeof id === 'string' && id.length === 36) mediaReview.cancel(id);
  });
  ipcMain.handle('host:get-library-filenames', event => { guardHost(event.sender.id); return store.mediaFilenames(); });
  ipcMain.handle('host:preview-filename-metadata', event => {
    guardHost(event.sender.id);
    return previewMetadata(state.versions, id => store.media(id), settings.metadataTemplates, settings.metadataFormat);
  });
  ipcMain.handle('host:read-embedded-metadata', async (event, versionId: unknown, requestId: unknown): Promise<EmbeddedMetadataResult> => {
    guardHost(event.sender.id);
    if (shuttingDown || typeof versionId !== 'string' || versionId.length > 500 || typeof requestId !== 'string' ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) return { status: 'unsupported' };
    const version = state.versions.find(item => item.id === versionId);
    if (!version || version.source || !isVersionAllowed(state, versionId, settings)) return { status: 'unsupported' };
    const original = store.media(versionId);
    if (!original) return { status: 'unsupported' };
    if (metadataRead) return { status: 'busy' };
    const controller = new AbortController();
    metadataRead = { id: requestId, controller };
    mediaChecks.add(controller);
    try {
      const result = await readEmbeddedMp4(original, [app.getPath('userData')], controller.signal);
      if (controller.signal.aborted || !senderIsHost(event.sender.id)) return { status: 'cancelled' };
      if (result.status !== 'ready') return result;
      const current = store.media(versionId);
      if (!current || current.path !== original.path || current.fingerprint !== original.fingerprint ||
          state.versions.find(item => item.id === versionId)?.source || !isVersionAllowed(state, versionId, settings)) return { status: 'changed' };
      return result;
    } finally { mediaChecks.delete(controller); metadataRead = null; }
  });
  ipcMain.handle('host:cancel-embedded-metadata', (event, requestId: unknown) => {
    guardHost(event.sender.id);
    if (metadataRead && metadataRead.id === requestId) metadataRead.controller.abort();
  });
  singerCapture.start();
  await reconcileSingerScreen();
  ipcMain.handle('host:singer-preview', event => { guardHost(event.sender.id); return previewFrame(); });
  ipcMain.handle('host:singer-screen-status', event => { guardHost(event.sender.id); return singerScreenStatus(); });
  ipcMain.handle('host:singer-screen-retry', async event => { guardHost(event.sender.id); await reconcileSingerScreen(); return singerScreenStatus(); });
  ipcMain.handle('host:singer-screen-copy', (event, url: unknown) => { guardHost(event.sender.id); if (typeof url !== 'string' || !singerScreenStatus().urls.includes(url)) throw new Error('Choose a current singer-screen address.'); clipboard.writeText(url); });
  ipcMain.handle('host:karafun-status', event => { guardHost(event.sender.id); return karaFunAccount.status(); });
  ipcMain.handle('host:partytyme-status',event=>{guardHost(event.sender.id);return partyTymeAccount.status();});
  ipcMain.handle('host:partytyme-connect',async event=>{
    guardHost(event.sender.id);if(shuttingDown||partyTymePickerOpen)throw new Error('Party Tyme connection is busy.');partyTymePickerOpen=true;
    try{
      const options:Electron.OpenDialogOptions={title:'Choose Party Tyme consumer credentials',properties:['openFile'],filters:[{name:'Private credentials',extensions:['json','txt','*']}]};
      const selection=host?await dialog.showOpenDialog(host,options):await dialog.showOpenDialog(options);
      if(selection.canceled||!selection.filePaths[0]||shuttingDown)return partyTymeAccount.status();
      const file=await open(selection.filePaths[0],'r');let raw:string;
      try{const info=await file.stat();if(!info.isFile()||info.size<1||info.size>16384)throw new Error('Choose a supported credentials file.');const bytes=Buffer.alloc(16385);const result=await file.read(bytes,0,bytes.length,0);if(result.bytesRead!==info.size)throw new Error('The credentials file changed. Retry.');raw=bytes.subarray(0,result.bytesRead).toString('utf8');}finally{await file.close();}
      return await partyTymeAccount.connect(partyTymeCredentials(raw));
    }catch(error){throw new Error(error instanceof Error&&error.name==='PartyTymeError'?error.message:'The private Party Tyme credentials file could not be opened.');}finally{partyTymePickerOpen=false;}
  });
  ipcMain.handle('host:partytyme-disconnect',event=>{guardHost(event.sender.id);return partyTymeAccount.disconnect();});
  ipcMain.handle('host:partytyme-search',async(event,query:unknown)=>{guardHost(event.sender.id); const revision=sourceVisibilityRevision; if(!settings.sourceVisibility.partytyme)return {status:'ok',songs:[]}; const result=await partyTymeHost.search(query); return revision===sourceVisibilityRevision && settings.sourceVisibility.partytyme ? result : {status:'ok',songs:[]};});
  ipcMain.handle('host:partytyme-request',(event,input:unknown)=>{guardHost(event.sender.id);if(!settings.sourceVisibility.partytyme)return {ok:false,error:'Party Tyme search is disabled in Sources.'};return partyTymeHost.request(input);});
  ipcMain.handle('host:partytyme-preparations',event=>{guardHost(event.sender.id);return partyTymeHost.status();});
  ipcMain.handle('host:partytyme-retry',(event,id:unknown)=>{guardHost(event.sender.id);if(typeof id!=='string'||id.length>500)throw new Error('Choose a recording.');partyTymeHost.retry(id);});
  ipcMain.handle('host:karafun-mix-status', event => { guardHost(event.sender.id); return karaFunMixer.status(); });
  ipcMain.handle('host:karafun-mix-set', (event, input: unknown) => {
    guardHost(event.sender.id); if (shuttingDown) throw new Error('The application is closing.');
    const result = karaFunMixer.set(input); publishDisplay(); return result;
  });
  ipcMain.handle('host:karafun-connect', event => { guardHost(event.sender.id); if (shuttingDown) throw new Error('The application is closing.'); return karaFunAccount.connect(host ?? undefined); });
  ipcMain.handle('host:karafun-retry-sign-in', event => { guardHost(event.sender.id); if (shuttingDown) throw new Error('The application is closing.'); return karaFunAccount.restore(); });
  ipcMain.handle('host:karafun-disconnect', event => { guardHost(event.sender.id); return karaFunAccount.disconnect(); });
  ipcMain.handle('host:karafun-search', async (event, query: unknown) => { guardHost(event.sender.id); const revision=sourceVisibilityRevision; if(!settings.sourceVisibility.karafun)return {status:'ok',songs:[]}; const result=await karaFunHost.search(query); return revision===sourceVisibilityRevision && settings.sourceVisibility.karafun ? result : {status:'ok',songs:[]}; });
  ipcMain.handle('host:karafun-request', (event, input: unknown) => { guardHost(event.sender.id); if(!settings.sourceVisibility.karafun)return {ok:false,error:'KaraFun search is disabled in Sources.'}; return karaFunHost.request(input); });
  ipcMain.handle('host:karafun-preparations', event => { guardHost(event.sender.id); return karaFunHost.status(); });
  ipcMain.handle('host:karafun-retry', (event, id: unknown) => { guardHost(event.sender.id); if (typeof id !== 'string' || id.length > 500) throw new Error('Choose a recording.'); karaFunHost.retry(id); });
  ipcMain.handle('host:youtube-search', (event, query: unknown) => { guardHost(event.sender.id); if (shuttingDown) return { status: 'unavailable', songs: [] }; return youtubeSearch.search(query); });
  ipcMain.handle('host:youtube-search-cancel', event => { guardHost(event.sender.id); youtubeSearch.cancel(); });
  ipcMain.handle('host:youtube-subscriptions-import', async event => {
    guardHost(event.sender.id); if (!host || shuttingDown) return null;
    const choice = await dialog.showOpenDialog(host, { title: 'Import YouTube subscriptions from Google Takeout', properties: ['openFile'], filters: [{ name: 'Subscriptions CSV or JSON', extensions: ['csv', 'json'] }] });
    if (choice.canceled || !choice.filePaths[0] || shuttingDown) return null;
    const info = await lstat(choice.filePaths[0]);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Choose a subscriptions CSV or JSON file smaller than 2 MiB.');
    return parseYouTubeSubscriptions(await readFile(choice.filePaths[0], 'utf8'));
  });
  ipcMain.handle('host:youtube-search-request', (event, input: unknown) => {
    guardHost(event.sender.id);
    if (!isRecord(input)) return { ok: false, error: 'Choose a current YouTube search result.' };
    if (!settings.sourceVisibility.youtube) return { ok: false, error: 'YouTube search is disabled in Sources.' };
    const song = youtubeSearch.lookup(input.searchId, input.videoId);
    if (!song) return { ok: false, error: 'The YouTube result or channel rules changed. Search again before queueing.' };
    return commitCatalogRequest({ singerId: input.singerId, requestId: input.requestId, track: { youtubeId: song.videoId, title: song.title, artist: song.artist || '' } }, 'youtube');
  });
  ipcMain.handle('host:get-state', event => { guardHost(event.sender.id); refreshAvailabilityDeadline(); return state; });
  ipcMain.handle('host:youtube-download-status', event => { guardHost(event.sender.id); return downloadStatus(); });
  ipcMain.handle('host:youtube-download', async (event, versionId: unknown) => {
    guardHost(event.sender.id);
    if (typeof versionId !== 'string') throw new Error('Choose a YouTube song.');
    if (!state.versions.some(version=>version.id===versionId && version.source?.provider==='youtube') || !isVersionAllowed(state, versionId, settings)) throw new Error('This video is unavailable.');
    if (shuttingDown) throw new Error('The application is closing.');
    if (queuedDownloads.snapshot().activeVersionId === versionId) return youtubeDownloads?.snapshot() ?? null;
    const version = state.versions.find(item => item.id === versionId)!;
    if (version.source?.provider !== 'youtube') throw new Error('Choose a YouTube recording to download.');
    const original = store.media(versionId);
    let retry: ExplicitVideoRetry | undefined;
    if (original && existsSync(original.path)) {
      const check = new AbortController(); mediaChecks.add(check);
      let checked: Awaited<ReturnType<typeof inspectCachedVideo>>;
      try { checked = await inspectCachedVideo(original, check.signal); } finally { mediaChecks.delete(check); }
      const current = state.versions.find(item => item.id === versionId);
      if (shuttingDown || current?.source?.provider !== 'youtube' || current.source.videoId !== version.source.videoId || !isVersionAllowed(state, versionId, settings) ||
          !sameStoredMedia(original, store.media(versionId)) || !cachedVideoIdentityMatches(original.path, checked.identity))
        throw new Error('The song or saved video changed while checking it. Review the selection and retry.');
      if (checked.valid) return null;
      if (state.requests.find(request => request.id === state.playback?.requestId)?.versionId === versionId)
        throw new Error('Stop this performance first, then Retry and Play. Your request stays in the queue.');
      if (queuedDownloads.snapshot().activeVersionId === versionId) return youtubeDownloads?.snapshot() ?? null;
      retry = { videoId: version.source!.videoId, media: original, identity: checked.identity };
    }
    const queue = queuedDownloads.snapshot(), live = new Set([...queue.pendingVersionIds, ...(queue.activeVersionId ? [queue.activeVersionId] : [])]);
    for (const id of explicitVideoRetries.keys()) if (!live.has(id)) explicitVideoRetries.delete(id);
    if (retry) explicitVideoRetries.set(versionId, retry); else explicitVideoRetries.delete(versionId);
    try { queuedDownloads.enqueue(versionId,true); } catch (error) { explicitVideoRetries.delete(versionId); throw error; }
    return youtubeDownloads?.snapshot() ?? null;
  });
  ipcMain.handle('host:youtube-download-cancel', (event, id: unknown) => {
    guardHost(event.sender.id); return typeof id === 'string' && (!!youtubeDownloads?.cancel(id) || queuedDownloads.cancelPending(id));
  });
  ipcMain.handle('host:choose-video-cache', async event => {
    guardHost(event.sender.id);
    if (!host || shuttingDown) return null;
    const selection = await dialog.showOpenDialog(host, { title: 'Choose permanent video download folder', properties: ['openDirectory', 'createDirectory'] });
    return selection.canceled || shuttingDown ? null : selection.filePaths[0] ?? null;
  });
  ipcMain.handle('host:reveal-video-cache', async event => {
    guardHost(event.sender.id);
    const directory = videoCacheDirectory();
    if (!existsSync(directory)) throw new Error('Download a video first, or choose an existing cache folder in Preferences.');
    const error = await shell.openPath(directory); if (error) throw new Error('The download folder could not be opened.');
  });
  ipcMain.handle('host:get-collections', event => { guardHost(event.sender.id); return store.collections.snapshot(); });
  ipcMain.handle('host:export-playlist', (event, id: unknown) => { guardHost(event.sender.id); return playlistTransfer.export(id); });
  ipcMain.handle('host:preview-playlist', event => { guardHost(event.sender.id); return playlistTransfer.preview(); });
  ipcMain.handle('host:discard-playlist-preview', (event, token: unknown) => { guardHost(event.sender.id); playlistTransfer.discard(token); });
  ipcMain.handle('host:apply-playlist', (event, token: unknown, destination: unknown) => {
    guardHost(event.sender.id);
    return shuttingDown || restorePending || restoreRequest ? { status: 'busy' } : playlistTransfer.apply(token, destination);
  });
  ipcMain.handle('host:playlist-export-cleanup', event => { guardHost(event.sender.id); return playlistTransfer.retryCleanup(); });
  ipcMain.handle('host:export-history', (event, filter: unknown) => { guardHost(event.sender.id); return historyExport.start(filter); });
  ipcMain.handle('host:history-export-status', event => { guardHost(event.sender.id); return historyExport.status(); });
  ipcMain.handle('host:history-export-cleanup', event => { guardHost(event.sender.id); return historyExport.retryCleanup(); });
  ipcMain.handle('host:reveal-media', (event, versionId: unknown) => {
    guardHost(event.sender.id);
    if (typeof versionId !== 'string' || !isVersionAllowed(state, versionId, settings)) throw new Error('Song unavailable.');
    const media = store.media(versionId);
    if (!media || !existsSync(media.path)) throw new Error('The source file is unavailable.');
    shell.showItemInFolder(media.path);
  });
  ipcMain.handle('host:relink-media', async (event, versionId: unknown) => {
    guardHost(event.sender.id);
    if (typeof versionId !== 'string' || !isVersionAllowed(state, versionId, settings)) throw new Error('Song unavailable.');
    if (!host || host.isDestroyed() || relinking || playbackTransition) throw new Error('Finish the current playback or file operation first.');
    const activeVersion = () => state.requests.find(item => item.id === state.playback?.requestId)?.versionId;
    if (activeVersion() === versionId) throw new Error('Stop the active performance before relinking this song.');
    const original = store.media(versionId);
    if (!original) throw new Error('This song has no source file to relink.');
    relinking = true;
    try {
      const selection = await dialog.showOpenDialog(host, { title: 'Relink original video file', properties: ['openFile'], filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
      if (selection.canceled || !selection.filePaths[0]) return { ok: true, cancelled: true };
      const path = selection.filePaths[0];
      if (extname(path).toLowerCase() !== '.mp4') throw new Error('Choose the original MP4 video file.');
      const check = new AbortController(); mediaChecks.add(check);
      try {
        await verifyAndRelinkMedia(path, original.fingerprint, check.signal,
          () => !shuttingDown && !playbackTransition && activeVersion() !== versionId && isVersionAllowed(state, versionId, settings),
          () => store.relinkMedia(original, path));
      }
      finally { mediaChecks.delete(check); }
      return { ok: true };
    } finally { relinking = false; }
  });
  ipcMain.handle('host:mutate-collections', (event, action: unknown) => {
    guardHost(event.sender.id);
    store.collections.mutate(action, state.singers, visibleVersions(state));
    return store.collections.snapshot();
  });
  ipcMain.handle('host:get-shortcuts', event => { guardHost(event.sender.id); return { shortcuts, path: shortcutsPath, error: shortcutError }; });
  ipcMain.handle('host:refresh-menu', event => { guardHost(event.sender.id); lastMenuSignature = ''; publishSettings(); });
  ipcMain.handle('host:menu-context', (event, value: unknown) => {
    guardHost(event.sender.id);
    if (!isRecord(value) || !workspaceMenuContextKeys.every(key => typeof value[key] === 'boolean')) throw new Error('Invalid menu context.');
    workspaceMenuContext = Object.fromEntries(workspaceMenuContextKeys.map(key => [key, value[key]])) as WorkspaceMenuContext;
    refreshApplicationMenu();
  });
  let cliInstallInProgress = false;
  ipcMain.handle('host:install-control-cli', async event => {
    guardHost(event.sender.id);
    if (shuttingDown || cliInstallInProgress) throw new Error('CLI installation is unavailable right now.');
    cliInstallInProgress = true;
    try {
      let shellName = process.env.SHELL ?? '';
      if (!shellName && process.platform !== 'win32') { try { shellName = userInfo().shell ?? ''; } catch { /* Show manual PATH instructions. */ } }
      return await installControlCli({ platform: process.platform, packaged: app.isPackaged, executable: app.getPath('exe'),
        resources: process.resourcesPath, home: app.getPath('home'), shell: shellName, appImage: process.env.APPIMAGE });
    } finally { cliInstallInProgress = false; }
  });
  ipcMain.handle('host:control-status', event => { guardHost(event.sender.id); return localControlStatus(); });
  ipcMain.handle('host:show-control-cli', event => {
    guardHost(event.sender.id);
    const path = app.isPackaged ? process.platform === 'darwin' ? join(process.resourcesPath, 'control', 'tpv-karaoke') : join(dirname(app.getPath('exe')), process.platform === 'win32' ? 'tpv-karaoke.cmd' : 'tpv-karaoke') : join(app.getAppPath(), 'dist/control/cli.cjs');
    if (!existsSync(path)) throw new Error('Build or install the current CLI first.');
    shell.showItemInFolder(path);
  });
  ipcMain.handle('host:ui-ready', event => {
    guardHost(event.sender.id); hostActionsReady = true;
    const actions = pendingHostActions; pendingHostActions = [];
    for (const action of actions) host?.webContents.send('host:app-action', action);
  });
  ipcMain.handle('host:save-shortcuts', (event, value: unknown) => {
    guardHost(event.sender.id);
    shortcuts = writeShortcuts(shortcutsPath, value); shortcutError = '';
    host?.webContents.send('host:shortcuts', shortcuts); publishDisplay();
    return shortcuts;
  });
  ipcMain.handle('host:edit-shortcuts-file', async event => {
    guardHost(event.sender.id);
    const error = await shell.openPath(shortcutsPath);
    if (error) throw new Error('Could not open keybindings.json in your default editor. Use Configuration Files to show it in the file manager.');
  });
  ipcMain.handle('host:get-missing-song-reviews', event => { guardHost(event.sender.id); return store.missingSongReviews(); });
  ipcMain.handle('host:set-missing-song-status', (event, id: unknown, expected: unknown, next: unknown) => {
    guardHost(event.sender.id);
    if (typeof id !== 'string' || !isMissingSongStatus(expected) || !isMissingSongStatus(next)) throw new Error('Invalid missing-song review.');
    const changed = store.setMissingSongStatus(id, expected, next); if (changed) publishMissingRequests(); return changed;
  });
  ipcMain.handle('host:get-missing-song-requests', event => { guardHost(event.sender.id); return store.missingSongRequests(); });
  ipcMain.handle('host:add-missing-song-request', (event, input: unknown) => {
    guardHost(event.sender.id);
    const request = normalizeMissingRequest(input);
    if (!request) return { ok: false, error: 'Enter a singer and song title within the length limits.' };
    store.addMissingSongRequest({ ...request, id: randomUUID(), createdAt: new Date().toISOString() });
    publishMissingRequests();
    return { ok: true };
  });
  ipcMain.handle('host:app-version', event => { guardHost(event.sender.id); return app.getVersion(); });
  ipcMain.handle('host:khost-status', event => { guardHost(event.sender.id); return khostBridge.status(); });
  ipcMain.handle('host:khost-search', (event, query: unknown) => { guardHost(event.sender.id); return shuttingDown || !settings.sourceVisibility.karafun ? { status: 'unavailable' } : khostBridge.search(query); });
  ipcMain.handle('host:khost-search-cancel', event => { guardHost(event.sender.id); khostBridge.cancelSearch(); });
  ipcMain.handle('host:khost-handoff', (event, value: unknown) => { guardHost(event.sender.id); return shuttingDown || !settings.sourceVisibility.karafun ? { status: 'unavailable' } : khostBridge.handoff(value); });
  ipcMain.handle('host:khost-handoff-status', (event, value: unknown) => { guardHost(event.sender.id); return khostBridge.handoffStatus(value); });
  ipcMain.handle('host:khost-handoff-acknowledge', async (event, value: unknown) => {
    guardHost(event.sender.id);
    if (!khostBridge.acknowledgeHandoff(value)) throw new Error('Wait for the handoff request to return before clearing its warning.');
    return khostBridge.status();
  });
  ipcMain.handle('host:khost-choose-profile', async event => {
    guardHost(event.sender.id);
    if (!host || shuttingDown || choosingKHostProfile) return khostBridge.status();
    choosingKHostProfile = true;
    try {
      const chosen = await dialog.showOpenDialog(host, { title: 'Choose Private TPV KHost Bridge Connection',
        properties: ['openFile'], filters: [{ name: 'Private Bridge JSON', extensions: ['json'] }] });
      if (!chosen.canceled && chosen.filePaths[0] && !shuttingDown) {
        await readKHostBridgeProfile(chosen.filePaths[0]);
        await settingsUpdates.run(() => {
          settings = writeSettings(settingsPath, { ...settings, khostBridgeConfigFile: chosen.filePaths[0] });
          khostBridge.invalidate(); settingsCreated = false; publishSettings();
        });
      }
      return khostBridge.status();
    } finally { choosingKHostProfile = false; }
  });
  ipcMain.handle('host:khost-clear-profile', async event => {
    guardHost(event.sender.id);
    await settingsUpdates.run(() => {
      settings = writeSettings(settingsPath, { ...settings, khostBridgeConfigFile: '' });
      khostBridge.invalidate(); settingsCreated = false; publishSettings();
    });
    return khostBridge.status();
  });
  ipcMain.handle('host:provider-catalog-status', event => { guardHost(event.sender.id); return providerCatalog.status(); });
  ipcMain.handle('host:provider-catalog-search', (event, query: unknown) => { guardHost(event.sender.id); return providerCatalog.search(query); });
  ipcMain.handle('host:provider-catalog-open', async (event, input: unknown) => {
    guardHost(event.sender.id);
    if (!input || typeof input !== 'object' || !isProviderCatalogId((input as any).provider) || typeof (input as any).id !== 'string') throw new Error('Choose a current provider search result.');
    const value = providerCatalog.url((input as any).provider, (input as any).id);
    if (!value) throw new Error('Search again to open an available official provider page.');
    await shell.openExternal(value);
  });
  ipcMain.handle('host:provider-catalog-choose-profile', async (event, provider: unknown) => {
    guardHost(event.sender.id);
    if (!isProviderCatalogId(provider) || (provider !== 'sunfly' && provider !== 'stingray')) throw new Error('Public catalogs do not need a credential file.');
    if (!host || shuttingDown || choosingProviderProfile) return providerCatalog.status();
    choosingProviderProfile = true;
    try {
      const chosen = await dialog.showOpenDialog(host, { title: `Choose Private ${provider === 'stingray' ? 'Stingray Developer JSON' : 'Sunfly Access Key'} Profile`, properties: ['openFile'] });
      if (!chosen.canceled && chosen.filePaths[0] && !shuttingDown) await settingsUpdates.run(() => {
        settings = writeSettings(settingsPath, { ...settings, providerCatalogProfiles: { ...settings.providerCatalogProfiles, [provider]: chosen.filePaths[0] } });
        host?.webContents.send('host:settings', settings);
      });
      return providerCatalog.status();
    } finally { choosingProviderProfile = false; }
  });
  ipcMain.handle('host:provider-catalog-clear-profile', async (event, provider: unknown) => {
    guardHost(event.sender.id);
    if (!isProviderCatalogId(provider)) throw new Error('Choose a provider.');
    await settingsUpdates.run(() => {
      settings = writeSettings(settingsPath, { ...settings, providerCatalogProfiles: { ...settings.providerCatalogProfiles, [provider]: '' } });
      host?.webContents.send('host:settings', settings);
    });
    return providerCatalog.status();
  });
  ipcMain.handle('host:choose-catalog-config', async event => {
    guardHost(event.sender.id); if (!host || shuttingDown) return null;
    const selected = await dialog.showOpenDialog(host, {title:'Choose private shared catalog configuration',properties:['openFile'],filters:[{name:'Catalog client configuration',extensions:['json']}]});
    return selected.canceled || shuttingDown ? null : selected.filePaths[0] ?? null;
  });
  ipcMain.handle('host:catalog-status', async (event, path: unknown) => {
    guardHost(event.sender.id); if (!sharedCatalog || shuttingDown) return {status:'unavailable'};
    if (path !== undefined && (typeof path !== 'string' || path.length > 4096)) return {status:'configuration-error'};
    const requested = typeof path === 'string' ? path || join(app.getPath('userData'), 'catalog-connection.json') : catalogConfigFile();
    const defaultRequested = path === '' || path === undefined && !settings.sharedCatalogConfigFile;
    if (defaultRequested && !existsSync(requested)) return sharedCatalog.publicStatus(!settings.sharedCatalogConfigFile);
    return sharedCatalog.status(requested, requested === catalogConfigFile());
  });
  ipcMain.handle('host:get-settings', event => { guardHost(event.sender.id); return { settings, path: settingsPath, created: settingsCreated }; });
  ipcMain.handle('host:rating-keys', (event, ids: unknown) => {
    guardHost(event.sender.id);
    if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== 'string' || id.length > 500)) throw new Error('Choose a bounded list of library recordings.');
    const keys: Record<string, RecordingKey> = {};
    for (const id of ids) {
      const version = state.versions.find(item => item.id === id);
      if (!version) continue;
      const key = recordingKeyFor(version.source, store.media(id)?.fingerprint);
      if (key) keys[id] = key;
    }
    return keys;
  });
  ipcMain.handle('host:rating-lookup', (event, keys: unknown) => { guardHost(event.sender.id); return hostRatings.lookup(keys); });
  ipcMain.handle('host:rating-vote', (event, key: unknown, value: unknown) => { guardHost(event.sender.id); return hostRatings.vote(key, value); });
  ipcMain.handle('host:rating-choose-profile', async event => {
    guardHost(event.sender.id); if (!host || shuttingDown) return null;
    const selected = await dialog.showOpenDialog(host, { title: 'Choose Private Rating Profile', properties: ['openFile'], filters: [{ name: 'Rating Profile JSON', extensions: ['json'] }] });
    return selected.canceled || shuttingDown ? null : selected.filePaths[0] ?? null;
  });
  ipcMain.handle('host:rating-profile-status', async (event, file: unknown) => {
    guardHost(event.sender.id);
    if (file !== undefined && (typeof file !== 'string' || file.length > 4096)) return { status: 'configuration-error' };
    const requested = typeof file === 'string' && file ? file : join(app.getPath('userData'), 'rating-connection.json');
    return new SongRatingsConnection(requested, { requireConfig: typeof file === 'string' && !!file }).lookup([]);
  });
  ipcMain.handle('host:choose-lyric-backdrop', async event => {
    guardHost(event.sender.id);
    if (!host || shuttingDown) return null;
    const picked = await dialog.showOpenDialog(host, { title: 'Choose Lyric Backdrop Video', properties: ['openFile'], filters: [{ name: 'MP4 Video', extensions: ['mp4'] }] });
    if (picked.canceled || !picked.filePaths[0] || shuttingDown) return null;
    await validateLyricBackdropFile(picked.filePaths[0]);
    return picked.filePaths[0];
  });
  ipcMain.handle('host:karaokenerds-search', async (event, query: unknown): Promise<LocalCatalogResult> => {
    guardHost(event.sender.id);
    const revision = sourceVisibilityRevision;
    if (!settings.sourceVisibility.karaokenerds) return { status: 'ready', tracks: [], limited: false, lastSuccess: null };
    const config = catalogConfigFile();
    if (settings.sharedCatalogEnabled && settings.sharedCatalogConfigFile && !existsSync(config)) return {status:'configuration-error',tracks:[],limited:false,lastSuccess:null};
    if (settings.sharedCatalogEnabled && existsSync(config) && sharedCatalog) {
      const result = await sharedCatalog.search(config, query);
      if (shuttingDown || revision !== sourceVisibilityRevision || !settings.sourceVisibility.karaokenerds || !settings.sharedCatalogEnabled || config !== catalogConfigFile()) return {status:'unavailable',tracks:[],limited:false,lastSuccess:null};
      return filteredCatalogResult(result);
    }
    if (settings.sharedCatalogEnabled && sharedCatalog && !settings.sharedCatalogConfigFile) {
      const result = await sharedCatalog.publicSearch(query);
      if (shuttingDown || revision !== sourceVisibilityRevision || !settings.sourceVisibility.karaokenerds || !settings.sharedCatalogEnabled || settings.sharedCatalogConfigFile || existsSync(catalogConfigFile())) return { status: 'unavailable', tracks: [], limited: false, lastSuccess: null };
      return filteredCatalogResult(result);
    }
    if (!communityBrowser) throw new Error('Catalog unavailable.');
    const local = communityBrowser.search(query); return filteredCatalogResult(local);
  });
  ipcMain.handle('host:request-catalog-track', (event, input: unknown) => { guardHost(event.sender.id); if (!settings.sourceVisibility.karaokenerds) return { ok: false, error: 'Karaoke Nerds search is disabled in Sources.' }; return commitCatalogRequest(input); });
  ipcMain.handle('host:add-youtube', async (event, input: unknown) => {
    guardHost(event.sender.id);
    if (shuttingDown || !isRecord(input) || !shortString(input.title) || typeof input.artist !== 'string' || input.artist.length > 500) return { ok: false, error: 'Enter a song title and optional artist.' };
    if (input.discoveryOrigin !== undefined && input.discoveryOrigin !== 'karaokenerds') return { ok: false, error: 'Invalid discovery source.' };
    if (input.discoveryOrigin === 'karaokenerds' && !settings.sourceVisibility.karaokenerds) return { ok: false, error: 'Karaoke Nerds search is disabled in Sources.' };
    if (compileSongBlacklist(settings).isBlocked({ title: input.title, artist: input.artist })) return { ok: false, error: 'This song or artist is blacklisted in Preferences.' };
    const videoId = youtubeIdentity(input.url);
    if (!videoId) return { ok: false, error: 'Enter a valid YouTube video link or ID.' };
    const existing = state.versions.find(version => version.source?.provider === 'youtube' && version.source.videoId === videoId);
    const brandSlug = typeof input.brandSlug === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(input.brandSlug) ? input.brandSlug : undefined;
    if (existing) return isVersionAllowed(state, existing.id, settings) ? {ok:true,versionId:existing.id,notice:'Already in your library. Video downloads when queued.'} : {ok:false,error:'This recording is unavailable under the current show policy.'};
    const id = randomUUID();
    const result = perform({ type: 'addVersion', version: { id, title: input.title.trim(), artist: input.artist.trim(), rating: 'unrated', source: { provider: 'youtube', videoId, ...(brandSlug ? {brandSlug} : {}) }, ...(input.discoveryOrigin === 'karaokenerds' ? { discoveryOrigin: 'karaokenerds' as const } : {}) } });
    if (!result.ok) return { ok: false, error: result.message };
    return {ok:true,versionId:id,notice:'Added to your library. Video downloads when queued, or choose Download Video to save it now.'};
  });
  ipcMain.handle('host:karaokenerds-open-video', async (event, id: unknown) => {
    guardHost(event.sender.id);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id)) return { ok: false, error: 'Invalid YouTube video.' };
    if (!youtubeAudioGate.canOpenPreview({ playbackActive: !!state.playback, playbackTransition, bumperActive: !!bumper && bumper.getState().status !== 'stopped' }))
      return { ok: false, error: 'Stop karaoke and bumper music before opening the YouTube player.' };
    try { await openYouTubePlayer(id); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not open the YouTube player.' }; }
  });
  ipcMain.handle('host:remote-status', event => { guardHost(event.sender.id); return remoteHost.status(); });
  ipcMain.handle('host:internet-status', event => {guardHost(event.sender.id);return internetQueue?.status() ?? {available:false,state:'failed',suggestedSlug:'proper-volume',slug:null,joinUrl:null,guests:[],message:'Internet sessions are unavailable. Reopen the app after checking its installation.'};});
  ipcMain.handle('host:internet-start', async(event,input:unknown)=>{guardHost(event.sender.id);if(shuttingDown||!internetQueue)throw new Error('Internet sessions are unavailable.');await internetQueue.start(input);});
  ipcMain.handle('host:internet-stop', async event=>{guardHost(event.sender.id);await internetQueue?.stop();});
  ipcMain.handle('host:internet-screen-start', async event=>{guardHost(event.sender.id);if(shuttingDown||!internetQueue)throw new Error('Internet sessions are unavailable.');await internetQueue.startScreen();});
  ipcMain.handle('host:internet-screen-stop', async event=>{guardHost(event.sender.id);await internetQueue?.stopScreen();});
  ipcMain.handle('host:internet-screen-copy', event=>{guardHost(event.sender.id);if(!internetQueue)throw new Error('Internet sessions are unavailable.');internetQueue.copyScreenLink();});
  ipcMain.handle('host:internet-copy', event=>{guardHost(event.sender.id);internetQueue?.copyLink();});
  ipcMain.handle('host:internet-revoke', (event,id:unknown)=>{guardHost(event.sender.id);if(typeof id!=='string'||id.length>500)throw new Error('Choose a singer.');internetQueue?.revokeGuest(id);});
  ipcMain.handle('host:remote-choose-certificate', event => { guardHost(event.sender.id); return remoteHost.select('certificate'); });
  ipcMain.handle('host:remote-choose-key', event => { guardHost(event.sender.id); return remoteHost.select('privateKey'); });
  ipcMain.handle('host:remote-open-lan', (event, input: unknown) => { guardHost(event.sender.id); return remoteHost.open(input); });
  ipcMain.handle('host:remote-close', event => { guardHost(event.sender.id); return remoteHost.close(); });
  ipcMain.handle('host:remote-invite', (event, ttl: unknown) => { guardHost(event.sender.id); return remoteHost.createInvitation(ttl); });
  ipcMain.handle('host:remote-revoke-invites', event => { guardHost(event.sender.id); return remoteHost.revokeInvitations(); });
  ipcMain.handle('host:remote-revoke-guest', (event, singerId: unknown) => { guardHost(event.sender.id); return remoteHost.revokeGuest(singerId); });
  ipcMain.handle('host:save-settings', async (event, value: unknown) => {
    guardHost(event.sender.id);
    return settingsUpdates.run(async () => {
      const proposed = applySettingsPatch(settings, value);
      if (proposed.lyricBackdrop === 'custom' && (settings.lyricBackdrop !== 'custom' || proposed.lyricBackdropFile !== settings.lyricBackdropFile))
        await validateLyricBackdropFile(proposed.lyricBackdropFile);
      const changingOutput = proposed.audioOutputId !== settings.audioOutputId;
      const disablingAutomaticBumper=settings.autoBumper && !proposed.autoBumper;
      if(changingOutput || proposed.autoBumper !== settings.autoBumper || proposed.autoBumperTrackId !== settings.autoBumperTrackId) automaticBumper.cancel();
      if (changingOutput || !proposed.autoAdvance) showAdvance.cancel();
      if (changingOutput && playbackTransition) throw new Error('Wait for the current playback transition.');
      if (changingOutput) { playbackTransition = true; publishBumper(); }
      try {
        if (changingOutput) { await bumper?.setOutputAvailable(false); pauseForOutputLoss(); }
        const ratingProfileChanged = settings.ratingProfileConfigFile !== proposed.ratingProfileConfigFile;
        const khostSettingsChanged = (['khostBridgeConfigFile', 'songBlacklist', 'artistBlacklist'] as const).some(key => JSON.stringify(settings[key]) !== JSON.stringify(proposed[key]));
        const youtubeSettingsChanged = (['youtubeSearchEnabled', 'youtubeSearchMode', 'youtubeApprovedChannels', 'youtubeBlockedChannels', 'songBlacklist', 'artistBlacklist', 'ytDlpExecutable'] as const).some(key => JSON.stringify(settings[key]) !== JSON.stringify(proposed[key]));
        const sourceVisibilityChanged = JSON.stringify(settings.sourceVisibility) !== JSON.stringify(proposed.sourceVisibility);
        settings = sourceVisibilityChanged
          ? saveWithDiscoveryRevision(state, next => store.save(next), next => { installShowState(next); },
            () => writeSettings(settingsPath, proposed), () => broadcast())
          : writeSettings(settingsPath, proposed);
        if (sourceVisibilityChanged) {
          sourceVisibilityRevision++; youtubeSearch.cancel(); karaFunHost.invalidateSearch(); partyTymeHost.invalidateSearch(); khostBridge.cancelSearch();
        }
        if (khostSettingsChanged) khostBridge.invalidate();
        if (ratingProfileChanged) { activeRatings = null; activeRatingPath = ''; }
        if(disablingAutomaticBumper && bumper?.getState().status !== 'stopped') await bumper?.stop();
        settingsCreated = false;
        publishSettings();
        if (changingOutput && displayReady) await bumper?.setOutputAvailable(true);
        broadcast();
        if (youtubeSettingsChanged) youtubeSearch.cancel();
        await reconcileSingerScreen();
        if (internetQueue) mobileRoomBeacon.update(internetQueue.status(),settings.boothName,settings.mobileRoomDiscovery);
        await reconcileLocalControl();
        return settings;
      } finally { if (changingOutput) { playbackTransition = false; publishBumper(); } }
    });
  });
  ipcMain.handle('host:cycle-accent-color', event => {
    guardHost(event.sender.id);
    return settingsUpdates.run(() => {
      settings = writeSettings(settingsPath, { ...settings, accentColor: nextAccentColor(settings.accentColor) });
      settingsCreated = false;
      publishSettings();
      return settings.accentColor;
    });
  });
  ipcMain.handle('host:reveal-config-file', (event, kind: unknown) => {
    guardHost(event.sender.id);
    if (kind !== 'settings' && kind !== 'shortcuts') throw new Error('Invalid configuration file.');
    const path = kind === 'settings' ? settingsPath : shortcutsPath;
    if (!existsSync(path)) throw new Error('Configuration file is unavailable.');
    shell.showItemInFolder(path);
  });
  ipcMain.handle('host:choose-display-logo', async event => {
    guardHost(event.sender.id);
    if (!host || choosingLogo) return false;
    choosingLogo = true;
    try {
      const result = await dialog.showOpenDialog(host, { title: 'Choose singer display logo', properties: ['openFile'], filters: [{ name: 'PNG or JPEG image', extensions: ['png', 'jpg', 'jpeg'] }] });
      if (result.canceled || !result.filePaths[0]) return false;
      logoData = await saveLogo(result.filePaths[0], logoPath);
      publishDisplay();
      if (host && !host.isDestroyed()) host.webContents.send('host:display-logo', logoData);
      return true;
    } finally { choosingLogo = false; }
  });
  ipcMain.handle('host:get-display-logo', event => { guardHost(event.sender.id); return logoData; });
  ipcMain.handle('host:clear-display-logo', async event => {
    guardHost(event.sender.id);
    if (choosingLogo) throw new Error('Finish choosing a logo first.');
    try { await unlink(logoPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    logoData = null;
    publishDisplay();
    if (host && !host.isDestroyed()) host.webContents.send('host:display-logo', logoData);
  });
  ipcMain.handle('host:toggle-host-fullscreen', event => { guardHost(event.sender.id); hostFullscreen?.toggle(); });
  ipcMain.handle('host:toggle-display-fullscreen', event => {
    guardHost(event.sender.id);
    if (!display || display.isDestroyed() || !displayFullscreen) throw new Error('Open the singer display first.');
    displayFullscreen.toggle();
  });
  ipcMain.handle('host:open-display', async event => { guardHost(event.sender.id); await createDisplay(); });
  ipcMain.handle('host:play-pause', event => { guardHost(event.sender.id); return hostPlayPause(); });
  ipcMain.handle('host:restart-track', event => { guardHost(event.sender.id); return restartCurrentTrack(); });
  ipcMain.handle('host:get-bumpers', event => { guardHost(event.sender.id); return bumperInfo(); });
  ipcMain.handle('host:add-bumpers', async event => {
    guardHost(event.sender.id);
    if (!host || !bumper || !bumperCatalog) throw new Error(bumperError || 'Bumper music is unavailable.');
    const selection = await dialog.showOpenDialog(host, { title: 'Choose bumper music', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'ogg'] }] });
    if (selection.canceled) return bumperInfo();
    const errors: string[] = [];
    for (const path of selection.filePaths) { try { bumperCatalog.addSelectedFile(path); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); } }
    publishBumper();
    if (errors.length) throw new Error(`Some files could not be added: ${errors.join(' ')}`);
    return bumperInfo();
  });
  ipcMain.handle('host:remove-bumper', async (event, id: unknown) => {
    guardHost(event.sender.id);
    if (!bumper || !bumperCatalog || typeof id !== 'string') throw new Error('Bumper music is unavailable.');
    await bumper.removeTrack(id, () => bumperCatalog!.remove(id)); publishBumper(); return bumperInfo();
  });
  ipcMain.handle('host:start-bumper', async (event, id: unknown) => {
    guardHost(event.sender.id);
    if (!bumper || typeof id !== 'string' || state.playback || playbackTransition) throw new Error('Bumper music is unavailable while a song or the YouTube player is active.');
    await ensureSingerDisplayReady(false);
    return youtubeAudioGate.startBumper(async () => {
      bumperError = '';
      await bumper!.setOutputAvailable(true);
      if (!await bumper!.start(id)) throw new Error('Could not start bumper music.');
      publishBumper(); return bumperInfo();
    });
  });
  ipcMain.handle('host:stop-bumper', async event => { guardHost(event.sender.id); automaticBumper.cancel(); if (bumper) await bumper.stop(); publishBumper(); return bumperInfo(); });
  ipcMain.handle('host:import', async (event, kind: unknown) => {
    guardHost(event.sender.id);
    if (kind !== undefined && kind !== 'files' && kind !== 'folder') throw new Error('Invalid import type.');
    return importFiles(kind === 'folder' ? 'folder' : 'files');
  });
  ipcMain.handle('host:import-status', event => { guardHost(event.sender.id); return importJob?.snapshot() ?? null; });
  ipcMain.handle('host:import-cancel', (event, id: unknown) => {
    guardHost(event.sender.id);
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid import.');
    return importJob?.cancel(id) ?? false;
  });
  ipcMain.handle('host:import-results', (event, id: unknown, offset: unknown, limit: unknown) => {
    guardHost(event.sender.id);
    if (!importJob || typeof id !== 'string' || id.length > 128 || typeof offset !== 'number' || typeof limit !== 'number') throw new Error('Invalid import results request.');
    return importJob.page(id, offset, limit);
  });
  ipcMain.handle('host:command', async (event, input: unknown) => {
    guardHost(event.sender.id);
    const command = validateCommand(input);
    if (!command) return { ok: false, error: 'Invalid or unsupported command.' };
    return executeHostCommand(command);
  });
  ipcMain.handle('host:applause-trigger', async event => {
    guardHost(event.sender.id);
    const result = await requestApplause({ role: 'host', id: 'host' }, randomUUID(), state.showId, state.hostEpoch, state.revision);
    return result.ok ? { ok: true } : { ok: false, error: result.message };
  });
  ipcMain.on('display:ready', event => {
    if (!shuttingDown && senderIsDisplay(event.sender.id)) {
      displayReady = true; bumperOutput?.displayReady();
      void (bumper?.setOutputAvailable(true) ?? Promise.resolve()).then(startLaunchBumper).catch(error => { bumperError = String(error); publishBumper(); });
      publishDisplay(); publishBumper(); showAdvance.changed();
    }
  });
  ipcMain.on('display:bumper-ack', (event, value: unknown) => { if (senderIsDisplay(event.sender.id)) bumperOutput?.acknowledge(value); });
  ipcMain.on('display:applause-result', (event, value: unknown) => { if (senderIsDisplay(event.sender.id)) applauseOutput.acknowledge(value); });
  ipcMain.on('display:photo-result', (event, value: unknown) => { if (senderIsDisplay(event.sender.id)) photoOutput.acknowledge(value); });
  ipcMain.on('display:bumper-devicechange', event => {
    if (!senderIsDisplay(event.sender.id) || !bumper) return;
    applauseOutput.clear();
    automaticBumper.cancel(); showAdvance.cancel(); startupBumperPending = false; cancelPendingPlayback();
    void bumper.setOutputAvailable(false).catch(error => { bumperError = String(error); }).finally(publishBumper);
  });
  ipcMain.on('display:bumper-event', (event, value: unknown) => {
    if (!senderIsDisplay(event.sender.id) || !bumper || !isRecord(value) || typeof value.generation !== 'string') return;
    if (value.type === 'ended') void bumper.ended(value.generation).catch(error => { bumperError = String(error); publishBumper(); });
    else if (value.type === 'error' && bumper.getState().generation === value.generation) {
      showAdvance.cancel(); automaticBumper.cancel();
      bumperError = 'Bumper audio could not play or its output changed. Check the output and try again.';
      void bumper.setOutputAvailable(false).catch(error => { bumperError = String(error); }).finally(publishBumper);
    }
  });
  ipcMain.on('display:shortcut', async (event, action: unknown) => {
    if (!senderIsDisplay(event.sender.id) || typeof action !== 'string' ||
      !SHORTCUT_ACTIONS.some(item => item.id === action && (item.scope === 'application' || item.scope === 'player'))) return;
    if (action === 'toggleFullscreen') { displayFullscreen?.toggle(); return; }
    if (action === 'playPause' || action === 'previous' || action === 'stop') {
      const result = action === 'playPause' ? await hostPlayPause() : action === 'previous' ? await restartCurrentTrack() : await executeHostCommand({ type: 'stop' });
      if (!result.ok && host && !host.isDestroyed()) void dialog.showMessageBox(host, { type: 'warning', message: result.error || 'The playback action could not finish.' });
      return;
    }
    dispatchHostAction(action as AppAction);
  });
  ipcMain.handle('host:get-timeline', event => { guardHost(event.sender.id); return timelineState(); });
  ipcMain.handle('host:seek', async (event, input: unknown) => {
    guardHost(event.sender.id);
    if (shuttingDown || playbackTransition || !displayReady) return { ok: false, error: 'The player is not ready to seek.' };
    timelineState();
    return playbackTimeline.seek(input);
  });
  ipcMain.on('display:event', (event, value: unknown) => {
    if (!senderIsDisplay(event.sender.id) || !isRecord(value)) return;
    // Closing a decoder can emit one last checkpoint/ended event. The store
    // must remain closed once the shutdown drain has completed.
    if (storeClosed || shuttingDown && value.type !== 'seek-result') return;
    if(value.type==='silenced' && typeof value.generation==='string'){void automaticBumper.acknowledge(value.generation);return;}
    if(!state.playback || value.generation !== state.playback.generationId) return;
    if (value.type === 'timeline') {
      if (typeof value.position === 'number' && typeof value.duration === 'number' && typeof value.seekable === 'boolean' &&
          playbackTimeline.report(state.playback.generationId, { position: value.position, duration: value.duration, seekable: value.seekable })) publishTimeline();
      return;
    }
    if (value.type === 'seek-result') {
      const pending = typeof value.id === 'string' ? pendingSeeks.get(value.id) : null;
      if (pending?.generation === value.generation) {
        if (value.ok === true && typeof value.position === 'number' && Number.isFinite(value.position)) pending.resolve(value.position);
        else pending.reject();
      }
      return;
    }
    // A failed decoder can reset currentTime to zero. Preserve the last
    // durable checkpoint in that case so Retry does not restart the song.
    if (!playbackTimeline.snapshot().seeking && typeof value.position === 'number' && Number.isFinite(value.position) && value.position >= 0 &&
        (value.type !== 'error' || value.position > 0)) store.checkpoint(state.playback.generationId, value.position);
    if (value.type === 'ended' && state.playback.status === 'playing') perform({ type: 'complete', generationId: state.playback.generationId }, 'engine');
    else if (value.type === 'output-error') {
      showAdvance.cancel(); automaticBumper.cancel(); startupBumperPending = false;
      if (typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision > 0) outputRecovery = { generation: state.playback.generationId, revision: value.revision };
      singerCapture.invalidate();
      pauseForOutputLoss();
      if (host && !host.isDestroyed()) void dialog.showMessageBox(host, { type: 'warning', message: 'Audio output needs attention', detail: typeof value.message === 'string' ? value.message.slice(0, 500) : 'Choose the output in Preferences and resume when ready.' });
    } else if (value.type === 'error') {
      showAdvance.cancel(); automaticBumper.cancel(); startupBumperPending = false;
      verifiedPlayback = null;
      pauseForOutputLoss();
      if (reportedMediaError !== value.generation && host && !host.isDestroyed()) {
        reportedMediaError = value.generation as string;
        void dialog.showMessageBox(host, { type: 'warning', message: 'Song playback paused', detail: mediaErrorDetail(value.code) }).catch(() => {});
      }
    }
  });
  screen.on('display-removed', (_event, removed) => {
    if (displayOutputIds.has(removed.id) && display && !display.isDestroyed() && display.isVisible()) {
      showAdvance.cancel(); automaticBumper.cancel(); startupBumperPending = false;
      if (pauseForOutputLoss()) warnDisplayLoss();
      display.hide();
    }
  });
  createHost();
  broadcast();
  void karaFunAccount.restore();
  void partyTymeAccount.restore();
  void ensureSingerDisplayReady(false).catch(error => { bumperError = error instanceof Error ? error.message : 'The preview player could not start.'; publishBumper(); });
  try { await reconcileLocalControl(); } catch { /* Core local show operation remains available. */ }
  syncQueuedDownloads();
  }).catch(error => {
    console.error('Unable to start application:', error);
    dialog.showErrorBox('Unable to start The Proper Volume Karaoke', error instanceof Error ? error.message : String(error));
    app.quit();
  });
}
let quitStarted = false, quitReady = false, storeClosed = false;
function closeStore(): void { if (!storeClosed && store) { storeClosed = true; communityBrowser?.close(); store.close(); } }
async function finishShowRestore(candidate: PreparedShowRestore): Promise<void> {
  try { await candidate.install(destination => store.backupBeforeRestore(destination), closeStore); }
  catch {
    closeStore();
    dialog.showErrorBox('Show restore stopped', 'Booth kept the current show. Close other tools using its database, check app data permissions and free space, then try again.');
  } finally { await candidate.discard().catch(() => {}); }
  const restartFlag = `--${restoreRestartSwitch}`;
  app.relaunch({ args: [...process.argv.slice(1).filter(arg => arg !== restartFlag), restartFlag] });
}
async function stopBeforeRestore(): Promise<void> {
  if (!restorePending) return;
  await restorePending.discard().catch(() => {});
  dialog.showErrorBox('Show restore stopped', 'Booth could not finish shutting down. Your current show is unchanged. Reopen Booth, end any active sessions and imports, then try again.');
}
function waitForImport(job: ImportJob): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 5000);
    void job.wait().then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(false); });
  });
}
// Fence new work before awaiting shutdown. Otherwise a late download, seek or
// guest reply could still mutate the show after its database connection closes.
app.on('before-quit', event => {
  automaticBumper.close(); showAdvance.close();
  cancelPendingPlayback();
  shuttingDown = true; mediaReview.cancel(); for (const check of mediaChecks) check.abort();
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.setAudioMuted(true);
  if (display && !display.isDestroyed() && displayReady) display.webContents.send('display:state', { playback: null, next: [], logo: null, shortcuts, bumperVolume: 0 });
  const nativePending = (karaFunHost?.needsShutdownWait() ?? false) || (partyTymeHost?.needsShutdownWait() ?? false);
  const nativeShutdown = Promise.all([karaFunHost?.shutdown(),partyTymeHost?.shutdown()]);
  void karaFunAccount?.close(); activeKaraFun = null;
  partyTymeAccount?.close();activePartyTyme=null;
  youtubeSearch.cancel(); singerCapture.stop(); mobileRoomBeacon.close();
  const singerScreenWasActive = singerScreenServer.status().state !== 'stopped';
  const singerScreenShutdown = singerScreenServer.stop().then(() => true, () => false);
  const pendingImport = importJob?.snapshot();
  const importing = !!pendingImport && ['scanning', 'hashing', 'cancelling'].includes(pendingImport.phase);
  if (importing) importJob?.cancel(pendingImport!.jobId);
  store?.disableRemoteQueue();
  if (quitReady) { closeStore(); return; }
  if (quitStarted) { event.preventDefault(); return; }
  // Abort first, synchronously preventing guest calls even if startup is still in progress.
  const convertingCdg = !!cdgImport?.active();
  const cdgShutdown = cdgImport?.shutdown() ?? Promise.resolve();
  const downloading = !!youtubeDownloads?.active() || preparingDownload || !!queuedDownloads.snapshot().activeVersionId || nativePending;
  const controlShutdown = localControl?.stop().then(() => true, () => false) ?? Promise.resolve(true);
  const downloadShutdown = Promise.race([Promise.all([queuedDownloads.shutdown(),youtubeDownloads?.shutdown(),nativeShutdown]).then(() => true, () => false), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 12000))]);
  const wait = singerScreenWasActive || !!localControl || !!internetQueue?.needsShutdownWait() || remoteHost.needsShutdownWait() || importing || convertingCdg || downloading || showBackup.needsShutdownWait() || !!restoreRequest || !!restorePending || historyExport.needsShutdownWait() || playlistTransfer.needsShutdownWait() || playbackTimeline.snapshot().seeking;
  const shutdown = remoteHost.shutdown();
  const internetShutdown=internetQueue?.shutdown() ?? Promise.resolve(true);
  const backupShutdown = showBackup.shutdown();
  const exportShutdown = Promise.all([historyExport.shutdown(), playlistTransfer.shutdown()]).then(results => results.every(Boolean));
  if (!wait) { quitReady = true; closeStore(); return; }
  event.preventDefault();
  quitStarted = true;
  const importShutdown = importing && importJob ? waitForImport(importJob) : Promise.resolve(true);
  const boundedBackup = Promise.race([backupShutdown, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]);
  const boundedRestore = restoreRequest ? Promise.race([restoreRequest.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]) : Promise.resolve(true);
  const boundedSeek = Promise.race([playbackTimeline.waitForSeek().then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]);
  const boundedExports = Promise.race([exportShutdown, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]);
  const boundedControl = Promise.race([controlShutdown, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 12000))]);
  void Promise.all([shutdown, importShutdown, boundedBackup, boundedExports, cdgShutdown, boundedSeek, downloadShutdown,internetShutdown,boundedControl,singerScreenShutdown,boundedRestore]).then(async ([remoteClean, importClean, backupClean, exportsClean, , seekClean, downloadClean,internetClean,controlClean,singerScreenClean,restoreClean]) => {
    if (!singerScreenClean || !controlClean || !remoteClean || !internetClean || !importClean || !backupClean || !exportsClean || !seekClean || !downloadClean || !restoreClean) {
      // Pending asynchronous room work may still hold the Store. Exit the process
      // without closing it underneath that work; the OS releases it on exit.
      await stopBeforeRestore();
      app.exit(1); return;
    }
    const restore = restorePending;
    restorePending = null;
    if (restore) await finishShowRestore(restore);
    quitReady = true; closeStore(); app.quit();
  }).catch(async () => { await stopBeforeRestore(); app.exit(1); });
});
