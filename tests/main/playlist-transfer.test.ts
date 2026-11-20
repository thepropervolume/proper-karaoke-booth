import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  MAX_PLAYLIST_FILE_BYTES, matchPlaylist, parsePlaylistFile, type PlaylistCandidate, type PlaylistFile,
} from '../../src/domain/playlist-transfer';
import { PlaylistTransfer, readPlaylistFile } from '../../src/main/playlist-transfer';
import { Store } from '../../src/main/store';

const key = `sha256:${'a'.repeat(64)}` as const;
const video = 'youtube:Test1234aBc';
const portable: PlaylistFile = { format: 'tpv-playlist', version: 1, name: 'Favorites', songs: [
  { title: 'A local song', artist: 'Beyoncé', recording: key },
  { title: 'A provider song', artist: 'Artist', recording: video },
] };

test('validates the versioned playlist and uses only exact stored recording identity', () => {
  assert.deepEqual(parsePlaylistFile(portable), portable);
  assert.equal(parsePlaylistFile({ ...portable, version: 2 }), null);
  assert.equal(parsePlaylistFile({ ...portable, songs: [{ ...portable.songs[0], path: 'private' }] }), null);
  assert.equal(parsePlaylistFile({ ...portable, songs: [{ ...portable.songs[0], recording: 'file:///private' }] }), null);
  assert.equal(parsePlaylistFile({ ...portable, songs: Array.from({ length: 1001 }, () => portable.songs[0]) }), null);
  const candidates: PlaylistCandidate[] = [
    { versionId: 'local', recording: key, allowed: true },
    { versionId: 'provider', recording: video, allowed: false },
  ];
  const songs = [...portable.songs, { ...portable.songs[0], recording: null }, { ...portable.songs[0], title: 'Renamed entry' }];
  assert.deepEqual(matchPlaylist(songs, candidates), [
    { status: 'matched', versionId: 'local' }, { status: 'unavailable', versionId: null },
    { status: 'unidentified', versionId: null }, { status: 'duplicate', versionId: null },
  ]);
  assert.deepEqual(matchPlaylist(songs.slice(0, 1), [...candidates, { ...candidates[0], versionId: 'another', allowed: false }]),
    [{ status: 'ambiguous', versionId: null }]);
});

test('publishes a round-trip export without replacing files and rejects oversized or invalid imports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tpv-playlist-test-'));
  const file = join(root, 'list.tpv.json');
  try {
    const transfer = new PlaylistTransfer({ pickExport: async () => file, pickImport: async () => file,
      snapshot: () => ({ file: portable, omitted: 1 }), candidates: () => [], apply: () => { throw new Error('unexpected'); } });
    assert.deepEqual(await transfer.export('list'), { status: 'saved', count: 2, omitted: 1 });
    assert.deepEqual(await readPlaylistFile(file), portable);
    const initial = await readFile(file);
    assert.deepEqual(await transfer.export('list'), { status: 'already-exists' });
    assert.deepEqual(await readFile(file), initial);
    await writeFile(file, Buffer.alloc(MAX_PLAYLIST_FILE_BYTES + 1));
    assert.deepEqual(await transfer.preview(), { status: 'invalid' });
    await writeFile(file, Buffer.from([0xff, 0xfe, 0x61]));
    assert.deepEqual(await transfer.preview(), { status: 'invalid' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preview is read-only and a changed mapping, expired review or replay cannot import a song', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tpv-playlist-review-'));
  const file = join(root, 'list.json');
  try {
    await writeFile(file, JSON.stringify(portable));
    let candidate = 'destination-v1', now = 0;
    const applied: string[][] = [];
    const transfer = new PlaylistTransfer({ pickExport: async () => null, pickImport: async () => file,
      snapshot: () => null, candidates: () => [{ versionId: candidate, recording: key, allowed: true }],
      now: () => now, apply: (_destination, versionIds) => { applied.push(versionIds); return { playlistId: 'list', added: versionIds.length }; } });
    const first = await transfer.preview();
    assert.equal(first.status, 'ready');
    assert.deepEqual(first.songs.map(song => song.status), ['matched', 'unavailable']);
    assert.equal(JSON.stringify(first).includes('destination-v1'), false);
    assert.equal(JSON.stringify(first).includes(key), false);
    assert.deepEqual(applied, []);
    candidate = 'destination-v2';
    assert.deepEqual(transfer.apply(first.token, { kind: 'kj' }), { status: 'stale' });
    const second = await transfer.preview();
    assert.equal(second.status, 'ready');
    now = 601_000;
    assert.deepEqual(transfer.apply(second.token, { kind: 'kj' }), { status: 'stale' });
    assert.deepEqual(applied, []);
    const third = await transfer.preview();
    assert.equal(third.status, 'ready');
    assert.deepEqual(transfer.apply(third.token, { kind: 'kj' }), { status: 'imported', playlistId: 'list', added: 1, skipped: 1 });
    assert.deepEqual(transfer.apply(third.token, { kind: 'kj' }), { status: 'stale' });
    assert.deepEqual(applied, [['destination-v2']]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('playlist apply rolls the whole write back and preserves existing KJ picks on storage failure', () => {
  const db = new DatabaseSync(':memory:');
  const store = new Store(db);
  try {
    const singers = [{ id: 'singer' }], songs = [{ id: 'existing' }, { id: 'new' }, { id: 'fail' }];
    store.collections.mutate({ type: 'add', playlistId: 'kj-picks', versionId: 'existing' }, singers, songs);
    db.exec("CREATE TRIGGER simulated_failure BEFORE INSERT ON playlist_items WHEN NEW.version_id = 'fail' BEGIN SELECT RAISE(ABORT, 'fake error'); END");
    const before = store.collections.snapshot();
    assert.throws(() => store.importPlaylist({ kind: 'singer', singerId: 'singer', name: 'New list' }, ['new', 'fail'], singers, songs), /fake error/);
    assert.throws(() => store.importPlaylist({ kind: 'kj' }, ['new', 'fail'], singers, songs), /fake error/);
    assert.deepEqual(store.collections.snapshot(), before);
    assert.deepEqual(store.importPlaylist({ kind: 'kj' }, ['existing', 'new'], singers, songs), { playlistId: 'kj-picks', added: 1 });
    const imported = store.importPlaylist({ kind: 'singer', singerId: 'singer', name: 'New list' }, ['new', 'existing'], singers, songs);
    assert.equal(imported.added, 2);
    assert.deepEqual(store.collections.playlistForTransfer(imported.playlistId), { name: 'New list', versionIds: ['new', 'existing'] });
  } finally { store.close(); }
});
