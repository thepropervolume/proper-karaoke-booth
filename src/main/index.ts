import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, screen, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { applyCommand, createInitialState, isVersionAllowed, orderedFuture, singerAvailable, remainingPauseSeconds, visibleVersions, type Command, type ShowState } from '../domain';
import type { HistoryEntry } from '../domain/collections';
import { isMissingSongStatus, normalizeMissingRequest } from '../domain/missing-request';
import { metadataFromPath } from '../domain/metadata';
import { Store } from './store';
import { readSettings, writeSettings } from './settings';
import { nextAccentColor, parseSettings, type Settings } from '../domain/settings';
import { SettingsUpdateQueue } from './settings-update-queue';
import { DEFAULT_SHORTCUTS, type Shortcuts } from '../domain/shortcuts';
import { readShortcuts } from './shortcuts';
import { loadLogo, saveLogo } from './logo';
import { BumperCatalog } from './bumper-catalog';
import { BumperController, type BumperTrack } from './bumper-controller';
import { BumperDisplayOutput } from './bumper-display-output';
import { builtInBumperTracks } from './bumper-builtins';
import { serveBumper } from './bumper-media';
import { HostRemoteLifecycle } from './remote-host-lifecycle';
import { createLanHostProvider } from './remote-provider';
import { RemoteAuthorityCoordinator } from './remote-authority-coordinator';
import { InternetQueueClient } from './internet-queue-client';
import { createSingerStaticHandler } from './remote-static';
import { fingerprintMedia, mediaIdentityMatches, type MediaIdentity } from './media-verification';
import { mediaErrorDetail } from './media-error-message';
import { mediaRange } from './media-range';
import { ImportJob } from './import-job';
import { CdgImport } from './cdg-import';
import { ShowBackup } from './show-backup';
import { HistoryExport } from './history-export';
import { DisplayFullscreen } from './display-fullscreen';
import { LocalCommunityBrowser, type LocalCatalogResult } from './karaokenerds-local-browser';
import { SharedCatalogConnection } from './shared-catalog-connection';
import { isYouTubePlayerActive, openYouTubePlayer } from './youtube-player-window';
import { YouTubeAudioGate } from './youtube-audio-gate';
import { YouTubeDownloads } from './youtube-download';
import { QueuedVideoDownloads } from './queued-video-downloads';
import { catalogRequest } from '../domain/catalog-request';
import { AutomaticBumper } from './automatic-bumper';
import { resolveYtDlpExecutable } from './youtube-tools';
import { youtubeIdentity } from '../domain/streaming-source';
import { PlaybackTimeline } from './playback-timeline';
import { applicationUserData } from './user-data-path';

