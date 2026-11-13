// Isolated host UI regression: promotion must not change the staged song.
// Run after building: node scripts/promote-request-smoke.mjs
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
const temp = await mkdtemp(join(tmpdir(), 'tpv-promote-ui-'));
const profile = join(temp, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile);
const media = join(temp, 'Synthetic Artist - Synthetic Title.mp4');
await writeFile(media, 'Synthetic file for import only; never played');
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.TPV_QA_PROFILE);if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw new Error('Unsafe profile');require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry,
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
try {
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, media);
  let host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv);
  await host.getByRole('button', { name: 'Import Video File', exact: true }).click();
  let initial;
  for (let n = 0; n < 200; n++) { initial = await host.evaluate(() => window.tpv.getState()); if (initial.versions.length === 1) break; await host.waitForTimeout(50); }
  assert.equal(initial.versions.length, 1, 'Synthetic import did not finish');
  const outcomes = await host.evaluate(async () => {
    const versionId = (await window.tpv.getState()).versions[0].id;
    const commands = [
      { type: 'addSinger', singer: { id: 'a', name: 'Singer Alpha' } },
      { type: 'addSinger', singer: { id: 'b', name: 'Singer Beta' } },
      { type: 'addSinger', singer: { id: 'c', name: 'Singer Charlie' } },
      { type: 'request', requestId: 'a1', singerId: 'a', versionId },
      { type: 'request', requestId: 'b1', singerId: 'b', versionId },
      { type: 'request', requestId: 'c1', singerId: 'c', versionId },
      { type: 'stage' },
    ];
    const result = [];
    for (const command of commands) result.push(await window.tpv.command(command));
    return result;
  });
  assert.ok(outcomes.every(result => result.ok));
  const rotation = host.getByRole('listbox', { name: 'Singer Rotation' });
  await rotation.getByRole('option').filter({ hasText: 'Singer Charlie' }).click();
  await host.getByRole('button', { name: 'Promote selected' }).click();
  for (let n = 0; n < 200; n++) { if ((await host.evaluate(() => window.tpv.getState())).promotedRequestId === 'c1') break; await host.waitForTimeout(50); }
  let state = await host.evaluate(() => window.tpv.getState());
  assert.equal(state.stagedRequestId, 'a1');
  await host.waitForFunction(() => document.querySelectorAll('[data-queue-list] [role=option]')[1]?.textContent?.includes('Singer Charlie'));
  const rows = rotation.getByRole('option');
  assert.match(await rows.nth(0).innerText(), /Singer Alpha/);
  assert.match(await rows.nth(1).innerText(), /Singer Charlie/);
  assert.match(await rows.nth(1).innerText(), /Promoted/);
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv);
  state = await host.evaluate(() => window.tpv.getState());
  assert.equal(state.stagedRequestId, 'a1'); assert.equal(state.promotedRequestId, 'c1');
  const saved = host.getByRole('listbox', { name: 'Singer Rotation' }).getByRole('option');
  await host.waitForFunction(() => document.querySelectorAll('[data-queue-list] [role=option]')[1]?.textContent?.includes('Singer Charlie'));
  assert.match(await saved.nth(0).innerText(), /Singer Alpha/);
  assert.match(await saved.nth(1).innerText(), /Singer Charlie/);
  console.log('PASS: host promotion preserves staged song and survives restart.');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
