// Actual Electron protocol regression, with synthetic files and a private show.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const repo = await realpath(resolve(process.argv[2] ?? '.')), parent = await realpath(tmpdir());
const require = createRequire(join(repo, 'package.json')), { _electron: electron } = require('playwright-core');
const root = await mkdtemp(join(parent, 'tpv-media-settings-qa-')), profile = join(root, 'profile'); await mkdir(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ bumperOnLaunch: false, sharedCatalogEnabled: false,
  providerCatalogEnabled: false, youtubeSearchEnabled: false, singerScreenEnabled: false }));
const blue = join(root, 'QA Artist - Original.mp4'), red = join(root, 'Replacement.mp4');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let app;
try {
  for (const [path, color] of [[blue, 'blue'], [red, 'red']]) {
    const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=25`, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path], { windowsHide: true });
    assert.equal(made.status, 0, made.stderr?.toString());
  }
  const original = await readFile(blue), originalHash = digest(original);
  assert.notEqual(originalHash, digest(await readFile(red)));
  const bootstrap = join(root, 'bootstrap.cjs');
  await writeFile(bootstrap, `const {app,dialog}=require('electron');const fs=require('node:fs');
app.setPath('userData',process.env.TPV_QA_PROFILE);app.setAppPath(process.env.TPV_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile');
globalThis.__tpvQaMediaWarnings=0;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_FILE]});
dialog.showMessageBox=async(_window,options)=>{if(options?.message==='Song source changed or became unavailable')globalThis.__tpvQaMediaWarnings++;return{response:0,checkboxChecked:false};};
require(process.env.TPV_QA_ENTRY);`);
  const env = { ...process.env, TPV_QA_PROFILE: profile, TPV_QA_REPO: repo, TPV_QA_FILE: blue, TPV_QA_ENTRY: join(repo, 'dist/main/index.cjs'),
    APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env });
    assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
    const host = await waitForHostWindow(app); await host.waitForFunction(() => !!window.tpv?.playPause); return host;
  };
  let host = await launch();
  const old = (await host.evaluate(() => window.tpv.getSettings())).settings;
  const changedAccent = await host.evaluate(() => window.tpv.cycleAccentColor());
  await host.evaluate(() => window.tpv.saveSettings({ masterVolume: 0.42 }));
  const saved = (await host.evaluate(() => window.tpv.getSettings())).settings;
  assert.notEqual(changedAccent, old.accentColor); assert.equal(saved.accentColor, changedAccent); assert.equal(saved.masterVolume, 0.42);
  const settingsPath = join(profile, 'settings.json'), beforeInvalid = await readFile(settingsPath, 'utf8');
  assert.equal(await host.evaluate(async () => { try { await window.tpv.saveSettings({ masterVolume: 0.7, unknownOption: true }); return false; } catch { return true; } }), true);
  assert.equal(await readFile(settingsPath, 'utf8'), beforeInvalid, 'Invalid patches cannot partially save another setting.');
  await host.evaluate(() => window.tpv.importFiles('files'));
  await waitForHostCondition(host, async () => (await window.tpv.imports.status())?.phase === 'completed');
  const library = await host.evaluate(() => window.tpv.getState()); assert.equal(library.versions.length, 1);
  await host.evaluate(async versionId => {
    for (const command of [{ type: 'addSinger', singer: { id: 'integrity-singer', name: 'Integrity QA' } },
      { type: 'request', requestId: 'integrity-request', singerId: 'integrity-singer', versionId }]) {
      const result = await window.tpv.command(command); if (!result.ok) throw Error(result.error);
    }
    const result = await window.tpv.playPause(); if (!result.ok) throw Error(result.error);
  }, library.versions[0].id);
  const generation = (await host.evaluate(() => window.tpv.getState())).playback.generationId;
  const fetchMedia = headers => app.evaluate(async ({ net }, input) => {
    const response = await net.fetch(input.url, { headers: input.headers });
    return { status: response.status, contentRange: response.headers.get('content-range'), bytes: Buffer.from(await response.arrayBuffer()).toString('base64') };
  }, { url: `tpv-media://play/${encodeURIComponent(generation)}`, headers });
  const range = await fetchMedia({ Range: 'bytes=7-29' });
  assert.equal(range.status, 206); assert.equal(range.contentRange, `bytes 7-29/${original.length}`);
  assert.deepEqual(Buffer.from(range.bytes, 'base64'), original.subarray(7, 30));
  const whole = await fetchMedia({}); assert.equal(whole.status, 200); assert.equal(digest(Buffer.from(whole.bytes, 'base64')), originalHash);
  await waitForHostCondition(host, async () => (await window.tpv.getTimeline()).seekable);
  assert.equal((await host.evaluate(generation => window.tpv.seek({ generation, position: 5 }), generation)).ok, true);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'playing');
  await copyFile(red, blue);
  const changed = await fetchMedia({ Range: 'bytes=0-127' }); assert.equal(changed.status, 409); assert.equal(changed.bytes, '');
  let state = await host.evaluate(() => window.tpv.getState());
  assert.equal(state.playback.status, 'paused'); assert.equal(state.playback.generationId, generation);
  assert.equal(state.playback.requestId, 'integrity-request'); assert.equal(state.requests[0].status, 'playing'); assert.equal(state.usedGenerationIds.length, 1);
  assert.equal((await fetchMedia({})).status, 409);
  assert.equal(await app.evaluate(() => globalThis.__tpvQaMediaWarnings), 1, 'One recovery warning per generation.');

  // Restoration and an explicit reopen/resume recover the original turn.
  await writeFile(blue, original);
  await app.close(); app = undefined;
  host = await launch();
  state = await host.evaluate(() => window.tpv.getState()); assert.equal(state.playback.status, 'paused');
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter(window => window.webContents.getURL().includes('/display/')).every(window => !window.isVisible())));
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  const display = app.windows().find(page => page !== host); assert.ok(display);
  await waitForHostCondition(display, () => { const player = document.querySelector('video'); return !!player && player.readyState >= 2 && player.error === null; });
  assert.equal((await fetchMedia({})).status, 200);
  assert.equal(digest(Buffer.from((await fetchMedia({})).bytes, 'base64')), originalHash);
  state = await host.evaluate(() => window.tpv.getState()); assert.equal(state.playback.generationId, generation); assert.equal(state.usedGenerationIds.length, 1);
  await host.evaluate(() => window.tpv.command({ type: 'stop' }));
  console.log('Verified file-handle HTTP ranges/seek, replacement rejection with safe pause and retained turn, restored paused-generation recovery, and atomic partial settings patches passed in an isolated muted show.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(root);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-media-settings-qa-')) throw Error('Unsafe integrity QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
