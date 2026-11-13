import { app, BrowserWindow, session, shell, WebContentsView } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { allowedYouTubeLink, youtubeEmbedUrl, YOUTUBE_APP_ID, YOUTUBE_REFERER } from './youtube-player-page';
import { youtubeShowPage } from './youtube-show-page';

type Snapshot = { ready: boolean; error: number | null; state: number; position: number; duration: number };
type Handlers = { report(generation: string, value: { position: number; duration: number; seekable: boolean }): void;
  ended(generation: string): void; nativeStatus(generation: string, status: 'playing' | 'paused'): void;
  failure(generation: string, message: string): void; shortcut(input: {code:string;control:boolean;alt:boolean;shift:boolean;meta:boolean;repeat:boolean}): boolean };

/** Remote content has no preload, Node access, show data or application IPC. */
export class YouTubeShowPlayer {
  private sequence = 0;
  private current: { generation: string; window: BrowserWindow; view: WebContentsView; server: Server; resize: () => void; visibility: () => void;
    timer: ReturnType<typeof setInterval> | null; status: 'playing' | 'paused' | null; polling: boolean; failed: boolean; changedAt: number; bufferingSince: number } | null = null;
  constructor(private readonly handlers: Handlers) {}
  isCurrent(generation: string): boolean { return this.current?.generation === generation && !this.current.failed; }
  stop(): void {
    this.sequence++;
    const current = this.current; this.current = null;
    if (!current) return;
    if (current.timer) clearInterval(current.timer);
    current.window.removeListener('resize', current.resize);
    current.window.removeListener('minimize', current.visibility); current.window.removeListener('hide', current.visibility);
    if (!current.window.isDestroyed()) current.window.contentView.removeChildView(current.view);
    if (!current.view.webContents.isDestroyed()) current.view.webContents.close();
    current.server.close();
  }
  async prepare(window: BrowserWindow, generation: string, videoId: string, position: number): Promise<void> {
    youtubeEmbedUrl(videoId); this.stop(); const sequence = this.sequence;
    if (window.isDestroyed() || window.isMinimized() || !window.isVisible()) throw new Error('Show the singer display before starting YouTube.');
    const token = randomBytes(24).toString('hex'); let port = 0;
    const server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== `/${token}/` || request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline'; frame-src https://www.youtube.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      response.end(youtubeShowPage(videoId, `http://127.0.0.1:${port}`));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); const address = server.address(); if (!address || typeof address === 'string') { reject(new Error('Could not start YouTube.')); return; } port = address.port; resolve(); }); });
    if (this.sequence !== sequence || window.isDestroyed()) { server.close(); throw new Error('The singer display changed while YouTube was opening.'); }
    const isolated = session.fromPartition(`youtube-show-${randomUUID()}`, { cache: false });
    isolated.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*'] }, (details, callback) => {
      const headers = { ...details.requestHeaders }; for (const key of Object.keys(headers)) if (key.toLowerCase() === 'referer') delete headers[key];
      headers.Referer = YOUTUBE_REFERER; callback({ requestHeaders: headers });
    });
    isolated.on('will-download', event => event.preventDefault());
    if (process.platform === 'win32') app.setAppUserModelId(YOUTUBE_APP_ID);
    const view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    const resize = () => {
      if (window.isDestroyed() || this.current?.view !== view) return;
      const [width, height] = window.getContentSize();
      view.setBounds({ x: 0, y: 0, width, height });
      if ((width < 200 || height < 300 || window.isMinimized() || !window.isVisible()) && this.current.status === 'playing') this.fail('The YouTube player must remain visible. Restore or enlarge the singer display, then resume.');
    };
    const visibility = () => { if (this.current?.view === view && this.current.status) this.fail('YouTube paused because the singer display is hidden. Restore it, then resume.'); };
    this.current = { generation, window, view, server, resize, visibility, timer: null, status: null, polling: false, failed: false, changedAt: 0, bufferingSince: 0 };
    resize();
    view.webContents.setWindowOpenHandler(({ url }) => { if (allowedYouTubeLink(url)) void shell.openExternal(url).catch(() => {}); return { action: 'deny' }; });
    view.webContents.on('will-navigate', event => event.preventDefault());
    view.webContents.on('will-attach-webview', event => event.preventDefault());
    view.webContents.on('render-process-gone', () => { if (this.current?.view === view) this.fail('The YouTube player stopped. Stop and restart this performance to try again.'); });
    view.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && this.handlers.shortcut({code:input.code,control:input.control,alt:input.alt,shift:input.shift,meta:input.meta,repeat:input.isAutoRepeat})) event.preventDefault(); });
    try {
      await view.webContents.loadURL(`http://127.0.0.1:${port}/${token}/`);
      const deadline = Date.now() + 20000;
      while (this.current?.view === view) {
        const snapshot = await this.read();
        if (snapshot.error) throw new Error(this.errorMessage(snapshot.error));
        if (snapshot.ready) break;
        if (Date.now() >= deadline) throw new Error('YouTube did not load. Check the internet connection, then try again.');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (this.current?.view !== view || window.isDestroyed()) throw new Error('The singer display was closed.');
      if (position > 0) await this.seek(position);
      window.contentView.addChildView(view); window.on('resize', resize); window.on('minimize', visibility); window.on('hide', visibility); resize();
      this.current.timer = setInterval(() => { void this.poll(); }, 500);
    } catch (error) { if (this.current?.view === view) this.stop(); throw error; }
  }
  private async read(): Promise<Snapshot> {
    const current = this.current;
    if (!current || current.view.webContents.isDestroyed()) throw new Error('YouTube is unavailable.');
    return current.view.webContents.executeJavaScript('window.tpvYouTube ? window.tpvYouTube.snapshot() : ({ready:false,error:null,state:-1,position:0,duration:0})');
  }
  update(generation: string, status: 'playing' | 'paused', caption: string, volume: number): void {
    const current = this.current;
    if (!current || current.generation !== generation || current.failed) return;
    if (current.status !== status) current.changedAt = Date.now();
    current.status = status;
    void current.view.webContents.executeJavaScript(`window.tpvYouTube.set(${JSON.stringify({ status, caption, volume })})`, true).catch(() => { if (this.current === current) this.fail('YouTube is unavailable. Stop and restart this performance to try again.'); });
  }
  private fail(message: string): void {
    const current = this.current; if (!current || current.failed) return;
    current.failed = true;
    if (!current.view.webContents.isDestroyed()) current.view.webContents.setAudioMuted(true);
    try { this.handlers.failure(current.generation, message); } catch { /* Audio stays muted if persistence needs recovery. */ }
  }
  private errorMessage(code: number): string {
    if (code === 100) return 'This YouTube video is unavailable or private. Choose another recording; your turn has not been consumed.';
    if (code === 101 || code === 150) return 'The video owner does not permit embedding. Choose another recording; your turn has not been consumed.';
    if (code === 153) return 'YouTube rejected this application identity. Playback needs an application configuration update.';
    if (code === 999) return 'YouTube blocked playback. Stop and restart this performance, or choose another recording.';
    return 'YouTube could not play this recording. Check the connection or choose another recording; your turn has not been consumed.';
  }
  private async poll(): Promise<void> {
    const current = this.current;
    if (!current || current.polling || !current.status || current.failed) return;
    current.polling = true;
    try {
      if (current.window.isDestroyed() || !current.window.isVisible() || current.window.isMinimized()) { this.fail('YouTube paused because the singer display is hidden. Restore it, then resume.'); return; }
      const value = await this.read(); if (this.current !== current) return;
      if (value.error) { this.fail(this.errorMessage(value.error)); return; }
      if (value.state === 3 && current.status === 'playing') { current.bufferingSince ||= Date.now(); if (Date.now() - current.bufferingSince > 30000) { this.fail('YouTube has been buffering for 30 seconds. Check the connection, then resume or choose another recording.'); return; } } else current.bufferingSince = 0;
      if (Number.isFinite(value.position) && value.position >= 0 && Number.isFinite(value.duration) && value.duration > 0) this.handlers.report(current.generation, { position: value.position, duration: value.duration, seekable: true });
      if (value.state === 0 && current.status === 'playing') this.handlers.ended(current.generation);
      else if (Date.now() - current.changedAt > 1500 && ((value.state === 1 && current.status !== 'playing') || (value.state === 2 && current.status === 'playing'))) this.handlers.nativeStatus(current.generation, value.state === 1 ? 'playing' : 'paused');
    } catch { if (this.current === current) this.fail('The YouTube player is unavailable. Stop and restart this performance to try again.'); }
    finally { current.polling = false; }
  }
  async seek(position: number): Promise<number> {
    if (!Number.isFinite(position) || position < 0 || !this.current) throw new Error('Invalid YouTube position.');
    const current = this.current;
    await current.view.webContents.executeJavaScript(`window.tpvYouTube.seek(${position})`, true);
    const deadline = Date.now() + 5000;
    while (this.current === current) {
      const value = await this.read();
      if (Number.isFinite(value.position) && Math.abs(value.position - position) < 2) return value.position;
      if (Date.now() >= deadline) throw new Error('YouTube did not confirm the seek.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The performance changed before seeking finished.');
  }
}
