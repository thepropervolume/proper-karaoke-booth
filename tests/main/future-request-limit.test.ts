import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { RemoteQueue } from '../../src/main/remote-queue';

test('the remote singer sees the configured limit, can retry safely, and unlimited applies to new requests', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const state = createInitialState('show-00001', 'epoch-0001');
    state.versions.push({ id: 'version-0001', title: 'Song', artist: 'Artist', rating: 'clean' });
    db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    let limit = 1;
    const queue = new RemoteQueue(db, () => ({ ...DEFAULT_SETTINGS, maxFutureRequestsPerSinger: limit }), () => {}, () => 1_000);
    const invite = queue.createInvitation(10_000), resume = randomBytes(32).toString('base64url');
    const guest = queue.join(invite, 'join-id-0001', resume, 'Alice', 0);
    const command = (id: string) => ({ commandId: id, showId: state.showId, hostEpoch: state.hostEpoch,
      expectedRevision: queue.snapshot(guest.session).revision, versionId: 'version-0001' });
    assert.equal(queue.submit(guest.session, command('command-0001')).ok, true);
    const rejectedCommand = command('command-0002'), rejected = queue.submit(guest.session, rejectedCommand);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) { assert.equal(rejected.code, 'LIMIT'); assert.match(rejected.message, /1 upcoming request/); }
    assert.equal(queue.snapshot(guest.session).requests.length, 1);
    limit = 0;
    assert.deepEqual(queue.submit(guest.session, rejectedCommand), rejected);
    assert.equal(queue.submit(guest.session, command('command-0003')).ok, true);
    limit = 1;
    assert.equal(queue.snapshot(guest.session).requests.length, 2);
    assert.equal(queue.submit(guest.session, command('command-0004')).ok, false);
  } finally { db.close(); }
});
