// Isolated Electron test for a second launch during playback and crash recovery.
// Run with: node scripts/second-instance-smoke.mjs <repository> <synthetic-mp4>
// Audio is muted. Never pass a real song or the host's real user-data directory.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [repoArg, fixtureArg] = process.argv.slice(2);
if (!repoArg || !fixtureArg) throw new Error('Usage: node scripts/second-instance-smoke.mjs <repository> <synthetic-mp4>');
const repo = await realpath(resolve(repoArg)), fixture = await realpath(resolve(fixtureArg));
if (!(await stat(fixture)).isFile() || !fixture.toLowerCase().endsWith('.mp4')) throw new Error('Fixture must be an existing synthetic MP4.');
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
if (typeof executablePath !== 'string') throw new Error('Platform-native Electron is required.');
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
const temp = await mkdtemp(join(tmpdir(), 'tpv-instance-qa-'));
const profile = join(temp, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile), bootstrap = join(temp, 'bootstrap.cjs'), video = join(temp, 'QA Artist - Synthetic Song.mp4');
await copyFile(fixture, video);
await writeFile(bootstrap, `const { app } = require('electron');\nconst fs = require('node:fs');\napp.setPath('userData', process.env.TPV_QA_PROFILE);\nif (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe test profile');\nrequire(process.env.TPV_QA_ENTRY);\n`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry,
  XDG_CONFIG_HOME: join(temp, 'xdg-config'), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');

let app, second;
const launch = async () => {
  const instance = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await instance.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile, 'Refusing to use a non-disposable profile.');
  await instance.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  }, video);
  return instance;
};
const exited = (child, timeoutMs = 15000) => new Promise((resolve, reject) => {
  if (child.exitCode !== null || child.signalCode !== null) { resolve({ code: child.exitCode, signal: child.signalCode }); return; }
  const timer = setTimeout(() => reject(new Error('Timed out waiting for the test process to exit.')), timeoutMs);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
});
try {
  app = await launch();
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await host.waitForFunction(async () => (await window.tpv.getState()).versions.length === 1);
  await host.evaluate(async () => {
    const current = await window.tpv.getState(), singerId = crypto.randomUUID();
    for (const command of [ { type: 'addSinger', singer: { id: singerId, name: 'QA Singer' } },
      { type: 'request', requestId: crypto.randomUUID(), singerId, versionId: current.versions[0].id }, { type: 'stage' } ]) {
      const result = await window.tpv.command(command); if (!result.ok) throw new Error(result.error);
    }
    await window.tpv.openDisplay();
  });
  let display;
  for (let i = 0; i < 100 && !display; i++) { display = app.windows().find(window => window !== host); if (!display) await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(display, 'Singer display did not open.');
  await display.locator('video').waitFor({ state: 'attached' });
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await display.waitForFunction(() => { const video = document.querySelector('video'); return video && video.videoWidth > 0 && !video.paused; }, null, { timeout: 15000 });
  const before = await host.evaluate(() => window.tpv.getState());
  assert.equal(before.playback?.status, 'playing');
  const windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

  second = spawn(executablePath, args, { cwd: repo, env, windowsHide: true, stdio: 'ignore' });
  const duplicateExit = await exited(second);
  assert.equal(duplicateExit.code, 0, `Second process exited unexpectedly: ${JSON.stringify(duplicateExit)}`);
  second = undefined;
  const after = await host.evaluate(() => window.tpv.getState());
  assert.equal(after.hostEpoch, before.hostEpoch); assert.equal(after.revision, before.revision);
  assert.deepEqual(after.playback, before.playback); assert.deepEqual(after.requests, before.requests);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), windowCount);
  assert.equal(await display.locator('video').evaluate(video => video.paused), false, 'Second launch interrupted playback.');

  const firstProcess = app.process(), firstExit = exited(firstProcess);
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(firstProcess.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else firstProcess.kill('SIGKILL');
  await firstExit; app = undefined;
  app = await launch();
  const restoredHost = await app.firstWindow(); await restoredHost.waitForFunction(() => !!window.tpv);
  const restored = await restoredHost.evaluate(() => window.tpv.getState());
  assert.notEqual(restored.hostEpoch, before.hostEpoch);
  assert.equal(restored.playback?.status, 'paused');
  assert.equal(restored.playback?.generationId, before.playback.generationId);
  assert.equal(restored.playback?.requestId, before.playback.requestId);
  assert.deepEqual(restored.requests, before.requests);
  assert.equal(app.windows().length, 1, 'Restart must not open a singer display or start playback automatically.');
  console.log('PASS: a second instance exited during muted playback without changing the active show; forced termination restored the same performance paused with a new host epoch.');
} finally {
  if (second && second.exitCode === null && second.signalCode === null) { second.kill(); await exited(second).catch(() => {}); }
  if (app) await app.close().catch(() => {});
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
