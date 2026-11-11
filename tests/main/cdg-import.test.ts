import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { crc32 } from 'node:zlib';
import { CdgImport, extractCdgZip, resolveCdgPair } from '../../src/main/cdg-import';

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
