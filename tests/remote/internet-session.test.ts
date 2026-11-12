import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JoinRevisionConflict } from '../../src/remote/client';
import { INTERNET_QUEUE_ORIGIN, validSessionLink, validateSessionSlug } from '../../src/remote/internet-session-control';
import { InternetSessionEnded, internetGuestTransport, lookupInternetSingerRoom } from '../../src/remote/internet-transport';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const room = () => ({ roomId: randomUUID(), generation: randomUUID(), slug: 'proper-volume', expiresAt: Date.now() + 60000, online: true });

test('session addresses and displayed links reject reserved routes and other origins', () => {
  assert.equal(validateSessionSlug('proper-volume'), null);
  for (const value of ['UPPER', 'ab', '-name', 'name-', 'x'.repeat(49), 'admin', 'singer', 'api', 'name/path', 'a b']) assert.ok(validateSessionSlug(value), value);
  assert.equal(validSessionLink(`${INTERNET_QUEUE_ORIGIN}/proper-volume`, 'proper-volume'), true);
  for (const value of ['https://evil.test/proper-volume', `${INTERNET_QUEUE_ORIGIN}/proper-volume?token=secret`, `${INTERNET_QUEUE_ORIGIN}/proper-volume#secret`, `${INTERNET_QUEUE_ORIGIN}/other`])
    assert.equal(validSessionLink(value, 'proper-volume'), false);
});

test('singer relay adapter uses fixed room generation and never sends host or invitation credentials', async () => {
  const current = room(), sent: { url: string; options?: RequestInit }[] = [];
  const transport = internetGuestTransport(current, { fetch: async (input, options) => { sent.push({ url: String(input), options }); return response({}); } });
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
