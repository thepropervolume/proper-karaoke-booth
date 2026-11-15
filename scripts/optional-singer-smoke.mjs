// Disposable muted UI/service rehearsal. No real library, profiles or providers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build as viteBuild } from 'vite';
import { build as bundle } from 'esbuild';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const repo = await realpath(resolve(process.argv[2] ?? '.'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const parent = await realpath(tmpdir()), temporary = await mkdtemp(join(parent, 'tpv-optional-singer-'));
const profile = join(temporary, 'profile'), stage = join(temporary, 'stage');
await mkdir(profile); await mkdir(stage);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ settingsVersion: 2, sharedCatalogEnabled: false,
  providerCatalogEnabled: false, youtubeSearchEnabled: false, localControlEnabled: false, singerScreenEnabled: false,
  autoBumper: false, bumperOnLaunch: false, autoAdvance: false, masterVolume: 0, lyricBackdrop: 'none' }));
const fixture = join(temporary, 'QA Artist - Optional Singer.mp4');
const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
  '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { windowsHide: true });
assert.equal(made.status, 0, made.stderr?.toString());
const bootstrap = join(temporary, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app, dialog, session } = require('electron'); const fs = require('node:fs');
app.setPath('userData', process.env.TPV_QA_PROFILE); app.setAppPath(process.env.TPV_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile');
globalThis.fetch=async()=>{throw Error('External requests disabled in optional-singer rehearsal');};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true})));
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_FIXTURE]});
dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});
require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: await realpath(profile), TPV_QA_REPO: repo, TPV_QA_FIXTURE: fixture,
  TPV_QA_ENTRY: join(stage, 'dist/main/index.cjs'), APPDATA: join(temporary, 'appdata'), LOCALAPPDATA: join(temporary, 'localappdata'),
  XDG_CONFIG_HOME: join(temporary, 'config'), XDG_DATA_HOME: join(temporary, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const launch = async () => {
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  const host = await waitForHostWindow(app); await host.waitForFunction(() => !!window.tpv?.getState);
  return host;
};
try {
  await viteBuild({ configFile: false, root: repo, base: './', logLevel: 'error', build: { outDir: join(stage, 'dist/ui'), emptyOutDir: true,
    rollupOptions: { input: { host: join(repo, 'src/renderer/index.html'), display: join(repo, 'src/display/index.html'), singer: join(repo, 'src/remote/index.html') } } } });
  await Promise.all(['main', 'preload'].map(name => bundle({ entryPoints: [join(repo, `src/${name}/index.ts`)], outfile: join(stage, `dist/${name}/index.cjs`), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] })));
  let host = await launch();
  await host.evaluate(() => window.tpv.importFiles('files'));
  await waitForHostCondition(host, async () => (await window.tpv.imports.status())?.phase === 'completed');
  await host.getByRole('listbox', { name: 'Songs' }).getByRole('option').first().dblclick();
  const dialog = host.getByRole('dialog', { name: 'Add to Queue', exact: true });
  assert.equal(await dialog.getByRole('combobox').inputValue(), '');
  assert.equal(await dialog.getByRole('button', { name: 'Add to Queue', exact: true }).isEnabled(), true);
  await dialog.getByRole('button', { name: 'Add to Queue', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).requests.length === 1);
  let state = await host.evaluate(() => window.tpv.getState());
  const requestId = state.requests[0].id, versionId = state.requests[0].versionId;
  assert.equal(state.requests[0].singerId, null); assert.equal(state.singers.length, 0); assert.equal(state.stagedRequestId, requestId);
  await host.locator('[data-queue-list]').getByText('Unassigned', { exact: true }).waitFor();
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'addSinger', singer: { id: 'optional-manual', name: 'Named Singer' } }))).ok, true);
  const edit = async singerId => {
    await host.locator('[data-queue-list] [role="option"]').first().click({ button: 'right' });
    await host.getByRole('menuitem', { name: 'Edit track or singer…', exact: true }).click();
    const editor = host.getByRole('dialog', { name: 'Edit Queued Request', exact: true });
    await editor.getByRole('combobox').first().selectOption(singerId ?? '');
    await editor.getByRole('button', { name: 'Save request', exact: true }).click();
    await waitForHostCondition(host, async ({ requestId, singerId }) => (await window.tpv.getState()).requests.find(item => item.id === requestId)?.singerId === singerId, { requestId, singerId });
    const current = await host.evaluate(() => window.tpv.getState());
    assert.equal(current.stagedRequestId, requestId); assert.equal(current.requests[0].versionId, versionId); assert.equal(current.playback, null);
  };
  await edit('optional-manual'); await edit(null);
  assert.equal((await host.evaluate(() => window.tpv.getState())).singers.length, 1, 'only the deliberately created singer exists');
  const started = await host.evaluate(() => window.tpv.playPause()); assert.equal(started.ok, true, JSON.stringify(started));
  await waitForHostCondition(host, async () => (await window.tpv.getTimeline()).position > .15);
  const singer = app.windows().find(page => page.url().includes('/display/')); assert.ok(singer);
  assert.equal(await singer.locator('#caption').textContent(), state.versions[0].title, 'blank singer has no separator or fake person caption');
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  state = await host.evaluate(() => window.tpv.getState()); const generation = state.playback.generationId;
  assert.equal(state.playback.status, 'paused');
  await app.close(); app = undefined; host = await launch();
  state = await host.evaluate(() => window.tpv.getState());
  assert.equal(state.requests[0].singerId, null); assert.equal(state.playback.generationId, generation); assert.equal(state.playback.status, 'paused');
  assert.equal((await host.evaluate(() => window.tpv.playPause())).ok, true);
  await waitForHostCondition(host, async () => (await window.tpv.getState()).requests[0].status === 'completed', undefined, { timeout: 10000 });
  const history = await host.evaluate(() => window.tpv.getCollections());
  assert.equal(history.history.length, 1); assert.equal(history.history[0].singerId, null); assert.equal(history.history[0].singer, '');
  console.log('PASS: blank singer queues through actual UI without a fake singer; prepared request can assign/clear; playback renders; restart preserves null; completion records anonymous history. External networking blocked; audio muted.');
} finally {
  if (app) await app.close();
  const actual = await realpath(temporary);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-optional-singer-')) throw Error('Unsafe optional singer cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
