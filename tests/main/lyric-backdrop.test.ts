import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lyricBackdropPath, validateLyricBackdropFile } from '../../src/main/lyric-backdrop';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/domain/settings';

test('old settings adopt the TPV backdrop; custom or disabled choices persist without machine-specific defaults', () => {
  assert.equal(parseSettings({}).lyricBackdrop, 'default');
  assert.equal(DEFAULT_SETTINGS.lyricBackdropFile, '');
  const locations = { packaged: false, appPath: join('repo', 'app'), resourcesPath: join('installed', 'resources') };
  assert.equal(lyricBackdropPath(DEFAULT_SETTINGS, locations), join(locations.appPath, 'assets', 'backdrops', 'tpv-karaoke-v3.mp4'));
  assert.equal(lyricBackdropPath(DEFAULT_SETTINGS, { ...locations, packaged: true }), join(locations.resourcesPath, 'backdrops', 'tpv-karaoke-v3.mp4'));
  const custom = parseSettings({ lyricBackdrop: 'custom', lyricBackdropFile: '/custom/my loop.mp4' });
  assert.equal(lyricBackdropPath(custom, locations), '/custom/my loop.mp4');
  assert.equal(lyricBackdropPath({ ...custom, lyricBackdrop: 'none' }, locations), undefined);
  assert.equal(parseSettings(JSON.parse(JSON.stringify(custom))).lyricBackdropFile, custom.lyricBackdropFile);
  for (const value of [null, 'file:///tmp/x.mp4', 'relative.mp4', 'https://host/movie.mp4', '/movie.wav', '/movie.mp4\n'])
    assert.throws(() => parseSettings({ lyricBackdrop: 'custom', lyricBackdropFile: value }), /lyric backdrop/i);
  assert.throws(() => parseSettings({ lyricBackdrop: 'unknown' }), /lyric backdrop/i);
  assert.throws(() => parseSettings({ lyricBackdrop: 'custom' }), /lyric backdrop/i);
  assert.equal(parseSettings({ lyricBackdrop: 'custom', lyricBackdropFile: 'C:\\Media\\backdrop.MP4' }).lyricBackdrop, 'custom');
});

test('unavailable or empty backdrop has a recovery message instead of silently changing the selected background', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tpv-backdrop-'));
  try {
    const video = join(directory, 'loop.mp4');
    await assert.rejects(validateLyricBackdropFile(video), /Preferences.*Solid CDG Background/);
    await mkdir(video);
    await assert.rejects(validateLyricBackdropFile(video), /cannot be read/);
    await rm(video, { recursive: true });
    await writeFile(video, '');
    await assert.rejects(validateLyricBackdropFile(video), /cannot be read/);
    await writeFile(video, 'fake header only: codec validation belongs to FFmpeg');
    await validateLyricBackdropFile(video);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
