import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { closeSync, ftruncateSync, mkdtempSync, mkdirSync, openSync, rmSync, symlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { hashImportFile } from '../../src/main/import-hash';
import { ImportJob } from '../../src/main/import-job';

function fixture() { return mkdtempSync(join(tmpdir(), 'tpv-import-test-')); }
function sparse(path: string, bytes: number) { const fd = openSync(path, 'w'); try { ftruncateSync(fd, bytes); } finally { closeSync(fd); } }

test('worker hashing returns the full-file fingerprint and leaves the host event loop responsive', async () => {
  const dir = fixture();
  try {
    const path = join(dir, 'large.mp4'); sparse(path, 64 * 1024 * 1024);
    const expected = createHash('sha256');
    for (let n = 0; n < 64; n++) expected.update(Buffer.alloc(1024 * 1024));
    const updates: number[] = []; let done = false;
    const pending = hashImportFile(path, new AbortController().signal, read => updates.push(read)).then(value => { done = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(done, false, 'Hashing must not block the host event loop until completion.');
    assert.equal(await pending, expected.digest('hex'));
    assert.ok(updates.some(value => value > 0));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('empty media cannot be imported as a playable file', async () => {
  const dir = fixture();
  try {
    const path = join(dir, 'empty.mp4'); writeFileSync(path, '');
    let commits = 0;
    const job = new ImportJob(() => { commits++; return { outcome: 'imported' }; });
    const started = job.start('files', [path]); const final = await job.wait(); assert.ok(final);
    assert.equal(final.failed, 1); assert.equal(commits, 0); assert.equal(job.page(started.jobId).items[0].outcome, 'failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('per-file results distinguish imports, duplicates, invalid input and failures with pagination', async () => {
  const dir = fixture();
  try {
    const first = join(dir, 'first.mp4'), second = join(dir, 'second.MP4'), missing = join(dir, 'missing.mp4'), text = join(dir, 'other.txt');
    writeFileSync(first, 'same media'); writeFileSync(second, 'same media'); writeFileSync(text, 'not video');
    const known = new Set<string>(), updates: string[] = [];
    const job = new ImportJob((_path, fingerprint) => {
      if (known.has(fingerprint)) return { outcome: 'duplicate' };
      known.add(fingerprint); return { outcome: 'imported', needsReview: true };
    }, progress => updates.push(progress.phase));
    const started = job.start('files', [first, second, missing, text]);
    assert.throws(() => job.start('files', [first]), /already in progress/);
    const final = await job.wait(); assert.ok(final);
    assert.equal(final.phase, 'completed'); assert.equal(final.discovered, 4); assert.equal(final.processed, 4);
    assert.equal(final.imported, 1); assert.equal(final.duplicates, 1); assert.equal(final.failed, 2); assert.equal(final.needsReview, 1);
    const firstPage = job.page(started.jobId, 0, 2), lastPage = job.page(started.jobId, 2, 2);
    assert.equal(firstPage.nextOffset, 2); assert.equal(lastPage.nextOffset, null); assert.equal(lastPage.total, 4);
    assert.deepEqual([...firstPage.items, ...lastPage.items].map(item => item.outcome), ['imported', 'duplicate', 'failed', 'failed']);
    assert.ok(firstPage.items.every(item => !item.name.includes(dir)), 'Renderer-facing results must not disclose source paths.');
    assert.ok(updates.includes('hashing') && updates.includes('completed'));
    assert.throws(() => job.page('wrong-job', 0, 10)); assert.throws(() => job.page(started.jobId, 0, 101));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cancelling an active hash stops the worker without committing that file', async () => {
  const dir = fixture();
  try {
    const path = join(dir, 'large.mp4'); sparse(path, 96 * 1024 * 1024);
    let commits = 0, job!: ImportJob;
    job = new ImportJob(() => { commits++; return { outcome: 'imported' }; }, progress => {
      if (progress.current && progress.current.bytesRead > 0) job.cancel(progress.jobId);
    });
    const started = job.start('files', [path]);
    const final = await job.wait(); assert.ok(final);
    assert.equal(final.phase, 'cancelled'); assert.equal(final.processed, 1); assert.equal(final.cancelled, 1); assert.equal(final.current, null);
    assert.equal(commits, 0); assert.equal(job.page(started.jobId).items[0].outcome, 'cancelled');
    assert.equal(job.cancel(started.jobId), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cancellation after an atomic commit retains that result and does not start another file', async () => {
  const dir = fixture();
  try {
    const first = join(dir, 'a.mp4'), second = join(dir, 'b.mp4'); writeFileSync(first, 'a'); writeFileSync(second, 'b');
    let commits = 0, job!: ImportJob;
    job = new ImportJob(() => { commits++; job.cancel(job.snapshot()!.jobId); return { outcome: 'imported' }; });
    const started = job.start('files', [first, second]);
    const final = await job.wait(); assert.ok(final);
    assert.equal(final.phase, 'cancelled'); assert.equal(final.imported, 1); assert.equal(commits, 1);
    assert.equal(job.page(started.jobId).items[0].name, basename(first));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a terminal progress subscriber can start a new job without changing the first job result', async () => {
  const dir = fixture();
  try {
    const first = join(dir, 'a.mp4'), second = join(dir, 'b.mp4'); writeFileSync(first, 'a'); writeFileSync(second, 'b');
    let nextId = '', job!: ImportJob;
    job = new ImportJob(() => ({ outcome: 'imported' }), progress => {
      if (progress.phase === 'completed' && !nextId) nextId = job.start('files', [second]).jobId;
    });
    const started = job.start('files', [first]); const firstCompletion = job.wait();
    const completed = await firstCompletion; assert.ok(completed);
    assert.equal(completed.jobId, started.jobId); assert.equal(completed.phase, 'completed');
    const next = await job.wait(); assert.ok(next);
    assert.equal(next.jobId, nextId); assert.notEqual(next.jobId, started.jobId);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recursive folder scan includes MP4 files, ignores other files and does not follow discovered symlinks', async () => {
  const dir = fixture(), external = fixture();
  try {
    const nested = join(dir, 'nested'); mkdirSync(nested); writeFileSync(join(dir, 'a.mp4'), 'a'); writeFileSync(join(nested, 'b.MP4'), 'b');
    writeFileSync(join(nested, 'not.txt'), 'no'); writeFileSync(join(external, 'outside.mp4'), 'outside');
    try { symlinkSync(external, join(dir, 'linked'), 'dir'); } catch (error) { if (!['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    const job = new ImportJob(() => ({ outcome: 'imported' }));
    const started = job.start('folder', [dir, join(dir, 'missing-folder')]); const final = await job.wait(); assert.ok(final);
    const results = job.page(started.jobId).items;
    assert.equal(final.imported, 2); assert.equal(final.failed, 1); assert.equal(results.length, 3);
    assert.ok(results.every(item => !item.name.includes('outside')));
    assert.ok(results.some(item => item.name.endsWith(join('nested', 'b.MP4'))));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(external, { recursive: true, force: true }); }
});

test('a file that changes during background hashing is rejected', async () => {
  const dir = fixture();
  try {
    const path = join(dir, 'changing.mp4'); sparse(path, 128 * 1024 * 1024);
    let changed = false;
    const pending = hashImportFile(path, new AbortController().signal, () => {
      if (changed) return; changed = true;
      const fd = openSync(path, 'r+'); try { writeSync(fd, Buffer.from([1]), 0, 1, 0); } finally { closeSync(fd); }
      utimesSync(path, new Date(0), new Date(0));
    });
    await assert.rejects(pending, /changed during import/);
    assert.equal(changed, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
