// Run under xvfb-run with a generated MP4. Uses a temporary profile and muted audio.
import { _electron as electron } from 'playwright-core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import electronPath from 'electron';

const fixture = process.argv[2];
if (!fixture) throw new Error('Pass the path to a synthetic MP4 fixture');
const config = await mkdtemp(join(tmpdir(), 'tpv-smoke-'));
const bootstrap = join(config, 'bootstrap.cjs');
await writeFile(bootstrap, "const { app } = require('electron'); app.setPath('userData', process.env.TPV_TEST_PROFILE); require(process.env.TPV_TEST_ENTRY);\n");
const launch = async () => {
  const instance = await electron.launch({ executablePath: electronPath, args: [bootstrap, `--user-data-dir=${config}`, '--mute-audio'], env: { ...process.env, XDG_CONFIG_HOME: config, TPV_TEST_PROFILE: config, TPV_TEST_ENTRY: resolve('dist/main/index.cjs') } });
  const actual = await instance.evaluate(({ app }) => app.getPath('userData'));
  if (resolve(actual).toLowerCase() !== resolve(config).toLowerCase()) { await instance.close(); throw new Error('Unsafe test profile; refusing to continue.'); }
  await instance.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  return instance;
};
let app;
try {
  app = await launch();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, resolve(fixture));
  const host = await app.firstWindow();
  host.on('pageerror', error => console.error('Host error:', error.message));
  await host.getByRole('button', { name: 'Import Video File' }).click();
  await host.getByRole('listbox', { name: 'Songs' }).getByRole('option').first().waitFor();
  await host.getByRole('button', { name: 'Singers', exact: true }).click();
  await host.getByLabel('Singer name').fill('Rehearsal singer');
  await host.getByRole('button', { name: 'Add singer' }).click();
  await host.getByRole('button', { name: 'Library', exact: true }).click();
  await host.getByRole('listbox', { name: 'Songs' }).getByRole('option').first().click();
  await host.getByLabel('Search library').fill('tpv-rehearsal');
  await host.getByRole('button', { name: 'Add request' }).click();
  await host.getByRole('button', { name: 'Stage next' }).click();
  await host.getByRole('button', { name: 'Singer display' }).click();
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
  const measured = await display.locator('video').evaluate(v => ({ time: v.currentTime, width: v.videoWidth, height: v.videoHeight, readyState: v.readyState }));
  await display.bringToFront();
  await display.keyboard.press('Space');
  await display.waitForFunction(() => document.querySelector('video')?.paused === true);
  await display.keyboard.press('Space');
  await display.waitForFunction(() => document.querySelector('video')?.paused === false);
  await display.keyboard.press('Control+f');
  await host.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search library');
  await display.close();
  if ((await host.evaluate(() => window.tpv.getState())).playback?.status !== 'paused') throw new Error('Closing singer display did not pause playback');
  await host.getByRole('button', { name: 'Singer display' }).click();
  for (let n = 0; n < 50; n++) { display = app.windows().find(w => w !== host); if (display) break; await new Promise(r => setTimeout(r, 100)); }
  await display.locator('#video').waitFor({ state: 'attached' });
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await display.waitForFunction(() => document.querySelector('video')?.paused === false);
  await host.getByRole('button', { name: 'Library', exact: true }).click();
  if (await host.getByLabel('Search library').inputValue() !== 'tpv-rehearsal') throw new Error('Search did not survive queue updates');
  await host.getByRole('button', { name: 'Preferences' }).click();
  await host.getByLabel('Appearance').selectOption('day');
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
  const restored = await app.firstWindow();
  await restored.getByRole('button', { name: 'Play/Pause', exact: true }).waitFor();
  const snapshot = await restored.evaluate(() => window.tpv.getState());
  if (snapshot.playback?.status !== 'paused' || snapshot.requests.length !== 1 || snapshot.versions.length !== 1) throw new Error('Interrupted show did not restore paused');
  await restored.getByRole('button', { name: 'Singer display' }).click();
  let restoredDisplay;
  for (let n = 0; n < 50; n++) { restoredDisplay = app.windows().find(w => w !== restored); if (restoredDisplay) break; await new Promise(r => setTimeout(r, 100)); }
  await restoredDisplay.locator('#video').waitFor({ state: 'attached' });
  await restored.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await restoredDisplay.waitForFunction(() => { const v = document.querySelector('video'); return v && v.duration > 0 && !v.paused; });
  await restoredDisplay.locator('video').evaluate(v => { window.oldVideoForTest = v; v.currentTime = v.duration - 0.5; });
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
    commands.push({type:'stage'}, {type:'start'});
    for (const command of commands) { const result = await window.tpv.command(command); if (!result.ok) throw new Error(result.error); }
    return (await window.tpv.getState()).playback.generationId;
  });
  await restoredDisplay.waitForFunction(generation => { const v = document.querySelector('video'); return v && v !== window.oldVideoForTest && !v.paused; }, next);
  await restoredDisplay.evaluate(() => { window.oldVideoForTest.dispatchEvent(new Event('ended')); window.oldVideoForTest.dispatchEvent(new Event('error')); });
  const afterStale = await restored.evaluate(() => window.tpv.getState());
  if (afterStale.playback?.generationId !== next || afterStale.playback?.status !== 'playing') throw new Error('Old media event affected a new generation');
  console.log('PASS: imported synthetic MP4, requested, accepted, staged, started, decoded video, paused/resumed, paused on display close, survived forced termination without autoplay, completed, and ignored stale media events.');
  console.log('Video measurement:', JSON.stringify(measured));
  console.log('Audio was muted in this automated test; physical audio output was not verified.');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(config, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
