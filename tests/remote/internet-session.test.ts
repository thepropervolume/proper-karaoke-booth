import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JoinRevisionConflict, SingerClient } from '../../src/remote/client';
import { INTERNET_QUEUE_ORIGIN, validSessionLink, validateSessionSlug } from '../../src/remote/internet-session-control';
import { InternetSessionEnded, internetGuestTransport, lookupInternetSingerRoom } from '../../src/remote/internet-transport';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const room = () => ({ roomId: randomUUID(), generation: randomUUID(), slug: 'proper-volume', expiresAt: Date.now() + 60000, online: true });
const snapshot = () => ({ showId: 'show-00001', hostEpoch: 'epoch-0001', revision: 1, singerId: 'singer-00001', singerName: 'Sam',
  catalog: [{ id: 'version-clean', title: 'Popular', artist: 'Nada Surf' }], catalogNextOffset: null, requests: [], serverNowMs: Date.now(), unavailableUntilMs: 0, requestsTruncated: false });

test('session addresses and displayed links reject reserved routes and other origins', () => {
  assert.equal(validateSessionSlug('proper-volume'), null);
  for (const value of ['UPPER', 'ab', '-name', 'name-', 'x'.repeat(49), 'admin', 'singer', 'api', 'name/path', 'a b']) assert.ok(validateSessionSlug(value), value);
  assert.equal(validSessionLink(`${INTERNET_QUEUE_ORIGIN}/proper-volume`, 'proper-volume'), true);
  for (const value of ['https://evil.test/proper-volume', `${INTERNET_QUEUE_ORIGIN}/proper-volume?token=secret`, `${INTERNET_QUEUE_ORIGIN}/proper-volume#secret`, `${INTERNET_QUEUE_ORIGIN}/other`])
    assert.equal(validSessionLink(value, 'proper-volume'), false);
});

test('singer relay adapter uses fixed room generation and never sends host or invitation credentials', async () => {
  const current = room(), sent: { url: string; options?: RequestInit }[] = [];
  const transport = internetGuestTransport(current, { fetch: async (input, options) => {
    sent.push({ url: String(input), options });
    return response(String(input).endsWith('/admission') ? { showId: 'show-00001', hostEpoch: 'epoch-0001', revision: 1 } : String(input).endsWith('/join') ? { session: 'A'.repeat(43), singerId: 'singer-00001' } : snapshot());
  } });
  await transport.admission('must-not-send');
  await transport.join('must-not-send', 'join-id', 'resume-secret', 'Sam', 4);
  await transport.snapshot('A'.repeat(43));
  for (const request of sent) {
    assert.ok(request.url.startsWith(`${INTERNET_QUEUE_ORIGIN}/v1/relay/rooms/${current.roomId}/${current.generation}/guest/`));
    assert.equal(request.options?.credentials, 'omit'); assert.equal(request.options?.redirect, 'error'); assert.equal(request.options?.referrerPolicy, 'no-referrer');
    assert.doesNotMatch(request.url, /must-not-send|resume-secret|AAAA/);
  }
  assert.deepEqual(JSON.parse(sent[0].options?.body as string), {});
  assert.deepEqual(JSON.parse(sent[1].options?.body as string), { joinId: 'join-id', resumeSecret: 'resume-secret', name: 'Sam', expectedRevision: 4 });
  assert.equal((sent[2].options?.headers as Record<string, string>).Authorization, `Bearer ${'A'.repeat(43)}`);
});

test('stale generation permanently stops the adapter rather than looking up a reused slug', async () => {
  let calls = 0, ended = 0;
  const transport = internetGuestTransport(room(), { fetch: async () => { calls++; return response({ error: 'SESSION_ENDED' }, 410); }, onEnded: () => { ended++; } });
  await assert.rejects(transport.snapshot('A'.repeat(43)), InternetSessionEnded);
  await assert.rejects(transport.resume('resume'), InternetSessionEnded);
  assert.equal(calls, 1); assert.equal(ended, 1);
});

test('relay join preserves the proven revision conflict while uncertain service responses stay errors', async () => {
  const conflict = internetGuestTransport(room(), { fetch: async () => response({ error: 'REVISION_CONFLICT' }, 409) });
  await assert.rejects(conflict.join('', 'join', 'resume', 'Sam', 0), JoinRevisionConflict);
  const uncertain = internetGuestTransport(room(), { fetch: async () => response({ error: 'UNCERTAIN' }, 503) });
  await assert.rejects(uncertain.join('', 'join', 'resume', 'Sam', 0), error => !(error instanceof JoinRevisionConflict));
});

test('lookup validates the exact requested slug and rejects an oversized response', async () => {
  const current = room();
  assert.deepEqual(await lookupInternetSingerRoom(current.slug, async input => { assert.equal(String(input), `${INTERNET_QUEUE_ORIGIN}/v1/relay/lookup/${current.slug}`); return response(current); }), current);
  await assert.rejects(lookupInternetSingerRoom(current.slug, async () => response({ ...current, slug: 'other-show' })));
  await assert.rejects(lookupInternetSingerRoom(current.slug, async () => response({ ...current, extra: 'x'.repeat(9000) })));
});

