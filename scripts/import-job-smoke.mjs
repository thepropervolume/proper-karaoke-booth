// Isolated Electron import/playback rehearsal. Audio is muted and the worker is
// deliberately slowed in this test process only. Run with a synthetic MP4:
// node scripts/import-job-smoke.mjs <repository> <synthetic-mp4>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = await realpath(resolve(process.argv[2] ?? '.'));
if (!process.argv[3]) throw new Error('Provide a synthetic MP4 fixture.');
const fixture = await realpath(resolve(process.argv[3]));
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const directory = await mkdtemp(join(tmpdir(), 'tpv-import-qa-'));
const profile = join(directory, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile);
const video = join(directory, 'Artist - Song.mp4'), duplicate = join(directory, 'Duplicate.mp4'), empty = join(directory, 'Empty.mp4'), slow = join(directory, 'Slow.mp4');
await copyFile(fixture, video); await copyFile(fixture, duplicate); await writeFile(empty, '');
const large = await open(slow, 'w'); try { await large.truncate(64 * 1024 * 1024); } finally { await large.close(); }
const bootstrap = join(directory, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app } = require('electron');
const fs = require('node:fs');
const workerThreads = require('node:worker_threads');
const RealWorker = workerThreads.Worker;
workerThreads.Worker = class TestWorker extends RealWorker {
  constructor(code, options) {
    if (options?.workerData?.path === process.env.TPV_QA_SLOW && typeof code === 'string') {
      const slowed = code.replace('hash.update(chunk); read += chunk.length;', 'await new Promise(resolve => setTimeout(resolve, 50)); hash.update(chunk); read += chunk.length;');
      if (slowed === code) throw new Error('Failed to slow the test worker');
      code = slowed;
    }
    super(code, options);
  }
};
app.setPath('userData', process.env.TPV_QA_PROFILE);
if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe profile');
require(process.env.TPV_QA_ENTRY);
`);
let app;
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry, TPV_QA_SLOW: slow,
  APPDATA: join(directory, 'appdata'), LOCALAPPDATA: join(directory, 'localappdata'), XDG_CONFIG_HOME: join(directory, 'config') };
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'], cwd: repo, env, timeout: 30000 });
async function waitFor(host, read, predicate, description) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const value = await host.evaluate(read);
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
try {
  app = await launch();
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({ dialog }, paths) => {
    let selections = 0;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selections++ === 0 ? paths.initial : [paths.slow] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  }, { initial: [video, duplicate, empty], slow });
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.imports);
  await host.getByRole('button', { name: 'Import Video File', exact: true }).click();
  const first = await waitFor(host, () => window.tpv.imports.status(), value => value?.phase === 'completed', 'initial import');
  assert.equal(first.imported, 1); assert.equal(first.duplicates, 1); assert.equal(first.failed, 1);
  await host.getByText('File results (3)', { exact: true }).click();
  await host.getByText('Duplicate.mp4', { exact: true }).waitFor();
  await host.getByText('Empty.mp4', { exact: true }).waitFor();
  const state = await host.evaluate(() => window.tpv.getState()); assert.equal(state.versions.length, 1);
  await host.evaluate(async versionId => {
    const singerId = crypto.randomUUID();
    for (const command of [{ type: 'addSinger', singer: { id: singerId, name: 'QA Singer' } },
      { type: 'request', requestId: crypto.randomUUID(), singerId, versionId }, { type: 'stage' }]) {
      const result = await window.tpv.command(command); if (!result.ok) throw new Error(result.error);
    }
    await window.tpv.openDisplay();
  }, state.versions[0].id);
  let display;
  for (let attempt = 0; attempt < 100 && !display; attempt++) { display = app.windows().find(window => window !== host); if (!display) await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(display, 'Singer display did not open.');
  await display.locator('video').waitFor({ state: 'attached' });
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await waitFor(host, () => window.tpv.getState(), value => value.playback?.status === 'playing', 'playback');
  await host.getByRole('button', { name: 'Import Video File', exact: true }).click();
  await waitFor(host, () => window.tpv.imports.status(), value => value?.phase === 'hashing' && value.current?.bytesRead > 0, 'slow worker progress');
  assert.equal(await host.getByRole('button', { name: 'Play/Pause', exact: true }).isEnabled(), true);
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await waitFor(host, () => window.tpv.getState(), value => value.playback?.status === 'paused', 'pause during import');
  assert.equal((await host.evaluate(() => window.tpv.imports.status())).phase, 'hashing', 'Playback must respond while hashing is active.');
  await host.getByRole('button', { name: 'Cancel import' }).click();
  const cancelled = await waitFor(host, () => window.tpv.imports.status(), value => value?.phase === 'cancelled', 'import cancellation');
  assert.equal(cancelled.cancelled, 1); assert.equal((await host.evaluate(() => window.tpv.getState())).versions.length, 1);
  await host.getByText('Files not yet discovered were not processed. Songs already imported remain in the library.').waitFor();
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await waitFor(host, () => window.tpv.getState(), value => value.playback?.status === 'playing', 'resume after cancellation');
  await host.getByRole('button', { name: 'Import Video File', exact: true }).click();
  await waitFor(host, () => window.tpv.imports.status(), value => value?.phase === 'hashing', 'import before shutdown');
  await app.close(); app = undefined;
  app = await launch();
  const restored = await app.firstWindow(); await restored.waitForFunction(() => !!window.tpv?.imports);
  const recovered = await restored.evaluate(() => window.tpv.getState());
  assert.equal(recovered.versions.length, 1); assert.equal(recovered.playback?.status, 'paused');
  assert.equal(await restored.evaluate(() => window.tpv.imports.status()), null);
  console.log('PASS: import outcomes, progress, pause during hashing, cancellation and shutdown recovery. Synthetic video and audio were muted.');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
