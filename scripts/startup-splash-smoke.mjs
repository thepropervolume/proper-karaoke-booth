// Run after npm run build. Uses disposable app data and intercepts website opening.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const root = await realpath(resolve('.'));
const require = createRequire(join(root, 'package.json'));
const { _electron } = require('playwright-core');
const tempRoot = await realpath(tmpdir());
const scratch = await realpath(await mkdtemp(join(tempRoot, 'tpv-startup-splash-')));
assert.equal(dirname(scratch), tempRoot);
const bootstrap = join(scratch, 'bootstrap.cjs');

await writeFile(bootstrap, `
const { app, BrowserWindow, nativeTheme, shell } = require('electron');
app.setPath('userData', process.env.TPV_SPLASH_PROFILE);
app.setAppPath(${JSON.stringify(root)});
if (require('node:fs').realpathSync(app.getPath('userData')) !== process.env.TPV_SPLASH_PROFILE) throw Error('Unsafe profile');
nativeTheme.themeSource = 'dark';
globalThis.qaOpened = [];
globalThis.qaHostInactive = false;
shell.openExternal = async url => { globalThis.qaOpened.push(url); };
const { showInactive } = BrowserWindow.prototype;
BrowserWindow.prototype.showInactive = function () {
  if (this.webContents.getURL().includes('/renderer/')) globalThis.qaHostInactive = true;
  return showInactive.call(this);
};
const ready = new Promise(resolve => { globalThis.qaReleaseHost = resolve; });
const files = require('node:fs/promises');
const { open } = files;
files.open = function (path, ...args) {
  return typeof path === 'string' && path.endsWith('singer-display-logo')
    ? ready.then(() => open(path, ...args)) : open(path, ...args);
};
require(${JSON.stringify(join(root, 'dist/main/index.cjs'))});
`);

async function launch(appearance) {
  const profile = join(scratch, appearance);
  await mkdir(profile);
  await writeFile(join(profile, 'settings.json'), JSON.stringify({
    appearance, desktopUpdateMode: 'off', providerCatalogEnabled: false, sharedCatalogEnabled: false,
    autoBumper: false, bumperOnLaunch: false,
  }));
  const env = { ...process.env, TPV_SPLASH_PROFILE: profile,
    APPDATA: join(scratch, 'appdata'), LOCALAPPDATA: join(scratch, 'localappdata'),
    XDG_CONFIG_HOME: join(scratch, 'config'), XDG_DATA_HOME: join(scratch, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  return _electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: root, env });
}

async function splashPage(electron) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    const splash = electron.windows().find(page => page.url().includes('/splash/index.html'));
    if (splash) {
      await splash.getByRole('heading', { name: 'KaraBooth' }).waitFor();
      return splash;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Startup splash is unavailable.');
}

let electron;
try {
  electron = await launch('day');
  console.log('Opened the disposable Electron profile.');
  const splash = await splashPage(electron);
  console.log('Checking the Day splash and website link.');
  assert.equal(await splash.title(), 'The Proper Volume Karaoke Booth');
  await splash.waitForFunction(() => !!document.documentElement.dataset.theme);
  assert.equal(await splash.locator('html').getAttribute('data-theme'), 'day', 'Saved Day overrides the test system Night theme.');
  const link = splash.getByRole('link', { name: 'Open thepropervolume.com in your browser' });
  await splash.emulateMedia({ reducedMotion: 'reduce' });
  await splash.keyboard.press('Tab');
  assert.ok(await link.evaluate(element => document.activeElement === element));
  await splash.keyboard.press('Enter');
  assert.deepEqual(await electron.evaluate(() => globalThis.qaOpened), ['https://thepropervolume.com/']);
  await splash.evaluate(() => { window.open('https://example.invalid/', '_blank'); });
  assert.equal(await electron.evaluate(() => globalThis.qaOpened.length), 1);
  assert.equal(await splash.evaluate(() => typeof window.tpv), 'undefined');
  const handoff = splash.waitForEvent('close', { timeout: 8000 });
  await electron.evaluate(() => globalThis.qaReleaseHost());
  const host = await waitForHostWindow(electron);
  await handoff;
  await host.getByRole('searchbox', { name: 'Search library' }).waitFor();
  assert.ok(await electron.evaluate(() => globalThis.qaHostInactive), 'Website activation preserves browser focus.');
  console.log('Checking Escape on startup in System appearance.');
  await electron.close();

  electron = await launch('system');
  const systemSplash = await splashPage(electron);
  assert.equal(await systemSplash.locator('html').getAttribute('data-theme'), 'night');
  const quit = electron.waitForEvent('close', { timeout: 8000 });
  await systemSplash.keyboard.press('Escape').catch(error => {
    if (!/Target page, context or browser has been closed/.test(String(error))) throw error;
  });
  await quit;
  electron = undefined;
  console.log('PASS: Day/System themes, restricted website link, host-ready handoff and early Quit.');
} finally {
  await electron?.close().catch(() => {});
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