test('malformed successful identity/snapshot/catalog responses are rejected before entering singer state', async () => {
  const malformed = [
    ['admission', {}], ['admission', { showId: 'show-00001', hostEpoch: 'epoch-0001', revision: -1 }],
    ['join', { session: 'short', singerId: 'singer-00001' }], ['resume', { session: 'A'.repeat(43), singerId: 'singer-00001', ownerToken: 'private' }],
    ['snapshot', {}], ['snapshot', { ...snapshot(), catalog: null }], ['snapshot', { ...snapshot(), catalog: [{ id: 'version-clean', title: 'Song', artist: 'Artist', mediaPath: 'private' }] }],
    ['snapshot', { ...snapshot(), requests: [{ id: 'request-0001', versionId: 'version-clean', status: 'invented' }] }],
    ['catalog', { revision: 1, items: [], nextOffset: 0 }], ['catalog', { revision: 1, items: Array(101).fill({ id: 'version-clean', title: 'Song', artist: 'Artist' }), nextOffset: null }],
  ] as const;
  for (const [operation, result] of malformed) {
    const transport = internetGuestTransport(room(), { fetch: async () => response(result) });
    const work = operation === 'admission' ? transport.admission('') : operation === 'join' ? transport.join('', 'join', 'resume', 'Sam', 0)
      : operation === 'resume' ? transport.resume('resume') : operation === 'snapshot' ? transport.snapshot('A'.repeat(43)) : transport.catalog('A'.repeat(43), 0, 50);
    await assert.rejects(work, /validated/);
  }
});

test('malformed 200 outcomes retain uncertain command identity until a validated receipt arrives', async () => {
  let outcomeValid = false, requestCount = 0, sentCommandId = '', receiptId = '';
  const transport = internetGuestTransport(room(), { fetch: async (input, init) => {
    const operation = new URL(String(input)).pathname.split('/').at(-1), body = JSON.parse(init!.body as string);
    if (operation === 'admission') return response({ showId: 'show-00001', hostEpoch: 'epoch-0001', revision: 1 });
    if (operation === 'join') return response({ session: 'A'.repeat(43), singerId: 'singer-00001' });
    if (operation === 'snapshot') return response(snapshot());
    if (operation === 'request') { requestCount++; sentCommandId = body.command.commandId; return response({ ok: true }); }
    if (operation === 'outcome') { receiptId = body.commandId; return response(outcomeValid ? { ok: true, revision: 2 } : { ok: true, revision: '2' }); }
    throw new Error('Unexpected test operation');
  } });
  const client = new SingerClient(transport, '', () => randomUUID());
  await client.join('Sam', () => {}); assert.equal(client.state().joined, true);
  await client.request('version-clean', () => {}); assert.equal(client.state().uncertain, true);
  await client.request('version-clean', () => {}); assert.equal(requestCount, 1);
  await client.checkOutcome(() => {}); assert.equal(client.state().uncertain, true); assert.equal(receiptId, sentCommandId);
  outcomeValid = true; await client.checkOutcome(() => {}); assert.equal(receiptId, sentCommandId); assert.equal(client.state().uncertain, false); assert.equal(requestCount, 1);
});

test('malformed 200 join keeps the original join identity available for a safe retry', async () => {
  const joins: unknown[] = []; let malformed = true;
  const transport = internetGuestTransport(room(), { fetch: async (input, init) => {
    const operation = new URL(String(input)).pathname.split('/').at(-1);
    if (operation === 'admission') return response({ showId: 'show-00001', hostEpoch: 'epoch-0001', revision: 1 });
    if (operation === 'join') { joins.push(JSON.parse(init!.body as string)); return response(malformed ? { session: 'short' } : { session: 'A'.repeat(43), singerId: 'singer-00001' }); }
    return response(snapshot());
  } });
  const client = new SingerClient(transport, '', () => randomUUID());
  await client.join('Sam', () => {}); assert.equal(client.state().joined, false); assert.equal(client.state().joinUncertain, true);
  malformed = false; await client.join('Sam', () => {});
  assert.deepEqual(joins[0], joins[1]); assert.equal(client.state().joined, true); assert.equal(client.state().joinUncertain, false);
});

test('only exact bounded outcomes are accepted and null is reserved for an unavailable receipt', async () => {
  const command = { commandId: 'command-0001', showId: 'show-00001', hostEpoch: 'epoch-0001', expectedRevision: 1, versionId: 'version-clean' };
  for (const body of [null, {}, { ok: true, revision: 1, extra: 'unapproved' }, { ok: false, revision: 1, code: 'INVALID' },
    { ok: false, revision: 1, code: 'INVALID', message: 'x'.repeat(501) }, { ok: false, revision: 1, code: 'lowercase', message: 'Invalid' }]) {
    const transport = internetGuestTransport(room(), { fetch: async () => response(body) });
    await assert.rejects(transport.submit('A'.repeat(43), command), /validated/);
  }
  const absent = internetGuestTransport(room(), { fetch: async () => response(null) });
  assert.equal(await absent.outcome('A'.repeat(43), command.commandId), null);
  const failure = { ok: false, revision: 1, code: 'INVALID', message: 'Request unavailable' };
  const rejected = internetGuestTransport(room(), { fetch: async () => response(failure) });
  assert.deepEqual(await rejected.submit('A'.repeat(43), command), failure);
});
