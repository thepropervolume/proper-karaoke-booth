import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { downloadYtDlpVideo, inspectYtDlpVideo, type YtDlpRunner } from '../../src/main/karaokenerds-ytdlp';
import type { CacheVideo } from '../../src/main/karaokenerds-cache-plan';

const executable = path.resolve('test-yt-dlp');
const id = 'abcDEF_123-';
const url = `https://youtu.be/${id}?list=untrusted`;
const video: CacheVideo = { id, provider: 'karaokenerds', brandSlug: 'TheProperVolume', artist: 'Nada Surf', title: 'Amateur', extension: 'mp4' };
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from('ftyp'), Buffer.from('test')]);

test('inspects one canonical video without downloading or claiming publication dates', async () => {
  let calls = 0;
  const run: YtDlpRunner = async (exe, args, options) => {
    calls++; assert.equal(exe, executable); assert.equal(options.cwd, undefined);
    assert.ok(args.includes('--ignore-config')); assert.ok(args.includes('--no-plugin-dirs')); assert.ok(args.includes('--no-playlist'));
    assert.ok(args.includes('--skip-download')); assert.ok(args.includes('--dump-single-json'));
    assert.equal(args.at(-1), `https://www.youtube.com/watch?v=${id}`);
    return { stdout: JSON.stringify({ id, upload_date: '20260521', release_date: '20230230' }) };
  };
  assert.deepEqual(await inspectYtDlpVideo(executable, url, { run }), { youtubeId: id, uploadDate: '2026-05-21', releaseDate: null, provenance: 'yt-dlp' });
  assert.equal(calls, 1);
  await assert.rejects(inspectYtDlpVideo(executable, 'https://youtube.com.evil.example/watch?v=abcDEF_123-', { run }), /Invalid/);
  await assert.rejects(inspectYtDlpVideo(executable, url, { run: async () => ({ stdout: JSON.stringify({ id: 'other' }) }) }), /inspection failed/);
  await assert.rejects(inspectYtDlpVideo(executable, url, { run: async () => { throw Error('sensitive tool stderr'); } }), error =>
    error instanceof Error && error.message === 'Video inspection failed.' && !String(error.stack).includes('sensitive tool stderr'));
});

test('publishes one validated MP4 at the requested path without overwriting', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tpv-yt-test-'));
  const calls: string[][] = [];
  const run: YtDlpRunner = async (_exe, args, options) => {
    calls.push(args); assert.ok(options.cwd);
    await writeFile(path.join(options.cwd!, 'video.mp4'), mp4);
    return { stdout: '' };
  };
  try {
    const result = await downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }, { run });
    assert.deepEqual(result, { status: 'downloaded', path: path.join(base, 'karaokenerds', 'Brands', 'TheProperVolume', 'Nada Surf', 'Nada Surf - Amateur.mp4'), cleanupNeeded: false });
    assert.deepEqual(await readFile(result.path), mp4);
    assert.ok(calls[0].includes('--no-overwrites'));
    assert.ok(calls[0].includes('bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]'));
    assert.ok(calls[0].includes('--merge-output-format'));
    assert.equal(calls[0].at(-1), `https://www.youtube.com/watch?v=${id}`);
    assert.equal((await readdir(path.dirname(result.path))).length, 1);
    assert.equal((await downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }, { run })).status, 'exists');
    assert.equal(calls.length, 1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects wrong video IDs, malformed files and propagated command errors', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tpv-yt-invalid-'));
  try {
    await assert.rejects(downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video: { ...video, id: 'wrong' } }), /Invalid/);
    await assert.rejects(downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }, { run: async (_e, _a, options) => {
      await writeFile(path.join(options.cwd!, 'video.mp4'), 'not an mp4 file'); return { stdout: '' };
    } }), /Video download failed/);
    await assert.rejects(downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }, { run: async () => { throw Error('private stderr'); } }), error =>
      error instanceof Error && error.message === 'Video download failed; temporary cleanup needs attention.' && !String(error.stack).includes('private stderr'));
    const parent = path.join(base, 'karaokenerds', 'Brands', 'TheProperVolume', 'Nada Surf');
    assert.equal((await readdir(parent)).filter(name => name.startsWith('.tpv-yt-')).length, 1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('preserves a cancelled command stage because a child process may still be writing', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tpv-yt-child-'));
  const abort = new AbortController();
  try {
    const result = await downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }, { signal: abort.signal, run: async (_e, _a, options) => {
      await writeFile(path.join(options.cwd!, 'video.mp4.part'), 'partial');
      abort.abort();
      throw new Error('child may still run');
    } });
    assert.equal(result.status, 'cancelled'); assert.equal(result.cleanupNeeded, true);
    const parent = path.dirname(result.path);
    const stages = (await readdir(parent)).filter(name => name.startsWith('.tpv-yt-'));
    assert.equal(stages.length, 1);
    assert.equal(await readFile(path.join(parent, stages[0], 'video.mp4.part'), 'utf8'), 'partial');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('does not replace a destination created while a download is running', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tpv-yt-race-'));
  try {
    const run: YtDlpRunner = async (_exe, _args, options) => {
      await writeFile(path.join(options.cwd!, 'video.mp4'), mp4);
      await writeFile(path.join(path.dirname(options.cwd!), 'Nada Surf - Amateur.mp4'), 'preserve');
      return { stdout: '' };
    };
    const result = await downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }, { run });
    assert.equal(result.status, 'exists'); assert.equal(result.cleanupNeeded, false);
    assert.equal(await readFile(result.path, 'utf8'), 'preserve');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('cancellation does not start a pre-aborted download or publish a completed cancelled one', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'tpv-yt-cancel-'));
  const abort = new AbortController(); abort.abort(); let called = false;
  try {
    const first = await downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }, { signal: abort.signal, run: async () => { called = true; return { stdout: '' }; } });
    assert.equal(first.status, 'cancelled'); assert.equal(called, false);
    const later = new AbortController();
    const second = await downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }, { signal: later.signal, run: async (_e, _a, options) => {
      await writeFile(path.join(options.cwd!, 'video.mp4'), mp4); later.abort(); return { stdout: '' };
    } });
    assert.equal(second.status, 'cancelled');
    assert.deepEqual(await readdir(path.dirname(second.path)), []);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects a pre-existing symlink in the cache hierarchy', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'tpv-yt-symlink-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'tpv-yt-outside-'));
  try {
    try { await symlink(outside, path.join(base, 'karaokenerds'), 'dir'); }
    catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Symlink creation unavailable'); return; } throw error; }
    await assert.rejects(downloadYtDlpVideo({ executable, watchUrl: url, baseDirectory: base, video }), /Video download failed/);
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(base, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