protocol.registerSchemesAsPrivileged([{ scheme: 'tpv-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let host: BrowserWindow | null = null;
let display: BrowserWindow | null = null;
let displayFullscreen: DisplayFullscreen | null = null;
let displayId: number | null = null;
let displayOutputIds = new Set<number>();
let store: Store<ShowState>;
let communityBrowser: LocalCommunityBrowser | null = null;
let sharedCatalog: SharedCatalogConnection | null = null;
function catalogConfigFile(): string { return settings.sharedCatalogConfigFile || join(app.getPath('userData'), 'catalog-connection.json'); }
let state: ShowState;
let settings: Settings;
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
let choosingDisplay = false;
let shuttingDown = false;
let importPickerOpen = false;
let bumperCatalog: BumperCatalog | null = null;
let bumperOutput: BumperDisplayOutput | null = null;
let bumper: BumperController | null = null;
let builtInBumpers: BumperTrack[] = [];
let bumperError = '';
let playbackTransition = false;
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
const historyExport = new HistoryExport(() => store.collections.snapshot().history, async () => {
  if (!host || host.isDestroyed() || shuttingDown) return null;
  const result = await dialog.showSaveDialog(host, { title: 'Export shown history to a new CSV file', defaultPath: 'karaoke-history.csv',
    filters: [{ name: 'CSV file', extensions: ['csv'] }], properties: ['showOverwriteConfirmation'] });
  return shuttingDown || !host || host.isDestroyed() || result.canceled ? null : result.filePath ?? null;
});
const mediaChecks = new Set<AbortController>();
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
function downloadStatus() {
  const sources = new Set(state.versions.filter(version => version.source?.provider === 'youtube').map(version => version.id));
  const queue=queuedDownloads.snapshot();
  return { job: youtubeDownloads?.snapshot() ?? null, preparing: preparingDownload, queue:{...queue,
    waitingVideos:queue.pendingVersionIds.map(versionId=>({versionId,title:state.versions.find(version=>version.id===versionId)?.title ?? 'Video'})),
    failures:queue.failures.map(failure=>({...failure,title:state.versions.find(version=>version.id===failure.versionId)?.title ?? 'Video'}))},
    cachedVersionIds: Object.keys(store.mediaFilenames()).filter(id => sources.has(id) && existsSync(store.media(id)!.path)) };
}
const queuedDownloads = new QueuedVideoDownloads(async versionId => {
  const job = await startYouTubeDownload(versionId);
  return job && youtubeDownloads ? youtubeDownloads.wait() : null;
});
function syncQueuedDownloads(): void {
  if (shuttingDown || !store || !settings) return;
  const active=youtubeDownloads?.snapshot();
  if(active && !isVersionAllowed(state,active.versionId))youtubeDownloads?.cancel(active.id);
  queuedDownloads.reconcile(orderedFuture(state,settings.rotationMode,Date.now()).filter(request => ['accepted','staged'].includes(request.status) && isVersionAllowed(state,request.versionId))
    .map(request=>request.versionId).filter(id=>state.versions.find(version=>version.id===id)?.source?.provider==='youtube' && (!store.media(id) || !existsSync(store.media(id)!.path))));
}
function automaticBumperEligible(): boolean {
  return !!settings?.autoBumper && !shuttingDown && !state.playback && !playbackTransition && displayReady && !!bumper &&
    !!settings.audioOutputId && settings.audioOutputId !== 'default' && bumper.isOutputAvailable() && !youtubeAudioGate.playbackBlocked() &&
    [...builtInBumpers,...(bumperCatalog?.forPlayback() ?? [])].some(track=>track.id===settings.autoBumperTrackId);
}
const automaticBumper = new AutomaticBumper(automaticBumperEligible, stillEligible => youtubeAudioGate.startBumper(async()=>{
  if(!stillEligible() || !bumper)return false;
  bumperError='';
  const started=await bumper.start(settings.autoBumperTrackId);
  if(started&&!stillEligible())await bumper.stop();
  return started&&stillEligible();
}),message=>{bumperError=message;publishBumper();});
async function startYouTubeDownload(versionId: string) {
  if (shuttingDown || preparingDownload) throw new Error('A video download is being prepared. Try again shortly.');
  const version = state.versions.find(item => item.id === versionId);
  if (!version?.source || !isVersionAllowed(state, versionId)) throw new Error('This video is unavailable.');
  const existingJob = youtubeDownloads?.snapshot();
  if (youtubeDownloads?.active()) {
    if (existingJob?.versionId === versionId) return existingJob;
    throw new Error('Another video is downloading. Wait or cancel it before downloading this song.');
  }
  if (store.media(versionId) && existsSync(store.media(versionId)!.path)) return null;
  preparingDownload = true;
  try {
    const executable = await resolveYtDlpExecutable(settings.ytDlpExecutable);
    if (shuttingDown) throw new Error('The application is closing.');
    const current=state.versions.find(item=>item.id===versionId);
    if(!current?.source || current.source.videoId!==version.source.videoId || !isVersionAllowed(state,versionId))throw new Error('This video selection is no longer available.');
    if(store.media(versionId) && existsSync(store.media(versionId)!.path))return null;
    const directory = videoCacheDirectory(), config = JSON.stringify([directory, executable]);
    if (!youtubeDownloads || config !== youtubeDownloadConfig) {
      youtubeDownloads = new YouTubeDownloads(directory, executable, asset => {
        const current = state.versions.find(item => item.id === asset.versionId);
        if (shuttingDown || current?.source?.videoId !== asset.videoId || !isVersionAllowed(state,asset.versionId)) throw new Error('The video selection changed or is no longer available under the show policy.');
        const previous = store.media(asset.versionId);
        const active = state.requests.find(request => request.id === state.playback?.requestId);
        if (previous && active?.versionId === asset.versionId) throw new Error('Stop the performance before replacing its video.');
        store.save(state, [{ id: asset.versionId, path: asset.path, fingerprint: asset.fingerprint }]);
        // The current Version and queued request IDs stay unchanged.
        try { broadcast(); } catch { /* A committed download must not be reported as failed by a view. */ }
      });
      youtubeDownloadConfig = config;
    }
    return youtubeDownloads.start({ versionId: version.id, videoId: version.source.videoId, title: version.title, artist: version.artist,
      ...(version.source.brandSlug ? {brandSlug: version.source.brandSlug} : {}) });
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

function senderIsHost(id: number): boolean { return !!host && !host.isDestroyed() && host.webContents.id === id; }
function senderIsDisplay(id: number): boolean { return !!display && !display.isDestroyed() && display.webContents.id === id; }
function guardHost(id: number): void { if (!senderIsHost(id)) throw new Error('Operation unavailable'); }
function bumperInfo() {
  return { tracks: [...builtInBumpers.map(({ id, name }) => ({ id, name, builtIn: true })), ...(bumperCatalog?.list() ?? []).map(track => ({ ...track, builtIn: false }))],
    status: bumper?.getState() ?? { status: 'stopped', trackId: null, generation: null },
    outputReady: !!bumper && bumper.isOutputAvailable() && displayReady && !!settings.audioOutputId && settings.audioOutputId !== 'default',
    karaokeActive: !!state.playback || playbackTransition, error: bumperError };
}
function publishBumper(): void { if (host && !host.isDestroyed()) host.webContents.send('host:bumper-state', bumperInfo()); }
let availabilityTimer: NodeJS.Timeout | undefined;
function refreshAvailabilityDeadline(): void {
  if (availabilityTimer) clearTimeout(availabilityTimer);
  const now = Date.now();
  let next = Infinity;
  for (const singer of state.singers) if ((singer.unavailableUntilMs ?? 0) > now) next = Math.min(next, singer.unavailableUntilMs!);
  if (Number.isFinite(next)) { availabilityTimer = setTimeout(() => { if (!shuttingDown) broadcast(); }, Math.min(2147483647, Math.max(1, next - now))); availabilityTimer.unref(); }
}
function broadcast(): void {
  refreshAvailabilityDeadline();
  publishTimeline();
  if (host && !host.isDestroyed()) host.webContents.send('host:state', state);
  publishDisplay();
  publishBumper();
}
function publishDisplay(): void {
  if (!display || display.isDestroyed() || !displayReady) return;
  const playback = state.playback;
  const request = state.requests.find(r => r.id === playback?.requestId);
  const version = state.versions.find(v => v.id === request?.versionId);
  const singer = state.singers.find(s => s.id === request?.singerId);
  const next = settings.showNextSingers ? orderedFuture(state, settings.rotationMode, Date.now())
    .filter(r => singerAvailable(state, r.singerId, Date.now()) && isVersionAllowed(state, r.versionId)).slice(0, 3)
    .map(r => state.singers.find(s => s.id === r.singerId)?.name ?? 'Unknown singer') : [];
  const current = playback && request && version && singer && store.media(version.id) ? { generation: playback.generationId, status: playback.status,
    src: `tpv-media://play/${encodeURIComponent(playback.generationId)}`,
    position: store.position(playback.generationId), title: version.title, singer: singer.name, volume: settings.masterVolume, outputId: settings.audioOutputId } : null;
  display.webContents.send('display:state', { playback: current, next, logo: settings.showDisplayLogo ? logoData : null, shortcuts, bumperVolume: settings.masterVolume });
}
function perform(command: Command, actor: 'host' | 'engine' = 'host'): ReturnType<typeof applyCommand>['outcome'] {
  const previousGeneration = state.playback?.generationId;
  const result = applyCommand(state, { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch,
    expectedRevision: state.revision, actor: { role: actor, id: actor }, command }, settings, Date.now());
  let history: HistoryEntry | undefined;
  if (result.outcome.ok && (command.type === 'complete' || command.type === 'skip') && state.playback) {
    const request = state.requests.find(r => r.id === state.playback?.requestId);
    if (request) {
      const singer = state.singers.find(s => s.id === request.singerId);
      const version = state.versions.find(v => v.id === request.versionId);
      history = { generationId: state.playback.generationId, singerId: request.singerId, singer: singer?.name ?? 'Unknown singer',
        versionId: request.versionId, title: version?.title ?? 'Unknown song', artist: version?.artist ?? '',
        outcome: command.type === 'complete' ? 'completed' : 'skipped', at: new Date().toISOString() };
    }
  }
  store.save(result.state, [], history);
  state = result.state;
  if (result.outcome.ok && (command.type === 'complete' || command.type === 'skip' || command.type === 'stop')) verifiedPlayback = null;
  if (result.outcome.ok && (command.type === 'complete' || command.type === 'skip' || command.type === 'stop')) bumper?.karaokeEnded();
  if (result.outcome.ok && previousGeneration && (command.type === 'complete' || command.type === 'skip')) automaticBumper.arm(previousGeneration);
  if (result.outcome.ok && ['request','accept','editRequest','moveRequest','promoteRequest','removeRequest','rejectRequest','setPolicy'].includes(command.type)) syncQueuedDownloads();
  try{broadcast();}catch{/* A closed view must not turn a durable command into a failure. */}
  return result.outcome;
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
function createHost(): void {
  host = new BrowserWindow({ width: 1440, height: 900, minWidth: 780, minHeight: 600, title: 'The Proper Volume Karaoke',
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  restrictWindow(host);
  void host.loadFile(join(uiRoot, 'renderer/index.html'));
  host.on('closed', () => { host = null; app.quit(); });
}
async function createDisplay(): Promise<void> {
  if (display && !display.isDestroyed()) { display.show(); display.focus(); return; }
  if (choosingDisplay || !host || host.isDestroyed()) return;
  choosingDisplay = true;
  let selectedId: number | undefined;
  try {
    const monitors = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;
    const buttons = monitors.map((m, i) => `${m.id === primaryId ? 'Primary' : `Display ${i + 1}`} (${m.bounds.width} × ${m.bounds.height})`);
    buttons.push('Cancel');
    const result = await dialog.showMessageBox(host, { type: 'question', title: 'Choose singer display',
      message: 'Choose the display for singers', detail: 'Playback will pause if this display is disconnected.',
      buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1, noLink: true });
    selectedId = monitors[result.response]?.id;
  } finally { choosingDisplay = false; }
  if (selectedId === undefined || shuttingDown || !host || host.isDestroyed()) return;
  const target = screen.getAllDisplays().find(m => m.id === selectedId);
  if (!target) {
    await dialog.showMessageBox(host, { type: 'warning', message: 'That display is no longer available. Choose another display.' });
    return;
  }
  displayId = target.id;
  displayOutputIds = new Set([target.id]);
  displayReady = false;
  display = new BrowserWindow({ x: target.workArea.x, y: target.workArea.y,
    width: Math.min(1280, target.workArea.width), height: Math.min(800, target.workArea.height), title: 'Singer Display',
    backgroundColor: '#000000', webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  restrictWindow(display);
  const window = display;
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
    displayReady = false;
    if (pauseForOutputLoss()) warnDisplayLoss();
    if (display && !display.isDestroyed()) display.destroy();
  };
  display.webContents.on('render-process-gone', loseDisplay);
  display.on('move', () => {
    if (!display || display.isDestroyed() || displayId === null) return;
    // The window manager can move a window before display-removed arrives.
    if (!screen.getAllDisplays().some(m => m.id === displayId)) { loseDisplay(); return; }
    displayId = screen.getDisplayMatching(display.getBounds()).id;
    displayOutputIds.add(displayId);
  });
  display.on('closed', () => {
    fullscreen.close(); if (displayFullscreen === fullscreen) displayFullscreen = null;
    display = null; displayReady = false; displayId = null; displayOutputIds.clear();
    automaticBumper.cancel(); bumperOutput?.displayDestroyed(); void bumper?.setOutputAvailable(false).catch(error => { bumperError = String(error); publishBumper(); });
    if (pauseForOutputLoss()) warnDisplayLoss(); publishBumper();
  });
  void display.loadFile(join(uiRoot, 'display/index.html'));
  if (settings.singerDisplayFullscreen) fullscreen.set(true);
}
function isRecord(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function shortString(x: unknown): x is string { return typeof x === 'string' && x.trim().length > 0 && x.length <= 500; }
function validateCommand(value: unknown): Command | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'editVersion':
      return shortString(value.id) && shortString(value.title) && typeof value.artist === 'string' && value.artist.length <= 500 ? { type: 'editVersion', id: value.id, title: value.title, artist: value.artist } : null;
    case 'addSinger':
      return isRecord(value.singer) && shortString(value.singer.id) && shortString(value.singer.name) ? { type: 'addSinger', singer: { id: value.singer.id, name: value.singer.name } } : null;
    case 'request':
      return shortString(value.requestId) && shortString(value.singerId) && shortString(value.versionId) ? { type: 'request', requestId: value.requestId, singerId: value.singerId, versionId: value.versionId } : null;
    case 'accept': return shortString(value.requestId) ? { type: 'accept', requestId: value.requestId } : null;
    case 'removeRequest': return shortString(value.requestId) ? { type: 'removeRequest', requestId: value.requestId } : null;
    case 'setSingerAvailability': return shortString(value.singerId) && Number.isInteger(value.minutes) && (value.minutes as number) >= 0 && (value.minutes as number) <= 60 && (value.releaseStaged === undefined || typeof value.releaseStaged === 'boolean') ? { type: 'setSingerAvailability', singerId: value.singerId, minutes: value.minutes as number, releaseStaged: value.releaseStaged as boolean | undefined } : null;
    case 'moveRequest': return shortString(value.requestId) && (value.beforeRequestId === null || shortString(value.beforeRequestId)) ? { type: 'moveRequest', requestId: value.requestId, beforeRequestId: value.beforeRequestId } : null;
    case 'editRequest': return shortString(value.requestId) && shortString(value.singerId) && shortString(value.versionId) ? { type: 'editRequest', requestId: value.requestId, singerId: value.singerId, versionId: value.versionId } : null;
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
  if (streaming?.provider === 'youtube' && !media) return null;
  if (streaming?.provider === 'youtube' && media && !existsSync(media.path)) return 'The saved video is missing. Right-click the library song and choose Download Video / Retry, or relink the original file.';
  if (!media || !existsSync(media.path)) return 'The source file is unavailable. Right-click the song in Song Library and choose Relink File.';
  return null;
}
async function executeHostCommand(command: Command): Promise<{ ok: boolean; error?: string }> {
  if (playbackTransition && ['start', 'resume', 'pause', 'stop', 'skip', 'stage', 'release', 'removeRequest'].includes(command.type))
    return { ok: false, error: 'Wait for the current playback transition to finish.' };
  if (command.type === 'start' || command.type === 'resume') {
    const requestId = command.type === 'start' ? state.stagedRequestId : state.playback?.requestId;
    const version = state.versions.find(item => item.id === state.requests.find(request => request.id === requestId)?.versionId);
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
      } catch { return { ok: false, error: 'The song file could not be verified. Check its location or relink the original file.' }; }
      finally { mediaChecks.delete(check); }
      if (shuttingDown || !await mediaIdentityMatches(media.path, sourceIdentity)) return { ok: false, error: 'The song file changed during verification. Check or relink the original file.' };
      await bumper?.karaokeStarting();
      if (shuttingDown) return { ok: false, error: 'The application is closing.' };
      const stillMatches = await mediaIdentityMatches(media.path, sourceIdentity);
      if (shuttingDown) return { ok: false, error: 'The application is closing.' };
      const reason = playable(command);
      const currentMedia = versionId && store.media(versionId);
      if (reason || !currentMedia || currentMedia.path !== media.path || currentMedia.fingerprint !== media.fingerprint || !stillMatches) {
        if (!state.playback) bumper?.karaokeEnded();
        return { ok: false, error: reason || 'The song file changed during verification. Check or relink the original file.' };
      }
      const result = perform(command);
      if (result.ok && state.playback) { verifiedPlayback = { ...media, generation: state.playback.generationId, identity: sourceIdentity }; reportedMediaError = ''; }
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
async function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === 'bumper') return bumper ? serveBumper(request, bumper.getState(), [...builtInBumpers, ...(bumperCatalog?.forPlayback() ?? [])]) : new Response(null, { status: 404 });
  const playback = state.playback;
  if (request.method !== 'GET' || url.hostname !== 'play' || !playback || url.pathname !== `/${encodeURIComponent(playback.generationId)}`) return new Response(null, { status: 404 });
  const song = state.requests.find(r => r.id === playback.requestId);
  const media = song && store.media(song.versionId);
  if (!media) return new Response(null, { status: 404 });
  try {
    const size = (await stat(media.path)).size;
    if (!Number.isSafeInteger(size) || size <= 0) return new Response(null, { status: 404 });
    const range = mediaRange(request.headers.get('range'), size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const { start, end, partial } = range;
    const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store' };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    const stream = Readable.toWeb(createReadStream(media.path, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: partial ? 206 : 200, headers });
  } catch { return new Response(null, { status: 404 }); }
}

// Only one process can own the show and audible player at a time.
const selectedUserData = applicationUserData({ appData: app.getPath('appData'), current: app.getPath('userData'), appName: app.getName(),
  packaged: app.isPackaged, explicit: app.commandLine.getSwitchValue('user-data-dir') || undefined });
app.setPath('userData', selectedUserData);
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
else {
  app.on('second-instance', () => {
    if (host && !host.isDestroyed()) { if (host.isMinimized()) host.restore(); host.show(); host.focus(); }
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
  const localData = process.platform === 'win32' ? process.env.LOCALAPPDATA : process.env.XDG_DATA_HOME || join(app.getPath('home'), '.local', 'share');
  communityBrowser = new LocalCommunityBrowser(join(localData || app.getPath('userData'), 'ProperKaraokeBooth', 'karaokenerds', 'community.sqlite'));
  sharedCatalog = new SharedCatalogConnection(join(app.getPath('userData'), 'shared-catalog-cache', 'queries.json'));
  logoData = await loadLogo(logoPath);
  store = new Store<ShowState>(join(app.getPath('userData'), 'show.sqlite'));
  state = store.load() ?? createInitialState(randomUUID(), randomUUID());
  // A restarted host is a new authority; an interrupted performance is never resumed automatically.
  state.hostEpoch = randomUUID();
  if (state.playback) state.playback.status = 'paused';
  store.save(state);
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
    state = result.state;
    // A UI notification must not make a successful durable import look failed.
    try { broadcast(); } catch { /* The host can reload the persisted show. */ }
    return { outcome: 'imported' as const, needsReview: parsed.ambiguous };
  };
  importJob = new ImportJob(commitImported, progress => { if (host && !host.isDestroyed() && !shuttingDown) host.webContents.send('host:import-progress', progress); });
  cdgImport = new CdgImport(join(app.getPath('userData'), 'cdg-library'), (path, fingerprint, metadataPath) =>
    commitImported(path, fingerprint, metadataPath.replace(/\.(mp3|cdg)$/i, '.mp4'), cdgImportParsing ?? settings).outcome);
  try {
    const staticHandler = createSingerStaticHandler(join(__dirname, '../ui'));
    const installCommitted = (committed: ShowState) => { if (shuttingDown) throw new Error('Show is shutting down.'); state = committed; syncQueuedDownloads(); broadcast(); };
    remoteAuthority = new RemoteAuthorityCoordinator(store, () => settings, installCommitted);
    internetQueue = new InternetQueueClient({coordinator:remoteAuthority,configurationFile:join(app.getPath('userData'),'remote-queue-connection.json'),
      publish:value=>{if(host&&!host.isDestroyed())host.webContents.send('host:internet-state',value);},onMissingRequest:publishMissingRequests,writeClipboard:value=>clipboard.writeText(value)});
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
    }, () => settings.masterVolume, () => settings.audioOutputId);
    bumper = new BumperController(bumperOutput, () => [...builtInBumpers, ...(bumperCatalog?.forPlayback() ?? [])], publishBumper);
    if (state.playback) await bumper.karaokeStarting();
  } catch (error) { bumper = null; bumperOutput = null; bumperError = error instanceof Error ? error.message : String(error); }
  protocol.handle('tpv-media', serveMedia);
  ipcMain.handle('host:cdg-status', event => { guardHost(event.sender.id); return cdgImport?.snapshot() ?? null; });
  ipcMain.handle('host:cdg-cancel', (event, id: unknown) => { guardHost(event.sender.id); return typeof id === 'string' && !!cdgImport?.cancel(id); });
  ipcMain.handle('host:cdg-import', async event => {
    guardHost(event.sender.id);
    if (!host || shuttingDown || cdgPickerOpen || cdgImport?.active()) throw new Error('Finish the current CD+G import first.');
    cdgPickerOpen = true;
    try {
      const picked = await dialog.showOpenDialog(host, { title: 'Import CD+G karaoke pair or ZIP', properties: ['openFile'], filters: [{ name: 'MP3 + CDG karaoke', extensions: ['zip', 'cdg', 'mp3'] }] });
      if (picked.canceled || !picked.filePaths[0] || shuttingDown) return null;
      cdgImportParsing = structuredClone({ metadataFormat: settings.metadataFormat, metadataTemplates: settings.metadataTemplates });
      return cdgImport!.start(picked.filePaths[0]);
    } finally { cdgPickerOpen = false; }
  });
  ipcMain.handle('host:backup-show', event => { guardHost(event.sender.id); return showBackup.start(); });
  ipcMain.handle('host:backup-cleanup', event => { guardHost(event.sender.id); return showBackup.retryCleanup(); });
  ipcMain.handle('host:get-library-filenames', event => { guardHost(event.sender.id); return store.mediaFilenames(); });
  ipcMain.handle('host:get-state', event => { guardHost(event.sender.id); refreshAvailabilityDeadline(); return state; });
  ipcMain.handle('host:youtube-download-status', event => { guardHost(event.sender.id); return downloadStatus(); });
  ipcMain.handle('host:youtube-download', async (event, versionId: unknown) => {
    guardHost(event.sender.id);
    if (typeof versionId !== 'string') throw new Error('Choose a YouTube song.');
    if (!state.versions.some(version=>version.id===versionId && version.source?.provider==='youtube') || !isVersionAllowed(state,versionId)) throw new Error('This video is unavailable.');
    if (store.media(versionId) && existsSync(store.media(versionId)!.path)) return null;
    queuedDownloads.enqueue(versionId,true); return youtubeDownloads?.snapshot() ?? null;
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
  ipcMain.handle('host:export-history', (event, filter: unknown) => { guardHost(event.sender.id); return historyExport.start(filter); });
  ipcMain.handle('host:history-export-status', event => { guardHost(event.sender.id); return historyExport.status(); });
  ipcMain.handle('host:history-export-cleanup', event => { guardHost(event.sender.id); return historyExport.retryCleanup(); });
  ipcMain.handle('host:reveal-media', (event, versionId: unknown) => {
    guardHost(event.sender.id);
    if (typeof versionId !== 'string' || !isVersionAllowed(state, versionId)) throw new Error('Song unavailable.');
    const media = store.media(versionId);
    if (!media || !existsSync(media.path)) throw new Error('The source file is unavailable.');
    shell.showItemInFolder(media.path);
  });
  ipcMain.handle('host:relink-media', async (event, versionId: unknown) => {
    guardHost(event.sender.id);
    if (typeof versionId !== 'string' || !isVersionAllowed(state, versionId)) throw new Error('Song unavailable.');
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
      let checked: Awaited<ReturnType<typeof fingerprintMedia>>;
      try { checked = await fingerprintMedia(path, check.signal); }
      catch { throw new Error('The selected file could not be verified. Choose a readable original MP4.'); }
      finally { mediaChecks.delete(check); }
      if (checked.fingerprint !== original.fingerprint) throw new Error('The selected file does not match the original recording. No link was changed.');
      const stillMatches = await mediaIdentityMatches(path, checked.identity);
      if (shuttingDown || playbackTransition || activeVersion() === versionId || !isVersionAllowed(state, versionId) || !stillMatches)
        throw new Error('The song or selected file changed while relinking. Try again after playback stops.');
      if (!store.relinkMedia(original, path)) throw new Error('The source link changed while relinking. Try again.');
      return { ok: true };
    } finally { relinking = false; }
  });
  ipcMain.handle('host:mutate-collections', (event, action: unknown) => {
    guardHost(event.sender.id);
    store.collections.mutate(action, state.singers, visibleVersions(state));
    return store.collections.snapshot();
  });
  ipcMain.handle('host:get-shortcuts', event => { guardHost(event.sender.id); return { shortcuts, path: shortcutsPath, error: shortcutError }; });
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
  ipcMain.handle('host:choose-catalog-config', async event => {
    guardHost(event.sender.id); if (!host || shuttingDown) return null;
    const selected = await dialog.showOpenDialog(host, {title:'Choose private shared catalog configuration',properties:['openFile'],filters:[{name:'Catalog client configuration',extensions:['json']}]});
    return selected.canceled || shuttingDown ? null : selected.filePaths[0] ?? null;
  });
  ipcMain.handle('host:catalog-status', async (event, path: unknown) => {
    guardHost(event.sender.id); if (!sharedCatalog || shuttingDown) return {status:'unavailable'};
    if (path !== undefined && (typeof path !== 'string' || path.length > 4096)) return {status:'configuration-error'};
    const requested = typeof path === 'string' && path ? path : catalogConfigFile();
    return sharedCatalog.status(requested, requested === catalogConfigFile());
  });
  ipcMain.handle('host:get-settings', event => { guardHost(event.sender.id); return { settings, path: settingsPath, created: settingsCreated }; });
  ipcMain.handle('host:karaokenerds-search', async (event, query: unknown): Promise<LocalCatalogResult> => {
    guardHost(event.sender.id);
    const config = catalogConfigFile();
    if (settings.sharedCatalogEnabled && settings.sharedCatalogConfigFile && !existsSync(config)) return {status:'configuration-error',tracks:[],limited:false,lastSuccess:null};
    if (settings.sharedCatalogEnabled && existsSync(config) && sharedCatalog) {
      const result = await sharedCatalog.search(config, query);
      if (shuttingDown || !settings.sharedCatalogEnabled || config !== catalogConfigFile()) return {status:'unavailable',tracks:[],limited:false,lastSuccess:null};
      return result;
    }
    if (!communityBrowser) throw new Error('Catalog unavailable.');
    return communityBrowser.search(query);
  });
  ipcMain.handle('host:request-catalog-track', (event, input: unknown) => {
    guardHost(event.sender.id);
    if(shuttingDown)return {ok:false,error:'The application is closing.'};
    const planned=catalogRequest(state,input,settings,{versionId:randomUUID(),commandId:randomUUID()},Date.now());
    if(!planned.result.ok)return planned.result;
    store.save(planned.state);state=planned.state;
    let notice:string|undefined;
    try{syncQueuedDownloads();}catch{notice='Queued successfully. Use Download Video / Retry if its download does not appear.';}
    try{broadcast();}catch{/* A committed request remains successful even if a view closes. */}
    return {...planned.result,...(notice?{notice}:{})};
  });
  ipcMain.handle('host:add-youtube', async (event, input: unknown) => {
    guardHost(event.sender.id);
    if (shuttingDown || !isRecord(input) || !shortString(input.title) || typeof input.artist !== 'string' || input.artist.length > 500) return { ok: false, error: 'Enter a song title and optional artist.' };
    const videoId = youtubeIdentity(input.url);
    if (!videoId) return { ok: false, error: 'Enter a valid YouTube video link or ID.' };
    const existing = state.versions.find(version => version.source?.provider === 'youtube' && version.source.videoId === videoId);
    const brandSlug = typeof input.brandSlug === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(input.brandSlug) ? input.brandSlug : undefined;
    if (existing) return isVersionAllowed(state,existing.id) ? {ok:true,versionId:existing.id,notice:'Already in your library. Video downloads when queued.'} : {ok:false,error:'This recording is unavailable under the current show policy.'};
    const id = randomUUID();
    const result = perform({ type: 'addVersion', version: { id, title: input.title.trim(), artist: input.artist.trim(), rating: 'unrated', source: { provider: 'youtube', videoId, ...(brandSlug ? {brandSlug} : {}) } } });
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
    const proposed = parseSettings(value);
    return settingsUpdates.run(async () => {
      const changingOutput = proposed.audioOutputId !== settings.audioOutputId;
      const disablingAutomaticBumper=settings.autoBumper && !proposed.autoBumper;
      if(changingOutput || proposed.autoBumper !== settings.autoBumper || proposed.autoBumperTrackId !== settings.autoBumperTrackId) automaticBumper.cancel();
      if (changingOutput && playbackTransition) throw new Error('Wait for the current playback transition.');
      if (changingOutput) { playbackTransition = true; publishBumper(); }
      try {
        if (changingOutput) { await bumper?.setOutputAvailable(false); pauseForOutputLoss(); }
        settings = writeSettings(settingsPath, proposed);
        if(disablingAutomaticBumper && bumper?.getState().status !== 'stopped') await bumper?.stop();
        settingsCreated = false;
        if (changingOutput && displayReady) await bumper?.setOutputAvailable(!!settings.audioOutputId && settings.audioOutputId !== 'default');
        publishDisplay();
        return settings;
      } finally { if (changingOutput) { playbackTransition = false; publishBumper(); } }
    });
  });
  ipcMain.handle('host:cycle-accent-color', event => {
    guardHost(event.sender.id);
    return settingsUpdates.run(() => {
      settings = writeSettings(settingsPath, { ...settings, accentColor: nextAccentColor(settings.accentColor) });
      settingsCreated = false;
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
      return true;
    } finally { choosingLogo = false; }
  });
  ipcMain.handle('host:clear-display-logo', async event => {
    guardHost(event.sender.id);
    if (choosingLogo) throw new Error('Finish choosing a logo first.');
    try { await unlink(logoPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    logoData = null;
    publishDisplay();
  });
  ipcMain.handle('host:toggle-display-fullscreen', event => {
    guardHost(event.sender.id);
    if (!display || display.isDestroyed() || !displayFullscreen) throw new Error('Open the singer display first.');
    displayFullscreen.toggle();
  });
  ipcMain.handle('host:open-display', async event => { guardHost(event.sender.id); await createDisplay(); });
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
    if (!displayReady || !settings.audioOutputId || settings.audioOutputId === 'default') throw new Error('Choose an explicit audio output and open the singer display first.');
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
  ipcMain.on('display:ready', event => { if (senderIsDisplay(event.sender.id)) { displayReady = true; bumperOutput?.displayReady(); void bumper?.setOutputAvailable(!!settings.audioOutputId && settings.audioOutputId !== 'default'); publishDisplay(); publishBumper(); } });
  ipcMain.on('display:bumper-ack', (event, value: unknown) => { if (senderIsDisplay(event.sender.id)) bumperOutput?.acknowledge(value); });
  ipcMain.on('display:bumper-devicechange', event => {
    if (!senderIsDisplay(event.sender.id) || !bumper) return;
    automaticBumper.cancel();
    void bumper.setOutputAvailable(false).catch(error => { bumperError = String(error); }).finally(publishBumper);
  });
  ipcMain.on('display:bumper-event', (event, value: unknown) => {
    if (!senderIsDisplay(event.sender.id) || !bumper || !isRecord(value) || typeof value.generation !== 'string') return;
    if (value.type === 'ended') void bumper.ended(value.generation).catch(error => { bumperError = String(error); publishBumper(); });
    else if (value.type === 'error' && bumper.getState().generation === value.generation) {
      bumperError = 'Bumper audio could not play or its output changed. Check the output and try again.';
      void bumper.setOutputAvailable(false).catch(error => { bumperError = String(error); }).finally(publishBumper);
    }
  });
  ipcMain.on('display:shortcut', async (event, action: unknown) => {
    if (!senderIsDisplay(event.sender.id) || !displayReady) return;
    if (action === 'search') {
      if (host && !host.isDestroyed()) { if (host.isMinimized()) host.restore(); host.show(); host.focus(); host.webContents.send('host:focus-search'); }
    } else if (action === 'playPause') {
      if (!state.playback && !state.stagedRequestId && !(await executeHostCommand({ type: 'stage' })).ok) return;
      const command: Command = state.playback ? { type: state.playback.status === 'paused' ? 'resume' : 'pause' } : { type: 'start', generationId: randomUUID() };
      const result = await executeHostCommand(command);
      if (!result.ok && host && !host.isDestroyed()) void dialog.showMessageBox(host, { type: 'warning', message: result.error || 'Playback could not start.' });
    }
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
    if (!playbackTimeline.snapshot().seeking && typeof value.position === 'number' && Number.isFinite(value.position) && value.position >= 0) store.checkpoint(state.playback.generationId, value.position);
    if (value.type === 'ended' && state.playback.status === 'playing') perform({ type: 'complete', generationId: state.playback.generationId }, 'engine');
    else if (value.type === 'output-error') {
      pauseForOutputLoss();
      if (host && !host.isDestroyed()) void dialog.showMessageBox(host, { type: 'warning', message: 'Audio output needs attention', detail: typeof value.message === 'string' ? value.message.slice(0, 500) : 'Choose the output in Preferences and resume when ready.' });
    } else if (value.type === 'error') {
      pauseForOutputLoss();
      if (reportedMediaError !== value.generation && host && !host.isDestroyed()) {
        reportedMediaError = value.generation as string;
        void dialog.showMessageBox(host, { type: 'warning', message: 'Song playback paused', detail: mediaErrorDetail(value.code) });
      }
    }
  });
  screen.on('display-removed', (_event, removed) => {
    if (displayOutputIds.has(removed.id) && display && !display.isDestroyed()) {
      displayReady = false;
      if (pauseForOutputLoss()) warnDisplayLoss();
      display.destroy();
    }
  });
  createHost();
  syncQueuedDownloads();
  }).catch(error => {
    console.error('Unable to start application:', error);
    dialog.showErrorBox('Unable to start The Proper Volume Karaoke', error instanceof Error ? error.message : String(error));
    app.quit();
  });
}
let quitStarted = false, quitReady = false, storeClosed = false;
function closeStore(): void { if (!storeClosed && store) { storeClosed = true; communityBrowser?.close(); store.close(); } }
function waitForImport(job: ImportJob): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 5000);
    void job.wait().then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(false); });
  });
}
app.on('before-quit', event => {
  automaticBumper.close();
  shuttingDown = true; for (const check of mediaChecks) check.abort();
  const pendingImport = importJob?.snapshot();
  const importing = !!pendingImport && ['scanning', 'hashing', 'cancelling'].includes(pendingImport.phase);
  if (importing) importJob?.cancel(pendingImport!.jobId);
  store?.disableRemoteQueue();
  if (quitReady) { closeStore(); return; }
  if (quitStarted) { event.preventDefault(); return; }
  // Abort first, synchronously preventing guest calls even if startup is still in progress.
  const convertingCdg = !!cdgImport?.active();
  const cdgShutdown = cdgImport?.shutdown() ?? Promise.resolve();
  const downloading = !!youtubeDownloads?.active() || preparingDownload || !!queuedDownloads.snapshot().activeVersionId;
  const downloadShutdown = Promise.race([Promise.all([queuedDownloads.shutdown(),youtubeDownloads?.shutdown()]).then(() => true, () => false), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 12000))]);
  const wait = !!internetQueue?.needsShutdownWait() || remoteHost.needsShutdownWait() || importing || convertingCdg || downloading || showBackup.needsShutdownWait() || historyExport.needsShutdownWait() || playbackTimeline.snapshot().seeking;
  const shutdown = remoteHost.shutdown();
  const internetShutdown=internetQueue?.shutdown() ?? Promise.resolve(true);
  const backupShutdown = showBackup.shutdown();
  const historyShutdown = historyExport.shutdown();
  if (!wait) { quitReady = true; closeStore(); return; }
  event.preventDefault();
  quitStarted = true;
  const importShutdown = importing && importJob ? waitForImport(importJob) : Promise.resolve(true);
  const boundedBackup = Promise.race([backupShutdown, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]);
  const boundedSeek = Promise.race([playbackTimeline.waitForSeek().then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]);
  const boundedHistory = Promise.race([historyShutdown, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))]);
  void Promise.all([shutdown, importShutdown, boundedBackup, boundedHistory, cdgShutdown, boundedSeek, downloadShutdown,internetShutdown]).then(([remoteClean, importClean, backupClean, historyClean, , seekClean, downloadClean,internetClean]) => {
    if (!remoteClean || !internetClean || !importClean || !backupClean || !historyClean || !seekClean || !downloadClean) {
      // Pending asynchronous room work may still hold the Store. Exit the process
      // without closing it underneath that work; the OS releases it on exit.
      app.exit(1); return;
    }
    quitReady = true; closeStore(); app.quit();
  });
});
