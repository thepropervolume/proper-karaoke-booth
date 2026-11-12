import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RELAY_OPERATIONS, RESERVED_SLUGS, isRelaySecret, isRelaySlug, isRelayUuid,
  parseGuestRequest, parseHostOpen, parseHostReplyEnvelope, parseRoomIdentity, projectGuestResponse,
} from '../../src/relay/protocol';

const roomId = 'e3b0c442-98fc-4c14-9afb-f4c8996fb924';
const generation = '27ae41e4-649b-434c-b934-ca495991b785';
const requestId = '142bc9d6-36ee-45c1-a932-8eb11fd7619d';
const secret = 's'.repeat(43);
const identity = { roomId, generation };
const command = { commandId: 'command-0001', showId: 'show-00001', hostEpoch: 'epoch-0001', expectedRevision: 3 };
const song = { id: 'version-001', title: 'Amateur', artist: 'Nada Surf' };
const snapshot = { showId: command.showId, hostEpoch: command.hostEpoch, revision: 3, singerId: 'singer-0001', singerName: 'Singer',
  catalog: [song], catalogNextOffset: null, requests: [{ id: 'request-001', versionId: song.id, status: 'accepted' }],
  unavailableUntilMs: 0, serverNowMs: 1_794_437_000_000, requestsTruncated: false };

test('slug, UUID and bearer validation bound canonical public and private identities', () => {
  for (const value of ['abc', 'tpv-karaoke', 'a--b', 'a'.repeat(48)]) assert.equal(isRelaySlug(value), true);
  for (const value of [...RESERVED_SLUGS, '', 'ab', 'a'.repeat(49), '-room', 'room-', 'Aroom', 'a/b', 'a%2fb', 'a\nb']) assert.equal(isRelaySlug(value), false);
  assert.equal(isRelayUuid(roomId), true);
  for (const value of ['room-0001', '00000000-0000-0000-0000-000000000000', roomId + '/']) assert.equal(isRelayUuid(value), false);
  assert.equal(isRelaySecret(secret), true);
  for (const value of [secret.slice(1), secret + 'x', secret.slice(1) + '+', secret.slice(1) + '=', secret + '\n', null]) assert.equal(isRelaySecret(value), false);
});

test('host open and room identity parsers reject extra authority fields', () => {
  assert.deepEqual(parseHostOpen({ slug: 'proper-volume', openId: requestId }), { slug: 'proper-volume', openId: requestId });
  assert.deepEqual(parseRoomIdentity(identity), identity);
  for (const input of [{ slug: 'proper-volume', openId: requestId, owner: 'other' }, { slug: 'admin', openId: requestId }, { slug: 'proper-volume', openId: 'no-uuid' }, null]) assert.equal(parseHostOpen(input), null);
  assert.equal(parseRoomIdentity({ ...identity, token: secret }), null);
  assert.equal(parseRoomIdentity({ ...identity, generation: 'old' }), null);
});

test('guest DTOs expose only the existing scoped guest operations and exact payloads', () => {
  const cases = [
    ['admission', {}, undefined],
    ['join', { joinId: 'join-00001', resumeSecret: secret, name: 'Guest', expectedRevision: 0 }, undefined],
    ['resume', { resumeSecret: secret }, undefined],
    ['snapshot', {}, secret],
    ['catalog', { offset: 0, limit: 100 }, secret],
    ['outcome', { commandId: command.commandId }, secret],
    ['request', { command: { ...command, versionId: song.id } }, secret],
    ['withdraw', { command: { ...command, requestId: 'request-001' } }, secret],
    ['availability', { command: { ...command, minutes: 60 } }, secret],
    ['missing-request', { command: { commandId: command.commandId, title: 'Song', artist: '' } }, secret],
  ] as const;
  assert.equal(cases.length, RELAY_OPERATIONS.length);
  for (const [operation, payload, session] of cases) {
    assert.deepEqual(parseGuestRequest(operation, payload, session), { operation, payload, ...(session ? { session } : {}) });
    assert.equal(parseGuestRequest(operation, { ...payload, actor: { role: 'host' } }, session), null);
    assert.equal(parseGuestRequest(operation, payload, session ? 'bad-token' : secret), null);
  }
  for (const operation of ['host', 'play', 'stop', 'readFile', '/api/v1/request', '__proto__']) assert.equal(parseGuestRequest(operation, {}, secret), null);
  assert.equal(parseGuestRequest('join', { joinId: 'join-00001', resumeSecret: secret, name: 'Guest', expectedRevision: 0, invitation: secret }), null);
});

test('guest commands reject hidden host fields, invalid counters and unsafe bounds', () => {
  const request = { command: { ...command, versionId: song.id } };
  for (const mutation of [{ actor: { role: 'host' } }, { type: 'skip' }, { confirmed: true }, { expectedRevision: -1 }, { expectedRevision: 0.5 }, { commandId: 'short' }, { hostEpoch: 'a'.repeat(129) }]) {
    assert.equal(parseGuestRequest('request', { command: { ...request.command, ...mutation } }, secret), null);
  }
  for (const values of [{ offset: -1, limit: 50 }, { offset: Number.MAX_SAFE_INTEGER + 1, limit: 50 }, { offset: 0, limit: 101 }, { offset: 0, limit: 0 }]) assert.equal(parseGuestRequest('catalog', values, secret), null);
  assert.ok(parseGuestRequest('withdraw', { command: { ...command, requestId: 'r'.repeat(500) } }, secret));
  assert.equal(parseGuestRequest('withdraw', { command: { ...command, requestId: 'r'.repeat(501) } }, secret), null);
  assert.equal(parseGuestRequest('availability', { command: { ...command, minutes: 61 } }, secret), null);
  assert.equal(parseGuestRequest('missing-request', { command: { commandId: command.commandId, title: 'x'.repeat(201), artist: '' } }, secret), null);
  assert.equal(parseGuestRequest('join', { joinId: 'join-00001', resumeSecret: secret, name: 'bad\nname', expectedRevision: 0 }), null);
  const deep: Record<string, unknown> = {}; let cursor = deep;
  for (let i = 0; i < 20; i++) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; }
  assert.equal(parseGuestRequest('snapshot', deep, secret), null);
});

