// Run after building: node scripts/history-search-smoke.mjs
// Initializes a disposable show, closes it, then seeds synthetic history before reopening.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const repo = await realpath(resolve('.'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const tempRoot = await realpath(tmpdir());
const temp = await mkdtemp(join(tempRoot, 'tpv-history-qa-'));
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
  // The first run created and closed a valid show database; no other writer is active.
  const db = new DatabaseSync(join(profile, 'show.sqlite'));
  try {
    const insert = db.prepare('INSERT INTO performance_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run('history-1', 'singer-one', 'José', 'v1', 'Déjà Vu', 'Beyoncé', 'completed', '2026-11-09T00:00:00Z');
    insert.run('history-2', 'singer-two', 'Casey', 'v2', 'Popular', 'Nada Surf', 'skipped', '2026-11-10T00:00:00Z');
    insert.run('history-3', 'singer-one', 'José', 'v3', 'Popular', 'Nada Surf', 'completed', '2026-11-11T00:00:00Z');
  } finally { db.close(); }
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const host = await app.firstWindow();
  await host.waitForFunction(() => !!window.tpv);
  const exportFile = join(temp, 'exported-history.csv');
  await app.evaluate(({ dialog }, path) => {
    globalThis.tpvHistoryDestination = path;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.tpvHistoryDestination });
  }, exportFile);
  const result = await host.evaluate(async () => window.tpv.command({ type: 'addSinger', singer: { id: 'singer-one', name: 'José' } }));
  assert.equal(result.ok, true);
  await host.getByRole('button', { name: 'Playlists', exact: true }).click();
  await host.getByRole('button', { name: 'History', exact: true }).click();
  const history = host.getByRole('region', { name: 'Library collections' });
  await history.getByText('Déjà Vu', { exact: true }).waitFor();
  const search = history.getByRole('searchbox', { name: 'Search history' });
  await search.fill('nada popular');
  assert.equal(await history.getByText('Popular', { exact: true }).count(), 2);
  assert.equal(await history.getByText('Déjà Vu', { exact: true }).count(), 0);
  await history.getByLabel('Filter by singer').selectOption('singer-one');
  assert.equal(await history.getByText('Popular', { exact: true }).count(), 1);
  await search.fill('jose deja');
  await history.getByText('Déjà Vu', { exact: true }).waitFor();
  await history.getByRole('button', { name: 'Export matching history…' }).click();
  await history.getByText('Exported 1 performance to CSV.', { exact: true }).waitFor();
  const csv = await readFile(exportFile, 'utf8');
  assert.ok(csv.startsWith('\uFEFF"Performed at"'));
  assert.ok(csv.includes('José'));
  assert.equal(csv.includes('Casey'), false);
  await history.getByRole('button', { name: 'Export matching history…' }).click();
  await history.getByText('That file already exists. Choose a new filename; existing files are never replaced.', { exact: true }).waitFor();
  assert.equal(await readFile(exportFile, 'utf8'), csv);
  await search.fill('not a song');
  await history.getByText('No performances match the current search and singer filter.', { exact: true }).waitFor();
  assert.equal((await host.evaluate(() => window.tpv.getCollections())).history.length, 3, 'Searching must not modify history.');
  console.log('History search, singer filtering, and preservation passed in an isolated profile.');
} finally {
  if (app) await app.close();
  if (temp.startsWith(tempRoot + sep) && (await realpath(temp)) === temp) await rm(temp, { recursive: true, force: true });
}
