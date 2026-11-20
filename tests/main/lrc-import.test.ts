import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { CdgImport } from '../../src/main/cdg-import';
import { LRC_BYTE_LIMIT, resolveLrcPair, useLrcPair } from '../../src/main/lrc-import';

const processOptions = { windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
const ffmpeg = (args: string[]) => {
  const result = spawnSync('ffmpeg', ['-v', 'error', ...args], processOptions);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};
const hasLrcTools = /\bsubtitles\s+V->V/.test(spawnSync('ffmpeg', ['-hide_banner', '-filters'], processOptions).stdout?.toString() ?? '') &&
  spawnSync('ffprobe', ['-version'], processOptions).status === 0;

async function waitForJob(job: CdgImport) {
  const until = Date.now() + 30_000;
  while (job.active() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(job.active(), false, 'Timed out waiting for synthetic conversion');
  return job.snapshot()!;
}

test('LRC pairs accept deliberate audio choices and never guess between sibling versions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tpv-lrc-pair-'));
  try {
    const lyrics = join(dir, 'Artist - Song.LRC'), audio = join(dir, 'Artist - SONG.MP3');
    await writeFile(lyrics, '[00:00.00]Synthetic');
    await assert.rejects(resolveLrcPair(lyrics), /unique LRC.*matching audio/);
    await writeFile(audio, 'synthetic');
    assert.equal(await useLrcPair(audio), true);
    assert.deepEqual(await resolveLrcPair(lyrics), { audio, lyrics });
    const alternate = join(dir, 'Artist - Song.wav');
    await writeFile(alternate, 'synthetic');
    await assert.rejects(resolveLrcPair(lyrics), /More than one matching audio file/);
    assert.deepEqual(await resolveLrcPair(alternate), { audio: alternate, lyrics });
    await writeFile(join(dir, 'Artist - Song.cdg'), 'synthetic');
    await assert.rejects(useLrcPair(audio), /both LRC and CDG/);
    assert.equal(await useLrcPair(lyrics), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid, oversized or cancelled LRC preparation never commits a song', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tpv-lrc-invalid-'));
  try {
    const lyrics = join(dir, 'song.lrc');
    await writeFile(join(dir, 'song.mp3'), 'synthetic');
    let commits = 0;
    const managed = join(dir, 'managed');
    const job = new CdgImport(managed, () => { commits++; return 'imported'; });
    await writeFile(lyrics, Buffer.alloc(LRC_BYTE_LIMIT + 1));
    job.start(lyrics);
    assert.match((await waitForJob(job)).message, /size limit/);
    await writeFile(lyrics, Buffer.from([0xff, 0xfe, 0x61]));
    job.start(lyrics);
    assert.match((await waitForJob(job)).message, /UTF-8/);
    await writeFile(lyrics, '[00:60.00]Invalid');
    job.start(lyrics);
    assert.match((await waitForJob(job)).message, /timestamp.*out of range/);
    const { id } = job.start(lyrics);
    assert.equal(job.cancel(id), true);
    assert.equal((await waitForJob(job)).phase, 'cancelled');
    assert.equal(commits, 0);
    assert.deepEqual(await readdir(managed), []);
    assert.equal(await readFile(lyrics, 'utf8'), '[00:60.00]Invalid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('converted LRC lyrics follow audio and clear cues on the looping backdrop', { skip: !hasLrcTools }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tpv-lrc-render-'));
  try {
    const lyrics = join(dir, 'Artist - Song.lrc'), audio = join(dir, 'Artist - Song.wav'), backdrop = join(dir, 'custom.mp4');
    const source = '[offset:100]\n[00:00.60]<i>Literal & text</i>\n[00:01.60]\n[00:02.20]<00:02.20>New <00:02.80>cue';
    await writeFile(lyrics, source);
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', audio]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=navy:s=640x360:r=25:d=0.5', '-f', 'lavfi',
      '-i', 'sine=frequency=880:duration=0.5', '-c:v', 'libx264', '-c:a', 'aac', backdrop]);
    const original = await readFile(audio);
    let converted = '';
    const job = new CdgImport(join(dir, 'managed'), (path, fingerprint, metadataPath) => {
      assert.equal(metadataPath, lyrics);
      assert.match(fingerprint, /^[a-f0-9]{64}$/);
      converted = path;
      return 'imported';
    });
    job.start(lyrics, backdrop);
    const result = await waitForJob(job);
    assert.equal(result.phase, 'completed', result.message);
    assert.deepEqual(await readdir(dirname(converted)), ['track.mp4']);
    assert.equal(await readFile(lyrics, 'utf8'), source);
    assert.deepEqual(await readFile(audio), original);

    const frame = (seconds: number) => {
      const pixels = ffmpeg(['-ss', String(seconds), '-i', converted, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      assert.equal(pixels.length, 1280 * 720 * 3);
      let white = 0;
      for (let i = 0; i < pixels.length; i += 3) if (pixels[i] > 180 && pixels[i + 1] > 180 && pixels[i + 2] > 180) white++;
      return { white, navy: pixels[2] > 100 && pixels[0] < 20 };
    };
    const intro = frame(0.2), first = frame(0.8), gap = frame(1.8), second = frame(2.5);
    assert.equal(intro.white, 0);
    assert.ok(first.white > 1000, `Expected first line pixels, got ${first.white}`);
    assert.equal(gap.white, 0);
    assert.ok(second.white > 1000, `Expected enhanced LRC's full line, got ${second.white}`);
    assert.ok([intro, first, gap, second].every(sample => sample.navy), 'Backdrop should loop across the audio length');

    const pcm = ffmpeg(['-ss', '2', '-i', converted, '-t', '0.5', '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1']);
    let crossings = 0;
    for (let i = 2; i < pcm.length; i += 2) if (pcm.readInt16LE(i - 2) <= 0 && pcm.readInt16LE(i) > 0) crossings++;
    assert.ok(crossings > 200 && crossings < 240, `Only the selected 440 Hz audio should be audible, got ${crossings} crossings`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
