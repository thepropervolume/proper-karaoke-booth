import { waitForHostCondition } from './wait-for-host-condition.mjs';
// Isolated regression: request failure must not create duplicate singers on retry.
// Run after building: node scripts/request-retry-smoke.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = await realpath(resolve('.'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
const temp = await mkdtemp(join(tmpdir(), 'tpv-request-retry-'));
const profile = join(temp, 'profile');
await mkdir(profile);
const canonicalProfile = await realpath(profile);
const fixture = join(temp, 'Synthetic Artist - Synthetic Title.mp4');
await writeFile(fixture, 'Synthetic file for import only; no playback');
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.TPV_QA_PROFILE);if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw new Error('Unsafe profile');require(process.env.TPV_QA_ENTRY);`);
let app;
try {
  const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry,
    APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'),
    XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
  if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({ dialog, ipcMain }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    const original = ipcMain._invokeHandlers.get('host:command');
    if (!original) throw new Error('Missing command handler');
    ipcMain.removeHandler('host:command');
    let rejectOnce = true;
    ipcMain.handle('host:command', (event, command) => {
      if (command?.type === 'request' && rejectOnce) { rejectOnce = false; return { ok: false, error: 'Synthetic request rejection' }; }
      return original(event, command);
    });
  }, fixture);
  const host = await app.firstWindow();
  await host.waitForFunction(() => !!window.tpv);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await waitForHostCondition(host, async () => (await window.tpv.getState()).versions.length === 1);
  const row = host.getByRole('option', { name: /Synthetic Title/ });
  await row.dblclick();
  const dialog = host.getByRole('dialog', { name: 'Add to Queue' });
  await dialog.getByRole('combobox').selectOption('__new__');
  await dialog.getByLabel('New singer name').fill('Retry Singer');
  await dialog.getByRole('button', { name: 'Add to Queue' }).click();
  await dialog.getByRole('alert').getByText(/Synthetic request rejection/).waitFor();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).singers.some(s => s.name === 'Retry Singer'));
  const first = await host.evaluate(() => window.tpv.getState());
  const singers = first.singers.filter(s => s.name === 'Retry Singer');
  assert.equal(singers.length, 1);
  assert.equal(await dialog.getByRole('combobox').inputValue(), singers[0].id, 'The dialog must select the committed singer after request failure.');
  await dialog.getByRole('button', { name: 'Add to Queue' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const last = await host.evaluate(() => window.tpv.getState());
  assert.equal(last.singers.filter(s => s.name === 'Retry Singer').length, 1, 'Retry must not create another singer.');
  assert.equal(last.requests.filter(r => r.singerId === singers[0].id && r.status === 'accepted').length, 1);
  console.log('PASS: an isolated request rejection preserves the new singer for retry.');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
