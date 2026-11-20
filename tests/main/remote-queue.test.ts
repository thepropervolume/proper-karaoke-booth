import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { JoinRevisionConflict, RemoteQueue } from '../../src/main/remote-queue';

const secret = () => randomBytes(32).toString('base64url');
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const state = createInitialState('show-00001', 'epoch-0001');
  state.versions.push({ id: 'version-clean', title: 'Clean', artist: 'Artist', rating: 'clean' }, { id: 'version-hidden', title: 'Hidden', artist: 'Artist', rating: 'explicit' });
  state.policy.ageRestricted = true;
  db.prepare('INSERT INTO show_state (id, value) VALUES (1, ?)').run(JSON.stringify(state));
  let time = 1000, committed = 0;
  const service = () => new RemoteQueue(db, () => DEFAULT_SETTINGS, () => { committed++; }, () => time);
  const read = () => JSON.parse((db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string }).value) as ShowState;
  return { db, service, read, tick: (ms: number) => { time += ms; }, commits: () => committed };
}

test('admission and resume credentials are scoped, revocable and time limited', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000), resume = secret();
    assert.deepEqual(service.admissionInfo(invite), { showId: 'show-00001', hostEpoch: 'epoch-0001', revision: 0 });
    assert.throws(() => service.admissionInfo(secret()));
    const a = service.join(invite, 'join-id-0001', resume, ' Alice ', 0);
    assert.equal(service.snapshot(a.session).singerId, a.singerId);
    assert.equal(s.read().singers.length, 1);
    const retry = service.join(invite, 'join-id-0001', resume, 'Alice', 0);
    assert.equal(retry.singerId, a.singerId); assert.equal(s.read().singers.length, 1);
    assert.throws(() => service.join(invite, 'join-id-0001', secret(), 'Alice', 0));
    assert.throws(() => service.join(invite, 'join-id-0001', resume, 'Mallory', 0));
    assert.throws(() => service.join(invite, 'join-id-0001', resume, 'Alice', 1));
    assert.throws(() => service.join(secret(), 'join-id-0002', secret(), 'Bob', 1));
    const invitationHashes = s.db.prepare('SELECT token_hash FROM remote_invitations').all() as { token_hash: string }[];
    assert.ok(invitationHashes.every(row => row.token_hash !== invite));
    s.tick(5001); assert.throws(() => service.admissionInfo(invite)); assert.throws(() => service.join(invite, 'join-id-0003', secret(), 'Late', 1));
    service.revokeGuest(a.singerId);
    assert.throws(() => service.snapshot(a.session)); assert.throws(() => service.resume(resume));
  } finally { s.db.close(); }
});

test('host guest enumeration is bounded, show-scoped and releases capacity when revoked', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000);
    const insert = s.db.prepare('INSERT INTO remote_guests (id, singer_id, show_id, resume_hash, resume_expires, join_id, join_name, join_revision, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let n = 0; n < 200; n++) insert.run(`guest-${n}`, `singer-${n}`, 'show-00001', `hash-${n}`, 2000, `join-${n}`, `Guest ${n}`, 0, 0);
    insert.run('foreign-guest', 'singer-0', 'another-show', 'foreign-hash', 2000, 'foreign-join', 'Other show', 0, 0);
    assert.equal(service.listGuests().length, 200);
    assert.ok(service.listGuests().every(item => item.name !== 'Other show'));
    assert.throws(() => service.join(invite, 'join-id-0999', secret(), 'Late guest', 0), /limit/);
    service.revokeGuest('singer-0');
    assert.equal(service.listGuests().length, 199);
    const foreign = s.db.prepare('SELECT revoked FROM remote_guests WHERE id = ?').get('foreign-guest') as { revoked: number };
    assert.equal(foreign.revoked, 0);
    service.join(invite, 'join-id-0999', secret(), 'Late guest', 0);
    assert.equal(service.listGuests().length, 200);
    insert.run('legacy-overflow', 'overflow-guest', 'show-00001', 'overflow-hash', 2000, 'overflow-join', 'Overflow', 0, 0);
    assert.throws(() => service.listGuests(), /recovery/);
  } finally { s.db.close(); }
});

