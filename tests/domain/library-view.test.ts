import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { libraryView } from '../../src/domain/library-view';
import type { Version } from '../../src/domain';

const songs: Version[] = [
  { id: 'a', title: 'Song 10', artist: 'Beyoncé', rating: 'clean', djCode: 'DJID-002', metadataAmbiguous: true },
  { id: 'b', title: 'Song 2', artist: 'Alpha', rating: 'explicit', trackNumber: '04' },
  { id: 'c', title: 'Other', artist: '', rating: 'unrated' },
  { id: 'd', title: 'Maybe', artist: 'Zed', rating: 'uncertain' }
];
const filenames = { a: 'DJID-002 - Original Artist - Original Title.mp4', b: '04.Alpha - Song 2.mp4' };
const ids = (items: Version[]) => items.map(item => item.id);

test('search matches current metadata, source basename, disk code and track number with accent-insensitive terms', () => {
  assert.deepEqual(ids(libraryView(songs, 'original title', filenames, 'import-oldest', 'all')), ['a']);
  assert.deepEqual(ids(libraryView(songs, 'BEYONCE original', filenames, 'import-oldest', 'all')), ['a']);
  assert.deepEqual(ids(libraryView(songs, 'djid-002', filenames, 'import-oldest', 'all')), ['a']);
  assert.deepEqual(ids(libraryView(songs, '04', filenames, 'import-oldest', 'all')), ['b']);
  assert.deepEqual(ids(libraryView(songs, 'original nonexistent', filenames, 'import-oldest', 'all')), []);
  assert.deepEqual(ids(libraryView(songs, 'song', {}, 'import-oldest', 'all')), ['a', 'b']);
});

test('host filters combine with search and only operate on the supplied policy-filtered list', () => {
  assert.deepEqual(ids(libraryView(songs, '', filenames, 'import-oldest', 'review')), ['a']);
  assert.deepEqual(ids(libraryView(songs, '', filenames, 'import-oldest', 'missing-artist')), ['c']);
  assert.deepEqual(ids(libraryView(songs, 'song', filenames, 'import-oldest', 'explicit')), ['b']);
  assert.deepEqual(ids(libraryView(songs, '', filenames, 'import-oldest', 'uncertain')), ['d']);
  assert.deepEqual(ids(libraryView(songs.filter(s => s.id !== 'b'), 'alpha', filenames, 'import-oldest', 'all')), []);
});

test('sorting is deterministic, uses numeric title order, keeps missing artists last, and never mutates source', () => {
  assert.deepEqual(ids(libraryView(songs, '', filenames, 'import-newest', 'all')), ['d', 'c', 'b', 'a']);
  assert.deepEqual(ids(libraryView(songs, 'song', filenames, 'title-asc', 'all')), ['b', 'a']);
  assert.deepEqual(ids(libraryView(songs, 'song', filenames, 'title-desc', 'all')), ['a', 'b']);
  assert.deepEqual(ids(libraryView(songs, '', filenames, 'artist-asc', 'all')), ['b', 'a', 'd', 'c']);
  assert.deepEqual(ids(libraryView(songs, '', filenames, 'artist-desc', 'all')), ['d', 'a', 'b', 'c']);
  assert.deepEqual(ids(songs), ['a', 'b', 'c', 'd']);
});
