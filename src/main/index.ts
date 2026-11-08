import { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { applyCommand, createInitialState, isVersionAllowed, orderedFuture, remainingPauseSeconds, visibleVersions, type Command, type ShowState } from '../domain';
import type { HistoryEntry } from '../domain/collections';
import { normalizeMissingRequest } from '../domain/missing-request';
import { metadataFromPath } from '../domain/metadata';
import { Store } from './store';
import { readSettings, writeSettings } from './settings';
import { parseSettings, type Settings } from '../domain/settings';
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
import { createSingerStaticHandler } from './remote-static';

protocol.registerSchemesAsPrivileged([{ scheme: 'tpv-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let host: BrowserWindow | null = null;
let display: BrowserWindow | null = null;
let displayId: number | null = null;
let displayOutputIds = new Set<number>();
let store: Store<ShowState>;
let state: ShowState;
let settings: Settings;
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
let importing = false;
let bumperCatalog: BumperCatalog | null = null;
let bumperOutput: BumperDisplayOutput | null = null;
let bumper: BumperController | null = null;
let builtInBumpers: BumperTrack[] = [];
let bumperError = '';
let playbackTransition = false;
let importAbort: AbortController | null = null;
const publishRemoteStatus = (value: ReturnType<HostRemoteLifecycle['status']>) => {
  if (host && !host.isDestroyed()) host.webContents.send('host:remote-status', value);
};
const publishMissingRequests = () => {
  if (!shuttingDown && host && !host.isDestroyed()) host.webContents.send('host:missing-song-requests', store.missingSongRequests());
};
let remoteHost = new HostRemoteLifecycle(null, publishRemoteStatus, publishMissingRequests);
const preload = join(__dirname, '../preload/index.cjs');
const uiRoot = join(__dirname, '../ui/src');

function senderIsHost(id: number): boolean { return !!host && !host.isDestroyed() && host.webContents.id === id; }
function senderIsDisplay(id: number): boolean { return !!display && !display.isDestroyed() && display.webContents.id === id; }
function guardHost(id: number): void { if (!senderIsHost(id)) throw new Error('Operation unavailable'); }
function bumperInfo() {
  return { tracks: [...builtInBumpers.map(({ id, name }) => ({ id, name, builtIn: true })), ...(bumperCatalog?.list() ?? []).map(track => ({ ...track, builtIn: false }))],
    status: bumper?.getState() ?? { status: 'stopped', trackId: null, generation: null },
    outputReady: !!bumper && displayReady && !!settings.audioOutputId && settings.audioOutputId !== 'default',
    karaokeActive: !!state.playback || playbackTransition, error: bumperError };
}
function publishBumper(): void { if (host && !host.isDestroyed()) host.webContents.send('host:bumper-state', bumperInfo()); }
function broadcast(): void {
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
  const next = settings.showNextSingers ? orderedFuture(state, settings.rotationMode)
    .filter(r => isVersionAllowed(state, r.versionId)).slice(0, 3)
    .map(r => state.singers.find(s => s.id === r.singerId)?.name ?? 'Unknown singer') : [];
  const current = playback && request && version && singer && store.media(version.id) ? { generation: playback.generationId, status: playback.status,
    src: `tpv-media://play/${encodeURIComponent(playback.generationId)}`,
    position: store.position(playback.generationId), title: version.title, singer: singer.name, volume: settings.masterVolume, outputId: settings.audioOutputId } : null;
  display.webContents.send('display:state', { playback: current, next, logo: settings.showDisplayLogo ? logoData : null, shortcuts, bumperVolume: settings.masterVolume });
}
function perform(command: Command, actor: 'host' | 'engine' = 'host'): ReturnType<typeof applyCommand>['outcome'] {
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
  if (result.outcome.ok && (command.type === 'complete' || command.type === 'skip' || command.type === 'stop')) bumper?.karaokeEnded();
  broadcast();
  return result.outcome;
}
function pauseForOutputLoss(): void {
  if (!shuttingDown && state.playback?.status === 'playing') perform({ type: 'pause' });
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
  const loseDisplay = () => {
    displayReady = false;
    pauseForOutputLoss();
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
    display = null; displayReady = false; displayId = null; displayOutputIds.clear();
    bumperOutput?.displayDestroyed(); void bumper?.setOutputAvailable(false).catch(error => { bumperError = String(error); publishBumper(); });
    pauseForOutputLoss(); publishBumper();
  });
  void display.loadFile(join(uiRoot, 'display/index.html'));
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
    case 'start': return { type: 'start', generationId: randomUUID() };
    case 'skip': return shortString(value.generationId) && value.confirmed === true ? { type: 'skip', generationId: value.generationId, confirmed: true } : null;
    case 'stage': case 'release': case 'pause': case 'resume': case 'stop': return { type: value.type };
    default: return null;
  }
}
function playable(command: Command): string | null {
  if (command.type !== 'start' && command.type !== 'resume') return null;
  const remaining = remainingPauseSeconds(state, Date.now());
  if (command.type === 'start' && remaining) return `Wait ${remaining} seconds before starting the next song.`;
  if (!display || display.isDestroyed() || !displayReady) return 'Open the singer display before starting or resuming.';
  const requestId = command.type === 'start' ? state.stagedRequestId : state.playback?.requestId;
  const request = state.requests.find(r => r.id === requestId);
  const media = request && store.media(request.versionId);
  if (!media || !existsSync(media.path)) return 'The source file is unavailable. Relinking is not yet supported.';
  return null;
}
async function executeHostCommand(command: Command): Promise<{ ok: boolean; error?: string }> {
  if (playbackTransition && ['start', 'resume', 'pause', 'stop', 'skip', 'stage', 'release', 'removeRequest'].includes(command.type))
    return { ok: false, error: 'Wait for the current playback transition to finish.' };
  const initial = playable(command);
  if (initial) return { ok: false, error: initial };
  if (command.type === 'start' || command.type === 'resume') {
    playbackTransition = true; publishBumper();
    try {
      await bumper?.karaokeStarting();
      const reason = playable(command);
      if (reason) { if (!state.playback) bumper?.karaokeEnded(); return { ok: false, error: reason }; }
      const result = perform(command);
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
async function fingerprint(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
async function importFiles(kind: 'files' | 'folder'): Promise<void> {
  if (!host) return;
  const selection = await dialog.showOpenDialog(host, kind === 'folder'
    ? { title: 'Import MP4 folder', properties: ['openDirectory'] }
    : { title: 'Import local MP4 files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
  if (selection.canceled || shuttingDown) return;
  // A folder import can take time; use one parsing rule for the entire batch.
  const metadataFormat = settings.metadataFormat;
  const metadataTemplates = [...settings.metadataTemplates];
  let duplicates = 0, failed = 0, ambiguous = 0;
  // Do not follow symbolic links when traversing: they can form cycles or escape the chosen folder.
  async function* candidates(paths: string[]): AsyncGenerator<string> {
    for (const path of paths) {
      if (shuttingDown) return;
      if (kind === 'files') { yield path; continue; }
      let entries;
      try { entries = await readdir(path, { withFileTypes: true }); }
      catch { failed++; continue; }
      for (const entry of entries) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) yield* candidates([child]);
        else if (entry.isFile() && extname(entry.name).toLowerCase() === '.mp4') yield child;
      }
    }
  }
  let imported = 0;
  for await (const path of candidates(selection.filePaths)) {
    if (shuttingDown) return;
    try {
      if (extname(path).toLowerCase() !== '.mp4' || !(await stat(path)).isFile()) { failed++; continue; }
      const hash = await fingerprint(path, importAbort!.signal);
      if (shuttingDown) return;
      if (store.byFingerprint(hash)) { duplicates++; continue; }
      const id = randomUUID();
      const parsed = metadataFromPath(path, metadataTemplates, metadataFormat);
      const { artist, title, djCode, trackNumber, matchedTemplate } = parsed;
      const result = applyCommand(state, { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision,
        actor: { role: 'host', id: 'host' }, command: { type: 'addVersion', version: { id, title, artist, rating: 'unrated',
          ...(djCode ? { djCode } : {}), ...(trackNumber ? { trackNumber } : {}),
          ...(matchedTemplate ? { metadataTemplate: matchedTemplate } : {}), metadataAmbiguous: parsed.ambiguous } } });
      if (!result.outcome.ok) { failed++; continue; }
      store.save(result.state, [{ id, path, fingerprint: hash }]);
      state = result.state;
      imported++;
      if (parsed.ambiguous) ambiguous++;
      broadcast();
    } catch { failed++; }
  }
  if (host && (kind === 'folder' || duplicates || failed || ambiguous)) await dialog.showMessageBox(host, { type: failed || ambiguous ? 'warning' : 'info', message: 'Import finished', detail: `${imported} file(s) imported; ${duplicates} duplicate file(s) skipped; ${failed} file(s) or folder(s) could not be read or imported.${ambiguous ? ` ${ambiguous} song(s) matched multiple patterns or possible splits; review their metadata in the library.` : ''}` });
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
    let start = 0, end = size - 1;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store' };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    const stream = Readable.toWeb(createReadStream(media.path, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: range ? 206 : 200, headers });
  } catch { return new Response(null, { status: 404 }); }
}

// Only one process can own the show and audible player at a time.
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
  logoData = await loadLogo(logoPath);
  store = new Store<ShowState>(join(app.getPath('userData'), 'show.sqlite'));
  state = store.load() ?? createInitialState(randomUUID(), randomUUID());
  // A restarted host is a new authority; an interrupted performance is never resumed automatically.
  state.hostEpoch = randomUUID();
  if (state.playback) state.playback.status = 'paused';
  store.save(state);
  try {
    const staticHandler = createSingerStaticHandler(join(__dirname, '../ui'));
    const provider = createLanHostProvider({ store, settings: () => settings, staticHandler,
      installCommitted: committed => { if (shuttingDown) throw new Error('Show is shutting down.'); state = committed; broadcast(); },
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
  ipcMain.handle('host:get-state', event => { guardHost(event.sender.id); return state; });
  ipcMain.handle('host:get-collections', event => { guardHost(event.sender.id); return store.collections.snapshot(); });
  ipcMain.handle('host:reveal-media', (event, versionId: unknown) => {
    guardHost(event.sender.id);
    if (typeof versionId !== 'string' || !isVersionAllowed(state, versionId)) throw new Error('Song unavailable.');
    const media = store.media(versionId);
    if (!media || !existsSync(media.path)) throw new Error('The source file is unavailable.');
    shell.showItemInFolder(media.path);
  });
  ipcMain.handle('host:mutate-collections', (event, action: unknown) => {
    guardHost(event.sender.id);
    store.collections.mutate(action, state.singers, visibleVersions(state));
    return store.collections.snapshot();
  });
  ipcMain.handle('host:get-shortcuts', event => { guardHost(event.sender.id); return { shortcuts, path: shortcutsPath, error: shortcutError }; });
  ipcMain.handle('host:get-missing-song-requests', event => { guardHost(event.sender.id); return store.missingSongRequests(); });
  ipcMain.handle('host:add-missing-song-request', (event, input: unknown) => {
    guardHost(event.sender.id);
    const request = normalizeMissingRequest(input);
    if (!request) return { ok: false, error: 'Enter a singer and song title within the length limits.' };
    store.addMissingSongRequest({ ...request, id: randomUUID(), createdAt: new Date().toISOString() });
    return { ok: true };
  });
  ipcMain.handle('host:get-settings', event => { guardHost(event.sender.id); return { settings, path: settingsPath, created: settingsCreated }; });
  ipcMain.handle('host:remote-status', event => { guardHost(event.sender.id); return remoteHost.status(); });
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
    const changingOutput = proposed.audioOutputId !== settings.audioOutputId;
    if (changingOutput && playbackTransition) throw new Error('Wait for the current playback transition.');
    if (changingOutput) { playbackTransition = true; publishBumper(); }
    try {
      if (changingOutput) { await bumper?.setOutputAvailable(false); pauseForOutputLoss(); }
      settings = writeSettings(settingsPath, proposed);
      settingsCreated = false;
      if (changingOutput && displayReady) await bumper?.setOutputAvailable(!!settings.audioOutputId && settings.audioOutputId !== 'default');
      publishDisplay();
      return settings;
    } finally { if (changingOutput) { playbackTransition = false; publishBumper(); } }
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
    if (!bumper || typeof id !== 'string' || state.playback || playbackTransition) throw new Error('Bumper music is unavailable while a song is active.');
    if (!displayReady || !settings.audioOutputId || settings.audioOutputId === 'default') throw new Error('Choose an explicit audio output and open the singer display first.');
    bumperError = '';
    await bumper.setOutputAvailable(true);
    if (!await bumper.start(id)) throw new Error('Could not start bumper music.');
    publishBumper(); return bumperInfo();
  });
  ipcMain.handle('host:stop-bumper', async event => { guardHost(event.sender.id); if (bumper) await bumper.stop(); publishBumper(); return bumperInfo(); });
  ipcMain.handle('host:import', async (event, kind: unknown) => {
    guardHost(event.sender.id);
    if (kind !== undefined && kind !== 'files' && kind !== 'folder') throw new Error('Invalid import type.');
    if (importing) throw new Error('An import is already in progress.');
    importing = true;
    importAbort = new AbortController();
    try { await importFiles(kind === 'folder' ? 'folder' : 'files'); }
    finally { importing = false; importAbort = null; }
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
  ipcMain.on('display:event', (event, value: unknown) => {
    if (!senderIsDisplay(event.sender.id) || !isRecord(value) || !state.playback || value.generation !== state.playback.generationId) return;
    if (typeof value.position === 'number' && Number.isFinite(value.position) && value.position >= 0) store.checkpoint(state.playback.generationId, value.position);
    if (value.type === 'ended' && state.playback.status === 'playing') perform({ type: 'complete', generationId: state.playback.generationId }, 'engine');
    else if (value.type === 'output-error') {
      pauseForOutputLoss();
      if (host && !host.isDestroyed()) void dialog.showMessageBox(host, { type: 'warning', message: 'Audio output needs attention', detail: typeof value.message === 'string' ? value.message.slice(0, 500) : 'Choose the output in Preferences and resume when ready.' });
    } else if (value.type === 'error') pauseForOutputLoss();
  });
  screen.on('display-removed', (_event, removed) => {
    if (displayOutputIds.has(removed.id) && display && !display.isDestroyed()) {
      displayReady = false;
      pauseForOutputLoss();
      display.destroy();
    }
  });
  createHost();
  }).catch(error => {
    console.error('Unable to start application:', error);
    dialog.showErrorBox('Unable to start The Proper Volume Karaoke', error instanceof Error ? error.message : String(error));
    app.quit();
  });
}
let quitStarted = false, quitReady = false, storeClosed = false;
function closeStore(): void { if (!storeClosed && store) { storeClosed = true; store.close(); } }
app.on('before-quit', event => {
  shuttingDown = true; importAbort?.abort();
  store?.disableRemoteQueue();
  if (quitReady) { closeStore(); return; }
  // Abort first, synchronously preventing guest calls even if startup is still in progress.
  const wait = remoteHost.needsShutdownWait();
  const shutdown = remoteHost.shutdown();
  if (!wait) { quitReady = true; closeStore(); return; }
  event.preventDefault();
  if (quitStarted) return;
  quitStarted = true;
  void shutdown.then(clean => {
    if (!clean) {
      // Pending asynchronous room work may still hold the Store. Exit the process
      // without closing it underneath that work; the OS releases it on exit.
      app.exit(1); return;
    }
    quitReady = true; closeStore(); app.quit();
  });
});