test('guest projections enforce policy and do not expose another singer or private state', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000);
    const a = service.join(invite, 'join-id-0001', secret(), 'Alice', 0);
    const b = service.join(invite, 'join-id-0002', secret(), 'Bob', 1);
    const snap = service.snapshot(a.session);
    assert.deepEqual(snap.catalog, [{ id: 'version-clean', title: 'Clean', artist: 'Artist' }]);
    assert.equal(snap.catalogNextOffset, null);
    assert.throws(() => service.catalog(a.session, 0, 101));
    assert.throws(() => service.catalog(a.session, -1, 10));
    assert.equal(service.catalogItem(a.session, 'version-hidden'), null);
    assert.equal(service.catalogItem(a.session, 'missing-0000'), null);
    assert.equal('receipts' in snap, false); assert.equal('singers' in snap, false); assert.equal('policy' in snap, false);
    const cmd = { commandId: 'command-0001', showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-hidden' };
    const result = service.submit(a.session, cmd);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, 'NOT_AVAILABLE');
    assert.equal(service.outcome(b.session, cmd.commandId), null);
    assert.throws(() => service.submit(a.session, { ...cmd, actor: { role: 'host' } }));
    assert.throws(() => service.submit(a.session, { ...cmd, singerId: b.singerId }));
    assert.throws(() => service.submit(a.session, { ...cmd, type: 'pause' }));
  } finally { s.db.close(); }
});

test('guest snapshot bounds history while retaining an older active request', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000);
    const guest = service.join(invite, 'join-id-0001', secret(), 'Alice', 0);
    const state = s.read();
    state.requests.push({ id: 'old-active', singerId: guest.singerId, versionId: 'version-clean', status: 'accepted', round: 1, order: 1 });
    for (let n = 0; n < 60; n++) state.requests.push({ id: `done-${n}`, singerId: guest.singerId, versionId: 'version-clean', status: 'completed', round: 1, order: n + 2 });
    state.requests.push({ id: 'other-guest', singerId: 'someone-else', versionId: 'version-clean', status: 'completed', round: 1, order: 100 });
    state.requests.push({ id: 'hidden-track', singerId: guest.singerId, versionId: 'version-hidden', status: 'accepted', round: 1, order: 101 });
    s.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    const snapshot = service.snapshot(guest.session);
    assert.equal(snapshot.requests.length, 50);
    assert.equal(snapshot.requestsTruncated, true);
    assert.equal(snapshot.requests[0].id, 'old-active');
    assert.equal(snapshot.requests[1].id, 'done-11');
    assert.equal(snapshot.requests.at(-1)?.id, 'done-59');
    assert.ok(snapshot.requests.every(request => request.id !== 'other-guest' && request.id !== 'hidden-track'));
  } finally { s.db.close(); }
});

test('join revision conflict proves registration rolled back and can be retried with a refreshed revision', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000), resume = secret();
    const state = s.read(); state.revision = 1;
    s.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    assert.throws(() => service.join(invite, 'join-id-0001', resume, 'Alice', 0), JoinRevisionConflict);
    assert.equal(s.read().singers.length, 0);
    assert.equal((s.db.prepare('SELECT COUNT(*) AS count FROM remote_guests').get() as { count: number }).count, 0);
    const admission = service.admissionInfo(invite);
    const guest = service.join(invite, 'join-id-0001', resume, 'Alice', admission.revision);
    assert.equal(service.snapshot(guest.session).singerName, 'Alice');
  } finally { s.db.close(); }
});

