// Windows desktop smoke with a disposable profile and synthetic karaoke files.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const repo = await realpath(resolve('.'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const temporaryRoot = await realpath(tmpdir());
const temporary = await mkdtemp(join(temporaryRoot, 'tpv-library-media-qa-'));
const profile = join(temporary, 'profile'), library = join(temporary, 'library'), source = join(library, 'Set');
const original = join(source, 'QA Artist - Original.mp4'), replacement = join(source, 'QA Artist - Replacement.mp4');
const lyrics = join(source, 'QA Artist - Lyrics.lrc'), audio = join(source, 'QA Artist - Lyrics.mp3');
let app;
try {
  await mkdir(profile); await mkdir(source, { recursive: true });
  await writeFile(join(profile, 'settings.json'), JSON.stringify({ desktopUpdateMode: 'off', providerCatalogEnabled: false,
    sharedCatalogEnabled: false, youtubeSearchEnabled: false, singerScreenEnabled: false, bumperOnLaunch: false, lyricBackdrop: 'none' }));
  for (const [path, filter] of [[original, 'color=c=blue:s=320x180:r=25'], [replacement, 'color=c=red:s=320x180:r=25']]) {
    const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', filter, '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr?.toString());
  }
  const encoded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '3', '-c:a', 'libmp3lame', audio], { windowsHide: true });
  assert.equal(encoded.status, 0, encoded.stderr?.toString());
  await writeFile(lyrics, '[00:00.00]First line\n[00:01.00]Second line\n');
  const buffers = await Promise.all([original, replacement, lyrics, audio].map(path => readFile(path)));
  const bootstrap = join(temporary, 'bootstrap.cjs');
  await writeFile(bootstrap, `const { app, session } = require('electron'); const { realpathSync } = require('node:fs');
app.setPath('userData', process.env.TPV_QA_PROFILE); app.setAppPath(process.env.TPV_QA_REPO);
if(realpathSync(app.getPath('userData')) !== realpathSync(process.env.TPV_QA_PROFILE)) throw Error('Unsafe profile');
globalThis.fetch = async () => { throw Error('External requests disabled in media workflow rehearsal'); };
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_details, done) => done({cancel:true})));
require(process.env.TPV_QA_ENTRY);`);
  const env = { ...process.env, TPV_QA_PROFILE: await realpath(profile), TPV_QA_REPO: repo, TPV_QA_ENTRY: join(repo, 'dist/main/index.cjs'),
    APPDATA: join(temporary, 'appdata'), LOCALAPPDATA: join(temporary, 'localappdata'), XDG_CONFIG_HOME: join(temporary, 'config'), XDG_DATA_HOME: join(temporary, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  await app.evaluate(({ dialog }, files) => {
    let allowReplacement = false;
    globalThis.allowTestReplacement = () => { allowReplacement = true; };
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false,
      filePaths: options.title.includes('Relink') ? [files.replacement] : options.properties.includes('openDirectory') ? [files.library] : files.initial });
    dialog.showMessageBox = async (_window, options) => ({ response: options.message.startsWith('The selected file differs') && !allowReplacement ? 1 : 0, checkboxChecked: false });
  }, { initial: [original, audio, lyrics], replacement, library });
  const host = await waitForHostWindow(app);
  await host.getByRole('button', { name: 'Import Songs', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.imports.status())?.phase === 'completed');
  const imported = await host.evaluate(() => window.tpv.imports.status());
  assert.equal(imported.imported, 2, JSON.stringify(await host.evaluate(id => window.tpv.imports.results(id, 0, 50), imported.jobId)));
  assert.equal(imported.failed, 0);
  const state = await host.evaluate(() => window.tpv.getState());
  const version = state.versions.find(song => song.title === 'Original'); assert.ok(version);
  const versionId = version.id;
  const requestId = 'qa-request';
  assert.equal((await host.evaluate(data => window.tpv.command({ type: 'request', ...data, singerId: null }), { requestId, versionId })).ok, true);
  const blocked = await host.evaluate(id => window.tpv.removeLocalMedia({ kind: 'file', id }), versionId);
  assert.match(blocked.error, /queued or playing/);
  assert.deepEqual(await host.evaluate(id => window.tpv.relinkMedia(id), versionId), { ok: true, cancelled: true });
  assert.match((await host.evaluate(() => window.tpv.getLibraryFilenames()))[versionId], /Original/);
  await app.evaluate(() => globalThis.allowTestReplacement());
  const relinked = await host.evaluate(id => window.tpv.relinkMedia(id), versionId);
  assert.match(relinked.notice, /Replacement linked/);
  assert.match((await host.evaluate(() => window.tpv.getLibraryFilenames()))[versionId], /Replacement/);
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests.find(request => request.id === requestId).versionId, versionId);
  assert.equal((await host.evaluate(id => window.tpv.command({ type: 'removeRequest', requestId: id }), requestId)).ok, true);
  await host.getByRole('button', { name: 'Remove Folder…', exact: true }).click();
  await waitForHostCondition(host, async id => (await window.tpv.getState()).versions.some(song => song.id === id && song.removedFromLibrary), versionId);
  assert.equal((await host.evaluate(() => window.tpv.getLibraryFilenames()))[versionId], undefined);
  assert.deepEqual(await Promise.all([original, replacement, lyrics, audio].map(path => readFile(path))), buffers);
  console.log('PASS: mixed video/LRC import, queued removal refusal, relink cancel + explicit replacement, and recursive index removal with intact source files.');
} finally {
  if (app) await app.close().catch(() => {});
  const target = await realpath(temporary);
  if (dirname(target) !== temporaryRoot || !target.startsWith(temporaryRoot + sep + 'tpv-library-media-qa-')) throw Error('Unsafe cleanup path.');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
