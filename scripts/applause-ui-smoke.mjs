// Muted rehearsal using a disposable show and synthetic media.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const repo = await realpath(resolve(process.argv[2] ?? '.'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const parent = await realpath(tmpdir());
const temporary = await mkdtemp(join(parent, 'tpv-applause-ui-'));
const profile = join(temporary, 'profile'), stage = join(temporary, 'stage');
await mkdir(profile);
await mkdir(stage);
await writeFile(join(profile, 'settings.json'), JSON.stringify({
  settingsVersion: 2, sharedCatalogEnabled: false, providerCatalogEnabled: false,
  youtubeSearchEnabled: false, localControlEnabled: false, singerScreenEnabled: false,
  autoBumper: false, bumperOnLaunch: false, autoAdvance: false, masterVolume: 0,
  lyricBackdrop: 'none',
}));
const fixture = join(temporary, 'Test Artist - Test Song.mp4');
const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '30', '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { windowsHide: true });
assert.equal(made.status, 0, made.stderr?.toString());
const bootstrap = join(temporary, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app, dialog, session } = require('electron'); const fs = require('node:fs');
app.setPath('userData', process.env.TPV_QA_PROFILE); app.setAppPath(process.env.TPV_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile');
globalThis.fetch=async()=>{throw Error('External requests disabled in applause rehearsal');};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true})));
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_FIXTURE]});
dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});
require(process.env.TPV_QA_ENTRY);`);
const env = {
  ...process.env, TPV_QA_PROFILE: await realpath(profile), TPV_QA_REPO: repo, TPV_QA_FIXTURE: fixture,
  TPV_QA_ENTRY: join(stage, 'dist/main/index.cjs'), APPDATA: join(temporary, 'appdata'),
  LOCALAPPDATA: join(temporary, 'localappdata'), XDG_CONFIG_HOME: join(temporary, 'config'),
  XDG_DATA_HOME: join(temporary, 'data'),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  const host = await waitForHostWindow(app);
  await host.waitForFunction(() => !!window.tpv?.getState);
  return host;
}

try {
  await viteBuild({ configFile: false, root: repo, base: './', logLevel: 'error',
    build: { outDir: join(stage, 'dist/ui'), emptyOutDir: true,
      rollupOptions: { input: { host: join(repo, 'src/renderer/index.html'), display: join(repo, 'src/display/index.html'), singer: join(repo, 'src/remote/index.html') } } } });
  await Promise.all(['main', 'preload'].map(name => bundle({
    entryPoints: [join(repo, `src/${name}/index.ts`)], outfile: join(stage, `dist/${name}/index.cjs`),
    bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'],
  })));
  let host = await launch();
  const send = async command => {
    const outcome = await host.evaluate(value => window.tpv.command(value), command);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
  };
  await host.evaluate(() => window.tpv.importFiles('files'));
  await waitForHostCondition(host, async () => (await window.tpv.imports.status())?.phase === 'completed');
  await send({ type: 'addSinger', singer: { id: 'qa-lead', name: 'QA Lead' } });
  const current = await host.evaluate(() => window.tpv.getState());
  const version = current.versions[0];
  assert.ok(version);
  await send({ type: 'request', requestId: 'qa-request', singerId: 'qa-lead', versionId: version.id });
  const queued = await host.evaluate(() => window.tpv.getState());
  const account = state => state.points.accounts.find(row => row.singerId === 'qa-lead');
  assert.equal(account(queued).points, 36);
  assert.equal(account(queued).credits, 3);
  await send({ type: 'addSinger', singer: { id: 'qa-partner', name: 'QA Partner' } });
  await host.getByRole('listbox', { name: 'Songs' }).getByRole('option').first().click({ button: 'right' });
  await host.getByRole('menuitem', { name: 'Edit Metadata', exact: true }).click();
  const metadata = host.getByRole('dialog', { name: 'Edit song details', exact: true });
  await metadata.getByRole('checkbox', { name: 'Duet', exact: true }).check();
  await metadata.getByRole('button', { name: 'Save details', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).versions[0].isDuet === true);
  await host.locator('[data-queue-list] [role="option"]').first().click({ button: 'right' });
  await host.getByRole('menuitem', { name: 'Edit track or singer…', exact: true }).click();
  const editor = host.getByRole('dialog', { name: 'Edit Queued Request', exact: true });
  await editor.getByLabel('Duet partner (optional)').selectOption('qa-partner');
  await editor.getByRole('button', { name: 'Save request', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).requests[0].coSingerId === 'qa-partner');
  const duet = await host.evaluate(() => window.tpv.getState());
  assert.equal(account(duet).points, 50);
  assert.equal(duet.points.accounts.find(row => row.singerId === 'qa-partner').points, 14);
  const started = await host.evaluate(() => window.tpv.playPause());
  assert.equal(started.ok, true, JSON.stringify(started));
  await waitForHostCondition(host, async () => (await window.tpv.getTimeline()).position > 0.15);
  const baseline = await host.evaluate(() => window.tpv.getState());
  await host.getByRole('button', { name: 'Applause', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).points.accounts.find(row => row.singerId === 'qa-lead').points === 60);
  const results = await host.evaluate(async () => Promise.all([
    window.tpv.applause.trigger(), window.tpv.applause.trigger(), window.tpv.applause.trigger(),
  ]));
  assert.equal(results.filter(result => result.ok).length, 2, JSON.stringify(results));
  assert.match(results.find(result => !result.ok).error, /Three applause/);
  const after = await host.evaluate(() => window.tpv.getState());
  assert.equal(after.playback.generationId, baseline.playback.generationId);
  assert.equal(account(after).points, 100);
  assert.equal(after.points.accounts.find(row => row.singerId === 'qa-partner').points, 64);
  assert.equal(account(after).credits, 3);
  await app.close();
  app = undefined;
  host = await launch();
  const restored = await host.evaluate(() => window.tpv.getState());
  assert.equal(restored.playback.status, 'paused');
  assert.equal(account(restored).points, 100);
  assert.equal(restored.points.accounts.find(row => row.singerId === 'qa-partner').points, 64);
  assert.equal(account(restored).credits, 3);
  console.log('PASS: host duet metadata and partner dialogs, duet awards, applause button, three overlapping clips, fourth rejected, score and credits retained after restart. Synthetic video; audio muted.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(temporary);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-applause-ui-'))
    throw new Error('Unsafe applause rehearsal cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
