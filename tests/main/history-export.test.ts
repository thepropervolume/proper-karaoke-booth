import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { HistoryEntry } from '../../src/domain/collections';
import { historyCsv, HistoryExport, writeHistoryCsv } from '../../src/main/history-export';

const records: HistoryEntry[] = [
  { generationId: 'private-id', singerId: 's1', singer: 'José', versionId: 'v1', title: 'A "Song",\nPart 2', artist: 'Beyoncé', outcome: 'completed', at: '2026-11-11T00:00:00Z' },
  { generationId: 'other-id', singerId: 's2', singer: ' =SUM(1,2)', versionId: 'v2', title: '+Harmful', artist: '@Artist', outcome: 'skipped', at: '2026-11-10T00:00:00Z' },
  { generationId: 'last-id', singerId: 's2', singer: '\tPerson', versionId: 'v3', title: '-Title', artist: 'Artist', outcome: 'completed', at: '2026-11-09T00:00:00Z' },
];

async function removeTestDirectory(directory: string): Promise<void> {
  const root = await realpath(tmpdir()), target = await realpath(directory);
  assert.equal(dirname(target).toLowerCase(), root.toLowerCase());
  assert.match(basename(target), /^tpv-history-/);
  await rm(target, { recursive: true, force: true });
}

test('CSV preserves Unicode and quoted multiline fields while neutralizing spreadsheet formulas', () => {
  const csv = historyCsv(records);
  assert.ok(csv.startsWith('\uFEFF"Performed at","Singer","Artist","Title","Outcome"\r\n'));
  assert.ok(csv.includes('"José","Beyoncé","A ""Song"",\nPart 2","completed"'));
  assert.ok(csv.includes('"\' =SUM(1,2)","\'@Artist","\'+Harmful","skipped"'));
  assert.ok(csv.includes('"\'\tPerson","Artist","\'-Title","completed"'));
  assert.equal(csv.includes('private-id'), false);
  assert.equal(csv.includes('s1'), false);
});

test('prefixes fullwidth spreadsheet formula characters even after leading spaces', () => {
  for (const prefix of ['＝', '＋', '－', '＠']) {
    const value = ` ${prefix}formula`;
    const csv = historyCsv([{ ...records[0], singer: value }]);
    assert.ok(csv.includes(`"'${value}"`), `fullwidth ${prefix} must be neutralized`);
  }
});

test('exports only selected history to a new file and never overwrites existing files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-history-export-'));
  const destination = join(directory, 'history.csv');
  const exporter = new HistoryExport(() => records, async () => destination);
  try {
    assert.deepEqual(await exporter.start({ query: 'jose song', singerId: 's1' }), { status: 'saved', count: 1 });
    const csv = await readFile(destination, 'utf8');
    assert.ok(csv.includes('José'));
    assert.equal(csv.includes('Harmful'), false);
    await writeFile(destination, 'keep this file', 'utf8');
    assert.deepEqual(await exporter.start({ query: '', singerId: '' }), { status: 'already-exists' });
    assert.equal(await readFile(destination, 'utf8'), 'keep this file');
  } finally { await removeTestDirectory(directory); }
});

test('cancellation, empty results, invalid filters and concurrent dialogs do not write or expose paths', async () => {
  let chooseCount = 0, writeCount = 0;
  let finish!: (value: string | null) => void;
  const choice = new Promise<string | null>(resolve => { finish = resolve; });
  const exporter = new HistoryExport(() => records, () => { chooseCount++; return choice; }, async () => { writeCount++; });
  assert.deepEqual(await exporter.start({ query: 'no matches', singerId: '' }), { status: 'no-results' });
  assert.deepEqual(await exporter.start({ query: '', singerId: '', path: '/arbitrary' }), { status: 'invalid-filter' });
  const first = exporter.start({ query: '', singerId: '' });
  assert.deepEqual(await exporter.start({ query: '', singerId: '' }), { status: 'busy' });
  finish(null);
  assert.deepEqual(await first, { status: 'cancelled' });
  assert.equal(chooseCount, 1);
  assert.equal(writeCount, 0);
});

test('file errors are classified without leaking a path or modifying unrelated files', async () => {
  const exporter = new HistoryExport(() => records, async () => join(tmpdir(), 'private-location.csv'), async () => {
    throw new Error('disk full at private-location.csv');
  });
  const result = await exporter.start({ query: '', singerId: '' });
  assert.deepEqual(result, { status: 'failed' });
  assert.equal(JSON.stringify(result).includes('private-location'), false);
});

test('shutdown cancels a pending picker before a file is written', async () => {
  let finish!: (value: string | null) => void, writes = 0;
  const choosing = new Promise<string | null>(resolve => { finish = resolve; });
  const exporter = new HistoryExport(() => records, () => choosing, async () => { writes++; });
  const pending = exporter.start({ query: '', singerId: '' });
  await Promise.resolve();
  assert.equal(exporter.needsShutdownWait(), true);
  const closing = exporter.shutdown();
  finish(join(tmpdir(), 'unused-history.csv'));
  assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(await closing, true);
  assert.equal(writes, 0);
});

test('an existing destination appearing before publication is never overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-history-collision-'));
  const destination = join(directory, 'history.csv');
  try {
    await assert.rejects(writeHistoryCsv(destination, historyCsv(records), {
      beforePublish: () => writeFileSync(destination, 'someone else\'s file', { flag: 'wx' }),
    }), (error: NodeJS.ErrnoException) => error.code === 'EEXIST');
    assert.equal(await readFile(destination, 'utf8'), 'someone else\'s file');
    assert.deepEqual(await readdir(directory), ['history.csv']);
  } finally { await removeTestDirectory(directory); }
});

test('cleanup failure reports whether history was published and retry leaves the destination intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-history-cleanup-'));
  const destination = join(directory, 'history.csv');
  const exporter = new HistoryExport(() => records, async () => destination,
    (path, csv) => writeHistoryCsv(path, csv, { beforeCleanup: () => { throw new Error('cleanup failed'); } }));
  try {
    assert.deepEqual(await exporter.start({ query: '', singerId: '' }), { status: 'cleanup-needed', published: true });
    const published = await readFile(destination, 'utf8');
    assert.ok(published.includes('José'));
    assert.deepEqual(await exporter.start({ query: '', singerId: '' }), { status: 'cleanup-needed', published: true });
    assert.deepEqual(await exporter.retryCleanup(), { status: 'saved', count: 3 });
    assert.equal(await readFile(destination, 'utf8'), published);
    assert.deepEqual(await readdir(directory), ['history.csv']);
  } finally { await removeTestDirectory(directory); }
});

test('write failure before publication leaves the chosen destination absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-history-writefail-'));
  const destination = join(directory, 'history.csv');
  const exporter = new HistoryExport(() => records, async () => destination,
    (path, csv) => writeHistoryCsv(path, csv, { beforePublish: () => { throw new Error('disk full'); } }));
  try {
    assert.deepEqual(await exporter.start({ query: '', singerId: '' }), { status: 'failed' });
    assert.deepEqual(await readdir(directory), []);
  } finally { await removeTestDirectory(directory); }
});
