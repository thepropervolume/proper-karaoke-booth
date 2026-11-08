import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { JoinRevisionConflict, SingerClient, takeInvitation, type GuestSnapshot, type GuestTransport } from '../../src/remote/client';
import { httpsGuestTransport } from '../../src/remote/transport';

const show = (): GuestSnapshot => ({ showId: 'show-123', hostEpoch: 'epoch-123', revision: 4, singerId: 'singer-123', singerName: 'Sam',
  catalog: [{ id: 'song-123', title: 'Popular', artist: 'Nada Surf' }], catalogNextOffset: null, requests: [] });
const secrets = () => { let i = 0; return () => `secret-${++i}`; };
function fake(): GuestTransport {
  return { admission: async () => ({ showId: 'show-123', hostEpoch: 'epoch-123', revision: 4 }),
    join: async () => ({ session: 'private-session', singerId: 'singer-123' }), resume: async () => ({ session: 'fresh-session', singerId: 'singer-123' }),
    snapshot: async () => show(), catalog: async () => ({ revision: 4, items: [], nextOffset: null }),
    submit: async () => ({ ok: true, revision: 5 }), submitMissing: async () => ({ ok: true, revision: 4 }), outcome: async () => null };
}
const listen = () => {};

test('join retries a lost response with exactly the same identity and never exposes secrets in view', async () => {
  const transport = fake(), calls: unknown[][] = [];
  transport.join = async (...args) => { calls.push(args); if (calls.length === 1) throw new Error('disconnected'); return { session: 'private-session', singerId: 'singer-123' }; };
  const client = new SingerClient(transport, 'private-invite', secrets());
  await client.join('Sam', listen);
  assert.equal(client.state().joinUncertain, true);
  await client.join('Other', listen);
  assert.equal(calls.length, 1);
  await client.join('Sam', listen);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(client.state().snapshot?.singerName, 'Sam');
  assert.doesNotMatch(JSON.stringify(client.state()), /private-(invite|session)|secret-/);
});

test('uncertain request is never replayed; outcome lookup and reconnect retain the original command', async () => {
  const transport = fake(); let submits = 0, outcomeId = '', resume = '';
  transport.submit = async () => { submits++; throw new Error('lost response'); };
  transport.outcome = async (_session, id) => { outcomeId = id; return { ok: true, revision: 5 }; };
  transport.resume = async secret => { resume = secret; return { session: 'new-session', singerId: 'singer-123' }; };
  const client = new SingerClient(transport, 'invite', secrets());
  await client.join('Sam', listen);
  await client.request('song-123', listen);
  assert.equal(client.state().uncertain, true);
  await client.request('song-123', listen);
  assert.equal(submits, 1);
  await client.reconnect(listen);
  await client.checkOutcome(listen);
  assert.equal(resume, 'secret-2');
  assert.equal(outcomeId, 'secret-3');
  assert.equal(client.state().uncertain, false);
});

test('a proven rolled-back join conflict can acquire a fresh revision and retry', async () => {
  const transport = fake(); const revisions: number[] = []; let admission = 0;
  transport.admission = async () => ({ showId: 'show-123', hostEpoch: 'epoch-123', revision: ++admission });
  transport.join = async (_invite, _id, _secret, _name, revision) => { revisions.push(revision); if (revisions.length === 1) throw new JoinRevisionConflict(); return { session: 'private-session', singerId: 'singer-123' }; };
  const client = new SingerClient(transport, 'invite', secrets());
  await client.join('Sam', listen);
  assert.equal(client.state().joinUncertain, false);
  await client.join('Sam', listen);
  assert.deepEqual(revisions, [1, 2]); assert.equal(client.state().joined, true);
});

test('missing-song request sends no singer identity and resolves uncertain delivery using its original receipt', async () => {
  const transport = fake(); let sent: unknown, outcomeId = '', calls = 0;
  transport.submitMissing = async (_session, command) => { sent = command; calls++; throw new Error('lost response'); };
  transport.outcome = async (_session, id) => { outcomeId = id; return { ok: true, revision: 4 }; };
  const client = new SingerClient(transport, 'invite', secrets());
  await client.join('Sam', listen); await client.requestMissing('  Popular  ', '  Nada Surf ', listen);
  assert.deepEqual(sent, { commandId: 'secret-3', title: 'Popular', artist: 'Nada Surf' });
  await client.requestMissing('Other', '', listen); assert.equal(calls, 1);
  await client.checkOutcome(listen); assert.equal(outcomeId, 'secret-3');
  assert.equal(client.state().message, 'Missing-song request sent to the host.');
});

test('a changed catalog revision restarts the visible list instead of appending a stale page', async () => {
  const transport = fake(); let loads = 0;
  transport.snapshot = async () => { loads++; return { ...show(), revision: loads === 1 ? 4 : 5, catalogNextOffset: loads === 1 ? 50 : null }; };
  transport.catalog = async () => ({ revision: 5, items: [{ id: 'stale', title: 'Stale', artist: '' }], nextOffset: null });
  const client = new SingerClient(transport, 'invite', secrets());
  await client.join('Sam', listen); await client.more(listen);
  assert.equal(client.state().snapshot?.revision, 5);
  assert.deepEqual(client.state().songs.map(song => song.id), ['song-123']);
});

test('invitation fragment is erased and HTTPS transport keeps bearer credentials out of URLs', async () => {
  let replaced = '';
  const invite = takeInvitation({ hash: '#invite=abc', pathname: '/join', search: '?x=1' } as Location,
    { replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => { replaced = String(url); } } as History);
  assert.equal(invite, 'abc'); assert.equal(replaced, '/join?x=1');
  assert.throws(() => httpsGuestTransport('http://example.test'), /HTTPS/);
  let url = '', options: RequestInit | undefined;
  const transport = httpsGuestTransport('https://example.test', async (input, init) => { url = String(input); options = init; return new Response(JSON.stringify(show()), { status: 200 }); });
  await transport.snapshot('private-session');
  assert.equal(url, 'https://example.test/api/v1/snapshot');
  assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer private-session');
  assert.equal(options?.referrerPolicy, 'no-referrer'); assert.equal(options?.credentials, 'omit');
  const conflict = httpsGuestTransport('https://example.test', async () => new Response(JSON.stringify({ error: 'REVISION_CONFLICT' }), { status: 409 }));
  await assert.rejects(conflict.join('invite', 'join', 'resume', 'Sam', 1), JoinRevisionConflict);
  const unknown = httpsGuestTransport('https://example.test', async () => new Response(JSON.stringify({ error: 'other' }), { status: 409 }));
  await assert.rejects(unknown.join('invite', 'join', 'resume', 'Sam', 1), error => !(error instanceof JoinRevisionConflict));
});
