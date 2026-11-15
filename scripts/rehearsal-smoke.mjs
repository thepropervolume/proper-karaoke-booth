// Run under xvfb-run with a generated MP4. Uses a temporary profile and muted audio.
import { _electron as electron } from 'playwright-core';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import electronPath from 'electron';

const fixture = process.argv[2];
if (!fixture) throw new Error('Pass the path to a synthetic MP4 fixture');
const config = await mkdtemp(join(tmpdir(), 'tpv-smoke-'));
const canonicalConfig = await realpath(config), temporaryRoot = await realpath(tmpdir());
const searchText = basename(fixture, '.mp4');
await writeFile(join(config, 'settings.json'), JSON.stringify({ settingsVersion: 2, sharedCatalogEnabled: false, providerCatalogEnabled: false,
  youtubeSearchEnabled: false, autoBumper: false, bumperOnLaunch: false, autoAdvance: false, singerScreenEnabled: false }));
const bootstrap = join(config, 'bootstrap.cjs');
await writeFile(bootstrap, "const { app, session } = require('electron'); app.setPath('userData', process.env.TPV_TEST_PROFILE); globalThis.fetch=async()=>{throw Error('External requests disabled for playback rehearsal.');}; app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true}))); require(process.env.TPV_TEST_ENTRY);\n");
async function hostWindow(instance) {
  for (let n = 0; n < 300; n++) { const page = instance.windows().find(value => value.url().includes('/renderer/')); if (page) { await page.waitForFunction(() => !!window.tpv); return page; } await new Promise(resolve => setTimeout(resolve, 50)); }
  throw Error('Host window did not load.');
}
const launch = async () => {
  const environment = { ...process.env, XDG_CONFIG_HOME: join(config, 'config'), XDG_DATA_HOME: join(config, 'data'), APPDATA: join(config, 'appdata'), LOCALAPPDATA: join(config, 'localappdata'), TPV_TEST_PROFILE: canonicalConfig, TPV_TEST_ENTRY: resolve('dist/main/index.cjs') };
  delete environment.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ executablePath: electronPath, args: [bootstrap, `--user-data-dir=${canonicalConfig}`, '--mute-audio'], env: environment });
  const actual = await instance.evaluate(({ app }) => app.getPath('userData'));
  if (resolve(actual).toLowerCase() !== resolve(config).toLowerCase()) { await instance.close(); throw new Error('Unsafe test profile; refusing to continue.'); }
  await instance.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  return instance;
};
let app;
try {
  app = await launch();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, resolve(fixture));
  const host = await hostWindow(app);
  host.on('pageerror', error => console.error('Host error:', error.message));
  await host.getByRole('button', { name: 'Import Video File' }).click();
  await host.getByRole('listbox', { name: 'Songs' }).getByRole('option').first().waitFor();
  await host.getByRole('button', { name: 'Singers', exact: true }).click();
  await host.getByLabel('Singer name').fill('Rehearsal singer');
  await host.getByRole('button', { name: 'Add singer' }).click();
  await host.getByRole('button', { name: 'Library', exact: true }).click();
  await host.getByRole('listbox', { name: 'Songs' }).getByRole('option').first().dblclick();
  const requestDialog = host.getByRole('dialog', { name: 'Add to Queue' });
  const singerId = (await host.evaluate(() => window.tpv.getState())).singers[0].id;
  await requestDialog.getByRole('combobox').selectOption(singerId);
  await requestDialog.getByRole('button', { name: 'Add to Queue', exact: true }).click();
  await requestDialog.waitFor({ state: 'hidden' });
  await host.getByLabel('Search library').fill(searchText);
  await host.waitForFunction(value => document.querySelector('input[aria-label="Search library"]')?.value === value, searchText);
  await host.getByRole('button', { name: 'Singer display', exact: true }).click();
  let display;
  for (let n = 0; n < 50; n++) {
    display = app.windows().find(w => w !== host);
    if (display) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!display) throw new Error('Singer display did not open');
  await display.locator('#video').waitFor({ state: 'attached' });
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await display.waitForFunction(() => { const v = document.querySelector('video'); return v && v.currentTime > 1 && v.videoWidth > 0 && !v.paused; }, null, { timeout: 15000 });
  const measured = await display.locator('#video').evaluate(v => ({ time: v.currentTime, width: v.videoWidth, height: v.videoHeight, readyState: v.readyState }));
  await display.bringToFront();
  await display.keyboard.press('Space');
  await display.waitForFunction(() => document.querySelector('video')?.paused === true);
  await display.keyboard.press('Space');
  await display.waitForFunction(() => document.querySelector('video')?.paused === false);
  await display.keyboard.press('Control+f');
  await host.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search library');
  const beforeClose = await host.evaluate(() => window.tpv.getState());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/')).close());
  if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/')).isVisible())) throw Error('Closing singer display did not hide it');
  const afterClose = await host.evaluate(() => window.tpv.getState());
  if (afterClose.playback?.status !== 'playing' || afterClose.playback.generationId !== beforeClose.playback.generationId) throw Error('Closing the visible singer window interrupted the preview/audio renderer');
  await host.getByRole('button', { name: 'Singer display', exact: true }).click();
  for (let n = 0; n < 50; n++) { display = app.windows().find(w => w !== host); if (display) break; await new Promise(r => setTimeout(r, 100)); }
  await display.locator('#video').waitFor({ state: 'attached' });
  await display.waitForFunction(() => document.querySelector('video')?.paused === false);
  await host.getByRole('button', { name: 'Library', exact: true }).click();
  const retainedSearch = await host.getByLabel('Search library').inputValue();
  if (retainedSearch !== searchText) throw new Error(`Search did not survive queue updates: ${JSON.stringify(retainedSearch)} expected ${JSON.stringify(searchText)}`);
  await host.getByRole('button', { name: 'Preferences' }).click();
  await host.getByRole('combobox', { name: /^Appearance/ }).selectOption('day');
  await host.getByLabel('Workspace layout').selectOption('rotation');
  await host.getByText('Audio Controls', { exact: true }).click();
  await host.getByRole('slider', { name: 'Playback Volume' }).fill('0');
  await host.getByRole('button', { name: 'Save preferences' }).click();
  await host.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-layout') === 'rotation' && document.documentElement.dataset.theme === 'day');
  if (await host.locator('html').getAttribute('data-theme') !== 'day') throw new Error('Day theme was not applied');
  if (await host.locator('.app').getAttribute('data-layout') !== 'rotation') throw new Error('Workspace layout was not applied');
  await display.waitForFunction(() => document.querySelector('video')?.volume === 0);
  if ((await host.evaluate(() => window.tpv.getSettings())).settings.masterVolume !== 0) throw new Error('Playback volume was not saved');
  await host.screenshot({ path: join(config, 'host.png') });
  const process = app.process();
  const exited = new Promise((resolve, reject) => {
    if (process.exitCode !== null || process.signalCode !== null) return resolve();
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for the terminated Electron process')), 10000);
    process.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
  if (globalThis.process.platform === 'win32') execFileSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill('SIGKILL');
  await exited;
  app = undefined;
  app = await launch();
  const restored = await hostWindow(app);
  await restored.getByRole('button', { name: 'Play/Pause', exact: true }).waitFor();
  const snapshot = await restored.evaluate(() => window.tpv.getState());
  if (snapshot.playback?.status !== 'paused' || snapshot.requests.length !== 1 || snapshot.versions.length !== 1) throw new Error('Interrupted show did not restore paused');
  await restored.getByRole('button', { name: 'Singer display', exact: true }).click();
  let restoredDisplay;
  for (let n = 0; n < 50; n++) { restoredDisplay = app.windows().find(w => w !== restored); if (restoredDisplay) break; await new Promise(r => setTimeout(r, 100)); }
  await restoredDisplay.locator('#video').waitFor({ state: 'attached' });
  await restored.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await restoredDisplay.waitForFunction(() => { const v = document.querySelector('video'); return v && v.duration > 0 && !v.paused; });
  await restoredDisplay.locator('#video').evaluate(v => { window.oldVideoForTest = v; v.currentTime = v.duration - 0.5; });
  let completed = false;
  for (let n = 0; n < 100; n++) {
    completed = (await restored.evaluate(() => window.tpv.getState())).requests[0].status === 'completed';
    if (completed) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!completed) throw new Error('Natural completion did not update the queue');
  const next = await restored.evaluate(async () => {
    const s = await window.tpv.getState();
    const commands = [ {type:'request', requestId:crypto.randomUUID(), singerId:s.singers[0].id, versionId:s.versions[0].id} ];
    for (const command of commands) { const result = await window.tpv.command(command); if (!result.ok) throw new Error(result.error); }
    const result = await window.tpv.playPause(); if (!result.ok) throw Error(result.error);
    return (await window.tpv.getState()).playback.generationId;
  });
  await restoredDisplay.waitForFunction(generation => { const v = document.querySelector('video'); return v && v !== window.oldVideoForTest && !v.paused; }, next);
  await restoredDisplay.evaluate(() => { window.oldVideoForTest.dispatchEvent(new Event('ended')); window.oldVideoForTest.dispatchEvent(new Event('error')); });
  const afterStale = await restored.evaluate(() => window.tpv.getState());
  if (afterStale.playback?.generationId !== next || afterStale.playback?.status !== 'playing') throw new Error('Old media event affected a new generation');
  console.log('PASS: synthetic import, request dialog, automatic preparation, decoding, global-search shortcut, Space pause/resume, Close hides without interrupting playback, interrupted-show recovery without autoplay, natural completion and stale media-event isolation.');
  console.log('Video measurement:', JSON.stringify(measured));
  console.log('Audio was muted in this automated test; physical audio output was not verified.');
} finally {
  if (app) await app.close().catch(() => {});
  if (await realpath(config) !== canonicalConfig || dirname(canonicalConfig) !== temporaryRoot) throw Error('Unsafe playback rehearsal cleanup path.');
  await rm(canonicalConfig, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
