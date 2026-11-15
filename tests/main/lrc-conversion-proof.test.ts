import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { convertLrcProof, LrcConversionCleanupError } from '../../src/main/lrc-conversion-proof';

const ffmpeg = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 15000 });
const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 15000 });
const probe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8', timeout: 15000 });
const supported = ffmpeg.status === 0 && /\bsubtitles\b/.test(ffmpeg.stdout) && encoders.status === 0 && /\blibx264\b/.test(encoders.stdout) && /\blibmp3lame\b/.test(encoders.stdout) && /\baac\b/.test(encoders.stdout) && probe.status === 0;
const render = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', ...args], { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024, timeout: 20000 });
const frame = (video: string, seconds: number) => render(['-ss', String(seconds), '-i', video, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);

test('LRC conversion renders line timing and clear cues at the media clock while preserving inputs', { skip: !supported, timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-lrc-proof-test-'));
  try {
    const audio = join(directory, 'song.mp3'), lyrics = join(directory, 'song.lrc'), backdrop = join(directory, 'backdrop.mp4'), output = join(directory, 'output.mp4');
    render(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.6', '-c:a', 'libmp3lame', audio]);
    render(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', backdrop]);
    await writeFile(lyrics, '[00:00.50]HELLO\n[00:01.00]\n[00:01.50]WORLD\n[00:02.00]\n');
    const originals = await Promise.all([audio, lyrics, backdrop].map(path => readFile(path)));
    const result = await convertLrcProof({ audio, lyrics, backdrop, output, signal: new AbortController().signal });
    assert.ok(result.durationMs >= 2500 && result.durationMs < 3000);
    assert.equal(result.enhancedTimingOmitted, false);
    assert.deepEqual(await Promise.all([audio, lyrics, backdrop].map(path => readFile(path))), originals);
    const before = frame(output, 0.25), first = frame(output, 0.75), clear = frame(output, 1.25), second = frame(output, 1.75), after = frame(output, 2.25);
    assert.deepEqual(before, clear);
    assert.deepEqual(clear, after);
    assert.notDeepEqual(first, clear);
    assert.notDeepEqual(second, clear);
    assert.notDeepEqual(first, second);
    const audioSamples = render(['-i', output, '-map', '0:a:0', '-t', '0.5', '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
    let peak = 0;
    for (let offset = 0; offset + 1 < audioSamples.length; offset += 2) peak = Math.max(peak, Math.abs(audioSamples.readInt16LE(offset)));
    assert.ok(audioSamples.length >= 7000 && peak > 100, 'Output audio decodes and is not silent');
    assert.deepEqual((await readdir(directory)).sort(), ['backdrop.mp4', 'output.mp4', 'song.lrc', 'song.mp3']);
    const outputBefore = await readFile(output);
    await assert.rejects(convertLrcProof({ audio, lyrics, backdrop, output, signal: new AbortController().signal }), /EEXIST/);
    assert.deepEqual(await readFile(output), outputBefore);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('LRC conversion reports whether output was published when cleanup fails', { skip: !supported, timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-lrc-proof-cleanup-'));
  try {
    const audio = join(directory, 'song.mp3'), lyrics = join(directory, 'song.lrc'), backdrop = join(directory, 'backdrop.mp4'), output = join(directory, 'output.mp4');
    render(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:a', 'libmp3lame', audio]);
    render(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', backdrop]);
    await writeFile(lyrics, '[00:00.10]HELLO\n');
    const failCleanup = () => { throw new Error('simulated cleanup failure'); };
    await assert.rejects(convertLrcProof({ audio, lyrics, backdrop, output, signal: new AbortController().signal }, { beforeCleanup: failCleanup }), error => {
      assert.ok(error instanceof LrcConversionCleanupError);
      assert.equal(error.published, true);
      assert.equal(error.operationError, undefined);
      assert.match(String(error.cause), /simulated cleanup failure/);
      return true;
    });
    assert.ok((await readFile(output)).length > 0);
    await writeFile(lyrics, 'not timed lyrics');
    await assert.rejects(convertLrcProof({ audio, lyrics, backdrop, output: join(directory, 'other.mp4'), signal: new AbortController().signal }, { beforeCleanup: failCleanup }), error => {
      assert.ok(error instanceof LrcConversionCleanupError);
      assert.equal(error.published, false);
      assert.match(String(error.operationError), /timestamp/);
      return true;
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('LRC conversion rejects invalid lyrics and cancelled work without creating output', { skip: !supported, timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-lrc-proof-test-'));
  try {
    const audio = join(directory, 'song.mp3'), lyrics = join(directory, 'song.lrc'), backdrop = join(directory, 'backdrop.mp4'), output = join(directory, 'output.mp4');
    render(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', audio]);
    render(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', backdrop]);
    await writeFile(lyrics, 'This has no timestamp');
    await assert.rejects(convertLrcProof({ audio, lyrics, backdrop, output, signal: new AbortController().signal }), /timestamp/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(convertLrcProof({ audio, lyrics, backdrop, output, signal: controller.signal }), /cancelled/);
    assert.deepEqual((await readdir(directory)).sort(), ['backdrop.mp4', 'song.lrc', 'song.mp3']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
