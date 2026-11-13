// Isolated, muted Electron rehearsal using a supplied synthetic MP4.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const repo = await realpath(resolve(process.argv[2] ?? '.'));
if (!process.argv[3]) throw Error('Provide a synthetic MP4 fixture.');
const fixture = await realpath(resolve(process.argv[3]));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const directory = await mkdtemp(join(tmpdir(), 'tpv-display-qa-'));
const profile = join(directory, 'profile'); await mkdir(profile);
const bootstrap = join(directory, 'bootstrap.cjs'), entry = await realpath(join(repo, 'dist/main/index.cjs'));
await writeFile(bootstrap, `const { app } = require('electron'); const fs = require('node:fs');
app.setPath('userData', process.env.TPV_QA_PROFILE);
if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw Error('Unsafe profile');
require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: profile, TPV_QA_ENTRY: entry, APPDATA: join(directory, 'appdata'), LOCALAPPDATA: join(directory, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function until(read, matches, label) {
  for (let n = 0; n < 300; n++) { const value = await read(); if (matches(value)) return value; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error(`Timed out waiting for ${label}.`);
}
try {
  app = await electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env, timeout: 30000 });
  await app.evaluate(({ dialog }, path) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, fixture);
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.toggleDisplayFullscreen);
  await host.evaluate(async () => { const {settings} = await window.tpv.getSettings(); await window.tpv.saveSettings({ ...settings, singerDisplayFullscreen: true }); await window.tpv.importFiles('files'); });
  await until(() => host.evaluate(() => window.tpv.imports.status()), value => value?.phase === 'completed', 'import');
  const state = await host.evaluate(() => window.tpv.getState()); assert.equal(state.versions.length, 1);
  await host.evaluate(async id => { for (const command of [{ type: 'addSinger', singer: { id: 'qa-singer', name: 'QA Singer' } },
    { type: 'request', requestId: 'qa-request', singerId: 'qa-singer', versionId: id }, { type: 'stage' }]) {
    const result = await window.tpv.command(command); if (!result.ok) throw Error(result.error); } await window.tpv.openDisplay(); }, state.versions[0].id);
  const display = await until(() => app.windows().find(window => window !== host), Boolean, 'singer window');
  const fullscreen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle().startsWith('Singer Display'))?.isFullScreen());
  await until(fullscreen, Boolean, 'saved fullscreen preference');
  assert.equal(await display.evaluate(async () => { try { await window.tpv.toggleDisplayFullscreen(); return false; } catch { return true; } }), true);
  await host.getByRole('button', { name: 'Toggle singer display fullscreen' }).click(); await until(fullscreen, value => value === false, 'exit fullscreen');
  await host.getByRole('button', { name: 'Toggle singer display fullscreen' }).click(); await until(fullscreen, Boolean, 'enter fullscreen');
  await until(() => display.evaluate(() => !!document.querySelector('video')), Boolean, 'display ready');
  await until(async () => host.evaluate(() => window.tpv.command({ type: 'start' })), value => value.ok, 'playback');
  await until(() => host.evaluate(() => window.tpv.getState()), value => value.playback?.status === 'playing', 'playing');
  await display.close();
  await until(() => host.evaluate(() => window.tpv.getState()), value => value.playback?.status === 'paused', 'paused after display loss');
  await host.evaluate(() => window.tpv.openDisplay());
  await until(fullscreen, Boolean, 'fullscreen on reopening');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback.status, 'paused');
  await app.close(); app = undefined;
  console.log('Fullscreen preference, host toggle, host-only guard, and display-loss pause passed.');
} finally { if (app) await app.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); }
