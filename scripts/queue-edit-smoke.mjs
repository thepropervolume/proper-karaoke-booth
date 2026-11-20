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
await writeFile(bootstrap, `const { app, session } = require('electron');\nconst fs = require('node:fs');\napp.setPath('userData', process.env.TPV_QA_PROFILE);\nif (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe profile');\nglobalThis.fetch = async () => { throw new Error('External networking is disabled for the queue rehearsal.'); };\napp.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true })));\nrequire(process.env.TPV_QA_ENTRY);\n`);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ bumperOnLaunch: false, sharedCatalogEnabled: false,
  providerCatalogEnabled: false, youtubeSearchEnabled: false, singerScreenEnabled: false }));
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')),
  XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data'),
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
async function hostWindow(application) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = application.windows().find(window => /\/renderer\/index\.html$/.test(window.url().replaceAll('\\', '/')));
    if (page) { await page.waitForFunction(() => !!window.tpv); return page; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('The host window did not load; a hidden singer renderer is not the host.');
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
  let queue = host.locator('[data-queue-list]');
  await waitForHostCondition(host, async () => (await window.tpv.getState()).stagedRequestId === 'a1');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'Preparing the queue at launch must never start a performance.');
  await host.waitForFunction(() => Array.from(document.querySelectorAll('[data-queue-list] strong')).map(e => e.textContent).join(',') === 'Alex,Ben,Casey');
  assert.equal(await queue.getByText('Next in queue', { exact: true }).count(), 1);
  assert.equal(await queue.getByText(/locked/i).count(), 0);
  await queue.getByText('Alex', { exact: true }).click();
  await host.getByRole('button', { name: 'Move down', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).stagedRequestId === 'b1');
  await host.waitForFunction(() => Array.from(document.querySelectorAll('[data-queue-list] strong')).map(e => e.textContent).join(',') === 'Ben,Alex,Casey');
  await queue.getByText('Alex', { exact: true }).click();
  await host.getByRole('button', { name: 'Move up', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).stagedRequestId === 'a1');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'Changing the next song must never start playback.');
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
  await queue.getByText('Alex', { exact: true }).click({ button: 'right' });
  assert.equal(await host.getByRole('menuitem', { name: 'Edit track or singer…' }).isEnabled(), true, 'A prepared request remains editable before playback.');
  await host.getByRole('menuitem', { name: 'Edit track or singer…' }).click();
  await edit.waitFor();
  await edit.getByLabel('Singer', { exact: true }).selectOption('c');
  await edit.getByLabel('Chosen track').selectOption('v2');
  await edit.getByRole('button', { name: 'Save request' }).click();
  await waitForHostCondition(host, async () => {
    const current = await window.tpv.getState(), request = current.requests.find(item => item.id === 'a1');
    return current.stagedRequestId === 'a1' && request?.status === 'staged' && request.singerId === 'c' && request.versionId === 'v2';
  });
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  host = await hostWindow(app); queue = host.locator('[data-queue-list]');
  await queue.getByText('Replacement song', { exact: true }).first().waitFor();
  state = await host.evaluate(() => window.tpv.getState());
  assert.equal(state.stagedRequestId, 'a1');
  assert.deepEqual(state.manualQueueOrder, ['a1', 'c1', 'b1']);
  assert.equal(state.requests.find(r => r.id === 'c1').versionId, 'v2');
  assert.equal(state.requests.find(r => r.id === 'a1').singerId, 'c');
  assert.equal(state.requests.find(r => r.id === 'a1').versionId, 'v2');
  assert.equal(state.requests.find(r => r.id === 'a1').status, 'staged');
  assert.equal(state.playback, null, 'Restart preserves preparation without automatic karaoke playback.');
  console.log('Automatic preparation, queue movement, waiting/prepared request edits, staged slot identity and restart persistence passed in an isolated profile with external networking disabled.');
} finally {
  if (app) await app.close();
  if (temp.startsWith(tempRoot + sep) && (await realpath(temp)) === temp) await rm(temp, { recursive: true, force: true });
}
