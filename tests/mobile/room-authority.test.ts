import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileShow } from '../../src/mobile/show';
import { MobileRoomAuthority, mobileSecret } from '../../src/mobile/room-authority';
import { SingerClient, JoinRevisionConflict, type GuestTransport } from '../../src/remote/client';
import { parseGuestAdmission, parseGuestCatalog, parseGuestJoin, parseGuestOutcome, parseGuestSnapshot } from '../../src/remote/guest-response';
import { projectGuestResponse } from '../../src/relay/protocol';
function fixture() {
  const show = new MobileShow(); show.add([{ id: 'youtube_Video123456', title: 'Wonderwall', artist: 'Oasis', provider: 'karaokenerds', videoId: 'Video123456' }]);
  const authority = new MobileRoomAuthority(show);
  const call = (operation: string, payload: unknown, session?: string) => {
    const reply = authority.dispatch({ requestId: crypto.randomUUID(), operation, payload, ...(session ? { session } : {}) });
    if (reply.status === 409) throw new JoinRevisionConflict();
    if (reply.status !== 200) throw new Error('Denied');
    assert.deepEqual(projectGuestResponse(operation, reply.status, reply.body), { status: reply.status, body: reply.body });
    return reply.body;
  };
  const transport: GuestTransport = {
    admission: async () => parseGuestAdmission(call('admission', {})),
    join: async (_, joinId, resumeSecret, name, expectedRevision) => parseGuestJoin(call('join', { joinId, resumeSecret, name, expectedRevision })),
    resume: async resumeSecret => parseGuestJoin(call('resume', { resumeSecret })),
    snapshot: async session => parseGuestSnapshot(call('snapshot', {}, session)),
    catalog: async (session, offset, limit) => parseGuestCatalog(call('catalog', { offset, limit }, session), offset, limit),
    submit: async (session, command) => parseGuestOutcome(call('request', { command }, session)),
    withdraw: async (session, command) => parseGuestOutcome(call('withdraw', { command }, session)),
    setAvailability: async (session, command) => parseGuestOutcome(call('availability', { command }, session)),
    submitMissing: async (session, command) => parseGuestOutcome(call('missing-request', { command }, session)),
    outcome: async (session, commandId) => { const result = call('outcome', { commandId }, session); return result === null ? null : parseGuestOutcome(result); },
  }; return { show, authority, transport, call };
}
test('a real singer client joins a mobile host, requests a song, marks away, withdraws and sends a missing song', async () => {
  const { show, authority, transport } = fixture(), client = new SingerClient(transport, '');
  await client.join('Alice', () => {}); assert.equal(client.state().joined, true);
  await client.request('youtube_Video123456', () => {}); assert.equal(show.next()?.singer, 'Alice'); assert.equal(client.state().snapshot?.requests.length, 1);
  await client.setAvailability(10, () => {}); assert.equal(show.next(), null);
  await client.withdraw(show.state().queue[0].id, () => {}); assert.equal(show.state().queue[0].status, 'withdrawn');
  await client.requestMissing('New Song', 'Artist', () => {}); assert.deepEqual(authority.missing, [{ singer: 'Alice', title: 'New Song', artist: 'Artist' }]);
  assert.equal(JSON.stringify(client.state()).includes('fileName'), false);
});
test('lost responses recover by command ID without duplicate queue entries; another guest cannot withdraw or query the receipt', async () => {
  const { show, transport, call } = fixture();
  const first = await transport.join('', mobileSecret(), mobileSecret(), 'Alice', show.revision);
  const command = { commandId: mobileSecret(), showId: show.showId, hostEpoch: (await transport.admission('')).hostEpoch, expectedRevision: show.revision, versionId: 'youtube_Video123456' };
  const a = await transport.submit(first.session, command), b = await transport.submit(first.session, command);
  assert.deepEqual(a, b); assert.equal(show.state().queue.length, 1);
  const second = await transport.join('', mobileSecret(), mobileSecret(), 'Ben', show.revision);
  assert.equal(await transport.outcome(second.session, command.commandId), null);
  const withdrawal = await transport.withdraw(second.session, { commandId: mobileSecret(), showId: show.showId, hostEpoch: (await transport.admission('')).hostEpoch, expectedRevision: show.revision, requestId: command.commandId });
  assert.equal(withdrawal.ok, false); assert.equal(show.next()?.singer, 'Alice');
  assert.throws(() => call('play', {}, first.session)); assert.throws(() => call('snapshot', {}, mobileSecret()));
});
test('ending a room revokes its singer credentials and epoch while preserving the host queue and submitted songs', async () => {
  const { show, authority, transport } = fixture();
  const admission = await transport.admission(''), guest = await transport.join('', mobileSecret(), mobileSecret(), 'Alice', show.revision);
  await transport.submit(guest.session, { commandId: mobileSecret(), showId: admission.showId, hostEpoch: admission.hostEpoch, expectedRevision: show.revision, versionId: 'youtube_Video123456' });
  authority.reset();
  await assert.rejects(transport.snapshot(guest.session));
  assert.notEqual((await transport.admission('')).hostEpoch, admission.hostEpoch); assert.equal(show.state().queue.length, 1);
});
