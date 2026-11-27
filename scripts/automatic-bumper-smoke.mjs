// Isolated, muted Electron rehearsal. Builds into a temporary directory and
// exercises the default output without audible sound; this does not verify
// physical speakers, monitor hot-plug or real hardware routing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const tempRoot = await realpath(tmpdir()), temp = await mkdtemp(join(tempRoot, 'tpv-auto-bumper-'));
const profile = join(temp, 'profile'), stage = join(temp, 'stage'); await mkdir(profile); await mkdir(stage);
const canonicalProfile = await realpath(profile), fixture = join(temp, 'Synthetic Artist - Intermission.mp4');
const customBumper = join(temp, 'Synthetic Bumper.wav');
await writeFile(join(profile, 'settings.json'), JSON.stringify({ settingsVersion: 2, sharedCatalogEnabled: false,
  providerCatalogEnabled: false, youtubeSearchEnabled: false, localControlEnabled: false, singerScreenEnabled: false,
  hostPreviewPosition: 'above', autoAdvance: true, autoBumper: true, bumperOnLaunch: true, bumperFadeMs: 1000,
  autoBumperTrackId: 'builtin-sunset', pauseIntervalSeconds: 2, masterVolume: 0, lyricBackdrop: 'none' }));
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app,dialog}=require('electron'); const fs=require('node:fs'); app.setPath('userData',process.env.TPV_QA_PROFILE); app.setAppPath(process.env.TPV_QA_REPO); if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile'); globalThis.fetch=async()=>{throw Error('External requests disabled in automation rehearsal');}; dialog.showMessageBox=async()=>({response:0,checkboxChecked:false}); require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: join(stage, 'dist/main/index.cjs'),
  TPV_QA_REPO: repo,
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
async function poll(read, predicate, description) {
  for (let n = 0; n < 300; n++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Timed out waiting for ${description}.`);
}
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args, env, cwd: repo, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile, 'Refusing to use a non-disposable profile.');
  const host = await poll(async () => app.windows().find(page => page.url().includes('/renderer/')), value => !!value, 'host window');
  await host.waitForFunction(() => !!window.tpv); return host;
};
try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=10:d=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { windowsHide: true });
  await viteBuild({ configFile: false, root: repo, base: './', build: { outDir: join(stage, 'dist/ui'), emptyOutDir: true, manifest: true,
    rollupOptions: { input: { host: join(repo, 'src/renderer/index.html'), display: join(repo, 'src/display/index.html'), singer: join(repo, 'src/remote/index.html') } } } });
  await Promise.all(['main', 'preload'].map(name => bundle({ entryPoints: [join(repo, `src/${name}/index.ts`)], outfile: join(stage, `dist/${name}/index.cjs`), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] })));
  let host = await launch();
  await poll(() => host.evaluate(() => window.tpv.getBumpers()), info => info.status.status === 'playing', 'startup bumper on the default output');
  await poll(() => host.evaluate(() => window.tpv.singerScreens.preview()), frame => !!frame?.image, 'preview with no visible singer window');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/'))?.isVisible()), false);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'Launch must never start karaoke.');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, fixture);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await poll(() => host.evaluate(() => window.tpv.getState()), value => value.versions.length === 1, 'synthetic import');
  const version = (await host.evaluate(() => window.tpv.getState())).versions[0];
  const send = async command => { const result = await host.evaluate(c => window.tpv.command(c), command); assert.equal(result.ok, true, result.error); };
  await send({ type: 'addSinger', singer: { id: 'auto-bumper-singer', name: 'QA Singer' } });
  for (const requestId of ['auto-one', 'auto-two', 'auto-three']) await send({ type: 'request', requestId, singerId: 'auto-bumper-singer', versionId: version.id });
  assert.equal((await host.evaluate(() => window.tpv.getState())).stagedRequestId, 'auto-one', 'Approved requests prepare automatically.');
  const display = app.windows().find(page => page !== host); assert.ok(display, 'The hidden singer renderer must exist.');
  const played = await host.evaluate(() => window.tpv.playPause()); assert.equal(played.ok, true, played.error);
  await display.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0 && !v.paused; }, null, { timeout: 15000 });
  assert.equal((await host.evaluate(() => window.tpv.getState())).stagedRequestId, 'auto-two');
  assert.equal((await host.evaluate(() => window.tpv.getBumpers())).status.status, 'stopped');
  await host.waitForFunction(() => document.querySelectorAll('[data-queue-list] [aria-label^="Approximate wait "]').length === 2);
  assert.equal(await host.locator('[data-queue-list] [aria-label^="Approximate wait "]').first().getAttribute('aria-label'), 'Approximate wait ~1 min');
  const paused = await host.evaluate(() => window.tpv.playPause()); assert.equal(paused.ok, true, paused.error);
  await host.waitForFunction(() => document.querySelectorAll('[data-queue-list] [aria-label^="Approximate wait "]').length === 0);
  assert.equal(await host.getByText('Some waits unavailable ⓘ').isVisible(), true);
  const continued = await host.evaluate(() => window.tpv.playPause()); assert.equal(continued.ok, true, continued.error);
  // Native Close hides the same renderer. Capturing it must not reopen it or
  // create a second audio player when the next singer begins.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/')).close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/'))?.isVisible()), false);
  await poll(() => host.evaluate(() => window.tpv.singerScreens.preview()), frame => !!frame?.image, 'playing preview after hiding the singer window');
  await display.locator('#video').evaluate(v => { v.currentTime = v.duration - 0.15; });
  await poll(() => host.evaluate(() => window.tpv.getState()), s => s.requests.some(r => r.id === 'auto-one' && r.status === 'completed'), 'natural completion');
  const firstBumper = await poll(() => host.evaluate(() => window.tpv.getBumpers()), info => info.status.status === 'playing', 'automatic bumper after completion');
  assert.equal(firstBumper.status.trackId, 'builtin-sunset', 'Use the saved automatic track.');
  assert.equal(await display.locator('#video').evaluate(v => v.paused && v.muted), true, 'Bumper must start only after karaoke is silent.');
  const firstGap = (await host.evaluate(() => window.tpv.getState())).nextStartAtMs;
  assert.ok(firstGap > Date.now(), 'The gap must remain active while the bumper plays.');
  await poll(() => host.evaluate(() => window.tpv.getState()), s => s.playback?.requestId === 'auto-two', 'next singer without another Play click');
  assert.ok(Date.now() >= firstGap, 'Automatic playback must respect the entire gap.');
  assert.equal((await host.evaluate(() => window.tpv.getBumpers())).status.status, 'stopped', 'Karaoke must wait for bumper silence.');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/'))?.isVisible()), false, 'Automatic playback must preserve the hidden singer window.');
  const generation = (await host.evaluate(() => window.tpv.getState())).playback.generationId;
  await send({ type: 'skip', generationId: generation, confirmed: true });
  await poll(() => host.evaluate(() => window.tpv.getBumpers()), info => info.status.status === 'playing', 'automatic bumper after skip');
  // Stop during an interlude cancels the pending start even though no karaoke
  // generation is active; the queued request remains staged for a deliberate Play.
  await send({ type: 'stop' });
  await new Promise(resolve => setTimeout(resolve, 2300));
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  assert.equal((await host.evaluate(() => window.tpv.getState())).stagedRequestId, 'auto-three');
  assert.equal((await host.evaluate(() => window.tpv.getBumpers())).status.status, 'stopped');
  const resumed = await host.evaluate(() => window.tpv.playPause()); assert.equal(resumed.ok, true, resumed.error);
  await send({ type: 'pause' });
  await app.close(); app = undefined;
  host = await launch();
  const afterRestart = await poll(() => host.evaluate(() => window.tpv.getBumpers()), info => info.status.status === 'playing', 'launch bumper with an interrupted paused performance');
  assert.equal(afterRestart.outputReady, true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'paused', 'Restart must not resume karaoke.');
  assert.equal((await host.evaluate(() => window.tpv.getSettings())).settings.autoBumperTrackId, 'builtin-sunset', 'Selected bumper track must survive restart.');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', customBumper], { windowsHide: true });
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, customBumper);
  const added = await host.evaluate(() => window.tpv.addBumpers());
  const custom = added.tracks.filter(track => !track.builtIn);
  assert.equal(custom.length, 1);
  await host.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = host.getByRole('dialog', { name: 'Preferences', exact: true });
  await preferences.locator('summary').filter({ hasText: /^Audio & Display$/ }).click();
  await preferences.getByRole('checkbox', { name: 'Include built-in bumper tracks' }).uncheck();
  const trackPicker = preferences.getByLabel('Automatic bumper track');
  assert.deepEqual(await trackPicker.locator('option').evaluateAll(options => options.map(option => option.value)), [custom[0].id]);
  await preferences.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await preferences.waitFor({ state: 'hidden' });
  assert.equal((await host.evaluate(() => window.tpv.getBumpers())).status.status, 'stopped');
  await app.close(); app = undefined;
  host = await launch();
  const customLaunch = await poll(() => host.evaluate(() => window.tpv.getBumpers()), info => info.status.status === 'playing', 'custom-only launch bumper');
  assert.equal(customLaunch.status.trackId, custom[0].id);
  console.log('PASS: launch and interlude audio, automatic queue advance, Stop, and restart with one custom bumper. Audio was muted.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(temp);
  if (dirname(actual) !== tempRoot || !actual.startsWith(tempRoot + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-auto-bumper-')) throw new Error('Unsafe QA cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
