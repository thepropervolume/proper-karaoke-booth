import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createInitialState } from '../../src/domain';
import { migrateShowSchema } from '../../src/main/schema-migrations';
import { createShowSnapshot } from '../../src/main/show-snapshots';
import { activateStagedShow, readShowSelection, selectPreviousShow, stageShowRestore } from '../../src/main/show-selection';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-selection-'));
  const live = new DatabaseSync(join(dir, 'show.sqlite'));
  migrateShowSchema(live);
  const current = createInitialState('show-00001', 'epoch-0001'); current.revision = 9;
  live.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(current)); live.close();
  const source = new DatabaseSync(':memory:'); migrateShowSchema(source);
  const saved = createInitialState('show-00002', 'epoch-0002'); saved.revision = 4;
  source.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(saved));
  const snapshot = join(dir, 'backup.sqlite'); await createShowSnapshot(source, snapshot); source.close();
  return { dir, snapshot };
}
function revision(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return JSON.parse((db.prepare('SELECT value FROM show_state').get() as { value: string }).value).revision; }
  finally { db.close(); }
}
test('stages and switches between databases without overwriting either', async () => {
  const { dir, snapshot } = await setup();
  try {
    const initial = readShowSelection(dir), candidate = await stageShowRestore(snapshot, dir);
    assert.equal(candidate.summary.revision, 4);
    const active = await activateStagedShow(dir, candidate, initial);
    assert.deepEqual(readShowSelection(dir), active); assert.equal(active.previousName, 'show.sqlite');
    assert.equal(revision(join(dir, active.activeName)), 4); assert.equal(revision(join(dir, 'show.sqlite')), 9);
    writeFileSync(join(dir, 'show.sqlite-wal'), 'foreign');
    assert.throws(() => selectPreviousShow(dir, active), /sidecar/);
    rmSync(join(dir, 'show.sqlite-wal'));
    const rolledBack = selectPreviousShow(dir, active);
    assert.equal(rolledBack.activeName, 'show.sqlite'); assert.equal(rolledBack.previousName, candidate.name);
    assert.equal(revision(join(dir, candidate.name)), 4); assert.equal(revision(join(dir, 'show.sqlite')), 9);
    const selectedAgain = await activateStagedShow(dir, candidate, rolledBack);
    await assert.rejects(activateStagedShow(dir, candidate, initial), /changed/);
    assert.deepEqual(readShowSelection(dir), selectedAgain);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rolls back a failed cutover and reconciles a lost post-commit response', async () => {
  const { dir, snapshot } = await setup();
  try {
    const initial = readShowSelection(dir), candidate = await stageShowRestore(snapshot, dir);
    await assert.rejects(activateStagedShow(dir, candidate, initial, { beforeCommit: () => { throw new Error('interrupted'); } }), /interrupted/);
    assert.deepEqual(readShowSelection(dir), initial);
    await assert.rejects(activateStagedShow(dir, candidate, initial, { afterCommit: () => { throw new Error('lost response'); } }), /lost response/);
    const selected = readShowSelection(dir); assert.equal(selected.activeName, candidate.name);
    assert.deepEqual(await activateStagedShow(dir, candidate, initial), selected);
    assert.equal(revision(join(dir, 'show.sqlite')), 9);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rejects modified candidates, unsafe names, sidecars, and stale selections', async () => {
  const { dir, snapshot } = await setup();
  try {
    const initial = readShowSelection(dir), candidate = await stageShowRestore(snapshot, dir);
    await assert.rejects(activateStagedShow(dir, { ...candidate, name: '../show.sqlite' }, initial), /Invalid/);
    writeFileSync(join(dir, `${candidate.name}-wal`), 'foreign');
    await assert.rejects(activateStagedShow(dir, candidate, initial), /sidecar/);
    rmSync(join(dir, `${candidate.name}-wal`));
    const db = new DatabaseSync(join(dir, candidate.name));
    const state = JSON.parse((db.prepare('SELECT value FROM show_state').get() as { value: string }).value);
    state.revision++; db.prepare('UPDATE show_state SET value=?').run(JSON.stringify(state)); db.close();
    await assert.rejects(activateStagedShow(dir, candidate, initial), /changed after review/);
    assert.deepEqual(readShowSelection(dir), initial);
    const fresh = await stageShowRestore(snapshot, dir);
    await assert.rejects(activateStagedShow(dir, fresh, { ...initial, revision: 8 }), /changed/);
    assert.deepEqual(readShowSelection(dir), initial);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('refuses a candidate changed immediately before committing the selection', async () => {
  const { dir, snapshot } = await setup();
  try {
    const initial = readShowSelection(dir), candidate = await stageShowRestore(snapshot, dir);
    await assert.rejects(activateStagedShow(dir, candidate, initial, { beforeCommit: () => {
      const db = new DatabaseSync(join(dir, candidate.name));
      const state = JSON.parse((db.prepare('SELECT value FROM show_state').get() as { value: string }).value);
      state.revision++; db.prepare('UPDATE show_state SET value=?').run(JSON.stringify(state)); db.close();
    } }), /changed/);
    assert.deepEqual(readShowSelection(dir), initial); assert.equal(revision(join(dir, 'show.sqlite')), 9);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('fails closed for corrupt selection, missing selected database, and dangling selection symlink', async () => {
  const { dir, snapshot } = await setup();
  try {
    const initial = readShowSelection(dir), candidate = await stageShowRestore(snapshot, dir);
    await activateStagedShow(dir, candidate, initial); rmSync(join(dir, candidate.name));
    assert.throws(() => readShowSelection(dir));
    rmSync(join(dir, 'show-selection.sqlite')); writeFileSync(join(dir, 'show-selection.sqlite'), 'corrupt');
    assert.throws(() => readShowSelection(dir)); rmSync(join(dir, 'show-selection.sqlite'));
    try { symlinkSync(join(dir, 'missing'), join(dir, 'show-selection.sqlite')); }
    catch (e) { if (['EPERM', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) return; throw e; }
    assert.throws(() => readShowSelection(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rejects a linked show root and a linked SQLite control journal', async () => {
  const { dir, snapshot } = await setup(), alias = `${dir}-alias`;
  try {
    try { symlinkSync(dir, alias, 'junction'); assert.throws(() => readShowSelection(alias), /link/); }
    catch (e) { if (!['EPERM', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; }
    const initial = readShowSelection(dir), candidate = await stageShowRestore(snapshot, dir);
    await activateStagedShow(dir, candidate, initial);
    try { symlinkSync(join(dir, 'nonexistent'), join(dir, 'show-selection.sqlite-journal')); }
    catch (e) { if (['EPERM', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) return; throw e; }
    assert.throws(() => readShowSelection(dir), /sidecar/);
  } finally { if (existsSync(alias)) unlinkSync(alias); rmSync(dir, { recursive: true, force: true }); }
});
for (const phase of ['before', 'after']) test(`recovers selection after terminating the cutover process ${phase} commit`, async () => {
  const { dir, snapshot } = await setup();
  try {
    const initial = readShowSelection(dir), candidate = await stageShowRestore(snapshot, dir), marker = join(dir, 'ready');
    const child = spawn(process.execPath, [...process.execArgv, resolve('tests/fixtures/show-selection-crash.ts'), dir, marker, phase, JSON.stringify(candidate), JSON.stringify(initial)], { windowsHide: true, stdio: 'pipe' });
    let stderr = ''; child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    const exited = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
    const deadline = Date.now() + 15_000;
    while (!existsSync(marker) && child.exitCode === null && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    if (!existsSync(marker)) { child.kill(); await exited; assert.fail(`Child did not reach cutover: ${stderr}`); }
    child.kill(); await exited;
    const actual = readShowSelection(dir);
    assert.equal(actual.activeName, phase === 'before' ? 'show.sqlite' : candidate.name);
    assert.equal(revision(join(dir, 'show.sqlite')), 9); assert.equal(revision(join(dir, candidate.name)), 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
