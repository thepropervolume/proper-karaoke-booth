import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewMetadata } from '../../src/main/metadata-preview';
import type { Version } from '../../src/domain';

test('previews existing imports with current templates and never mutates saved metadata', () => {
  const versions: Version[] = [
    { id: 'one', artist: 'PVOL-0428', title: 'Jimmy Eat World - A Praise Chorus', rating: 'unrated' },
    { id: 'two', artist: 'Nada Surf', title: 'Popular', rating: 'unrated' },
    { id: 'remote', artist: 'PVOL-0428', title: 'Jimmy Eat World - A Praise Chorus', rating: 'unrated', source: { provider: 'youtube', videoId: 'abcdefghijk' } },
  ];
  const before = structuredClone(versions);
  const paths: Record<string, string> = { one: 'C:\\songs\\PVOL-0428 - Jimmy Eat World - A Praise Chorus.mp4',
    two: '/songs/Nada Surf/Nada Surf - Popular.mp4', remote: '/songs/PVOL-0428 - Jimmy Eat World - A Praise Chorus.mp4' };
  const proposals = previewMetadata(versions, id => paths[id] ? { path: paths[id] } : undefined,
    ['${DJ Code}-${Track Number} - ${Artist} - ${Title}', '${Artist}/${Artist} - ${Title}'], 'artist-title');
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0], { id: 'one', filename: 'PVOL-0428 - Jimmy Eat World - A Praise Chorus.mp4',
    oldArtist: 'PVOL-0428', oldTitle: 'Jimmy Eat World - A Praise Chorus', artist: 'Jimmy Eat World', title: 'A Praise Chorus', ambiguous: false });
  assert.deepEqual(versions, before);
});

test('directory templates and repeated placeholders must match before proposing an edit', () => {
  const versions: Version[] = [{ id: 'one', artist: 'Old', title: 'Old title', rating: 'unrated' },
    { id: 'two', artist: 'Other', title: 'Old title', rating: 'unrated' }];
  const paths: Record<string, string> = { one: '/songs/Nada Surf/NADA SURF - Popular.mp4', two: '/songs/Queen/Nada Surf - Popular.mp4' };
  const result = previewMetadata(versions, id => ({ path: paths[id] }), ['${Artist}/${Artist} - ${Title}'], 'artist-title');
  assert.equal(result.length, 1); assert.equal(result[0].artist, 'Nada Surf'); assert.equal(result[0].title, 'Popular');
});
