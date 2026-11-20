// Exercise native menu callbacks in Electron with no real show, media, or network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const root = await realpath(tmpdir()), temp = await mkdtemp(join(root, 'tpv-application-menu-'));
const profile = join(temp, 'profile'), bootstrap = join(temp, 'bootstrap.cjs');
await mkdir(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ sharedCatalogEnabled: false, youtubeSearchEnabled: false, autoBumper: false,
  bumperOnLaunch: false, autoAdvance: false }));
await writeFile(bootstrap, `
const { app, dialog, shell } = require('electron');
const { realpathSync } = require('node:fs');
app.setPath('userData', process.env.TPV_MENU_QA_PROFILE);
app.setAppPath(process.env.TPV_MENU_QA_REPO);
if (realpathSync(app.getPath('userData')) !== realpathSync(process.env.TPV_MENU_QA_PROFILE)) throw Error('Unsafe menu QA profile.');
globalThis.menuQa = { dialogs: [], external: [] };
globalThis.fetch = async () => new Response('QA offline', { status: 503 });
shell.openExternal = async (url) => { menuQa.external.push(url); };
dialog.showOpenDialog = async (window, options) => { menuQa.dialogs.push(options.title); return { canceled: true, filePaths: [] }; };
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
require(process.env.TPV_MENU_QA_ENTRY);`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { TPV_MENU_QA_PROFILE: profile, TPV_MENU_QA_REPO: repo, TPV_MENU_QA_ENTRY: join(repo, 'dist/main/index.cjs'),
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') });
const args = [bootstrap, `--user-data-dir=${profile}`, '--mute-audio', '--disable-background-networking'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args, cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  const host = await waitForHostWindow(app);
  const check = (predicate, arg) => waitForHostCondition(app, predicate, arg);
  const windowState = (path, full) => check(({ BrowserWindow }, { path, full }) => BrowserWindow.getAllWindows().some(window =>
    window.webContents.getURL().includes(path) && window.isVisible() && window.isFullScreen() === full), { path, full });
  const click = (labels, enabled = true) => check(({ Menu, BrowserWindow }, { labels, enabled }) => {
    let menu = Menu.getApplicationMenu(), item;
    for (const label of labels) {
      item = menu?.items.find(value => value.label === label);
      if (!item) throw Error(`Menu is missing ${labels.join(' → ')}`);
      menu = item.submenu;
    }
    if (item.enabled !== enabled) return false;
    if (enabled) item.click(item, BrowserWindow.getFocusedWindow(), {});
    return true;
  }, { labels, enabled });

  await click(['Playback', 'Play / Pause'], false);
  await click(['Edit', 'Preferences…']);
  const preferences = host.getByRole('dialog', { name: 'Preferences', exact: true });
  await preferences.waitFor();
  await click(['File', 'Import Video…'], false);
  await preferences.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const [label, title] of [['Import Video…', 'Import local MP4 files'], ['Import Folder…', 'Import MP4 folder'],
    ['Import CD+G / LRC / ZIP…', 'Import CD+G, LRC or ZIP']]) {
    await click(['File', label]);
    await check((_electron, title) => globalThis.menuQa.dialogs.includes(title), title);
  }
  await click(['Edit', 'Find Song']);
  await waitForHostCondition(host, () => document.activeElement?.getAttribute('aria-label') === 'Search library');
  await click(['View', 'Font', 'Serif']);
  await waitForHostCondition(host, async () => (await window.tpv.getSettings()).settings.fontFamily === 'serif');

  await click(['Window', 'Toggle Singer Display Full Screen'], false);
  await click(['Window', 'Open Singer Display']);
  await windowState('/display/index.html', false);
  const singer = app.windows().find(page => page.url().includes('/display/index.html'));
  assert.ok(singer);
  await click(['Window', 'Toggle Singer Display Full Screen']);
  await windowState('/display/index.html', true);
  await windowState('/renderer/index.html', false);
  await click(['Window', 'Toggle Singer Display Full Screen']);
  await windowState('/display/index.html', false);
  await click(['Window', 'Toggle Host Full Screen']);
  await windowState('/renderer/index.html', true);
  await windowState('/display/index.html', false);
  await singer.keyboard.press('F11');
  await singer.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window =>
    window.webContents.getURL().includes('/renderer/index.html')).isFullScreen()), true);
  await click(['Window', 'Show Host Window']);
  await host.keyboard.press('F11');
  await windowState('/renderer/index.html', false);

  const openHelp = app.waitForEvent('window', { predicate: page => page !== host && page !== singer });
  await click(['Help', 'Documentation']);
  const help = await openHelp;
  await help.getByRole('heading', { name: 'Karaoke Booth Documentation', exact: true }).waitFor();
  const safe = () => help.evaluate(() => typeof window.tpv === 'undefined' && typeof window.tpvDisplay === 'undefined' &&
    Array.from(document.querySelectorAll('a[href]')).every(link => link.getAttribute('href').startsWith('#')));
  assert.equal(await safe(), true);
  await help.getByRole('navigation', { name: 'Documentation topics' }).getByRole('link', { name: 'Queue Management', exact: true }).click();
  await help.getByRole('heading', { name: 'Queue Management', exact: true }).waitFor();
  assert.equal(await safe(), true);
  await click(['Help', 'Documentation']);
  assert.deepEqual(app.windows().filter(page => page.url().includes('/help/index.html')), [help]);
  assert.equal(await help.getByRole('heading', { name: 'Queue Management', exact: true }).isVisible(), true);
  assert.deepEqual(await app.evaluate(() => globalThis.menuQa.external), []);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  console.log('Native File, Edit, font, separate host/singer fullscreen, F11 and offline Help menu passed.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(temp);
  if (dirname(actual) !== root || !actual.startsWith(root + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-application-menu-')) throw Error('Unsafe menu QA cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
