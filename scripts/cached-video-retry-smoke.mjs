// Run with: node --import tsx scripts/cached-video-retry-smoke.mjs [repository]
// Offline fake downloader, synthetic MP4s, one disposable show authority.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/main/store.ts';
import { createInitialState } from '../src/domain/index.ts';
import { DEFAULT_SETTINGS } from '../src/domain/settings.ts';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(process.argv[2] ?? '.')), parent = await realpath(tmpdir());
const require = createRequire(join(repo, 'package.json')), { _electron: electron } = require('playwright-core');
const root = await mkdtemp(join(parent, 'tpv-cache-retry-qa-')), profile = join(root, 'profile'), cache = join(root, 'cache'); await mkdir(profile);
const blue = join(root, 'Original-Blue.mp4'), red = join(root, 'Different-Red.mp4');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let app;
try {
  for (const [path, color] of [[blue, 'blue'], [red, 'red']]) {
    const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=25`, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path], { windowsHide: true });
    assert.equal(made.status, 0, made.stderr?.toString());
  }
  const expectedBytes = await readFile(blue), badBytes = await readFile(red), fingerprint = digest(expectedBytes); assert.notEqual(fingerprint, digest(badBytes));
  const examples = [
    { id: 'cache-healthy', title: 'Healthy', videoId: 'M7lc1UVf-VE', bytes: expectedBytes },
    { id: 'cache-corrupt', title: 'Corrupt', videoId: 'abcdefghijk', bytes: badBytes },
    { id: 'cache-relink', title: 'Relink', videoId: '0123456789_', bytes: badBytes },
    { id: 'cache-late-active', title: 'Late Active', videoId: 'ZYXWVUTSRQ_', bytes: badBytes },
  ];
  const initial = createInitialState('cache-retry-show', 'cache-retry-epoch'), media = [];
  for (const item of examples) {
    initial.versions.push({ id: item.id, title: item.title, artist: 'QA', rating: 'unrated', source: { provider: 'youtube', videoId: item.videoId, brandSlug: 'TheProperVolume' } });
    item.path = join(cache, 'karaokenerds', 'Brands', 'TheProperVolume', 'QA', `QA - ${item.title}.mp4`);
    await mkdir(dirname(item.path), { recursive: true }); await writeFile(item.path, item.bytes);
    await writeFile(item.path + '.tpv.json', JSON.stringify({ format: 1, provider: 'youtube', videoId: item.videoId, fingerprint }));
    media.push({ id: item.id, path: item.path, fingerprint });
  }
  // Fixture setup finishes and closes before the application opens its writer.
  const fixtureStore = new Store(join(profile, 'show.sqlite')); fixtureStore.save(initial, media); fixtureStore.close();
  const fakeExecutable = join(root, 'fake-yt-dlp.exe'), fakeProgram = join(root, 'fake-downloader.mjs'); await writeFile(fakeExecutable, '#!/bin/false\n', { mode: 0o700 });
  const counter = join(root, 'calls.txt'), signal = join(root, 'started.txt'), release = join(root, 'release.txt'); await writeFile(release, 'go');
  await writeFile(fakeProgram, `import fs from 'node:fs';import path from 'node:path';import{setTimeout as wait}from'node:timers/promises';
const count=Number(fs.existsSync(process.env.TPV_QA_COUNTER)?fs.readFileSync(process.env.TPV_QA_COUNTER,'utf8'):0)+1;
fs.writeFileSync(process.env.TPV_QA_COUNTER,String(count));fs.writeFileSync(process.env.TPV_QA_SIGNAL,String(count));
console.log('TPV_ID:'+new URL(process.argv.at(-1)).searchParams.get('v'));
while(!fs.existsSync(process.env.TPV_QA_RELEASE))await wait(20);
fs.copyFileSync(process.env.TPV_QA_PAYLOAD,path.join(process.cwd(),'video.mp4'));console.log('TPV_PROGRESS: 100.0%');`);
  await writeFile(join(profile, 'settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, sharedCatalogEnabled: false, ytDlpExecutable: fakeExecutable, karaokeNerdsCacheDirectory: cache }));
  const bootstrap = join(root, 'bootstrap.cjs');
  await writeFile(bootstrap, `const{app,dialog,session}=require('electron');const fs=require('node:fs'),cp=require('node:child_process');
app.setPath('userData',process.env.TPV_QA_PROFILE);app.setAppPath(process.env.TPV_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile');
const spawn=cp.spawn;cp.spawn=(file,args,options)=>fs.realpathSync(file)===fs.realpathSync(process.env.TPV_QA_FAKE)?spawn(process.env.TPV_QA_NODE,[process.env.TPV_QA_PROGRAM,...args],options):spawn(file,args,options);
globalThis.fetch=async()=>{throw Error('External requests disabled for offline QA');};
for(const name of['node:http','node:https']){const mod=require(name);mod.request=()=>{throw Error('External requests disabled for offline QA');};mod.get=mod.request;}
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_PAYLOAD]});dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});
require(process.env.TPV_QA_ENTRY);`);
  const env = { ...process.env, TPV_QA_PROFILE: profile, TPV_QA_REPO: repo, TPV_QA_ENTRY: join(repo, 'dist/main/index.cjs'), TPV_QA_FAKE: fakeExecutable,
    TPV_QA_NODE: process.execPath, TPV_QA_PROGRAM: fakeProgram, TPV_QA_PAYLOAD: blue, TPV_QA_COUNTER: counter, TPV_QA_SIGNAL: signal, TPV_QA_RELEASE: release,
    APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.youtubeDownloads);
  assert.equal(await host.evaluate(() => window.tpv.youtubeDownloads.start('cache-healthy')), null);
  assert.equal(await readFile(counter, 'utf8').catch(() => '0'), '0', 'Healthy bytes remain a no-op.');

  // A valid active cache is still a no-op, but repairing a corrupt active
  // generation must require an explicit Stop instead of changing its source.
  await host.evaluate(async () => {
    for (const command of [{ type: 'addSinger', singer: { id: 'cache-singer', name: 'Cache QA' } },
      { type: 'request', requestId: 'active-cache-request', singerId: 'cache-singer', versionId: 'cache-healthy' }]) {
      const result = await window.tpv.command(command); if (!result.ok) throw Error(result.error);
    }
    const result = await window.tpv.playPause(); if (!result.ok) throw Error(result.error);
  });
  const activeGeneration = (await host.evaluate(() => window.tpv.getState())).playback.generationId;
  const display = app.windows().find(page => page !== host); assert.ok(display);
  await waitForHostCondition(display, () => { const player = document.querySelector('video');
    return !!player && Number.isFinite(player.duration) && player.buffered.length > 0 && player.buffered.end(player.buffered.length - 1) >= player.duration - 0.1;
  });
  assert.equal(await host.evaluate(() => window.tpv.youtubeDownloads.start('cache-healthy')), null);
  await writeFile(examples[0].path, badBytes);
  const activeRetryError = () => host.evaluate(async () => { try { await window.tpv.youtubeDownloads.start('cache-healthy'); return ''; } catch (error) { return String(error); } });
  assert.match(await activeRetryError(), /Stop this performance first.*Your request stays in the queue/);
  let active = await host.evaluate(() => window.tpv.getState());
  assert.equal(active.playback.generationId, activeGeneration); assert.equal(active.playback.status, 'playing');
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  assert.match(await activeRetryError(), /Stop this performance first/);
  active = await host.evaluate(() => window.tpv.getState()); assert.equal(active.playback.status, 'paused'); assert.equal(active.playback.generationId, activeGeneration);
  assert.equal(await readFile(counter, 'utf8').catch(() => '0'), '0', 'An active repair starts no downloader.');
  assert.deepEqual((await host.evaluate(() => window.tpv.youtubeDownloads.status())).queue.pendingVersionIds, []);
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'stop' }))).ok, true);
  active = await host.evaluate(() => window.tpv.getState());
  assert.equal(active.playback, null); assert.equal(active.requests.find(request => request.id === 'active-cache-request').status, 'accepted');
  await writeFile(examples[0].path, expectedBytes);

  await host.evaluate(() => window.tpv.youtubeDownloads.start('cache-corrupt'));
  await waitForHostCondition(host, async () => { const state = await window.tpv.youtubeDownloads.status();
    if (state.job?.versionId === 'cache-corrupt' && state.job.phase === 'failed') throw Error(state.job.message);
    return state.job?.versionId === 'cache-corrupt' && state.job.phase === 'completed' && state.queue.activeVersionId === null;
  });
  const repairedPath = examples[1].path.slice(0, -4) + ` [${examples[1].videoId}].mp4`;
  assert.deepEqual(await readFile(examples[1].path), badBytes, 'Retry never overwrites the corrupt source.');
  assert.deepEqual(await readFile(repairedPath), expectedBytes);
  assert.equal((await host.evaluate(() => window.tpv.getLibraryFilenames()))['cache-corrupt'], basename(repairedPath));
  assert.equal(await host.evaluate(() => window.tpv.youtubeDownloads.start('cache-corrupt')), null);
  assert.equal(await readFile(counter, 'utf8'), '1', 'A repaired cached video does not redownload again.');

  // A host relink during a retry must win over the eventual new download.
  await unlink(release);
  await host.evaluate(() => window.tpv.youtubeDownloads.start('cache-relink'));
  const deadline = performance.now() + 5000;
  while (await readFile(signal, 'utf8').catch(() => '') !== '2') { assert.ok(performance.now() < deadline, 'Fake retry did not start.'); await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal((await host.evaluate(() => window.tpv.relinkMedia('cache-relink'))).ok, true);
  await writeFile(release, 'go');
  await waitForHostCondition(host, async () => { const state = await window.tpv.youtubeDownloads.status();
    return state.job?.versionId === 'cache-relink' && state.job.phase === 'failed' && state.queue.activeVersionId === null;
  });
  assert.equal((await host.evaluate(() => window.tpv.getLibraryFilenames()))['cache-relink'], basename(blue));
  assert.deepEqual(await readFile(examples[2].path), badBytes);
  assert.equal(await readFile(counter, 'utf8'), '2');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'Acquisition never starts playback.');

  // An already-running repair also cannot attach if its version becomes
  // active while the fake downloader is waiting for completion.
  await unlink(release);
  await host.evaluate(() => window.tpv.youtubeDownloads.start('cache-late-active'));
  const activeDeadline = performance.now() + 5000;
  while (await readFile(signal, 'utf8').catch(() => '') !== '3') { assert.ok(performance.now() < activeDeadline, 'Late-active fake retry did not start.'); await new Promise(resolve => setTimeout(resolve, 20)); }
  await writeFile(examples[3].path, expectedBytes);
  await host.evaluate(async () => {
    for (const command of [{ type: 'request', requestId: 'late-active-request', singerId: 'cache-singer', versionId: 'cache-late-active' },
      { type: 'promoteRequest', requestId: 'late-active-request' }]) {
      const result = await window.tpv.command(command); if (!result.ok) throw Error(result.error);
    }
    const result = await window.tpv.playPause(); if (!result.ok) throw Error(result.error);
  });
  const lateGeneration = (await host.evaluate(() => window.tpv.getState())).playback.generationId;
  await writeFile(release, 'go');
  await waitForHostCondition(host, async () => { const state = await window.tpv.youtubeDownloads.status();
    return state.job?.versionId === 'cache-late-active' && state.job.phase === 'failed' && state.queue.activeVersionId === null;
  });
  const lateState = await host.evaluate(() => window.tpv.getState());
  assert.equal(lateState.playback.requestId, 'late-active-request'); assert.equal(lateState.playback.generationId, lateGeneration);
  assert.equal((await host.evaluate(() => window.tpv.getLibraryFilenames()))['cache-late-active'], basename(examples[3].path));
  assert.equal(await readFile(counter, 'utf8'), '3');
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'stop' }))).ok, true);
  await app.close(); app = undefined;
  const verifiedStore = new Store(join(profile, 'show.sqlite'));
  try {
    assert.equal(verifiedStore.media('cache-corrupt').path, repairedPath);
    assert.equal(verifiedStore.media('cache-corrupt').fingerprint, fingerprint);
    assert.equal(verifiedStore.media('cache-relink').path, blue);
    assert.equal(verifiedStore.media('cache-late-active').path, examples[3].path);
    assert.deepEqual(verifiedStore.load().versions.map(version => version.id), examples.map(item => item.id));
  } finally { verifiedStore.close(); }
  console.log('Offline cache retry: healthy no-op, active playing/paused repair rejection, explicit Stop preserves the request, safe collision repair without overwrite/autoplay, concurrent relink and late-active attachment fences passed.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(root);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-cache-retry-qa-')) throw Error('Unsafe cache retry QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
