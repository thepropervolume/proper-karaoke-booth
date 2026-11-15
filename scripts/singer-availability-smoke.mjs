import { waitForHostCondition } from './wait-for-host-condition.mjs';
// Run after building: node scripts/singer-availability-smoke.mjs
// Initializes a disposable show, closes it, then seeds synthetic history before reopening.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const repo = await realpath(resolve('.'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const tempRoot = await realpath(tmpdir());
const temp = await mkdtemp(join(tempRoot, 'tpv-availability-qa-'));
const profile = join(temp, 'profile');
await mkdir(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ settingsVersion: 2, sharedCatalogEnabled: false, providerCatalogEnabled: false,
  youtubeSearchEnabled: false, autoBumper: false, bumperOnLaunch: false, singerScreenEnabled: false }));
const canonicalProfile = await realpath(profile);
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app } = require('electron');\nconst fs = require('node:fs');\napp.setPath('userData', process.env.TPV_QA_PROFILE);\nif (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe profile');\nglobalThis.fetch=async()=>{throw Error('External requests disabled for availability rehearsal.');};\nrequire(process.env.TPV_QA_ENTRY);\n`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')),
  XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data'),
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
async function hostWindow(instance) {
  for (let n = 0; n < 300; n++) { const page = instance.windows().find(value => value.url().includes('/renderer/')); if (page) { await page.waitForFunction(() => !!window.tpv); return page; } await new Promise(resolve => setTimeout(resolve, 50)); }
  throw Error('Host window did not load.');
}
try {
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await hostWindow(app);
  await app.close(); app = undefined;
  const db = new DatabaseSync(join(profile, 'show.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT value FROM show_state WHERE id = 1').get().value);
    state.versions = [{ id: 'v1', title: 'First song', artist: 'One', rating: 'clean' }, { id: 'v2', title: 'Replacement song', artist: 'Two', rating: 'clean' }];
    state.singers = [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Casey' }];
    state.requests = state.singers.map((singer, index) => ({ id: singer.id + '1', singerId: singer.id, versionId: 'v1', status: 'accepted', round: 1, order: index + 1 }));
    state.nextOrder = 4;
    db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
  } finally { db.close(); }
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  let host = await hostWindow(app);
  await host.getByRole('button', { name: 'Singers', exact: true }).click();
  const row = host.locator('.track-row').filter({ has: host.getByText('Alex', { exact: true }) });
  await row.getByRole('spinbutton', { name: 'Alex unavailable minutes' }).fill('1');
  host.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Mark unavailable', exact: true }).click();
  await row.getByText('Unavailable · back in 1 min', { exact: true }).waitFor();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).stagedRequestId === 'b1');
  await row.getByRole('button', { name: 'Return now', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).singers.find(s => s.id === 'a').unavailableUntilMs === 0);
  assert.equal((await host.evaluate(() => window.tpv.getState())).stagedRequestId, 'b1');
  await host.getByText('Queue options', { exact: true }).click();
  await host.getByRole('button', { name: 'Release Prepared Song', exact: true }).click();
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'stage' }))).ok, true);
  await waitForHostCondition(host, async () => (await window.tpv.getState()).stagedRequestId === 'a1');
  host.once('dialog', dialog => dialog.dismiss());
  await row.getByRole('button', { name: 'Mark unavailable', exact: true }).click();
  assert.equal((await host.evaluate(() => window.tpv.getState())).stagedRequestId, 'a1');
  host.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Mark unavailable', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).stagedRequestId === null);
  let state = await host.evaluate(() => window.tpv.getState());
  const deadline = state.singers.find(s => s.id === 'a').unavailableUntilMs;
  assert.ok(deadline > Date.now());
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  host = await hostWindow(app);
  await host.waitForFunction(() => !!window.tpv);
  state = await host.evaluate(() => window.tpv.getState());
  assert.equal(state.singers.find(s => s.id === 'a').unavailableUntilMs, deadline);
  await app.close(); app = undefined;
  // Seed an imminent deadline only after closing the isolated authority.
  const expiryDb = new DatabaseSync(join(profile, 'show.sqlite'));
  try {
    state = JSON.parse(expiryDb.prepare('SELECT value FROM show_state WHERE id=1').get().value);
    for (const request of state.requests) if (request.status === 'staged') request.status = 'accepted';
    state.stagedRequestId = null;
    for (const singer of state.singers) singer.unavailableUntilMs = Date.now() + 3000;
    expiryDb.prepare('UPDATE show_state SET value = ? WHERE id=1').run(JSON.stringify(state));
  } finally { expiryDb.close(); }
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  host = await hostWindow(app);
  await host.locator('[data-queue-list]').getByText('Unavailable · back in 1 min', { exact: true }).first().waitFor();
  await host.waitForFunction(() => Array.from(document.querySelectorAll('[data-queue-list] strong')).map(e => e.textContent).join(',') === 'Alex,Ben,Casey');
  await waitForHostCondition(host, async () => (await window.tpv.getState()).stagedRequestId === 'a1');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  console.log('Singer absence, early return, staged confirmation, restart and timed queue reintegration passed.');
} finally {
  if (app) await app.close();
  if (temp.startsWith(tempRoot + sep) && (await realpath(temp)) === temp) await rm(temp, { recursive: true, force: true });
}
