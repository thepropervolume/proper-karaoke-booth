import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { RemoteQueue } from '../../src/main/remote-queue';

const secret = () => randomBytes(32).toString('base64url');
test('photo submission is session-bound, replay-safe, and never persists the image in receipts', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const show = createInitialState('show-00001', 'epoch-0001');
  db.prepare('INSERT INTO show_state (id, value) VALUES (1, ?)').run(JSON.stringify(show));
  let deliveries = 0;
  const queue = new RemoteQueue(db, () => DEFAULT_SETTINGS, () => {}, () => 1000, () => {}, () => {}, undefined,
    async (singerId, _eventId, _showId, _hostEpoch, revision, _image, authorized) => {
      assert.equal(authorized(), true);
      assert.ok(singerId);
      deliveries++;
      return { ok: true, revision };
    });
  try {
    const invitation = queue.createInvitation(5000);
    const guest = queue.join(invitation, 'join-id-0001', secret(), 'Alice', 0);
    const snapshot = queue.snapshot(guest.session);
    assert.equal(snapshot.photoEnabled, true);
    const command = { commandId: 'photo-00001', showId: show.showId, hostEpoch: show.hostEpoch,
      expectedRevision: snapshot.revision, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' };
    assert.equal((await queue.submitPhoto(guest.session, command)).ok, true);
    assert.equal((await queue.submitPhoto(guest.session, command)).ok, true);
    assert.equal(deliveries, 1);
    const changed = await queue.submitPhoto(guest.session, { ...command, dataUrl: 'data:image/jpeg;base64,/9j/3w==' });
    assert.equal(changed.ok, false);
    assert.equal((changed as { code: string }).code, 'COMMAND_ID_REUSED');
    const receipts = JSON.stringify(db.prepare('SELECT * FROM remote_receipts').all());
    assert.ok(!receipts.includes(command.dataUrl));
    assert.ok(!JSON.stringify(db.prepare('SELECT value FROM show_state').all()).includes(command.dataUrl));
    queue.revokeGuest(guest.singerId);
    await assert.rejects(queue.submitPhoto(guest.session, { ...command, commandId: 'photo-00002' }));
  } finally { db.close(); }
});