test('response projection strips private fields at every approved nesting level', () => {
  const privateFields = { token: 'private-owner-key', path: '/private/music.mp4', notes: 'private host notes' };
  assert.deepEqual(projectGuestResponse('admission', 200, { showId: command.showId, hostEpoch: command.hostEpoch, revision: 3, ...privateFields }),
    { status: 200, body: { showId: command.showId, hostEpoch: command.hostEpoch, revision: 3 } });
  assert.deepEqual(projectGuestResponse('join', 200, { session: secret, singerId: 'singer-0001', ...privateFields }), { status: 200, body: { session: secret, singerId: 'singer-0001' } });
  const result = projectGuestResponse('snapshot', 200, { ...snapshot, ...privateFields,
    catalog: [{ ...song, ...privateFields }], requests: [{ ...snapshot.requests[0], ...privateFields }] });
  assert.deepEqual(result, { status: 200, body: snapshot });
  assert.doesNotMatch(JSON.stringify(result), /private-owner|private\/|private host/);
  assert.deepEqual(projectGuestResponse('catalog', 200, { revision: 3, items: [{ ...song, ...privateFields }], nextOffset: null, ...privateFields }),
    { status: 200, body: { revision: 3, items: [song], nextOffset: null } });
  assert.deepEqual(projectGuestResponse('request', 200, { ok: true, revision: 4, ...privateFields }), { status: 200, body: { ok: true, revision: 4 } });
});

test('error projections never forward raw exceptions and preserve only explicit join revision conflicts', () => {
  assert.deepEqual(projectGuestResponse('request', 400, { error: '/private/password', stack: 'sensitive stack' }),
    { status: 400, body: { error: 'Request could not be completed.' } });
  assert.equal(projectGuestResponse('request', 200, new Error('/private/password')), null);
  assert.deepEqual(projectGuestResponse('join', 409, { error: 'REVISION_CONFLICT', private: 'secret' }), { status: 409, body: { error: 'REVISION_CONFLICT' } });
  assert.equal(projectGuestResponse('request', 409, { error: 'REVISION_CONFLICT' }), null);
  assert.equal(projectGuestResponse('join', 409, { error: '/private/password' }), null);
  assert.equal(projectGuestResponse('join', 500, { error: '/private/password' }), null);
  assert.deepEqual(projectGuestResponse('outcome', 200, null), { status: 200, body: null });
  assert.deepEqual(projectGuestResponse('outcome', 200, { ok: false, code: 'REVISION_CONFLICT', message: 'Show state has changed', revision: 4, notes: 'private' }),
    { status: 200, body: { ok: false, code: 'REVISION_CONFLICT', message: 'Show state has changed', revision: 4 } });
});

test('response schemas enforce song, request, status, timestamp and JSON depth limits', () => {
  assert.ok(projectGuestResponse('catalog', 200, { revision: 0, items: Array.from({ length: 100 }, (_, i) => ({ ...song, id: `version-${String(i).padStart(4, '0')}` })), nextOffset: 100 }));
  for (const replacement of [{ catalog: Array(101).fill(song) }, { catalog: [{ ...song, title: 't'.repeat(501) }] },
    { requests: Array(51).fill(snapshot.requests[0]) }, { requests: [{ ...snapshot.requests[0], status: 'host' }] },
    { requests: [snapshot.requests[0], snapshot.requests[0]] }, { serverNowMs: Number.NaN }, { unavailableUntilMs: -1 }, { revision: -1 }, { requestsTruncated: 'yes' }]) {
    assert.equal(projectGuestResponse('snapshot', 200, { ...snapshot, ...replacement }), null);
  }
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.equal(projectGuestResponse('snapshot', 200, cycle), null);
  assert.equal(projectGuestResponse('request', 200, { ok: false, code: 'INVALID', message: 'm'.repeat(501), revision: 0 }), null);
});

test('host reply envelope is bounded, strict and separately projects by the pending operation', () => {
  const reply = { ...identity, responses: [{ requestId, status: 200 as const, body: { ok: true, revision: 4, secret: 'never-forward' } }] };
  assert.deepEqual(parseHostReplyEnvelope(reply), reply);
  const parsed = parseHostReplyEnvelope(reply)!;
  assert.deepEqual(projectGuestResponse('request', parsed.responses[0].status, parsed.responses[0].body), { status: 200, body: { ok: true, revision: 4 } });
  for (const value of [{ ...reply, owner: secret }, { ...reply, responses: [] }, { ...reply, responses: Array(9).fill(reply.responses[0]) },
    { ...reply, responses: [reply.responses[0], reply.responses[0]] }, { ...reply, responses: [{ ...reply.responses[0], status: 500 }] },
    { ...reply, responses: [{ ...reply.responses[0], requestId: 'not-a-uuid' }] }, { ...reply, responses: [{ ...reply.responses[0], operation: 'skip' }] }]) assert.equal(parseHostReplyEnvelope(value), null);
  const deep = { ...reply, responses: [{ ...reply.responses[0], body: { next: { next: { next: { next: { next: { next: { next: {} } } } } } } } }] };
  assert.equal(parseHostReplyEnvelope(deep), null);
});