test('missing-song requests derive singer identity and replay a durable guest-scoped receipt', () => {
  const s = setup();
  try {
    let service = s.service();
    const invite = service.createInvitation(5000), resume = secret();
    const alice = service.join(invite, 'join-id-0001', resume, 'Alice', 0);
    const bob = service.join(invite, 'join-id-0002', secret(), 'Bob', 1);
    const input = { commandId: 'missing-0001', title: '  Lost Song  ', artist: '  Artist  ' };
    assert.throws(() => service.submitMissing(alice.session, { ...input, singer: 'Bob' }));
    assert.throws(() => service.submitMissing(alice.session, { ...input, title: ' ' }));
    assert.throws(() => service.submitMissing(alice.session, { ...input, title: 'x'.repeat(201) }));
    assert.throws(() => service.submitMissing(alice.session, { ...input, artist: 'x'.repeat(201) }));
    const first = service.submitMissing(alice.session, input);
    assert.equal(first.ok, true);
    assert.deepEqual(service.submitMissing(alice.session, input), first);
    assert.deepEqual(service.outcome(alice.session, input.commandId), first);
    assert.equal(service.outcome(bob.session, input.commandId), null);
    const conflict = service.submitMissing(alice.session, { ...input, title: 'Another Song' });
    assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.code, 'COMMAND_ID_REUSED');
    const snap = service.snapshot(alice.session);
    const crossed = service.submit(alice.session, { commandId: input.commandId, showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-clean' });
    assert.equal(crossed.ok, false); if (!crossed.ok) assert.equal(crossed.code, 'COMMAND_ID_REUSED');
    const rows = s.db.prepare('SELECT singer, title, artist FROM missing_song_requests').all();
    assert.deepEqual(rows.map(row => ({ ...row })), [{ singer: 'Alice', title: 'Lost Song', artist: 'Artist' }]);
    const owner = s.db.prepare('SELECT singer_id AS singerId, show_id AS showId FROM remote_missing_song_owners').get() as { singerId: string; showId: string };
    assert.equal(owner.singerId, alice.singerId); assert.equal(owner.showId, snap.showId);
    service = s.service();
    const resumed = service.resume(resume);
    assert.deepEqual(service.submitMissing(resumed.session, input), first);
    assert.equal((s.db.prepare('SELECT COUNT(*) AS count FROM missing_song_requests').get() as { count: number }).count, 1);
  } finally { s.db.close(); }
});

test('missing-song entry and receipt roll back together on persistence failure', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000);
    const guest = service.join(invite, 'join-id-0001', secret(), 'Alice', 0);
    const input = { commandId: 'missing-0001', title: 'Song', artist: '' };
    s.db.exec("CREATE TRIGGER deny_missing_receipt BEFORE INSERT ON remote_receipts BEGIN SELECT RAISE(ABORT, 'fault'); END");
    assert.throws(() => service.submitMissing(guest.session, input));
    assert.equal((s.db.prepare('SELECT COUNT(*) AS count FROM missing_song_requests').get() as { count: number }).count, 0);
    assert.equal((s.db.prepare('SELECT COUNT(*) AS count FROM remote_missing_song_owners').get() as { count: number }).count, 0);
    assert.equal(service.outcome(guest.session, input.commandId), null);
    s.db.exec('DROP TRIGGER deny_missing_receipt');
    assert.equal(service.submitMissing(guest.session, input).ok, true);
  } finally { s.db.close(); }
});

test('sessions expire independently and the private resume secret has a bounded lifetime', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000), resume = secret();
    const a = service.join(invite, 'join-id-0001', resume, 'Alice', 0);
    s.tick(8 * 3600000 + 1);
    assert.throws(() => service.snapshot(a.session));
    const renewed = service.resume(resume);
    assert.equal(service.snapshot(renewed.session).singerId, a.singerId);
    s.tick(16 * 3600000);
    assert.throws(() => service.resume(resume));
    assert.throws(() => service.snapshot(renewed.session));
  } finally { s.db.close(); }
});

test('catalog pages are bounded, revision-tagged and consistently policy-filtered', () => {
  const s = setup();
  try {
    const state = s.read();
    for (let i = 0; i < 55; i++) state.versions.push({ id: `version-${String(i).padStart(4, '0')}`, title: `Song ${i}`, artist: 'A', rating: 'clean' });
    s.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    const service = s.service(), invite = service.createInvitation(5000);
    const guest = service.join(invite, 'join-id-0001', secret(), 'Alice', 0);
    const first = service.catalog(guest.session), next = service.catalog(guest.session, first.nextOffset!);
    assert.equal(first.items.length, 50); assert.equal(next.items.length, 6); assert.equal(next.nextOffset, null);
    assert.equal(first.revision, next.revision);
    assert.ok([...first.items, ...next.items].every(item => item.id !== 'version-hidden'));
  } finally { s.db.close(); }
});

test('durable original outcome survives restart, concurrent revisions and replay', () => {
  const s = setup();
  try {
    let service = s.service(); const invite = service.createInvitation(5000), resumeA = secret();
    const a = service.join(invite, 'join-id-0001', resumeA, 'Alice', 0);
    const b = service.join(invite, 'join-id-0002', secret(), 'Bob', 1);
    const state = service.snapshot(a.session);
    const command = { commandId: 'command-0001', showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision, versionId: 'version-clean' };
    const first = service.submit(a.session, command); assert.equal(first.ok, true);
    const stale = service.submit(b.session, { ...command, commandId: 'command-0002' });
    assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.code, 'REVISION_CONFLICT');
    assert.deepEqual(service.submit(a.session, command), first);
    const changed = service.submit(a.session, { ...command, versionId: 'version-hidden' });
    assert.equal(changed.ok, false); if (!changed.ok) assert.equal(changed.code, 'COMMAND_ID_REUSED');
    assert.equal(s.read().requests.length, 1);
    const restarted = s.read(); restarted.hostEpoch = 'epoch-0002';
    s.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(restarted));
    service = s.service(); assert.throws(() => service.snapshot(a.session));
    const resumed = service.resume(resumeA);
    assert.deepEqual(service.outcome(resumed.session, command.commandId), first);
    assert.deepEqual(service.submit(resumed.session, command), first);
    assert.equal(s.read().requests.length, 1);
    service.closeRoom(); assert.throws(() => service.snapshot(resumed.session)); assert.throws(() => service.resume(resumeA));
  } finally { s.db.close(); }
});

