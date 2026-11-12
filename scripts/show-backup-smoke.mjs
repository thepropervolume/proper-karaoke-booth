import { waitForHostCondition } from './wait-for-host-condition.mjs';
// Run against an isolated built checkout. No user data or source media is touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const repo = await realpath(resolve(process.argv[2] ?? '.'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const directory = await mkdtemp(join(tmpdir(), 'tpv-backup-qa-'));
const profile = join(directory, 'profile'); await mkdir(profile);
const backup = join(directory, 'show-backup.sqlite'), occupied = join(directory, 'occupied.sqlite');
await writeFile(occupied, 'keep');
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
const bootstrap = join(directory, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app } = require('electron'); const fs = require('node:fs');
app.setPath('userData', process.env.TPV_QA_PROFILE);
if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw Error('Unsafe profile');
require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: profile, TPV_QA_ENTRY: entry, APPDATA: join(directory, 'appdata'), LOCALAPPDATA: join(directory, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: repo, env, timeout: 30000 });
  await app.evaluate(({ dialog }, paths) => {
    let calls = 0;
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showSaveDialog = async () => ++calls === 1 ? { canceled: true } : { canceled: false, filePath: calls === 2 ? paths.backup : paths.occupied };
  }, { backup, occupied });
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.backupShow);
  const singerId = 'backup-qa-singer';
  assert.equal((await host.evaluate(id => window.tpv.command({ type: 'addSinger', singer: { id, name: 'Backup QA' } }), singerId)).ok, true);
  const missing = await host.evaluate(async () => {
    const notifications = []; const unsubscribe = window.tpv.onMissingSongReviews(value => notifications.push(value));
    await window.tpv.addMissingSongRequest({ singer: 'Backup QA', title: 'Missing Song', artist: 'Artist' });
    const rows = await window.tpv.getMissingSongReviews();
    const changed = await window.tpv.setMissingSongStatus(rows[0].id, 'pending', 'reviewing');
    const stale = await window.tpv.setMissingSongStatus(rows[0].id, 'pending', 'fulfilled');
    const updated = await window.tpv.getMissingSongReviews(); unsubscribe();
    return { changed, stale, status: updated[0].status, notifications: notifications.length };
  });
  assert.equal(missing.changed, true); assert.equal(missing.stale, false); assert.equal(missing.status, 'reviewing'); assert.ok(missing.notifications >= 2);
  await host.getByRole('button', { name: 'Requests', exact: true }).click();
  const review = host.getByRole('combobox', { name: 'Status for Missing Song, requested by Backup QA' });
  await review.waitFor(); assert.equal(await review.inputValue(), 'reviewing');
  await review.selectOption('fulfilled');
  await waitForHostCondition(host, async () => (await window.tpv.getMissingSongReviews())[0]?.status === 'fulfilled');
  await host.getByRole('button', { name: 'Back up show…' }).click();
  await host.getByRole('button', { name: 'Back up show…' }).click();
  await host.getByText(/Show backup saved/).waitFor();
  const db = new DatabaseSync(backup, { readOnly: true });
  try { const row = db.prepare('SELECT value FROM show_state WHERE id = 1').get(); assert.ok(JSON.parse(row.value).singers.some(singer => singer.id === singerId)); }
  finally { db.close(); }
  await host.getByRole('button', { name: 'Back up show…' }).click();
  await host.getByText(/Backup could not be completed/).waitFor();
  assert.equal(await readFile(occupied, 'utf8'), 'keep');
  await host.evaluate(() => window.tpv.openDisplay());
  let display; for (let n = 0; n < 100 && !display; n++) { display = app.windows().find(window => window !== host); if (!display) await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(display);
  assert.equal(await display.evaluate(async () => { try { await window.tpv.backupShow(); return false; } catch { return true; } }), true);
  assert.equal(await display.evaluate(async () => { try { await window.tpv.getMissingSongReviews(); return false; } catch { return true; } }), true);
  assert.equal(await display.evaluate(async () => { try { await window.tpv.getLibraryFilenames(); return false; } catch { return true; } }), true);
  await app.close(); app = undefined;
  console.log('Backup UI, snapshot, no-overwrite, request reviews and singer-window guards passed.');
} finally { if (app) await app.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); }
