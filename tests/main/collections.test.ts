import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collections } from '../../src/main/collections';

test('singer playlists and KJ Picks retain valid, unique songs and reject invalid inputs', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const collections = new Collections(db);
    const singers = [{ id: 'singer-a' }, { id: 'singer-b' }], songs = [{ id: 'song-a' }, { id: 'song-b' }];
    collections.mutate({ type: 'create', id: 'p1', name: ' Favorites ', singerId: 'singer-a' }, singers, songs);
    collections.mutate({ type: 'add', playlistId: 'p1', versionId: 'song-a' }, singers, songs);
    collections.mutate({ type: 'add', playlistId: 'p1', versionId: 'song-a' }, singers, songs);
    collections.mutate({ type: 'add', playlistId: 'kj-picks', versionId: 'song-b' }, singers, songs);
    assert.deepEqual(collections.snapshot().playlists, [{ id: 'kj-picks', name: 'KJ Picks', singerId: null }, { id: 'p1', name: 'Favorites', singerId: 'singer-a' }]);
    assert.deepEqual(collections.snapshot().items, [{ playlistId: 'p1', versionId: 'song-a' }, { playlistId: 'kj-picks', versionId: 'song-b' }]);
    assert.throws(() => collections.mutate({ type: 'create', id: 'p2', name: ' ', singerId: 'singer-a' }, singers, songs));
    assert.throws(() => collections.mutate({ type: 'create', id: 'p2', name: 'X', singerId: 'missing' }, singers, songs));
    assert.throws(() => collections.mutate({ type: 'add', playlistId: 'p1', versionId: 'missing' }, singers, songs));
    assert.throws(() => collections.mutate({ type: 'add', playlistId: 'missing', versionId: 'song-a' }, singers, songs));
    collections.mutate({ type: 'remove', playlistId: 'p1', versionId: 'song-a' }, singers, songs);
    assert.deepEqual(collections.snapshot().items, [{ playlistId: 'kj-picks', versionId: 'song-b' }]);
    assert.deepEqual(new Collections(db).snapshot().playlists, collections.snapshot().playlists);
  } finally { db.close(); }
});

test('playlists and history persist across database close and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-collections-'));
  let db: DatabaseSync | undefined;
  try {
    const path = join(dir, 'show.sqlite');
    db = new DatabaseSync(path);
    let collections = new Collections(db);
    collections.mutate({ type: 'create', id: 'list', name: 'Songs', singerId: 's' }, [{ id: 's' }], [{ id: 'v' }]);
    collections.mutate({ type: 'add', playlistId: 'list', versionId: 'v' }, [{ id: 's' }], [{ id: 'v' }]);
    collections.record({ generationId: 'g', singerId: 's', singer: 'Singer', versionId: 'v', title: 'Title', artist: '', outcome: 'skipped', at: '2026-01-01T00:00:00Z' });
    db.close(); db = undefined;
    db = new DatabaseSync(path);
    collections = new Collections(db);
    assert.equal(collections.snapshot().playlists.find(p => p.id === 'list')?.singerId, 's');
    assert.deepEqual(collections.snapshot().items, [{ playlistId: 'list', versionId: 'v' }]);
    assert.equal(collections.snapshot().history[0].outcome, 'skipped');
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('history shares show transaction and records a generation only once', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const collections = new Collections(db);
    const entry = { generationId: 'g1', singerId: 's1', singer: 'A', versionId: 'v1', title: 'Song', artist: 'Artist', outcome: 'completed' as const, at: '2026-01-01T00:00:00Z' };
    db.exec('BEGIN'); collections.record(entry); db.exec('ROLLBACK');
    assert.equal(collections.snapshot().history.length, 0);
    db.exec('BEGIN'); collections.record(entry); db.exec('COMMIT');
    collections.record(entry);
    assert.deepEqual(collections.snapshot().history, [entry]);
    assert.throws(() => collections.record({ ...entry, generationId: '' }));
    assert.equal(collections.snapshot().history.length, 1);
  } finally { db.close(); }
});

test('an unassigned performance records blank singer text and a nullable identity', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const collections = new Collections(db);
    const entry = { generationId: 'unassigned', singerId: null, singer: '', versionId: 'v', title: 'Song', artist: 'Artist', outcome: 'completed' as const, at: '2026-11-15T00:00:00Z' };
    collections.record(entry); assert.deepEqual(collections.snapshot().history, [entry]);
    assert.throws(() => collections.record({ ...entry, generationId: 'bad', singerId: undefined } as unknown as typeof entry));
    assert.throws(() => collections.record({ ...entry, generationId: 'bad', singer: 'Invented Person' }));
  } finally { db.close(); }
});