test('state and receipt roll back together when persistence fails', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000);
    const a = service.join(invite, 'join-id-0001', secret(), 'Alice', 0);
    const state = service.snapshot(a.session), before = s.commits();
    const command = { commandId: 'command-0001', showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: state.revision, versionId: 'version-clean' };
    s.db.exec("CREATE TRIGGER deny_receipt BEFORE INSERT ON remote_receipts BEGIN SELECT RAISE(ABORT, 'fault'); END");
    assert.throws(() => service.submit(a.session, command));
    assert.equal(s.read().requests.length, 0); assert.equal(service.outcome(a.session, command.commandId), null); assert.equal(s.commits(), before);
    s.db.exec('DROP TRIGGER deny_receipt');
    assert.equal(service.submit(a.session, command).ok, true);
  } finally { s.db.close(); }
});


test('withdrawal is guest-owned, idempotent and includes the prepared queued song', () => {
  const s = setup();
  try {
    const service = s.service(), invite = service.createInvitation(5000);
    const alice = service.join(invite, 'join-id-0001', secret(), 'Alice', 0);
    const bob = service.join(invite, 'join-id-0002', secret(), 'Bob', 1);
    let snapshot = service.snapshot(alice.session);
    assert.equal(service.submit(alice.session, { commandId: 'request-0001', showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, versionId: 'version-clean' }).ok, true);
    snapshot = service.snapshot(alice.session); const requestId = snapshot.requests[0].id;
    const input = { commandId: 'withdraw-0001', showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, requestId };
    assert.throws(() => service.withdraw(alice.session, { ...input, singerId: bob.singerId }));
    const foreign = service.withdraw(bob.session, input);
    assert.equal(foreign.ok, false); assert.equal(s.read().requests[0].status, 'accepted');
    const result = service.withdraw(alice.session, input);
    assert.equal(result.ok, true); assert.deepEqual(service.withdraw(alice.session, input), result);
    assert.deepEqual(service.outcome(alice.session, input.commandId), result);
    assert.equal(s.read().requests[0].status, 'withdrawn');
    const reused = service.withdraw(alice.session, { ...input, requestId: 'different-request' });
    assert.equal(reused.ok, false); if (!reused.ok) assert.equal(reused.code, 'COMMAND_ID_REUSED');
    snapshot = service.snapshot(alice.session);
    assert.equal(service.submit(alice.session, { commandId: 'request-0002', showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, versionId: 'version-clean' }).ok, true);
    const state = s.read(); state.requests[1].status = 'staged'; state.stagedRequestId = state.requests[1].id;
    s.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    const stagedInput = { ...input, commandId: 'withdraw-0002', expectedRevision: state.revision, requestId: state.requests[1].id };
    const accepted = service.withdraw(alice.session, stagedInput);
    assert.equal(accepted.ok, true); assert.equal(s.read().stagedRequestId, null); assert.equal(s.read().requests[1].status, 'withdrawn');
    assert.deepEqual(service.withdraw(alice.session, stagedInput), accepted);
  } finally { s.db.close(); }
});


