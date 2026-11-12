import { waitForHostCondition } from './wait-for-host-condition.mjs';
// Run after building: node scripts/queue-edit-smoke.mjs
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
const temp = await mkdtemp(join(tempRoot, 'tpv-queue-edit-qa-'));
const profile = join(temp, 'profile');
await mkdir(profile);
const canonicalProfile = await realpath(profile);
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app } = require('electron');\nconst fs = require('node:fs');\napp.setPath('userData', process.env.TPV_QA_PROFILE);\nif (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe profile');\nrequire(process.env.TPV_QA_ENTRY);\n`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')),
  XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data'),
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
try {
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.firstWindow();
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
  let host = await app.firstWindow();
  let queue = host.locator('[data-queue-list]');
  await queue.getByText('Casey', { exact: true }).click();
  await host.getByRole('button', { name: 'Move up', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).manualQueueOrder?.[1] === 'c1');
  await host.waitForFunction(() => Array.from(document.querySelectorAll('[data-queue-list] strong')).map(e => e.textContent).join(',') === 'Alex,Casey,Ben');
  assert.deepEqual(await queue.locator('strong').allTextContents(), ['Alex', 'Casey', 'Ben']);
  await queue.getByText('Casey', { exact: true }).click({ button: 'right' });
  await host.getByRole('menuitem', { name: 'Edit track or singer…' }).click();
  const edit = host.getByRole('dialog', { name: 'Edit Queued Request' });
  await edit.waitFor();
  await edit.getByLabel('Singer', { exact: true }).selectOption('b');
  await edit.getByLabel('Chosen track').selectOption('v2');
  await edit.getByRole('button', { name: 'Save request' }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).requests.find(r => r.id === 'c1').versionId === 'v2');
  let state = await host.evaluate(() => window.tpv.getState());
  assert.equal(state.requests.find(r => r.id === 'c1').singerId, 'b');
  assert.equal(state.requests.find(r => r.id === 'c1').round, 2);
  await host.getByRole('button', { name: 'Stage next', exact: true }).click();
  await queue.getByText('Alex', { exact: true }).click({ button: 'right' });
  assert.equal(await host.getByRole('menuitem', { name: 'Edit track or singer…' }).isDisabled(), true);
  await host.keyboard.press('Escape');
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  host = await app.firstWindow(); queue = host.locator('[data-queue-list]');
  await queue.getByText('Replacement song', { exact: true }).waitFor();
  state = await host.evaluate(() => window.tpv.getState());
  assert.equal(state.stagedRequestId, 'a1');
  assert.deepEqual(state.manualQueueOrder, ['a1', 'c1', 'b1']);
  assert.equal(state.requests.find(r => r.id === 'c1').versionId, 'v2');
  console.log('Queue movement, request edit, staged protection and persistence passed in an isolated profile.');
} finally {
  if (app) await app.close();
  if (temp.startsWith(tempRoot + sep) && (await realpath(temp)) === temp) await rm(temp, { recursive: true, force: true });
}
