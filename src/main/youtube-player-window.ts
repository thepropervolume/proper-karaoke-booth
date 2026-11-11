/** A manually controlled YouTube preview. This is independent of the show queue. */
import { app, BrowserWindow, session, shell } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { allowedYouTubeLink, youtubeEmbedUrl, youtubePlayerPage, YOUTUBE_APP_ID, YOUTUBE_REFERER } from './youtube-player-page';

let current: { window: BrowserWindow; videoId: string } | null = null;
let opening = false;
export function isYouTubePlayerActive(): boolean { return opening || !!current; }

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('YouTube player is unavailable.')); return; }
      resolve(address.port);
    });
  });
}

/**
 * Opening never starts playback. Callers must first ensure karaoke and bumper
 * audio are inactive and must reject their start/resume while this is active.
 */
export async function openYouTubePlayer(videoId: unknown): Promise<void> {
  youtubeEmbedUrl(videoId); // Reject invalid identities before opening a listener.
  const id = videoId as string;
  if (opening) throw new Error('The YouTube player is already opening.');
  if (current) {
    if (current.window.isDestroyed()) current = null;
    else if (current.videoId === id) { current.window.show(); current.window.focus(); return; }
    else throw new Error('Close the current YouTube player before opening another song.');
  }
  opening = true;
  let window: BrowserWindow | null = null;
  let server: Server | null = null;
  try {
    const token = randomBytes(24).toString('hex');
    let port = 0;
    const page = youtubePlayerPage(id);
    server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== `/${token}/` || request.headers.host !== `127.0.0.1:${port}`) {
        response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end(); return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.youtube.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      response.end(page);
    });
    port = await listen(server);
    const playerSession = session.fromPartition(`youtube-player-${randomUUID()}`, { cache: false });
    playerSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*'] }, (details, callback) => {
      const headers = { ...details.requestHeaders };
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'referer') delete headers[key];
      headers.Referer = YOUTUBE_REFERER;
      callback({ requestHeaders: headers });
    });
    playerSession.on('will-download', event => event.preventDefault());
    // This is the development app identifier. The installer must register the
    // same stable ID before distribution, as YouTube's embed guidance requires.
    if (process.platform === 'win32') app.setAppUserModelId(YOUTUBE_APP_ID);
    window = new BrowserWindow({ width: 1000, height: 700, minWidth: 360, minHeight: 300, title: 'YouTube Player', show: false,
      webPreferences: { session: playerSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    current = { window, videoId: id };
    const ownWindow = window, ownServer = server;
    window.removeMenu();
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (allowedYouTubeLink(url)) void shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => { if (!ownWindow.isDestroyed()) ownWindow.close(); });
    window.on('closed', () => { if (current?.window === ownWindow) current = null; ownServer.close(); });
    // Prevent audio in a hidden or background window. Reopening is explicit.
    window.on('minimize', () => { if (!ownWindow.isDestroyed()) ownWindow.close(); });
    window.on('hide', () => { if (!ownWindow.isDestroyed()) ownWindow.close(); });
    window.on('blur', () => { if (!ownWindow.isDestroyed()) ownWindow.close(); });
    window.show();
    await window.loadURL(`http://127.0.0.1:${port}/${token}/`);
    if (window.isDestroyed()) throw new Error('The YouTube player was closed.');
  } catch {
    if (window && !window.isDestroyed()) window.close(); else server?.close();
    throw new Error('Could not open the YouTube player. Check your connection and try again.');
  } finally { opening = false; }
}
