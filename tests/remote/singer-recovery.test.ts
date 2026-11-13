import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Outcome } from '../../src/domain';
import { SingerClient, type GuestSnapshot, type GuestTransport } from '../../src/remote/client';

const snapshot = (revision = 4): GuestSnapshot => ({ showId: 'show-123', hostEpoch: 'epoch-123', revision, singerId: 'singer-123', singerName: 'Sam',
  catalog: [{ id: 'song-123', title: 'Popular', artist: 'Nada Surf' }], catalogNextOffset: null,
  requests: [{ id: 'request-123', versionId: 'song-123', status: 'accepted' }] });
const secrets = () => { let count = 0; return () => `secret-${++count}`; };
const listen = () => {};
type Kind = 'song' | 'withdraw' | 'availability' | 'missing';

function setup(kind: Kind, committedBeforeLoss: boolean) {
  const calls: { kind: Kind; session: string; command: unknown }[] = [];
  let applied = 0, receipt: Outcome | null = null, revision = 4;
  const perform = async (actual: Kind, session: string, command: unknown): Promise<Outcome> => {
    assert.equal(actual, kind); calls.push({ kind: actual, session, command: structuredClone(command) });
    if (calls.length === 1) {
      if (committedBeforeLoss) { applied++; receipt = { ok: true, revision: 5 }; }
      throw new Error('lost response');
    }
    if (!receipt) { applied++; receipt = { ok: true, revision: 5 }; }
    return receipt;
  };
  const transport: GuestTransport = {
    admission: async () => ({ showId: 'show-123', hostEpoch: 'epoch-123', revision: 4 }),
    join: async () => ({ session: 'session-first', singerId: 'singer-123' }),
    resume: async () => ({ session: 'session-next', singerId: 'singer-123' }),
    snapshot: async () => snapshot(revision), catalog: async () => ({ revision, items: [], nextOffset: null }),
    submit: (session, command) => perform('song', session, command),
    withdraw: (session, command) => perform('withdraw', session, command),
    setAvailability: (session, command) => perform('availability', session, command),
    submitMissing: (session, command) => perform('missing', session, command),
    outcome: async () => null,
  };
  const client = new SingerClient(transport, 'invite', secrets());
  const invoke = () => kind === 'song' ? client.request('song-123', listen) : kind === 'withdraw' ? client.withdraw('request-123', listen) :
    kind === 'availability' ? client.setAvailability(12, listen) : client.requestMissing('  Missing  ', ' Artist ', listen);
  return { client, transport, calls, invoke, applied: () => applied, setRevision: (value: number) => { revision = value; } };
}

for (const kind of ['song', 'withdraw', 'availability', 'missing'] as const) {
  for (const committedBeforeLoss of [false, true]) test(`${kind}: explicit retry preserves original command after ${committedBeforeLoss ? 'committed response loss' : 'no delivery'}`, async () => {
    const f = setup(kind, committedBeforeLoss);
    await f.client.join('Sam', listen); await f.invoke();
    assert.equal(f.client.state().uncertain, true); assert.equal(f.client.state().retryAvailable, false);
    await f.client.retryPending(listen); await f.invoke(); assert.equal(f.calls.length, 1, 'No automatic or unchecked retry.');
    await f.client.checkOutcome(listen); assert.equal(f.client.state().retryAvailable, true);
    f.setRevision(99); await f.client.reconnect(listen);
    assert.equal(f.client.state().snapshot?.revision, 99);
    await f.client.retryPending(listen);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].session, 'session-next');
    assert.deepEqual(f.calls[1].command, f.calls[0].command, 'Retry must preserve command ID and all original fields.');
    assert.equal(f.applied(), 1, 'The authority applies the command once.');
    assert.equal(f.client.state().uncertain, false); assert.equal(f.client.state().retryAvailable, false);
    assert.doesNotMatch(JSON.stringify(f.client.state()), /session-(first|next)|secret-/);
  });
}

test('another lost retry retains the original request until a fresh outcome lookup permits retry', async () => {
  const f = setup('song', false), originalSubmit = f.transport.submit;
  await f.client.join('Sam', listen); await f.invoke();
  await f.client.checkOutcome(listen); assert.equal(f.client.state().retryAvailable, true);
  f.transport.submit = async (session, command) => { f.calls.push({ kind: 'song', session, command: structuredClone(command) }); throw new Error('lost again'); };
  await f.client.retryPending(listen);
  assert.equal(f.client.state().uncertain, true); assert.equal(f.client.state().retryAvailable, false);
  await f.client.retryPending(listen); assert.equal(f.calls.length, 2, 'Another retry requires a fresh outcome check.');
  f.transport.submit = originalSubmit;
  await f.client.checkOutcome(listen); await f.client.retryPending(listen);
  assert.equal(f.client.state().uncertain, false); assert.deepEqual(f.calls[2].command, f.calls[0].command);
  assert.equal(f.applied(), 1);
});

test('malformed success and outcome replies cannot discard an uncertain command', async () => {
  const f = setup('song', false), originalSubmit = f.transport.submit;
  f.transport.submit = async (session, command) => { f.calls.push({ kind: 'song', session, command: structuredClone(command) }); return { ok: true } as Outcome; };
  await f.client.join('Sam', listen); await f.invoke();
  assert.equal(f.client.state().uncertain, true);
  f.transport.outcome = async () => ({ ok: true } as Outcome);
  await f.client.checkOutcome(listen); assert.equal(f.client.state().uncertain, true); assert.equal(f.client.state().retryAvailable, false);
  f.transport.outcome = async () => null; f.transport.submit = originalSubmit;
  await f.client.checkOutcome(listen); await f.client.retryPending(listen);
  assert.equal(f.applied(), 1); assert.equal(f.client.state().uncertain, false);
});

test('reconnect refuses a different singer identity before retrying an uncertain command', async () => {
  const f = setup('song', false);
  await f.client.join('Sam', listen); await f.invoke(); await f.client.checkOutcome(listen);
  f.transport.resume = async () => ({ session: 'other-singer-session', singerId: 'other-singer' });
  await f.client.reconnect(listen);
  assert.match(f.client.state().message, /Could not reconnect/);
  await f.client.retryPending(listen);
  assert.equal(f.calls[1].session, 'session-first');
  assert.deepEqual(f.calls[1].command, f.calls[0].command);
});
