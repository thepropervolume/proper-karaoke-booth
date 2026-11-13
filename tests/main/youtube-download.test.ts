import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm, rename, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { YouTubeDownloads, YouTubeDownloadRunError, runYouTubeDownload, type DownloadedYouTubeAsset, type YouTubeDownloadRunner } from '../../src/main/youtube-download';

const input = { versionId: 'v1', videoId: 'M7lc1UVf-VE', title: 'Song', artist: 'Artist', brandSlug: 'TheProperVolume' };
const movie = Buffer.concat([Buffer.from([0,0,0,24]), Buffer.from('ftypisom0000synthetic-test-video')]);
const executable = process.execPath;
async function fixture(action: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'tpv-youtube-download-'));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const fakeRun: YouTubeDownloadRunner = async (_exe, args, options) => {
  const id = new URL(args.at(-1)!).searchParams.get('v');
  options.onLine(`TPV_ID:${id}`); options.onLine('TPV_PROGRESS: 73.5%');
  await writeFile(join(options.cwd, 'video.mp4'), movie);
};
const expectedFile = (root: string) => join(root, 'karaokenerds', 'Brands', 'TheProperVolume', 'Artist', 'Artist - Song.mp4');

test('downloads exact recording with fixed shell-free arguments and commits permanent hashed media', async () => fixture(async root => {
  let committed: DownloadedYouTubeAsset | undefined, called = 0;
  const run: YouTubeDownloadRunner = async (exe, args, options) => {
    called++; assert.equal(exe, executable); assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
    for (const flag of ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-simulate', '--no-overwrites']) assert.ok(args.includes(flag));
    assert.match(args[args.indexOf('--format') + 1], /vcodec\^=avc1/); assert.match(args[args.indexOf('--format') + 1], /acodec\^=mp4a/);
    assert.equal(args[args.indexOf('--output') + 1], 'video.%(ext)s');
    await fakeRun(exe, args, options);
  };
  const job = new YouTubeDownloads(root, executable, value => { committed = value; }, { run });
  job.start(input); const result = await job.wait();
  assert.equal(result?.phase, 'completed'); assert.equal(called, 1); assert.equal(committed?.path, expectedFile(root));
  assert.equal(committed?.fingerprint, createHash('sha256').update(movie).digest('hex'));
  assert.deepEqual(await readFile(expectedFile(root)), movie);
  assert.equal(JSON.parse(await readFile(expectedFile(root) + '.tpv.json', 'utf8')).videoId, input.videoId);
  assert.equal((await readdir(dirname(expectedFile(root)))).some(name => name.startsWith('.tpv-youtube-')), false);
  await job.shutdown(); assert.deepEqual(await readFile(expectedFile(root)), movie);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}));

test('reuses only matching ownership and complete fingerprint without another download', async () => fixture(async root => {
  const first = new YouTubeDownloads(root, executable, () => {}, { run: fakeRun }); first.start(input); await first.wait();
  let asset: DownloadedYouTubeAsset | undefined;
  const second = new YouTubeDownloads(root, executable, value => { asset = value; }, { run: async () => { throw Error('Must not download'); } });
  second.start({ ...input, versionId: 'v2' });
  assert.equal((await second.wait())?.phase, 'completed'); assert.equal(asset?.versionId, 'v2'); assert.equal(asset?.path, expectedFile(root));
}));

test('same title different video and unowned existing files never overwrite the earlier bytes', async () => fixture(async root => {
  const file = expectedFile(root); await mkdir(dirname(file), { recursive: true }); await writeFile(file, 'host original');
  const job = new YouTubeDownloads(root, executable, () => {}, { run: fakeRun }); job.start(input);
  assert.equal((await job.wait())?.phase, 'completed'); assert.equal(await readFile(file, 'utf8'), 'host original');
  const fallback = file.slice(0, -4) + ` [${input.videoId}].mp4`; assert.deepEqual(await readFile(fallback), movie);
  // A second exact recording with same human metadata receives its own ID suffix.
  job.start({ ...input, videoId: 'abcdefghijk' }); assert.equal((await job.wait())?.phase, 'completed');
  assert.deepEqual(await readFile(fallback), movie); assert.equal(await readFile(file, 'utf8'), 'host original');
}));

test('invalid output and identity mismatch do not commit or expose private child errors', async () => fixture(async root => {
  for (const kind of ['bad-output', 'wrong-identity', 'raw-error'] as const) {
    let commit = false;
    const job = new YouTubeDownloads(join(root, kind), executable, () => { commit = true; }, { run: async (_exe, _args, options) => {
      if (kind === 'raw-error') throw Error('private signed URL https://secret.test/token=secret');
      options.onLine(`TPV_ID:${kind === 'wrong-identity' ? 'abcdefghijk' : input.videoId}`);
      await writeFile(join(options.cwd, 'video.mp4'), kind === 'bad-output' ? 'not video' : movie);
    } });
    job.start(input); const result = await job.wait(); assert.equal(result?.phase, 'failed'); assert.equal(commit, false);
    assert.doesNotMatch(JSON.stringify(result), /secret|signed URL|private/);
    assert.equal(result?.cleanupNeeded, kind === 'raw-error');
  }
}));

test('cancellation waits for worker acknowledgement before removing staging or allowing another job', async () => fixture(async root => {
  let release!: () => void, begun!: () => void, commit = false;
  const started = new Promise<void>(resolve => { begun = resolve; });
  const run: YouTubeDownloadRunner = async (_exe, _args, options) => {
    await writeFile(join(options.cwd, 'video.mp4.part'), movie); begun();
    await new Promise<void>(resolve => { release = resolve; });
    throw new YouTubeDownloadRunError(true);
  };
  const job = new YouTubeDownloads(root, executable, () => { commit = true; }, { run });
  const state = job.start(input); await started; assert.equal(job.cancel(state.id), true); assert.equal(job.active(), true);
  assert.throws(() => job.start(input), /already in progress/);
  assert.equal((await readdir(dirname(expectedFile(root)))).filter(name => name.startsWith('.tpv-youtube-')).length, 1);
  release(); await job.wait(); assert.equal(job.snapshot()?.phase, 'cancelled'); assert.equal(commit, false); assert.equal(job.active(), false);
  assert.equal((await readdir(dirname(expectedFile(root)))).filter(name => name.startsWith('.tpv-youtube-')).length, 0);
}));

test('uncertain database outcome preserves published asset and ownership for safe retry', async () => fixture(async root => {
  const job = new YouTubeDownloads(root, executable, () => { throw Error(`database error at ${root}/secret.sqlite`); }, { run: fakeRun });
  job.start(input); const result = await job.wait(); assert.equal(result?.phase, 'failed'); assert.doesNotMatch(JSON.stringify(result), /secret.sqlite/);
  assert.deepEqual(await readFile(expectedFile(root)), movie); assert.ok(await lstat(expectedFile(root) + '.tpv.json'));
  let recovered = false; const retry = new YouTubeDownloads(root, executable, () => { recovered = true; }, { run: async () => { throw Error('No retry download'); } });
  retry.start(input); assert.equal((await retry.wait())?.phase, 'completed'); assert.equal(recovered, true);
}));

test('a late cancellation cannot replace a completed durable outcome during cleanup', async () => fixture(async root => {
  let lateCancel: boolean | undefined;
  const job = new YouTubeDownloads(root, executable, () => {
    queueMicrotask(() => { lateCancel = job.cancel(job.snapshot()!.id); });
  }, { run: fakeRun });
  job.start(input); const result = await job.wait();
  assert.equal(lateCancel, false); assert.equal(result?.phase, 'completed'); assert.deepEqual(await readFile(expectedFile(root)), movie);
}));

test('replaced staging junction is never followed for cleanup', async () => fixture(async root => {
  const victim = join(root, 'victim'); await mkdir(victim); await writeFile(join(victim, 'preserve.txt'), 'original');
  const job = new YouTubeDownloads(join(root, 'cache'), executable, () => { throw Error('No commit'); }, { run: async (_exe, _args, options) => {
    options.onLine(`TPV_ID:${input.videoId}`); await writeFile(join(options.cwd, 'video.mp4'), movie);
    await rename(options.cwd, options.cwd + '-moved'); await symlink(victim, options.cwd, process.platform === 'win32' ? 'junction' : 'dir');
  } });
  job.start(input); const result = await job.wait(); assert.equal(result?.phase, 'failed'); assert.equal(result.cleanupNeeded, true);
  assert.equal(await readFile(join(victim, 'preserve.txt'), 'utf8'), 'original');
}));

test('invalid IDs/configuration are rejected before invoking yt-dlp and standalone path is safe', async () => fixture(async root => {
  let calls = 0; const job = new YouTubeDownloads(root, executable, () => {}, { run: async (...args) => { calls++; await fakeRun(...args); } });
  assert.throws(() => job.start({ ...input, videoId: '../escape' }), /Invalid/); assert.equal(calls, 0);
  assert.throws(() => new YouTubeDownloads('relative', executable, () => {}), /absolute/);
  assert.throws(() => new YouTubeDownloads(root, 'relative', () => {}), /absolute/);
  job.start({ ...input, brandSlug: undefined, artist: '../CON', title: 'A/B:*?' }); assert.equal((await job.wait())?.phase, 'completed');
  assert.ok((await readdir(join(root, 'youtube'))).every(name => name !== '..'));
}));

test('real process cancellation terminates a spawned descendant before cleanup is declared safe', async () => fixture(async root => {
  const sentinel = join(root, 'orphan.txt'), program = join(root, 'tree.cjs');
  await writeFile(program, `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',"setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'orphan'),1500)",process.argv[2]],{stdio:'ignore'});console.log('READY');setInterval(()=>{},1000);`);
  const controller = new AbortController();
  const result = runYouTubeDownload(process.execPath, [program, sentinel], { cwd: root, signal: controller.signal, onLine(line) { if (line === 'READY') controller.abort(); } });
  await assert.rejects(result, error => error instanceof YouTubeDownloadRunError && error.cleanupSafe);
  await new Promise(resolve => setTimeout(resolve, 1800));
  await assert.rejects(lstat(sentinel), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
}));
