// Synthetic sources, muted playback, isolated profile; never touches a real show.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = await realpath(resolve('.')), root = await realpath(tmpdir());
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const temp = await mkdtemp(join(root, 'tpv-cdg-smoke-')), profile = join(temp, 'profile'); await mkdir(profile);
const source = join(temp, 'Artist - CDG Smoke.cdg'), audio = join(temp, 'Artist - CDG Smoke.mp3');
const data = Buffer.alloc(24 * 300 * 4); for (let i = 0; i < data.length; i += 24) { data[i] = 9; data[i + 1] = 1; }
await writeFile(source, data);
assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'libmp3lame', audio], { windowsHide: true }).status, 0);
const originalAudio = await readFile(audio);
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app,dialog}=require('electron'); const fs=require('node:fs'); app.setPath('userData',process.env.TPV_QA_PROFILE); if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile'); dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_SOURCE]}); require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: await realpath(profile), TPV_QA_SOURCE: source, TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))), await realpath(profile));
  const host = await app.firstWindow();
  await host.getByRole('button', { name: 'Import CD+G / ZIP…' }).click();
  const deadline = Date.now() + 30000;
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
  assert.deepEqual(await readFile(source), data); assert.deepEqual(await readFile(audio), originalAudio);
  console.log('CD+G native import, conversion, library metadata and unchanged sources verified in an isolated profile.');
} finally {
  if (app) await app.close();
  if (temp.startsWith(root + sep) && await realpath(temp) === temp) await rm(temp, { recursive: true, force: true });
}