test('withdrawal accepts maximum-length generated and host request IDs while enforcing ownership and bounds', () => {
  const s = setup();
  try {
    const service = s.service(), invitation = service.createInvitation(5000);
    const alice = service.join(invitation, 'join-id-0001', secret(), 'Alice', 0);
    const bob = service.join(invitation, 'join-id-0002', secret(), 'Bob', 1);
    let snap = service.snapshot(alice.session);
    assert.equal(service.submit(alice.session, { commandId: 'x'.repeat(128), showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-clean' }).ok, true);
    snap = service.snapshot(alice.session);
    const id = snap.requests[0].id;
    assert.equal(id.length, 172);
    const input = { commandId: 'withdraw-max-01', showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, requestId: id };
    assert.equal(service.withdraw(bob.session, input).ok, false);
    assert.equal(service.withdraw(alice.session, input).ok, true);
    const state = s.read();
    state.requests.push({ id: 'a'.repeat(500), singerId: alice.singerId, versionId: 'version-clean', status: 'pending', round: null, order: null });
    s.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    const hostRequest = { ...input, commandId: 'withdraw-max-02', expectedRevision: state.revision, requestId: 'a'.repeat(500) };
    assert.throws(() => service.withdraw(alice.session, { ...hostRequest, requestId: 'a'.repeat(501) }));
    assert.throws(() => service.withdraw(alice.session, { ...hostRequest, requestId: '   ' }));
    assert.equal(service.withdraw(alice.session, hostRequest).ok, true);
  } finally { s.db.close(); }
});


test('a remote singer can put their prepared queued turn on hold', () => {
  const s = setup();
  try {
    const service = s.service(), invitation = service.createInvitation(5000);
    const alice = service.join(invitation, 'join-id-0001', secret(), 'Alice', 0);
    let snap = service.snapshot(alice.session);
    assert.equal(service.submit(alice.session, { commandId: 'request-0001', showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, versionId: 'version-clean' }).ok, true);
    const state = s.read(); state.requests[0].status = 'staged'; state.stagedRequestId = state.requests[0].id;
    s.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    snap = service.snapshot(alice.session);
    assert.equal(service.setAvailability(alice.session, { commandId: 'away-0001', showId: snap.showId, hostEpoch: snap.hostEpoch, expectedRevision: snap.revision, minutes: 5 }).ok, true);
    assert.equal(s.read().stagedRequestId, null); assert.equal(s.read().requests[0].status, 'accepted');
    assert.equal(s.read().playback, null);
  } finally { s.db.close(); }
});

test('availability is self-owned, minute-bounded, receipt-recoverable and does not extend on retry', () => {
  const s = setup();
  try {
    const service = s.service(), invitation = service.createInvitation(60000);
    const a = service.join(invitation, 'join-away-a', secret(), 'Alice', 0);
    const b = service.join(invitation, 'join-away-b', secret(), 'Bob', s.read().revision);
    const snapshot = service.snapshot(a.session);
    const command = { commandId: 'away-command-1', showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, minutes: 5 };
    for (const minutes of [-1, 0.5, 61]) assert.throws(() => service.setAvailability(a.session, { ...command, minutes }));
    assert.throws(() => service.setAvailability(a.session, { ...command, singerId: b.singerId }));
    const outcome = service.setAvailability(a.session, command); assert.equal(outcome.ok, true);
    assert.equal(s.read().singers.find(singer => singer.id === a.singerId)?.unavailableUntilMs, 301000);
    assert.equal(s.read().singers.find(singer => singer.id === b.singerId)?.unavailableUntilMs, undefined);
    s.tick(10000); assert.deepEqual(service.setAvailability(a.session, command), outcome);
    assert.equal(service.snapshot(a.session).unavailableUntilMs, 301000, 'replaying does not extend the deadline');
    assert.deepEqual(service.outcome(a.session, command.commandId), outcome);
    const reused = service.setAvailability(a.session, { ...command, minutes: 6 }); assert.equal(reused.ok, false);
    assert.equal(service.outcome(b.session, command.commandId), null);
    const current = service.snapshot(a.session);
    assert.equal(service.setAvailability(a.session, { ...command, commandId: 'away-return-1', expectedRevision: current.revision, minutes: 0 }).ok, true);
    assert.equal(service.snapshot(a.session).unavailableUntilMs, 0);
  } finally { s.db.close(); }
});

test('availability state and receipt roll back together when persistence fails', () => {
  const s = setup();
  try {
    const service = s.service(), invitation = service.createInvitation(60000);
    const a = service.join(invitation, 'join-away-a', secret(), 'Alice', 0);
    const snapshot = service.snapshot(a.session);
    const command = { commandId: 'away-command-1', showId: snapshot.showId, hostEpoch: snapshot.hostEpoch, expectedRevision: snapshot.revision, minutes: 1 };
    s.db.exec("CREATE TRIGGER fail_away BEFORE INSERT ON remote_receipts BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
    assert.throws(() => service.setAvailability(a.session, command));
    assert.equal(service.snapshot(a.session).unavailableUntilMs, 0);
    assert.equal(service.outcome(a.session, command.commandId), null);
    s.db.exec('DROP TRIGGER fail_away');
    assert.equal(service.setAvailability(a.session, command).ok, true);
  } finally { s.db.close(); }
});
