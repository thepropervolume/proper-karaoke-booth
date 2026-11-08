import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { RemoteRelayScope } from '../../src/main/remote-relay-scope';
import { RemoteQueue } from '../../src/main/remote-queue';
import { Store } from '../../src/main/store';

const secret = () => randomBytes(32).toString('base64url');
function fixture() {
  const store = new Store<ShowState>(':memory:');
  let state = createInitialState('show-00001', 'epoch-0001');
  state.versions.push({ id: 'version-clean', title: 'Song', artist: 'Artist', rating: 'clean' });
  store.save(state);
  const queue = store.openRemoteQueue(() => DEFAULT_SETTINGS, value => { state = value; });
  return { store, queue, state: () => state };
}

test('relay and LAN credentials are isolated while sharing one show authority', () => {
  const f = fixture();
  try {
    const lanInvite = f.queue.createInvitation(60000), lanResume = secret();
    const lan = f.queue.join(lanInvite, 'lan-join-0001', lanResume, 'Lan Singer', 0);
    const relay = new RemoteRelayScope(f.queue), invite = relay.createInvitation(60000), relayResume = secret();
    assert.throws(() => relay.authority.admissionInfo(lanInvite));
    assert.throws(() => f.queue.admissionInfo(invite));
    const guest = relay.authority.join(invite, 'relay-join-0001', relayResume, 'Relay Singer', f.state().revision);
    assert.throws(() => f.queue.snapshot(guest.session));
    assert.throws(() => relay.authority.snapshot(lan.session));
    assert.throws(() => f.queue.resume(relayResume));
    assert.throws(() => relay.authority.resume(lanResume));
    assert.deepEqual(f.queue.listGuests().map(x => x.name), ['Lan Singer']);
    assert.deepEqual(relay.guests().map(x => x.name), ['Relay Singer']);
    const snap = relay.authority.snapshot(guest.session);
    const command = { commandId: 'relay-command-1', showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-clean' };
    const result = relay.authority.submit(guest.session, command);
    assert.equal(result.ok, true);
    assert.deepEqual(relay.authority.submit(guest.session, command), result);
    assert.deepEqual(relay.authority.outcome(guest.session, command.commandId), result);
    assert.throws(() => f.queue.outcome(guest.session, command.commandId));
    assert.throws(() => relay.authority.outcome(lan.session, command.commandId));
    assert.equal(f.queue.outcome(lan.session, command.commandId), null);
    const lanSnap = f.queue.snapshot(lan.session);
    assert.equal(f.queue.submit(lan.session, { ...command, hostEpoch: lanSnap.hostEpoch, expectedRevision: lanSnap.revision }).ok, true);
    assert.equal(f.state().requests[0].singerId, guest.singerId);
    f.queue.createInvitation(60000); // replacing the LAN invite cannot invalidate the relay invite
    assert.equal(relay.authority.admissionInfo(invite).showId, snap.showId);
    relay.close();
    assert.throws(() => relay.authority.snapshot(guest.session));
    assert.equal(f.queue.snapshot(lan.session).singerName, 'Lan Singer');
    assert.equal(f.queue.resume(lanResume).singerId, lan.singerId);
  } finally { f.store.close(); }
});

test('a database predating scope tables upgrades legacy LAN invitations and resume credentials', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE remote_invitations (token_hash TEXT PRIMARY KEY, show_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE remote_guests (id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, show_id TEXT NOT NULL, resume_hash TEXT NOT NULL UNIQUE, resume_expires INTEGER NOT NULL, join_id TEXT NOT NULL UNIQUE, join_name TEXT NOT NULL, join_revision INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE remote_sessions (token_hash TEXT PRIMARY KEY, guest_id TEXT NOT NULL, run_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);`);
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const state = createInitialState('show-00001', 'epoch-0001'); state.singers.push({ id: 'singer-0001', name: 'Legacy' });
    db.prepare('INSERT INTO show_state (id, value) VALUES (1, ?)').run(JSON.stringify(state));
    const invite = secret(), resume = secret(), expires = Date.now() + 60000;
    db.prepare('INSERT INTO remote_invitations (token_hash, show_id, expires) VALUES (?, ?, ?)').run(hash(invite), state.showId, expires);
    db.prepare('INSERT INTO remote_guests (id, singer_id, show_id, resume_hash, resume_expires, join_id, join_name, join_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('guest-00001', 'singer-0001', state.showId, hash(resume), expires, 'join-00001', 'Legacy', 0);
    const queue = new RemoteQueue(db, () => DEFAULT_SETTINGS, () => {}), relay = new RemoteRelayScope(queue);
    assert.equal(queue.admissionInfo(invite).showId, state.showId);
    const resumed = queue.resume(resume);
    assert.equal(queue.snapshot(resumed.session).singerName, 'Legacy');
    assert.throws(() => relay.authority.admissionInfo(invite));
    assert.throws(() => relay.authority.resume(resume));
    assert.throws(() => relay.authority.snapshot(resumed.session));
  } finally { db.close(); }
});

test('after failed revocation and process restart old relay credentials cannot enter a new scope or LAN', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-relay-restart-')), file = join(dir, 'show.sqlite');
  let store = new Store<ShowState>(file);
  try {
    let state = createInitialState('show-00001', 'epoch-0001'); store.save(state);
    let queue = store.openRemoteQueue(() => DEFAULT_SETTINGS, value => { state = value; });
    const lanInvite = queue.createInvitation(60000), lanResume = secret();
    queue.join(lanInvite, 'lan-join-0001', lanResume, 'Lan', 0);
    const relay = new RemoteRelayScope(queue), oldInvite = relay.createInvitation(60000), relayResume = secret();
    relay.authority.join(oldInvite, 'relay-join-0001', relayResume, 'Relay', state.revision);
    queue.closeRoom = () => { throw new Error('simulated revocation fault'); };
    assert.throws(() => relay.close());
    store.close(); store = new Store<ShowState>(file);
    state = store.load()!; state.hostEpoch = 'epoch-0002'; store.save(state);
    queue = store.openRemoteQueue(() => DEFAULT_SETTINGS, value => { state = value; });
    const newRelay = new RemoteRelayScope(queue);
    const inspect = new DatabaseSync(file, { readOnly: true });
    try {
      const stale = inspect.prepare('SELECT revoked FROM remote_guests WHERE id IN (SELECT guest_id FROM remote_guest_scopes)').get() as { revoked: number };
      assert.equal(stale.revoked, 1, 'stale relay credentials should be durably revoked on startup');
    } finally { inspect.close(); }
    assert.throws(() => queue.admissionInfo(oldInvite)); assert.throws(() => queue.resume(relayResume));
    assert.throws(() => newRelay.authority.admissionInfo(oldInvite)); assert.throws(() => newRelay.authority.resume(relayResume));
    assert.equal(queue.snapshot(queue.resume(lanResume).session).singerName, 'Lan');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('closing LAN leaves relay credentials intact and vice versa', () => {
  const f = fixture();
  try {
    const lanInvite = f.queue.createInvitation(60000), lan = f.queue.join(lanInvite, 'lan-join-0001', secret(), 'Lan', 0);
    const relay = new RemoteRelayScope(f.queue), invite = relay.createInvitation(60000), resume = secret();
    const guest = relay.authority.join(invite, 'relay-join-0001', resume, 'Relay', f.state().revision);
    f.queue.closeRoom();
    assert.throws(() => f.queue.snapshot(lan.session));
    assert.equal(relay.authority.snapshot(guest.session).singerName, 'Relay');
    assert.equal(relay.authority.resume(resume).singerId, guest.singerId);
    assert.equal(relay.authority.admissionInfo(invite).showId, f.state().showId);
    relay.close();
  } finally { f.store.close(); }
});

test('new relay scopes in the same process do not revoke each other', () => {
  const f = fixture();
  try {
    const first = new RemoteRelayScope(f.queue), firstInvite = first.createInvitation(60000);
    const a = first.authority.join(firstInvite, 'relay-join-0001', secret(), 'One', 0);
    const second = new RemoteRelayScope(f.queue), secondInvite = second.createInvitation(60000);
    const b = second.authority.join(secondInvite, 'relay-join-0002', secret(), 'Two', f.state().revision);
    assert.equal(first.authority.snapshot(a.session).singerName, 'One');
    first.close();
    assert.equal(second.authority.snapshot(b.session).singerName, 'Two');
    second.close();
  } finally { f.store.close(); }
});

test('failed stale-scope cleanup rolls back and the next scope retries before opening', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    let state = createInitialState('show-00001', 'epoch-0001');
    db.prepare('INSERT INTO show_state (id, value) VALUES (1, ?)').run(JSON.stringify(state));
    const prior = new RemoteQueue(db, () => DEFAULT_SETTINGS, value => { state = value; });
    const old = new RemoteRelayScope(prior), invite = old.createInvitation(60000);
    old.authority.join(invite, 'relay-join-0001', secret(), 'Old Relay', 0);
    const restarted = new RemoteQueue(db, () => DEFAULT_SETTINGS, value => { state = value; });
    db.exec("CREATE TRIGGER deny_relay_cleanup BEFORE UPDATE ON remote_guests BEGIN SELECT RAISE(ABORT, 'fault'); END");
    assert.throws(() => new RemoteRelayScope(restarted));
    assert.equal((db.prepare('SELECT revoked FROM remote_invitations').get() as { revoked: number }).revoked, 0);
    assert.equal((db.prepare('SELECT revoked FROM remote_guests').get() as { revoked: number }).revoked, 0);
    db.exec('DROP TRIGGER deny_relay_cleanup');
    const fresh = new RemoteRelayScope(restarted);
    assert.equal((db.prepare('SELECT revoked FROM remote_invitations').get() as { revoked: number }).revoked, 1);
    assert.equal((db.prepare('SELECT revoked FROM remote_guests').get() as { revoked: number }).revoked, 1);
    assert.throws(() => fresh.authority.admissionInfo(invite));
    fresh.close();
  } finally { db.close(); }
});

test('a failed relay revocation blocks access immediately and can be retried without revoking LAN', () => {
  const f = fixture();
  try {
    const invite = f.queue.createInvitation(60000), lan = f.queue.join(invite, 'lan-join-0001', secret(), 'Lan', 0);
    const relay = new RemoteRelayScope(f.queue), relayInvite = relay.createInvitation(60000);
    const guest = relay.authority.join(relayInvite, 'relay-join-0001', secret(), 'Relay', f.state().revision);
    const original = f.queue.closeRoom.bind(f.queue); let attempts = 0;
    f.queue.closeRoom = scope => { if (++attempts === 1) throw new Error('simulated failure'); original(scope); };
    assert.throws(() => relay.close());
    assert.throws(() => relay.authority.snapshot(guest.session));
    assert.equal(f.queue.snapshot(lan.session).singerName, 'Lan');
    relay.close(); assert.equal(attempts, 2);
    assert.equal(f.queue.snapshot(lan.session).singerName, 'Lan');
  } finally { f.store.close(); }
});

test('relay credentials can still be durably revoked after the global guest shutdown gate', () => {
  const f = fixture();
  try {
    const relay = new RemoteRelayScope(f.queue), invite = relay.createInvitation(60000);
    const guest = relay.authority.join(invite, 'relay-join-0001', secret(), 'Relay', 0);
    f.store.disableRemoteQueue();
    assert.throws(() => relay.authority.snapshot(guest.session), /shutting down/);
    assert.doesNotThrow(() => relay.close());
  } finally { f.store.close(); }
});
