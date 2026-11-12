// Isolated, muted Electron rehearsal. Builds into a temporary directory and
// uses a synthetic output device; this does not verify real speakers or routing.
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
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app}=require('electron'); const fs=require('node:fs'); app.setPath('userData',process.env.TPV_QA_PROFILE); if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile'); require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: join(stage, 'dist/main/index.cjs'),
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
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv); return host;
};
try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=10:d=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { windowsHide: true });
  await viteBuild({ configFile: false, root: repo, base: './', build: { outDir: join(stage, 'dist/ui'), emptyOutDir: true, manifest: true,
    rollupOptions: { input: { host: join(repo, 'src/renderer/index.html'), display: join(repo, 'src/display/index.html'), singer: join(repo, 'src/remote/index.html') } } } });
  await Promise.all(['main', 'preload'].map(name => bundle({ entryPoints: [join(repo, `src/${name}/index.ts`)], outfile: join(stage, `dist/${name}/index.cjs`), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] })));
  let host = await launch();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, fixture);
  await host.getByRole('button', { name: 'Import Video File', exact: true }).click();
  await poll(() => host.evaluate(() => window.tpv.getState()), value => value.versions.length === 1, 'synthetic import');
  const version = (await host.evaluate(() => window.tpv.getState())).versions[0];
  const send = async command => { const result = await host.evaluate(c => window.tpv.command(c), command); assert.equal(result.ok, true, result.error); };
  await send({ type: 'addSinger', singer: { id: 'auto-bumper-singer', name: 'QA Singer' } });
  for (const requestId of ['auto-one', 'auto-two', 'auto-three']) await send({ type: 'request', requestId, singerId: 'auto-bumper-singer', versionId: version.id });
  const displayPromise = app.waitForEvent('window'); await host.evaluate(() => window.tpv.openDisplay());
  const display = await displayPromise; await display.locator('video').waitFor({ state: 'attached' });
  await display.evaluate(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: async () => [{ kind: 'audiooutput', deviceId: 'qa-output', label: 'Synthetic output' }] } });
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: async () => {} });
  });
  await host.evaluate(async () => {
    const { settings } = await window.tpv.getSettings();
    await window.tpv.saveSettings({ ...settings, audioOutputId: 'qa-output', masterVolume: 0, autoBumper: true, autoBumperTrackId: 'builtin-sunset', pauseIntervalSeconds: 3 });
  });
  assert.equal((await host.evaluate(() => window.tpv.getBumpers())).status.status, 'stopped', 'Enabling preferences must not autoplay.');
  await send({ type: 'stage' }); await send({ type: 'start', generationId: crypto.randomUUID() });
  await display.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0 && !v.paused; }, null, { timeout: 15000 });
  await display.locator('video').evaluate(v => { v.currentTime = v.duration - 0.15; });
  await poll(() => host.evaluate(() => window.tpv.getState()), s => s.requests.some(r => r.id === 'auto-one' && r.status === 'completed'), 'natural completion');
  const firstBumper = await poll(() => host.evaluate(() => window.tpv.getBumpers()), info => info.status.status === 'playing', 'automatic bumper after completion');
  assert.equal(firstBumper.status.trackId, 'builtin-sunset', 'Use the saved automatic track.');
  assert.equal(await display.locator('video').evaluate(v => v.paused && v.muted), true, 'Bumper must start only after karaoke is silent.');
  await send({ type: 'stage' });
  const tooSoon = await host.evaluate(() => window.tpv.command({ type: 'start', generationId: crypto.randomUUID() }));
  assert.equal(tooSoon.ok, false, 'Pause interval should prevent starting immediately.');
  await poll(() => host.evaluate(() => window.tpv.getState()), s => Date.now() >= s.nextStartAtMs, 'pause interval');
  await send({ type: 'start', generationId: crypto.randomUUID() });
  assert.equal((await host.evaluate(() => window.tpv.getBumpers())).status.status, 'stopped', 'Karaoke must wait for bumper silence.');
  const generation = (await host.evaluate(() => window.tpv.getState())).playback.generationId;
  await send({ type: 'skip', generationId: generation, confirmed: true });
  await poll(() => host.evaluate(() => window.tpv.getBumpers()), info => info.status.status === 'playing', 'automatic bumper after skip');
  await send({ type: 'stage' });
  await poll(() => host.evaluate(() => window.tpv.getState()), s => Date.now() >= s.nextStartAtMs, 'second pause interval');
  await send({ type: 'start', generationId: crypto.randomUUID() }); await send({ type: 'stop' });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal((await host.evaluate(() => window.tpv.getBumpers())).status.status, 'stopped', 'Stop must not start bumper.');
  await app.close(); app = undefined;
  host = await launch();
  const afterRestart = await host.evaluate(() => window.tpv.getBumpers());
  assert.equal(afterRestart.status.status, 'stopped'); assert.equal(afterRestart.outputReady, false, 'Restart must not reopen the output.');
  assert.equal((await host.evaluate(() => window.tpv.getSettings())).settings.autoBumperTrackId, 'builtin-sunset', 'Selected bumper track must survive restart.');
  await host.getByRole('button', { name: 'Preferences' }).click(); await host.getByText('Audio Controls', { exact: true }).click();
  await host.getByText('Automatic bumper is waiting for an explicit output and an open singer display.').waitFor();
  console.log('PASS: muted synthetic completion and skip trigger acknowledged intermission; pause interval, host-start stop, Stop, restart and unavailable output are guarded. No physical audio was tested.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(temp);
  if (dirname(actual) !== tempRoot || !actual.startsWith(tempRoot + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-auto-bumper-')) throw new Error('Unsafe QA cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
