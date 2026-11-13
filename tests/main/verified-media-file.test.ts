import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintMedia } from '../../src/main/media-verification';
import { openVerifiedMediaFile, VerifiedMediaFileError } from '../../src/main/verified-media-file';

async function fixture(work: (directory: string, path: string, bytes: Buffer) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-verified-range-')), path = join(directory, 'song.mp4'), bytes = Buffer.from('original verified recording bytes');
  try { await writeFile(path, bytes); await work(directory, path, bytes); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('unchanged media range streams from the verified handle and closes it', async () => fixture(async (_directory, path, bytes) => {
  const { identity } = await fingerprintMedia(path), file = await openVerifiedMediaFile(path, identity);
  const chunks: Buffer[] = [];
  for await (const chunk of file.createReadStream({ start: 4, end: 12, autoClose: true })) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes.subarray(4, 13));
  await assert.rejects(file.stat(), /closed|bad file/i);
}));

test('changed, replaced and missing source paths cannot supply a verified range', async () => fixture(async (directory, path) => {
  const { identity } = await fingerprintMedia(path);
  await writeFile(path, 'different recording with same size');
  const later = new Date(Date.now() + 2000); await utimes(path, later, later);
  await assert.rejects(openVerifiedMediaFile(path, identity), VerifiedMediaFileError);
  await rename(path, join(directory, 'moved.mp4'));
  await assert.rejects(openVerifiedMediaFile(path, identity), VerifiedMediaFileError);
  await writeFile(path, 'replacement');
  await assert.rejects(openVerifiedMediaFile(path, identity), VerifiedMediaFileError);
}));

test('a pathname replacement after opening cannot switch the bytes of the existing range handle', async () => fixture(async (directory, path, bytes) => {
  const { identity } = await fingerprintMedia(path), file = await openVerifiedMediaFile(path, identity);
  try {
    await rename(path, join(directory, 'original.mp4')); await writeFile(path, 'replacement song bytes');
    assert.deepEqual(await file.readFile(), bytes);
    assert.notDeepEqual(await readFile(path), bytes);
  } finally { await file.close(); }
}));

test('a leaf symlink swap is rejected even when it points to the original verified inode', async context => fixture(async (directory, path) => {
  const { identity } = await fingerprintMedia(path), moved = join(directory, 'original.mp4'); await rename(path, moved);
  try { await symlink(moved, path, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { context.skip('Windows session cannot create file symlinks.'); return; }
    throw error;
  }
  await assert.rejects(openVerifiedMediaFile(path, identity), VerifiedMediaFileError);
}));
