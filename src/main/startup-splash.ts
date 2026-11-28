import { app, BrowserWindow, nativeTheme, screen, shell, type NativeImage } from 'electron';
import { join } from 'node:path';
import type { Settings } from '../domain/settings';
import { BOOTH_PRODUCT_NAME } from './application-menu';

const SITE = 'https://thepropervolume.com/';
const QUIT = 'about:blank#quit-karabooth-startup';
const STALL_MS = 15_000;

/** A lightweight local window while the host loads its show. It receives no host preload or IPC. */
export class StartupSplash {
  private readonly window: BrowserWindow;
  private readonly deadline: ReturnType<typeof setTimeout>;
  private webOpened = false;
  private dismissing = false;

  constructor(uiRoot: string, appearance: Settings['appearance'], icon: NativeImage | string | undefined) {
    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.max(1, Math.min(620, workArea.width - 32));
    const height = Math.max(1, Math.min(360, workArea.height - 32));
    const night = appearance === 'night' || (appearance === 'system' && nativeTheme.shouldUseDarkColors);
    const window = new BrowserWindow({
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width, height, title: BOOTH_PRODUCT_NAME, icon, backgroundColor: night ? '#090E18' : '#FDFEF8',
      show: false, frame: false, resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
    });
    this.window = window;
    window.removeMenu();
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url === SITE) {
        this.webOpened = true;
        void shell.openExternal(SITE).catch(() => { this.webOpened = false; });
      }
      if (url === QUIT) app.quit();
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.on('closed', () => {
      if (!this.dismissing) app.quit();
    });
    window.webContents.once('render-process-gone', () => this.dismiss());
    const loaded = window.loadFile(join(uiRoot, 'splash/index.html'), { query: { theme: night ? 'night' : 'day' } });
    void loaded.then(() => {
      if (!window.isDestroyed()) window.show();
    }).catch(() => this.dismiss());
    this.deadline = setTimeout(() => {
      void loaded.then(() => {
        if (!window.isDestroyed()) return window.webContents.executeJavaScript("document.documentElement.dataset.startupState = 'waiting'");
      }).catch(() => {});
    }, STALL_MS);
    this.deadline.unref();
  }

  showHost(host: BrowserWindow): void {
    // A website click or task switch should not pull focus back from another application.
    if (this.webOpened || (!this.window.isDestroyed() && this.window.isVisible() && !this.window.isFocused())) host.showInactive();
    else host.show();
    this.dismiss();
  }

  focus(): void {
    if (!this.window.isDestroyed() && this.window.isVisible()) this.window.focus();
  }

  dismiss(): void {
    clearTimeout(this.deadline);
    this.dismissing = true;
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}
