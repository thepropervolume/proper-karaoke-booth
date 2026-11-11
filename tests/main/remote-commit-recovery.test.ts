import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { Store } from '../../src/main/store';
import { RemoteQueue } from '../../src/main/remote-queue';
import { migrateShowSchema } from '../../src/main/schema-migrations';

const secret = () => randomBytes(32).toString('base64url');
const database = (store: Store<ShowState>) => (store as unknown as { db: DatabaseSync }).db;

test('an uncertain guest commit locks host and guest writes until restart without losing the request receipt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-remote-commit-'));
  const path = join(directory, 'show.sqlite');
  let store = new Store<ShowState>(path);
  try {
    let state = createInitialState('show-00001', 'epoch-0001');
    state.versions.push({ id: 'version-clean', title: 'Song', artist: 'Artist', rating: 'clean' });
    store.save(state);
    let notified = 0;
    const remote = store.openRemoteQueue(() => DEFAULT_SETTINGS, next => { state = next; }, Date.now, () => { notified++; });
    const invitation = remote.createInvitation(10_000), resume = secret();
    const guest = remote.join(invitation, 'join-id-0001', resume, 'Alice', state.revision);
    const snapshot = remote.snapshot(guest.session);
    const input = { commandId: 'command-0001', showId: snapshot.showId, hostEpoch: snapshot.hostEpoch,
      expectedRevision: snapshot.revision, versionId: 'version-clean' };
    const db = database(store), original = db.exec.bind(db); let injected = false;
    db.exec = (sql: string) => {
      if (sql === 'COMMIT' && !injected) { injected = true; original(sql); throw new Error('injected post-commit failure'); }
      return original(sql);
    };
    assert.throws(() => remote.submit(guest.session, input), /needs recovery/i);
    assert.equal(notified, 1);
    assert.equal(state.requests.length, 0, 'host state was not installed after the uncertain commit');
    assert.equal(store.load()!.requests.length, 1, 'the guest request really committed');
    assert.throws(() => store.save(state), /needs recovery/i, 'stale host state must not overwrite the committed request');
    assert.throws(() => remote.outcome(guest.session, input.commandId), /needs recovery/i);
    store.close(); store = new Store<ShowState>(path);
    assert.equal(store.load()!.requests.length, 1);
    const restored = store.openRemoteQueue(() => DEFAULT_SETTINGS, next => { state = next; });
    const resumed = restored.resume(resume);
    assert.equal(restored.outcome(resumed.session, input.commandId)?.ok, true, 'durable receipt agrees with the recovered request');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a guest commit failure with a successful rollback can be safely retried', () => {
  const store = new Store<ShowState>(':memory:');
  try {
    let state = createInitialState('show-00001', 'epoch-0001');
    state.versions.push({ id: 'version-clean', title: 'Song', artist: 'Artist', rating: 'clean' });
    store.save(state);
    let notified = 0;
    const remote = store.openRemoteQueue(() => DEFAULT_SETTINGS, next => { state = next; }, Date.now, () => { notified++; });
    const invite = remote.createInvitation(10_000), guest = remote.join(invite, 'join-id-0001', secret(), 'Alice', 0);
    const snapshot = remote.snapshot(guest.session);
    const input = { commandId: 'command-0001', showId: snapshot.showId, hostEpoch: snapshot.hostEpoch,
      expectedRevision: snapshot.revision, versionId: 'version-clean' };
    const db = database(store), original = db.exec.bind(db); let injected = false;
    db.exec = (sql: string) => {
      if (sql === 'COMMIT' && !injected) { injected = true; throw new Error('injected pre-commit failure'); }
      return original(sql);
    };
    assert.throws(() => remote.submit(guest.session, input), /injected pre-commit failure/);
    assert.equal(notified, 0);
    assert.equal(store.load()!.requests.length, 0);
    assert.equal(remote.submit(guest.session, input).ok, true);
    assert.equal(store.load()!.requests.length, 1);
  } finally { store.close(); }
});

test('a standalone remote authority also fails closed when its transaction outcome is unknown', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(createInitialState('show-00001', 'epoch-0001')));
    const remote = new RemoteQueue(db, () => DEFAULT_SETTINGS, () => {});
    const invite = remote.createInvitation(10_000), original = db.exec.bind(db); let injected = false;
    db.exec = (sql: string) => {
      if (sql === 'COMMIT' && !injected) { injected = true; original(sql); throw new Error('injected post-commit failure'); }
      return original(sql);
    };
    assert.throws(() => remote.join(invite, 'join-id-0001', secret(), 'Alice', 0), /needs recovery/i);
    assert.throws(() => remote.admissionInfo(invite), /needs recovery/i);
    assert.throws(() => remote.createInvitation(10_000), /needs recovery/i);
  } finally { db.close(); }
});
