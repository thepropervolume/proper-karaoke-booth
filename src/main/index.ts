import { app, BrowserWindow, dialog, ipcMain, protocol, screen } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { applyCommand, createInitialState, type Command, type ShowState } from '../domain';
import { normalizeMissingRequest } from '../domain/missing-request';
import { metadataFromFilename } from '../domain/metadata';
import { Store } from './store';
import { DEFAULT_SHORTCUTS, matchesShortcut, type Shortcuts } from '../domain/shortcuts';
import { readShortcuts } from './shortcuts';

protocol.registerSchemesAsPrivileged([{ scheme: 'tpv-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let host: BrowserWindow | null = null;
let display: BrowserWindow | null = null;
let displayId: number | null = null;
let displayOutputIds = new Set<number>();
let store: Store<ShowState>;
let state: ShowState;
let shortcuts: Shortcuts = DEFAULT_SHORTCUTS;
let shortcutsPath: string;
let shortcutError = '';
let displayReady = false;
let choosingDisplay = false;
let shuttingDown = false;
let importing = false;
let importAbort: AbortController | null = null;
const preload = join(__dirname, '../preload/index.cjs');
const uiRoot = join(__dirname, '../ui/src');

function senderIsHost(id: number): boolean { return !!host && !host.isDestroyed() && host.webContents.id === id; }
function senderIsDisplay(id: number): boolean { return !!display && !display.isDestroyed() && display.webContents.id === id; }
function guardHost(id: number): void { if (!senderIsHost(id)) throw new Error('Operation unavailable'); }
function broadcast(): void {
  if (host && !host.isDestroyed()) host.webContents.send('host:state', state);
  publishDisplay();
}
function publishDisplay(): void {
  if (!display || display.isDestroyed() || !displayReady) return;
  const playback = state.playback;
  const request = state.requests.find(r => r.id === playback?.requestId);
  const version = state.versions.find(v => v.id === request?.versionId);
  const singer = state.singers.find(s => s.id === request?.singerId);
  if (!playback || !request || !version || !singer || !store.media(version.id)) {
    display.webContents.send('display:state', null);
    return;
  }
  display.webContents.send('display:state', { generation: playback.generationId, status: playback.status,
    src: `tpv-media://play/${encodeURIComponent(playback.generationId)}`,
    position: store.position(playback.generationId), title: version.title, singer: singer.name });
}
function perform(command: Command, actor: 'host' | 'engine' = 'host'): ReturnType<typeof applyCommand>['outcome'] {
  const result = applyCommand(state, { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch,
    expectedRevision: state.revision, actor: { role: actor, id: actor }, command });
  store.save(result.state);
  state = result.state;
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
  // The singer display is a separate renderer, so host keyboard listeners do not
  // receive its keystrokes. Only expose these specific host shortcuts here.
  display.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (matchesShortcut(shortcuts, 'search', input)) {
      event.preventDefault();
      if (host && !host.isDestroyed()) {
        if (host.isMinimized()) host.restore();
        host.show(); host.focus();
        host.webContents.send('host:focus-search');
      }
      return;
    }
    if (matchesShortcut(shortcuts, 'playPause', input) && state.playback) {
      event.preventDefault();
      const command: Command = { type: state.playback.status === 'paused' ? 'resume' : 'pause' };
      const reason = playable(command);
      if (reason) {
        if (host && !host.isDestroyed()) void dialog.showMessageBox(host, { type: 'warning', message: reason });
      } else perform(command);
    }
  });
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
  display.on('closed', () => { display = null; displayReady = false; displayId = null; displayOutputIds.clear(); pauseForOutputLoss(); });
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
    case 'start': return { type: 'start', generationId: randomUUID() };
    case 'skip': return shortString(value.generationId) && value.confirmed === true ? { type: 'skip', generationId: value.generationId, confirmed: true } : null;
    case 'stage': case 'release': case 'pause': case 'resume': case 'stop': return { type: value.type };
    default: return null;
  }
}
function playable(command: Command): string | null {
  if (command.type !== 'start' && command.type !== 'resume') return null;
  if (!display || display.isDestroyed() || !displayReady) return 'Open the singer display before starting or resuming.';
  const requestId = command.type === 'start' ? state.stagedRequestId : state.playback?.requestId;
  const request = state.requests.find(r => r.id === requestId);
  const media = request && store.media(request.versionId);
  if (!media || !existsSync(media.path)) return 'The source file is unavailable. Relinking is not yet supported.';
  return null;
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
  const metadataFormat = 'artist-title';
  let duplicates = 0, failed = 0;
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
      const { artist, title } = metadataFromFilename(basename(path, extname(path)), metadataFormat);
      const result = applyCommand(state, { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision,
        actor: { role: 'host', id: 'host' }, command: { type: 'addVersion', version: { id, title, artist, rating: 'unrated' } } });
      if (!result.outcome.ok) { failed++; continue; }
      store.save(result.state, [{ id, path, fingerprint: hash }]);
      state = result.state;
      imported++;
      broadcast();
    } catch { failed++; }
  }
  if (host && (kind === 'folder' || duplicates || failed)) await dialog.showMessageBox(host, { type: failed ? 'warning' : 'info', message: 'Import finished', detail: `${imported} file(s) imported; ${duplicates} duplicate file(s) skipped; ${failed} file(s) or folder(s) could not be read or imported.` });
}
async function serveMedia(request: Request): Promise<Response> {
  const playback = state.playback;
  const url = new URL(request.url);
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
  app.whenReady().then(() => {
  app.setName('The Proper Volume Karaoke');
  shortcutsPath = join(app.getPath('userData'), 'keybindings.json');
  try { shortcuts = readShortcuts(shortcutsPath); }
  catch (error) { shortcutError = error instanceof Error ? error.message : String(error); shortcuts = DEFAULT_SHORTCUTS; }
  store = new Store<ShowState>(join(app.getPath('userData'), 'show.sqlite'));
  state = store.load() ?? createInitialState(randomUUID(), randomUUID());
  // A restarted host is a new authority; an interrupted performance is never resumed automatically.
  state.hostEpoch = randomUUID();
  if (state.playback) state.playback.status = 'paused';
  store.save(state);
  protocol.handle('tpv-media', serveMedia);
  ipcMain.handle('host:get-state', event => { guardHost(event.sender.id); return state; });
  ipcMain.handle('host:get-shortcuts', event => { guardHost(event.sender.id); return { shortcuts, path: shortcutsPath, error: shortcutError }; });
  ipcMain.handle('host:get-missing-song-requests', event => { guardHost(event.sender.id); return store.missingSongRequests(); });
  ipcMain.handle('host:add-missing-song-request', (event, input: unknown) => {
    guardHost(event.sender.id);
    const request = normalizeMissingRequest(input);
    if (!request) return { ok: false, error: 'Enter a singer and song title within the length limits.' };
    store.addMissingSongRequest({ ...request, id: randomUUID(), createdAt: new Date().toISOString() });
    return { ok: true };
  });
  ipcMain.handle('host:open-display', async event => { guardHost(event.sender.id); await createDisplay(); });
  ipcMain.handle('host:import', async (event, kind: unknown) => {
    guardHost(event.sender.id);
    if (kind !== undefined && kind !== 'files' && kind !== 'folder') throw new Error('Invalid import type.');
    if (importing) throw new Error('An import is already in progress.');
    importing = true;
    importAbort = new AbortController();
    try { await importFiles(kind === 'folder' ? 'folder' : 'files'); }
    finally { importing = false; importAbort = null; }
  });
  ipcMain.handle('host:command', (event, input: unknown) => {
    guardHost(event.sender.id);
    const command = validateCommand(input);
    if (!command) return { ok: false, error: 'Invalid or unsupported command.' };
    const reason = playable(command);
    if (reason) return { ok: false, error: reason };
    const result = perform(command);
    return result.ok ? { ok: true } : { ok: false, error: result.message };
  });
  ipcMain.on('display:ready', event => { if (senderIsDisplay(event.sender.id)) { displayReady = true; publishDisplay(); } });
  ipcMain.on('display:event', (event, value: unknown) => {
    if (!senderIsDisplay(event.sender.id) || !isRecord(value) || !state.playback || value.generation !== state.playback.generationId) return;
    if (typeof value.position === 'number' && Number.isFinite(value.position) && value.position >= 0) store.checkpoint(state.playback.generationId, value.position);
    if (value.type === 'ended' && state.playback.status === 'playing') perform({ type: 'complete', generationId: state.playback.generationId }, 'engine');
    else if (value.type === 'error') pauseForOutputLoss();
  });
  screen.on('display-removed', (_event, removed) => {
    if (displayOutputIds.has(removed.id) && display && !display.isDestroyed()) {
      displayReady = false;
      pauseForOutputLoss();
      display.destroy();
    }
  });
  createHost();
  }).catch(error => { console.error('Unable to start application:', error); app.quit(); });
}
app.on('before-quit', () => { shuttingDown = true; importAbort?.abort(); store?.close(); });
