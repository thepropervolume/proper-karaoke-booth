import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { RemoteQueue } from '../../src/main/remote-queue';
import { SingerClient, type GuestTransport } from '../../src/remote/client';

const secrets = () => { let index = 0; return () => String(++index).padStart(43, 'A'); };
const listen = () => {};
function fixture(loss: 'before' | 'after') {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const initial = createInitialState('show-123', 'epoch-123');
  initial.versions.push({ id: 'song-123', title: 'Popular', artist: 'Nada Surf', rating: 'clean' });
  db.prepare('INSERT INTO show_state (id, value) VALUES (1, ?)').run(JSON.stringify(initial));
  const queue = new RemoteQueue(db, () => DEFAULT_SETTINGS, () => {});
  const invite = queue.createInvitation(60_000), requests: unknown[] = [];
  const read = () => JSON.parse((db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string }).value) as ShowState;
  const transport: GuestTransport = {
    admission: token => Promise.resolve(queue.admissionInfo(token)),
    join: (token, id, resume, name, revision) => Promise.resolve(queue.join(token, id, resume, name, revision)),
    resume: secret => Promise.resolve(queue.resume(secret)),
    snapshot: session => Promise.resolve(queue.snapshot(session)),
    catalog: (session, offset, limit) => Promise.resolve(queue.catalog(session, offset, limit)),
    submit: async (session, command) => {
      requests.push(structuredClone(command));
      if (requests.length === 1 && loss === 'before') throw new Error('Request never reached authority');
      const outcome = queue.submit(session, command);
      if (requests.length === 1) throw new Error('Reply lost after commit');
      return outcome;
    },
    withdraw: (session, command) => Promise.resolve(queue.withdraw(session, command)),
    setAvailability: (session, command) => Promise.resolve(queue.setAvailability(session, command)),
    submitMissing: (session, command) => Promise.resolve(queue.submitMissing(session, command)),
    outcome: (session, id) => Promise.resolve(queue.outcome(session, id)),
  };
  return { db, read, requests, client: new SingerClient(transport, invite, secrets()) };
}

test('actual authority receipt resolves a lost committed reply without resending', async () => {
  const f = fixture('after');
  try {
    await f.client.join('Sam', listen); await f.client.request('song-123', listen);
    assert.equal(f.client.state().uncertain, true); assert.equal(f.read().requests.length, 1);
    await f.client.checkOutcome(listen);
    assert.equal(f.client.state().uncertain, false); assert.equal(f.client.state().retryAvailable, false);
    assert.equal(f.requests.length, 1); assert.equal(f.read().requests.length, 1);
  } finally { f.db.close(); }
});

test('actual authority applies an explicitly retried undelivered command only once', async () => {
  const f = fixture('before');
  try {
    await f.client.join('Sam', listen); await f.client.request('song-123', listen);
    assert.equal(f.read().requests.length, 0); await f.client.checkOutcome(listen);
    assert.equal(f.client.state().retryAvailable, true);
    await f.client.retryPending(listen);
    assert.deepEqual(f.requests[1], f.requests[0]); assert.equal(f.read().requests.length, 1);
    assert.equal(f.client.state().uncertain, false);
  } finally { f.db.close(); }
});

test('retrying an undelivered old-epoch command fails safely after host restart', async () => {
  const f = fixture('before');
  try {
    await f.client.join('Sam', listen); await f.client.request('song-123', listen); await f.client.checkOutcome(listen);
    const state = f.read(); state.hostEpoch = 'epoch-456';
    f.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
    await f.client.retryPending(listen);
    assert.equal(f.read().requests.length, 0); assert.equal(f.client.state().uncertain, false);
    assert.match(f.client.state().message, /epoch|show/i);
  } finally { f.db.close(); }
});
