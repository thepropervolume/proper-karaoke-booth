import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createInitialState } from '../../src/domain';
import { validStreamingSource, streamingSourceLabel } from '../../src/domain/streaming-source';
import { recordingKeyFor } from '../../src/domain/song-rating';

test('KaraFun catalog and community recordings retain separate narrow identities', () => {
  for (const catalog of ['catalog', 'community'] as const) {
    const source = { provider: 'karafun' as const, catalog, songId: '6229' };
    assert.equal(validStreamingSource(source), true);
    const state = createInitialState('show', 'epoch');
    const result = applyCommand(state, { commandId: 'add', showId: 'show', hostEpoch: 'epoch', expectedRevision: 0,
      actor: { role: 'host', id: 'host' }, command: { type: 'addVersion', version: {
        id: `kf-${catalog}`, title: 'Synthetic song', artist: 'Artist', rating: 'unrated', source,
      } } });
    assert.equal(result.outcome.ok, true);
    assert.deepEqual(result.state.versions[0].source, source);
    assert.equal(streamingSourceLabel(source), 'KaraFun');
  }
  assert.equal(streamingSourceLabel(), 'Local');
  assert.equal(streamingSourceLabel({ provider: 'youtube', videoId: 'abcdefghijk' }), 'YouTube');
});

test('provider identities cannot contain URLs, credentials, paths or ambiguous identifiers', () => {
  const valid = { provider: 'karafun', catalog: 'catalog', songId: '6229' };
  for (const patch of [{ songId: '../6229' }, { songId: 'https://example.test/6229' }, { songId: '06229' },
    { songId: '0' }, { songId: 6229 }, { songId: '1'.repeat(13) }, { catalog: 'youtube' },
    { token: 'private' }, { url: 'https://example.test/private' }, { videoId: 'abcdefghijk' }]) {
    assert.equal(validStreamingSource({ ...valid, ...patch }), false);
  }
});

test('KaraFun source files never masquerade as YouTube ratings or source-less local votes', () => {
  assert.equal(recordingKeyFor({ provider: 'karafun', catalog: 'catalog', songId: '6229' }, 'a'.repeat(64)), 'karafun:catalog:6229');
  assert.equal(recordingKeyFor({ provider: 'karafun', catalog: 'community', songId: '6229' }, 'a'.repeat(64)), 'karafun:community:6229');
  assert.equal(recordingKeyFor({ provider: 'karafun', catalog: 'catalog', songId: '06229' }, 'a'.repeat(64)), null);
});
