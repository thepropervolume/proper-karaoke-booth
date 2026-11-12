import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState, type Version } from '../../src/domain';
import { unifiedLibrary, type LibraryCatalogTrack } from '../../src/domain/unified-library';
import { requestLibrarySong } from '../../src/renderer/request-library-song';

const local: Version = { id: 'local', title: 'Amateur', artist: 'Nada Surf', rating: 'clean', djCode: 'PVOL', trackNumber: '0382' };
const imported: Version = { id: 'saved', title: 'Host title', artist: 'Host artist', rating: 'clean', source: { provider: 'youtube', videoId: 'abcdefghijk' } };
const remote: LibraryCatalogTrack = { youtubeId: 'abcdefghijk', title: 'Amateur', artist: 'Nada Surf', brandSlug: 'TheProperVolume' };
const other = { ...remote, youtubeId: 'ABCDEFGHIJK' };
const fixture = () => ({ ...createInitialState('show', 'epoch'), versions: [local, imported] });
const project = (state = fixture(), tracks: LibraryCatalogTrack[] = [], query = 'Amateur') => unifiedLibrary(state, query, {}, 'import-oldest', 'all', tracks);

test('local matches remain available without catalog results and filename/sort/filter behavior remains intact', () => {
  const state = fixture();
  assert.deepEqual(project(state).map(row => row.id), ['local']);
  assert.deepEqual(unifiedLibrary(state, 'original', { saved: 'Original filename.mp4' }, 'title-asc', 'clean', []).map(row => row.id), ['saved']);
  assert.deepEqual(unifiedLibrary(state, '', {}, 'import-newest', 'all', [other]).map(row => row.id), ['catalog:youtube:ABCDEFGHIJK', 'saved', 'local']);
  assert.deepEqual(unifiedLibrary(state, '', {}, 'import-oldest', 'explicit', [other]), []);
});

test('exact YouTube identities merge repeated results while distinct recordings and local media remain separate', () => {
  const rows = project(fixture(), [remote, remote, other, other]);
  assert.deepEqual(rows.map(row => row.id), ['local', 'saved', 'catalog:youtube:ABCDEFGHIJK']);
  assert.equal(rows[1].title, 'Host title');assert.equal(rows[1].catalogTrack, undefined);
  assert.deepEqual(rows[2].catalogTrack, other);
  assert.equal(fixture().versions.length, 2);
  const duplicateLocal = { ...imported, id: 'old-duplicate' };
  const state = { ...fixture(), versions: [imported, duplicateLocal] };
  assert.deepEqual(project(state, [remote], '').map(row => row.id), ['saved']);
});

test('catalog matches never bypass excluded versions, clean-only rules or an explicit include list', () => {
  const state = fixture();state.policy.excludeVersionIds = ['saved'];
  assert.deepEqual(project(state, [remote, other]).map(row => row.id), ['local', 'catalog:youtube:ABCDEFGHIJK']);
  state.policy.ageRestricted = true;
  assert.deepEqual(project(state, [remote, other]).map(row => row.id), ['local']);
  state.policy.ageRestricted = false;state.policy.includeVersionIds = ['local'];
  assert.deepEqual(project(state, [remote, other]).map(row => row.id), ['local']);
  state.policy.includeVersionIds = ['saved'];state.policy.excludeVersionIds = [];
  assert.deepEqual(project(state, [remote, other]).map(row => row.id), ['saved']);
});

test('invalid catalog identities are omitted without corrupting local rows or inventing brand slugs', () => {
  const rows = project(fixture(), [{ ...other, youtubeId: '../bad' }, { ...other, title: 'x'.repeat(501) }, { ...other, title: 'bad\ncontrol' }, { ...other, brandSlug: '../invented' }]);
  assert.equal(rows.length, 2);assert.equal(rows[1].catalogTrack?.brandSlug, undefined);
  assert.equal(rows[0].id, 'local');
});

test('requesting a catalog-only row queues through one authority call and local rows keep the existing request path', async () => {
  const row = project(fixture(), [other]).find(item => item.catalogTrack)!;
  const calls: unknown[] = [];
  const bridge = { requestCatalogTrack: async (input: unknown) => { calls.push(['catalog', input]); return { ok: true, versionId: 'committed', notice: 'Download queued.' }; },
    command: async (input: unknown) => { calls.push(['local', input]); return { ok: true }; } };
  assert.deepEqual(await requestLibrarySong(row, 'singer', 'request', bridge), { ok: true, versionId: 'committed', notice: 'Download queued.' });
  await requestLibrarySong(imported, 'singer', 'another', bridge);
  assert.deepEqual(calls, [['catalog', { track: other, singerId: 'singer', requestId: 'request' }], ['local', { type: 'request', versionId: 'saved', singerId: 'singer', requestId: 'another' }]]);
});
