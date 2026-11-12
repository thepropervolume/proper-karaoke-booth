import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { crc32 } from 'node:zlib';
import { CdgImport, convertCdg, extractCdgZip, resolveCdgPair } from '../../src/main/cdg-import';

function zip(entries: { name: string; data: Buffer; flags?: number; checksum?: number }[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), checksum = entry.checksum ?? crc32(entry.data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(entry.flags ?? 0, 6); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(entry.data.length, 18); header.writeUInt32LE(entry.data.length, 22); header.writeUInt16LE(name.length, 26);
    locals.push(header, name, entry.data);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(entry.flags ?? 0, 8); index.writeUInt32LE(checksum, 16); index.writeUInt32LE(entry.data.length, 20); index.writeUInt32LE(entry.data.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE(offset, 42); central.push(index, name); offset += header.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const graphics = Buffer.alloc(24 * 300);
for (let i = 0; i < 300; i++) { graphics[i * 24] = 9; graphics[i * 24 + 1] = 1; }

test('paired files use a unique case-insensitive sibling name and reject missing assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-pair-'));
  try {
    const audio = join(dir, 'Singer - Title.MP3'), cdg = join(dir, 'Singer - Title.cdg');
    await writeFile(audio, 'audio'); await writeFile(cdg, graphics);
    assert.deepEqual(await resolveCdgPair(audio), { audio, graphics: cdg });
    await rm(cdg); await assert.rejects(resolveCdgPair(audio), /unique MP3 and CDG/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('ZIP extracts only one matching pair to fixed filenames and leaves input unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-zip-'));
  try {
    const archive = zip([{ name: 'folder/Artist - Title.mp3', data: Buffer.from('audio') }, { name: 'folder/Artist - Title.cdg', data: graphics }]);
    const source = join(dir, 'source.zip'), output = join(dir, 'out'); await mkdir(output); await writeFile(source, archive);
    const result = await extractCdgZip(source, output, new AbortController().signal);
    assert.equal(result.metadataName, 'folder/Artist - Title.mp3'); assert.deepEqual(await readFile(result.graphics), graphics);
    assert.deepEqual(await readFile(source), archive); assert.deepEqual((await readdir(output)).sort(), ['audio.mp3', 'lyrics.cdg']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('ZIP rejects path traversal, ambiguous pairs, encryption, corrupt bytes and cancellation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-invalid-'));
  try {
    const pair = [{ name: 'song.mp3', data: Buffer.from('audio') }, { name: 'song.cdg', data: graphics }];
    const cases = [
      [{ name: '../escape.mp3', data: Buffer.from('bad') }, pair[1]],
      [...pair, { name: 'other.mp3', data: Buffer.from('audio') }],
      [{ ...pair[0], flags: 1 }, pair[1]],
      [{ ...pair[0], checksum: 123 }, pair[1]],
    ];
    for (let i = 0; i < cases.length; i++) {
      const source = join(dir, `${i}.zip`), output = join(dir, `${i}`); await mkdir(output); await writeFile(source, zip(cases[i]));
      await assert.rejects(extractCdgZip(source, output, new AbortController().signal));
    }
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(extractCdgZip(join(dir, '1.zip'), dir, cancelled.signal));
    assert.equal((await readdir(dir)).includes('escape.mp3'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
test('cancellation before conversion never commits or deletes the selected sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-cancel-'));
  try {
    const audio = join(dir, 'song.mp3'), cdg = join(dir, 'song.cdg'); await writeFile(audio, 'audio'); await writeFile(cdg, graphics);
    let committed = false;
    const job = new CdgImport(join(dir, 'managed'), () => { committed = true; return 'imported'; });
    const progress = job.start(cdg); assert.equal(job.cancel(progress.id), true); await job.shutdown();
    assert.equal(job.snapshot()?.phase, 'cancelled'); assert.equal(committed, false); assert.deepEqual(await readFile(cdg), graphics);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('CDG/MP3 conversion produces a playable MP4 before committing without changing originals', { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-convert-'));
  try {
    const audio = join(dir, 'Artist - Song.mp3'), cdg = join(dir, 'Artist - Song.cdg');
    assert.equal(spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', audio], { windowsHide: true }).status, 0);
    await writeFile(cdg, graphics); const original = await readFile(audio);
    let committed = '';
    const job = new CdgImport(join(dir, 'managed'), (path, fingerprint, metadataPath) => { committed = path; assert.equal(metadataPath, cdg); assert.match(fingerprint, /^[a-f0-9]{64}$/); return 'imported'; });
    job.start(cdg);
    while (job.active()) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(job.snapshot()?.phase, 'completed', job.snapshot()?.message); assert.ok((await stat(committed)).size > 1000);
    assert.equal(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', committed], { windowsHide: true }).status, 0);
    assert.deepEqual(await readFile(audio), original); assert.deepEqual(await readFile(cdg), graphics);
    assert.deepEqual(await readdir(join(committed, '..')), ['track.mp4']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('cleanup refuses a replaced managed directory for both retained and duplicate conversions', { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-cleanup-'));
  try {
    const audio = join(dir, 'song.mp3'), cdg = join(dir, 'song.cdg');
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', audio], { windowsHide: true }).status, 0);
    await writeFile(cdg, graphics);
    for (const outcome of ['imported', 'duplicate'] as const) {
      const victim = join(dir, `victim-${outcome}`); await mkdir(victim); await writeFile(join(victim, 'audio.mp3'), 'preserve audio'); await writeFile(join(victim, 'lyrics.cdg'), 'preserve graphics');
      const job = new CdgImport(join(dir, `managed-${outcome}`), path => {
        // This callback is synchronous like Store.save. Replace the job directory
        // between publication and cleanup to reproduce a hostile junction swap.
        const directory = dirname(path);
        const result = spawnSync(process.execPath, ['-e', `const f=require('node:fs'); f.renameSync(process.argv[1],process.argv[1]+'-moved'); f.symlinkSync(process.argv[2],process.argv[1],process.platform==='win32'?'junction':'dir');`, directory, victim], { windowsHide: true });
        assert.equal(result.status, 0); return outcome;
      });
      job.start(cdg); while (job.active()) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(job.snapshot()?.phase, 'completed', job.snapshot()?.message); assert.match(job.snapshot()!.message, /Temporary files could not be removed/);
      assert.equal(await readFile(join(victim, 'audio.mp3'), 'utf8'), 'preserve audio'); assert.equal(await readFile(join(victim, 'lyrics.cdg'), 'utf8'), 'preserve graphics');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});


// Identical RGB colors at different palette indexes are deliberate: a chroma
// key would erase the black foreground along with the black screen background.
function indexedGraphics(): Buffer {
  const data = Buffer.alloc(24 * 600);
  for (let i = 0; i < 600; i++) data[i * 24] = 9;
  const packet = (index: number, instruction: number, payload: number[]) => {
    data[index * 24 + 1] = instruction; Buffer.from(payload).copy(data, index * 24 + 4);
  };
  const colors = [0x000, 0x000, 0xfff, 0xfff, 0x000, 0x000, 0x000, 0x000];
  packet(0, 30, colors.flatMap(color => [color >> 6, color & 63]));
  packet(1, 1, [0, 0]);
  packet(2, 6, [0, 1, 5, 10, ...Array(12).fill(63)]);
  packet(3, 6, [0, 2, 5, 20, ...Array(12).fill(63)]);
  // A new, differently colored background near a 25 fps rounding boundary must
  // disappear without masking black lyrics or leaving a one-frame solid flash.
  packet(6, 1, [3, 0]);
  packet(7, 6, [3, 1, 5, 10, ...Array(12).fill(63)]);
  packet(8, 6, [3, 2, 5, 20, ...Array(12).fill(63)]);
  packet(18, 38, [0, 3, 5, 10, ...Array(12).fill(63)]);
  packet(30, 38, [0, 3, 5, 10, ...Array(12).fill(63)]);
  const fadeBlack = Array(16).fill(0); fadeBlack[1] = 63;
  packet(150, 28, fadeBlack); // Pending alpha does not apply until palette load.
  packet(180, 30, colors.flatMap(color => [color >> 6, color & 63]));
  packet(240, 28, Array(16).fill(0));
  packet(241, 30, colors.flatMap(color => [color >> 6, color & 63]));
  // Coarse scrolling is decoded by FFmpeg for RGB and the indexed mask.
  packet(300, 24, [3, 0x10, 0]);
  return data;
}
const ffmpeg = (args: string[]) => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString()); return result.stdout;
};

test('a looping CDG backdrop preserves same-RGB black lyrics, timing, XOR, latched alpha, scroll and MP3-only audio', { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-backdrop-'));
  try {
    const audio = join(dir, 'song.mp3'), cdg = join(dir, 'song.cdg'), backdrop = join(dir, 'backdrop.mp4'), output = join(dir, 'rendered.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', audio]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=1280x720:r=25:d=0.5', '-f', 'lavfi', '-i', 'color=blue:s=1280x720:r=25:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[video]', '-map', '[video]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', backdrop]);
    const originalGraphics = indexedGraphics(); await writeFile(cdg, originalGraphics); const originalAudio = await readFile(audio), originalBackdrop = await readFile(backdrop);
    await convertCdg(audio, cdg, output, new AbortController().signal, () => {}, backdrop);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', output], { windowsHide: true });
    assert.equal(probe.status, 0); const metadata = JSON.parse(probe.stdout.toString());
    assert.equal(metadata.streams.filter((stream: { codec_type: string }) => stream.codec_type === 'audio').length, 1);
    assert.equal(metadata.streams[0].width, 1280); assert.equal(metadata.streams[0].height, 720);
    assert.ok(Math.abs(Number(metadata.format.duration) - 2) < 0.15);
    const pixel = (frame: Buffer, x: number, y: number) => [...frame.subarray((y * 1280 + x) * 3, (y * 1280 + x) * 3 + 3)];
    for (const seconds of [0, 0.04, 0.08, 0.4, 0.56, 0.72, 1.4]) {
      const frame = ffmpeg(['-ss', String(seconds), '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      const background = pixel(frame, 100, 100), behindLyrics = pixel(frame, 800, 400);
      assert.ok(background[seconds > 0.5 && seconds < 1 ? 2 : 0] > 220, `backdrop loop at ${seconds}: ${background}`);
      assert.ok(behindLyrics[seconds > 0.5 && seconds < 1 ? 2 : 0] > 220, `no opaque screen at ${seconds}: ${behindLyrics}`);
      const shift = seconds >= 1 ? 20 : 0;
      const blackLyric = pixel(frame, 350 + shift, 210);
      if (seconds === 0.08) assert.ok(blackLyric.every(component => component > 225), 'XOR changed the palette index to white');
      else if (seconds === 0.72) assert.ok(blackLyric[2] > 220 && blackLyric[0] < 25, 'latched transparent lyric reveals backdrop');
      else assert.ok(blackLyric.every(component => component < 25), `black lyric survives at ${seconds}`);
      assert.ok(pixel(frame, 550 + shift, 210).every(component => component > 225), `white lyric survives at ${seconds}`);
    }
    const pcm = ffmpeg(['-ss', '0.5', '-i', output, '-t', '0.5', '-vn', '-ac', '1', '-ar', '44100', '-f', 'f32le', 'pipe:1']);
    let crossings = 0;
    for (let offset = 4; offset < pcm.length; offset += 4) if ((pcm.readFloatLE(offset) >= 0) !== (pcm.readFloatLE(offset - 4) >= 0)) crossings++;
    assert.ok(Math.abs(crossings - 440) < 6, `expected MP3 440Hz, not backdrop 880Hz: ${crossings}`);
    assert.deepEqual(await readFile(cdg), originalGraphics); assert.deepEqual(await readFile(audio), originalAudio); assert.deepEqual(await readFile(backdrop), originalBackdrop);
    assert.equal((await readdir(dir)).includes('rendered.mp4.alpha.cdg'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an unavailable backdrop fails with a recovery path and never commits a song', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-backdrop-missing-'));
  try {
    const audio = join(dir, 'song.mp3'), cdg = join(dir, 'song.cdg'); await writeFile(audio, 'audio'); await writeFile(cdg, graphics);
    let committed = false;
    const job = new CdgImport(join(dir, 'managed'), () => { committed = true; return 'imported'; });
    job.start(cdg, join(dir, 'missing.mp4')); while (job.active()) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(committed, false); assert.equal(job.snapshot()?.phase, 'failed'); assert.match(job.snapshot()?.message ?? '', /backdrop is unavailable.*Preferences.*retry/);
    assert.deepEqual(await readdir(join(dir, 'managed')), []);
    assert.deepEqual(await readFile(cdg), graphics);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('cancelling a running backdrop conversion waits for FFmpeg and removes its private mask', { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cdg-backdrop-cancel-'));
  try {
    const audio = join(dir, 'song.mp3'), cdg = join(dir, 'song.cdg'), backdrop = join(dir, 'backdrop.mp4'), output = join(dir, 'rendered.mp4');
    ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:a', 'libmp3lame', audio]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=green:s=320x180:r=25:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', backdrop]);
    const source = indexedGraphics(); await writeFile(cdg, source);
    const controller = new AbortController(); let observedProgress = false;
    await assert.rejects(convertCdg(audio, cdg, output, controller.signal, () => { observedProgress = true; controller.abort(); }, backdrop), /Import cancelled/);
    assert.equal(observedProgress, true); assert.equal((await readdir(dir)).includes('rendered.mp4.alpha.cdg'), false);
    assert.deepEqual(await readFile(cdg), source);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
