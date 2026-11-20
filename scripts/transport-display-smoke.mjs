// Synthetic, muted, disposable show only. No user media or profile is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';

const repo = await realpath(resolve(process.argv[2] ?? '.'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const parent = await realpath(tmpdir());
const directory = await mkdtemp(join(parent, 'tpv-transport-qa-'));
const profile = join(directory, 'profile'); await mkdir(profile);
const stage = join(directory, 'stage'); await mkdir(stage);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ settingsVersion: 2, sharedCatalogEnabled: false,
  providerCatalogEnabled: false, youtubeSearchEnabled: false, localControlEnabled: false, singerScreenEnabled: false,
  autoBumper: false, bumperOnLaunch: false, autoAdvance: false, masterVolume: 0, lyricBackdrop: 'none' }));
const fixture = join(directory, 'QA Artist - Transport.mp4');
const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { windowsHide: true });
assert.equal(made.status, 0, made.stderr?.toString());
const bootstrap = join(directory, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app, dialog } = require('electron'); const fs = require('node:fs');
app.setPath('userData', process.env.TPV_QA_PROFILE); app.setAppPath(process.env.TPV_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile');
globalThis.__tpvQaChooserCount=0;
globalThis.fetch=async()=>{throw Error('External requests disabled in transport rehearsal');};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_FIXTURE]});
dialog.showMessageBox=async(_window,options)=>{if(options?.title==='Choose singer display'){globalThis.__tpvQaChooserCount++;throw Error('Automatic Play must not open a screen chooser');}return{response:0,checkboxChecked:false};};
require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: await realpath(profile), TPV_QA_REPO: repo, TPV_QA_FIXTURE: fixture,
  TPV_QA_ENTRY: join(stage, 'dist/main/index.cjs'), APPDATA: join(directory, 'appdata'), LOCALAPPDATA: join(directory, 'localappdata'),
  XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  let host;
  for (let n = 0; n < 300; n++) { host = app.windows().find(page => page.url().includes('/renderer/')); if (host) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(host, 'The host interface must load.'); await host.waitForFunction(() => !!window.tpv?.playPause && !!window.tpv?.restartTrack);
  await waitForHostCondition(host, async () => !!(await window.tpv.singerScreens.preview())?.image);
  return host;
};
const singer = host => app.windows().find(page => page !== host && page.url().includes('/display/'));
const closeSinger = async host => {
  const page = singer(host); assert.ok(page, 'Singer window must be open.');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/')).close());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/'))?.isVisible()), false);
  assert.equal(singer(host), page, 'Close must hide the same preview/audio renderer.');
};
const destroySinger = async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/'))?.destroy());
  const deadline = performance.now() + 3000;
  while (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('/display/')))) {
    assert.ok(performance.now() < deadline, 'Native singer window did not close.');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
try {
  await viteBuild({ configFile: false, root: repo, base: './', logLevel: 'error', build: { outDir: join(stage, 'dist/ui'), emptyOutDir: true,
    rollupOptions: { input: { host: join(repo, 'src/renderer/index.html'), display: join(repo, 'src/display/index.html'), singer: join(repo, 'src/remote/index.html') } } } });
  await Promise.all(['main', 'preload'].map(name => bundle({ entryPoints: [join(repo, `src/${name}/index.ts`)], outfile: join(stage, `dist/${name}/index.cjs`), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] })));
  let host = await launch();
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  assert.equal(app.windows().length, 2, 'Startup prepares one hidden singer renderer without starting karaoke.');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/'))?.isVisible()), false);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await waitForHostCondition(host, async () => (await window.tpv.imports.status())?.phase === 'completed');
  const library = await host.evaluate(() => window.tpv.getState());
  assert.equal(library.versions.length, 1);
  await host.evaluate(async versionId => {
    for (const command of [{ type: 'addSinger', singer: { id: 'qa-singer', name: 'Transport QA' } },
      { type: 'request', requestId: 'qa-request', singerId: 'qa-singer', versionId }]) {
      const result = await window.tpv.command(command); if (!result.ok) throw Error(result.error);
    }
  }, library.versions[0].id);
  const starts = await host.evaluate(() => Promise.all([window.tpv.playPause(), window.tpv.playPause(), window.tpv.playPause()]));
  assert.ok(starts.every(result => result.ok), JSON.stringify(starts));
  let active = await host.evaluate(() => window.tpv.getState());
  const generation = active.playback.generationId;
  assert.equal(active.playback.status, 'playing'); assert.equal(active.playback.requestId, 'qa-request');
  assert.equal(active.usedGenerationIds.length, 1); assert.equal(app.windows().length, 2);
  assert.equal(await app.evaluate(() => globalThis.__tpvQaChooserCount), 0);
  const placementPath = join(profile, 'singer-display-placement.json');
  const placement = JSON.parse(await readFile(placementPath, 'utf8'));
  assert.equal(placement.version, 1); assert.ok(Number.isSafeInteger(placement.displayId));
  await waitForHostCondition(host, async () => (await window.tpv.getTimeline()).seekable);
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.equal((await host.evaluate(generation => window.tpv.seek({ generation, position: 8 }), generation)).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.restartTrack())).ok, true);
  active = await host.evaluate(() => window.tpv.getState());
  assert.equal(active.playback.generationId, generation); assert.equal(active.playback.status, 'playing');
  assert.equal(active.usedGenerationIds.length, 1); assert.equal(active.requests[0].status, 'playing');
  assert.ok((await host.evaluate(() => window.tpv.getTimeline())).position < 2, 'Previous restarts the same song at zero.');
  const display = singer(host); assert.ok(display);
  assert.equal(await display.evaluate(async () => { try { await window.tpv.playPause(); return false; } catch { return true; } }), true, 'Only the host can invoke the transport IPC.');
  await host.evaluate(() => window.tpv.playPause());
  await closeSinger(host);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'paused');
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.equal(app.windows().length, 2);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.generationId, generation);
  assert.equal(JSON.parse(await readFile(placementPath, 'utf8')).displayId, placement.displayId);
  await host.evaluate(() => window.tpv.playPause());
  await app.close(); app = undefined;
  host = await launch();
  active = await host.evaluate(() => window.tpv.getState());
  assert.equal(active.playback.status, 'paused'); assert.equal(active.playback.generationId, generation);
  assert.equal(app.windows().length, 2);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/display/'))?.isVisible()), false);
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.equal(JSON.parse(await readFile(placementPath, 'utf8')).displayId, placement.displayId);
  console.log('Automatic Play, Previous/resume, host-only guard and monitor/restart persistence passed.');

  // Withhold the actual display-ready handshake, not merely a DOM selector.
  // Play must time out without consuming a turn or creating a generation.
  await host.evaluate(() => window.tpv.command({ type: 'stop' }));
  await app.evaluate(({ ipcMain }) => { globalThis.__tpvQaReadyListeners = ipcMain.listeners('display:ready'); ipcMain.removeAllListeners('display:ready'); });
  await destroySinger();
  const failed = await host.evaluate(() => window.tpv.playPause());
  assert.equal(failed.ok, false); assert.match(failed.error, /did not become ready/);
  active = await host.evaluate(() => window.tpv.getState());
  assert.equal(active.playback, null); assert.equal(active.stagedRequestId, 'qa-request'); assert.equal(active.usedGenerationIds.length, 1);
  await destroySinger();
  await app.evaluate(({ ipcMain }) => { for (const listener of globalThis.__tpvQaReadyListeners) ipcMain.on('display:ready', listener); delete globalThis.__tpvQaReadyListeners; });
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).usedGenerationIds.length, 2);
  assert.equal(await app.evaluate(() => globalThis.__tpvQaChooserCount), 0);

  // Hold an actual seek-result IPC while Pause supersedes Previous. Releasing
  // the real acknowledgment must never turn that paused performance back on.
  await waitForHostCondition(host, async () => (await window.tpv.getTimeline()).seekable);
  active = await host.evaluate(() => window.tpv.getState());
  assert.equal((await host.evaluate(generation => window.tpv.seek({ generation, position: 8 }), active.playback.generationId)).ok, true);
  await app.evaluate(({ ipcMain }) => {
    globalThis.__tpvQaEventListeners = ipcMain.listeners('display:event'); globalThis.__tpvQaHeldSeeks = [];
    ipcMain.removeAllListeners('display:event');
    ipcMain.on('display:event', (event, value) => {
      if (value?.type === 'seek-result') globalThis.__tpvQaHeldSeeks.push([event, value]);
      else for (const listener of globalThis.__tpvQaEventListeners) listener(event, value);
    });
  });
  await host.evaluate(() => { window.__tpvQaPendingRestart = window.tpv.restartTrack(); });
  let deadline = performance.now() + 3000;
  while (!await app.evaluate(() => globalThis.__tpvQaHeldSeeks.length > 0)) {
    assert.ok(performance.now() < deadline, 'The real restart seek acknowledgment was not captured.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'pause' }))).ok, true, 'Pause must work while Previous is awaiting its seek.');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners('display:event');
    for (const listener of globalThis.__tpvQaEventListeners) ipcMain.on('display:event', listener);
    for (const args of globalThis.__tpvQaHeldSeeks) for (const listener of globalThis.__tpvQaEventListeners) listener(...args);
    delete globalThis.__tpvQaEventListeners; delete globalThis.__tpvQaHeldSeeks;
  });
  const cancelledRestart = await host.evaluate(() => window.__tpvQaPendingRestart);
  assert.equal(cancelledRestart.ok, false); assert.match(cancelledRestart.error, /cancelled/);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'paused');

  // Hold the real display-ready handshake while manual Play waits. Stop must
  // settle successfully, and the original Play must stay cancelled even after
  // the renderer becomes fully ready. This catches the production late-start race.
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'stop' }))).ok, true);
  const beforeCancelledStart = await host.evaluate(() => window.tpv.getState());
  await app.evaluate(({ ipcMain }) => {
    globalThis.__tpvQaReadyListeners = ipcMain.listeners('display:ready'); globalThis.__tpvQaHeldReadies = [];
    ipcMain.removeAllListeners('display:ready');
    ipcMain.on('display:ready', (...args) => globalThis.__tpvQaHeldReadies.push(args));
  });
  await destroySinger();
  await host.evaluate(() => { window.__tpvQaPendingPlay = window.tpv.playPause(); });
  deadline = performance.now() + 3000;
  while (!await app.evaluate(() => globalThis.__tpvQaHeldReadies.length > 0)) {
    assert.ok(performance.now() < deadline, 'The real replacement display-ready handshake was not captured.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'stop' }))).ok, true);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners('display:ready');
    for (const listener of globalThis.__tpvQaReadyListeners) ipcMain.on('display:ready', listener);
    for (const args of globalThis.__tpvQaHeldReadies) for (const listener of globalThis.__tpvQaReadyListeners) listener(...args);
    delete globalThis.__tpvQaReadyListeners; delete globalThis.__tpvQaHeldReadies;
  });
  const cancelledPlay = await host.evaluate(() => window.__tpvQaPendingPlay);
  assert.equal(cancelledPlay.ok, false); assert.match(cancelledPlay.error, /cancelled/);
  active = await host.evaluate(() => window.tpv.getState());
  assert.equal(active.playback, null); assert.equal(active.stagedRequestId, beforeCancelledStart.stagedRequestId);
  assert.deepEqual(active.usedGenerationIds, beforeCancelledStart.usedGenerationIds, 'Late display readiness after Stop must not allocate a playback generation.');
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true, 'A fresh deliberate Play remains available after the cancelled operation settles.');
  assert.equal((await host.evaluate(() => window.tpv.getState())).usedGenerationIds.length, beforeCancelledStart.usedGenerationIds.length + 1);
  // Change the next turn while Play is waiting on a real display handshake.
  // The edit must succeed, but the old intent must not start either song.
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'stop' }))).ok, true);
  const beforeReorder = await host.evaluate(() => window.tpv.getState());
  const versionId = beforeReorder.requests.find(request => request.id === 'qa-request').versionId;
  assert.equal((await host.evaluate(versionId => window.tpv.command({ type: 'request', requestId: 'qa-request-two', singerId: null, versionId }), versionId)).ok, true);
  await app.evaluate(({ ipcMain }) => {
    globalThis.__tpvQaReadyListeners = ipcMain.listeners('display:ready'); globalThis.__tpvQaHeldReadies = [];
    ipcMain.removeAllListeners('display:ready'); ipcMain.on('display:ready', (...args) => globalThis.__tpvQaHeldReadies.push(args));
  });
  await destroySinger();
  await host.evaluate(() => { window.__tpvQaPendingPlay = window.tpv.playPause(); });
  deadline = performance.now() + 3000;
  while (!await app.evaluate(() => globalThis.__tpvQaHeldReadies.length > 0)) {
    assert.ok(performance.now() < deadline, 'The delayed display handshake was not captured.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'moveRequest', requestId: 'qa-request-two', beforeRequestId: 'qa-request' }))).ok, true, 'A queued song remains movable during playback preparation.');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners('display:ready');
    for (const listener of globalThis.__tpvQaReadyListeners) ipcMain.on('display:ready', listener);
    for (const args of globalThis.__tpvQaHeldReadies) for (const listener of globalThis.__tpvQaReadyListeners) listener(...args);
    delete globalThis.__tpvQaReadyListeners; delete globalThis.__tpvQaHeldReadies;
  });
  const obsolete = await host.evaluate(() => window.__tpvQaPendingPlay);
  assert.equal(obsolete.ok, false); assert.match(obsolete.error, /changed|cancelled/i);
  active = await host.evaluate(() => window.tpv.getState());
  assert.equal(active.playback, null); assert.equal(active.stagedRequestId, 'qa-request-two');
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.requestId, 'qa-request-two');
  // Re-select the original singer, then hold and return them before the pending
  // Start finishes. The same request ID reappears, but its old intent is stale.
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'stop' }))).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'moveRequest', requestId: 'qa-request', beforeRequestId: 'qa-request-two' }))).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).stagedRequestId, 'qa-request');
  await app.evaluate(({ ipcMain }) => {
    globalThis.__tpvQaReadyListeners = ipcMain.listeners('display:ready'); globalThis.__tpvQaHeldReadies = [];
    ipcMain.removeAllListeners('display:ready'); ipcMain.on('display:ready', (...args) => globalThis.__tpvQaHeldReadies.push(args));
  });
  await destroySinger();
  await host.evaluate(() => { window.__tpvQaPendingPlay = window.tpv.playPause(); });
  deadline = performance.now() + 3000;
  while (!await app.evaluate(() => globalThis.__tpvQaHeldReadies.length > 0)) {
    assert.ok(performance.now() < deadline, 'The ABA display handshake was not captured.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'setSingerAvailability', singerId: 'qa-singer', minutes: 1 }))).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'setSingerAvailability', singerId: 'qa-singer', minutes: 0 }))).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'moveRequest', requestId: 'qa-request', beforeRequestId: 'qa-request-two' }))).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).stagedRequestId, 'qa-request');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners('display:ready');
    for (const listener of globalThis.__tpvQaReadyListeners) ipcMain.on('display:ready', listener);
    for (const args of globalThis.__tpvQaHeldReadies) for (const listener of globalThis.__tpvQaReadyListeners) listener(...args);
    delete globalThis.__tpvQaReadyListeners; delete globalThis.__tpvQaHeldReadies;
  });
  const staleReturn = await host.evaluate(() => window.__tpvQaPendingPlay);
  assert.equal(staleReturn.ok, false); assert.match(staleReturn.error, /changed|cancelled/i);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  await app.evaluate(({ ipcMain }) => {
    globalThis.__tpvQaReadyListeners = ipcMain.listeners('display:ready'); globalThis.__tpvQaHeldReadies = [];
    ipcMain.removeAllListeners('display:ready'); ipcMain.on('display:ready', (...args) => globalThis.__tpvQaHeldReadies.push(args));
  });
  await destroySinger();
  await host.evaluate(() => { window.__tpvQaPendingPlay = window.tpv.playPause(); });
  deadline = performance.now() + 3000;
  while (!await app.evaluate(() => globalThis.__tpvQaHeldReadies.length > 0)) {
    assert.ok(performance.now() < deadline, 'The unrelated-change display handshake was not captured.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'addSinger', singer: { id: 'qa-unrelated', name: 'New Singer' } }))).ok, true);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners('display:ready');
    for (const listener of globalThis.__tpvQaReadyListeners) ipcMain.on('display:ready', listener);
    for (const args of globalThis.__tpvQaHeldReadies) for (const listener of globalThis.__tpvQaReadyListeners) listener(...args);
    delete globalThis.__tpvQaReadyListeners; delete globalThis.__tpvQaHeldReadies;
  });
  assert.equal((await host.evaluate(() => window.__tpvQaPendingPlay)).ok, true, 'An unrelated singer joining must not cancel Start.');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.requestId, 'qa-request');
  console.log('Automatic display, monitor persistence, concurrent Play, Previous/resume, host-only IPC, silent restarts, timeout/retry, Pause during delayed seek and Stop during delayed display readiness passed in an isolated muted show.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(directory);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-transport-qa-')) throw Error('Unsafe transport QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
