// Synthetic, muted, disposable show only. No user media or profile is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(process.argv[2] ?? '.'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const parent = await realpath(tmpdir());
const directory = await mkdtemp(join(parent, 'tpv-transport-qa-'));
const profile = join(directory, 'profile'); await mkdir(profile);
const fixture = join(directory, 'QA Artist - Transport.mp4');
const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { windowsHide: true });
assert.equal(made.status, 0, made.stderr?.toString());
const bootstrap = join(directory, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app, dialog } = require('electron'); const fs = require('node:fs');
app.setPath('userData', process.env.TPV_QA_PROFILE); app.setAppPath(process.env.TPV_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile');
globalThis.__tpvQaChooserCount=0;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_FIXTURE]});
dialog.showMessageBox=async(_window,options)=>{if(options?.title==='Choose singer display'){globalThis.__tpvQaChooserCount++;throw Error('Automatic Play must not open a screen chooser');}return{response:0,checkboxChecked:false};};
require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: await realpath(profile), TPV_QA_REPO: repo, TPV_QA_FIXTURE: fixture,
  TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')), APPDATA: join(directory, 'appdata'), LOCALAPPDATA: join(directory, 'localappdata'),
  XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.playPause && !!window.tpv?.restartTrack);
  return host;
};
const singer = host => app.windows().find(page => page !== host);
const closeSinger = async host => {
  const page = singer(host); assert.ok(page, 'Singer window must be open.');
  await page.close();
  const deadline = performance.now() + 3000;
  while (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.getTitle() === 'Singer Display'))) {
    assert.ok(performance.now() < deadline, 'Native singer window did not close.');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
try {
  let host = await launch();
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  assert.equal(app.windows().length, 1, 'Startup never opens a singer player or starts a song.');
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
  assert.equal(app.windows().length, 1);
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.equal(JSON.parse(await readFile(placementPath, 'utf8')).displayId, placement.displayId);
  console.log('Automatic Play, Previous/resume, host-only guard and monitor/restart persistence passed.');

  // Withhold the actual display-ready handshake, not merely a DOM selector.
  // Play must time out without consuming a turn or creating a generation.
  await host.evaluate(() => window.tpv.command({ type: 'stop' }));
  await closeSinger(host);
  await app.evaluate(({ ipcMain }) => { globalThis.__tpvQaReadyListeners = ipcMain.listeners('display:ready'); ipcMain.removeAllListeners('display:ready'); });
  const failed = await host.evaluate(() => window.tpv.playPause());
  assert.equal(failed.ok, false); assert.match(failed.error, /did not become ready/);
  active = await host.evaluate(() => window.tpv.getState());
  assert.equal(active.playback, null); assert.equal(active.stagedRequestId, 'qa-request'); assert.equal(active.usedGenerationIds.length, 1);
  await closeSinger(host);
  await app.evaluate(({ ipcMain }) => { for (const listener of globalThis.__tpvQaReadyListeners) ipcMain.on('display:ready', listener); delete globalThis.__tpvQaReadyListeners; });
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).usedGenerationIds.length, 2);
  assert.equal(await app.evaluate(() => globalThis.__tpvQaChooserCount), 0);
  console.log('Automatic display, monitor persistence, concurrent Play, acknowledged Previous/resume, host-only IPC, no startup autoplay and display-readiness timeout/retry passed in an isolated muted show.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(directory);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-transport-qa-')) throw Error('Unsafe transport QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
