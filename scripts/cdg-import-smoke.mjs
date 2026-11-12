// Synthetic sources, muted playback, isolated profile; never touches a real show.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const repo = await realpath(resolve('.')), root = await realpath(tmpdir());
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const temp = await mkdtemp(join(root, 'tpv-cdg-smoke-')), profile = join(temp, 'profile'); await mkdir(profile);
const source = join(temp, 'Artist - CDG Smoke.cdg'), audio = join(temp, 'Artist - CDG Smoke.mp3');
const data = Buffer.alloc(24 * 300 * 4); for (let i = 0; i < data.length; i += 24) { data[i] = 9; data[i + 1] = 1; }
await writeFile(source, data);
assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'libmp3lame', audio], { windowsHide: true }).status, 0);
const originalAudio = await readFile(audio);
const customBackdrop = join(temp, 'custom-backdrop.mp4');
assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=640x360:r=25:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', customBackdrop], { windowsHide: true }).status, 0);
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app,dialog}=require('electron'); const fs=require('node:fs'); app.setPath('userData',process.env.TPV_QA_PROFILE); app.setAppPath(process.env.TPV_QA_REPO); if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile'); dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_SOURCE]}); require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_REPO: repo, TPV_QA_PROFILE: await realpath(profile), TPV_QA_SOURCE: source, TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env });
    assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))), await realpath(profile));
    const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv); return host;
  };
  const openBackdropPreferences = async host => {
    await host.getByRole('button', { name: 'Preferences', exact: true }).click();
    await host.locator('summary').filter({ hasText: /^Singer Display$/ }).click();
    return host.getByLabel('Lyric Backdrop', { exact: true });
  };
  const savePreferences = async host => {
    await host.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await host.getByRole('dialog', { name: 'Preferences', exact: true }).waitFor({ state: 'hidden' });
  };
  let host = await launch();
  assert.equal((await host.evaluate(() => window.tpv.getSettings())).settings.lyricBackdrop, 'default');
  const preference = await openBackdropPreferences(host); assert.equal(await preference.inputValue(), 'default');
  await preference.selectOption('custom');
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, customBackdrop);
  await host.getByRole('button', { name: 'Choose Backdrop Video…', exact: true }).click();
  await host.waitForFunction(file => [...document.querySelectorAll('input')].some(input => input.value === file), customBackdrop);
  assert.equal(await host.getByLabel('Custom Backdrop MP4', { exact: true }).inputValue(), customBackdrop);
  await savePreferences(host);
  await app.close(); app = undefined; host = await launch();
  let saved = (await host.evaluate(() => window.tpv.getSettings())).settings;
  assert.equal(saved.lyricBackdrop, 'custom'); assert.equal(saved.lyricBackdropFile, customBackdrop);
  await (await openBackdropPreferences(host)).selectOption('none'); await savePreferences(host);
  await app.close(); app = undefined; host = await launch();
  assert.equal((await host.evaluate(() => window.tpv.getSettings())).settings.lyricBackdrop, 'none');
  await (await openBackdropPreferences(host)).selectOption('default'); await savePreferences(host);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
  await host.getByRole('button', { name: 'Import CD+G / ZIP…' }).click();
  const deadline = Date.now() + 60000;
  while (true) {
    const progress = await host.evaluate(() => window.tpv.cdg.status());
    if (progress?.phase === 'completed') break;
    assert.notEqual(progress?.phase, 'failed', progress?.message);
    assert.ok(Date.now() < deadline, 'CDG import timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const state = await host.evaluate(()=>window.tpv.getState());
  assert.equal(state.versions.length, 1, JSON.stringify(await host.evaluate(() => window.tpv.cdg.status()))); assert.equal(state.versions[0].title, 'CDG Smoke'); assert.equal(state.versions[0].artist, 'Artist');
  await host.getByText('CDG Smoke', { exact: true }).waitFor();
  const directories = await readdir(join(profile, 'cdg-library'));
  assert.equal(directories.length, 1);
  const converted = join(profile, 'cdg-library', directories[0], 'track.mp4');
  const frame = (file, filter) => {
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', filter, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(decoded.status, 0, decoded.stderr?.toString()); return decoded.stdout;
  };
  const actual = frame(converted, 'select=eq(n\\,10)');
  const expected = frame(join(repo, 'assets/backdrops/tpv-karaoke-v3.mp4'), 'fps=25,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,select=eq(n\\,10)');
  assert.equal(actual.length, 1280 * 720 * 3); assert.equal(actual.length, expected.length);
  let difference = 0; for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i] - expected[i]);
  assert.ok(difference / actual.length < 5, `Expected the actual bundled backdrop behind CDG: mean pixel error ${difference / actual.length}`);
  const beforePreferenceChange = createHash('sha256').update(await readFile(converted)).digest('hex');
  await (await openBackdropPreferences(host)).selectOption('none'); await savePreferences(host);
  assert.equal(createHash('sha256').update(await readFile(converted)).digest('hex'), beforePreferenceChange, 'Changing preferences never rewrites an existing converted song.');
  assert.deepEqual(await readFile(source), data); assert.deepEqual(await readFile(audio), originalAudio);
  console.log('CD+G default bundled video pixels, persisted default/custom/solid preferences, native import, library metadata, unchanged existing conversion and original sources verified in an isolated muted profile.');
} finally {
  if (app) await app.close();
  if (temp.startsWith(root + sep) && await realpath(temp) === temp) await rm(temp, { recursive: true, force: true });
}
