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

