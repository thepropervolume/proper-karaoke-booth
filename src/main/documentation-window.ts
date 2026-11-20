import { BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';

let documentation: BrowserWindow | null = null;

export async function openDocumentationWindow(host?: BrowserWindow | null): Promise<void> {
  if (documentation && !documentation.isDestroyed()) {
    if (documentation.isMinimized()) documentation.restore();
    documentation.show();
    documentation.focus();
    return;
  }
  const window = new BrowserWindow({
    title: 'Karaoke Booth Documentation', width: 1000, height: 760, minWidth: 490, minHeight: 400,
    show: false, parent: host && !host.isDestroyed() ? host : undefined,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  documentation = window;
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => { if (documentation === window) documentation = null; });
  try {
    await window.loadFile(join(__dirname, '../ui/src/help/index.html'));
    if (!window.isDestroyed()) window.show();
  } catch {
    if (window.isDestroyed()) return;
    window.destroy();
    dialog.showErrorBox('Documentation unavailable', 'Booth could not open its bundled documentation. Reinstall the current version and try again.');
  }
}
