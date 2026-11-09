import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cachedVideoPath, planCachePaths, selectLatestByArtistTrack, type CacheVideo } from '../../src/main/karaokenerds-cache-plan';

const video: CacheVideo = {
  id: 'one', provider: 'karaokenerds', brandPrefix: 'PVOL', trackCode: '0382', artist: 'Nada Surf', title: 'Amateur', extension: 'mp4', publishedAt: '2025-01-01T00:00:00Z',
};

test('builds the requested directory and filename on both operating-system path styles', () => {
  assert.equal(cachedVideoPath('/chosen/path', video, path.posix), '/chosen/path/karaokenerds/Brands/PVOL/Nada Surf/PVOL-0382 - Nada Surf - Amateur.mp4');
  assert.equal(cachedVideoPath('C:\\chosen\\path', { ...video, trackCode: 'PVOL-0382', extension: '.MP4' }, path.win32), 'C:\\chosen\\path\\karaokenerds\\Brands\\PVOL\\Nada Surf\\PVOL-0382 - Nada Surf - Amateur.mp4');
});

test('neutralizes path injection and reserved names and rejects unsafe inputs', () => {
  const result = cachedVideoPath('/cache', { ...video, provider: '../evil', artist: 'CON', title: '../A\\B:?' }, path.posix);
  assert.equal(result, '/cache/.._evil/Brands/PVOL/_CON/PVOL-0382 - _CON - .._A_B__.mp4');
  assert.throws(() => cachedVideoPath('/cache', { ...video, provider: '..' }, path.posix));
  assert.throws(() => cachedVideoPath('relative', video, path.posix));
  assert.throws(() => cachedVideoPath('/cache', { ...video, extension: '../../mp4' }, path.posix));
  const long = cachedVideoPath('/cache', { ...video, title: '😀'.repeat(200) }, path.posix);
  assert.ok(path.posix.basename(long).length <= 246);
  assert.ok(!path.posix.basename(long).includes('\ufffd'));
});

test('selects latest for each artist and track with deterministic tie handling', () => {
  const earlier = { ...video, id: 'earlier', publishedAt: '2023-01-01' };
  const later = { ...video, id: 'later', artist: 'nada surf', title: ' AMATEUR ', publishedAt: '2024-01-01' };
  const tie = { ...later, id: 'z', brandPrefix: 'Other' };
  const other = { ...video, id: 'other', title: 'Popular', publishedAt: null };
  assert.deepEqual(selectLatestByArtistTrack([tie, earlier, other, later]).selected.map(item => item.id), ['later', 'other']);
  assert.deepEqual(selectLatestByArtistTrack([later, other, earlier, tie]).selected.map(item => item.id), ['later', 'other']);
  assert.throws(() => selectLatestByArtistTrack([video, video]));
});

test('does not guess when multiple versions include an undated candidate', () => {
  const result = selectLatestByArtistTrack([video, { ...video, id: 'unknown', publishedAt: null }]);
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.unresolved, [{ artist: 'Nada Surf', title: 'Amateur', videoIds: ['one', 'unknown'], reason: 'missing-publication-date' }]);
});

test('reports filename collisions, including case and sanitization collisions, instead of overwriting', () => {
  const collision = { ...video, id: 'two', artist: 'NADA SURF', title: 'AMATEUR' };
  const other = { ...video, id: 'three', title: 'Popular' };
  const planned = planCachePaths('/cache', [collision, other, video], path.posix);
  assert.deepEqual(planned.ready.map(item => item.video.id), ['three']);
  assert.deepEqual(planned.collisions.map(item => item.videoIds), [['one', 'two']]);
  const first = { ...video, id: 'a', title: 'A/B' };
  const second = { ...video, id: 'b', title: 'A:B' };
  assert.deepEqual(planCachePaths('/cache', [first, second], path.posix).collisions[0].videoIds, ['a', 'b']);
});
