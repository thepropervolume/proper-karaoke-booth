import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PaidProviderSessions, type PaidProviderConnection } from '../../src/main/paid-provider-sessions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('providers without approved adapters are unavailable and cannot connect', async () => {
  const sessions = new PaidProviderSessions();
  assert.deepEqual(sessions.status(), [
    { id: 'karafun', phase: 'unavailable' }, { id: 'party-tyme', phase: 'unavailable' }, { id: 'sunfly', phase: 'unavailable' }
  ]);
  await assert.rejects(sessions.connect('karafun'), /not available/);
  await assert.rejects(sessions.disconnect('party-tyme'), /not available/);
  await assert.rejects(sessions.connect('unknown' as 'karafun'), /Unknown/);
});

test('an approved adapter establishes and relinquishes its connection without exposing account details', async () => {
  let closed = 0;
  const sessions = new PaidProviderSessions({ karafun: { async connect() {
    return { accountEmail: 'not-for-status@example.invalid', secret: 'not-for-status', async disconnect() { closed++; } };
  } } });
  await sessions.connect('karafun');
  assert.deepEqual(sessions.status()[0], { id: 'karafun', phase: 'connected' });
  assert.doesNotMatch(JSON.stringify(sessions.status()), /not-for-status/);
  await sessions.disconnect('karafun');
  assert.equal(closed, 1);
  assert.equal(sessions.status()[0].phase, 'disconnected');
});

test('adapter failures report only a generic state and a fresh attempt is allowed', async () => {
  let calls = 0;
  const sessions = new PaidProviderSessions({ sunfly: { async connect() {
    if (++calls === 1) throw new Error('provider secret in unsafe error');
    return { async disconnect() {} };
  } } });
  await sessions.connect('sunfly');
  assert.deepEqual(sessions.status()[2], { id: 'sunfly', phase: 'error' });
  assert.doesNotMatch(JSON.stringify(sessions.status()), /secret/);
  await sessions.connect('sunfly');
  assert.equal(sessions.status()[2].phase, 'connected');
});

test('cancellation waits for an adapter that resolves late, then disconnects the returned handle', async () => {
  const late = deferred<PaidProviderConnection>();
  const close = deferred<void>();
  let signal: AbortSignal | undefined, disconnects = 0;
  const sessions = new PaidProviderSessions({ karafun: { async connect(received) { signal = received; return late.promise; } } });
  const connecting = sessions.connect('karafun');
  await Promise.resolve();
  const disconnecting = sessions.disconnect('karafun');
  assert.equal(signal?.aborted, true);
  assert.equal(sessions.status()[0].phase, 'disconnecting');
  await assert.rejects(sessions.connect('karafun'), /busy/);
  late.resolve({ async disconnect() { disconnects++; await close.promise; } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(sessions.status()[0].phase, 'disconnecting');
  close.resolve();
  await Promise.all([connecting, disconnecting]);
  assert.equal(disconnects, 1);
  assert.equal(sessions.status()[0].phase, 'disconnected');
});

test('immediate cancellation does not invoke the adapter', async () => {
  let calls = 0;
  const sessions = new PaidProviderSessions({ karafun: { async connect() { calls++; return { async disconnect() {} }; } } });
  const connecting = sessions.connect('karafun');
  await sessions.disconnect('karafun');
  await connecting;
  assert.equal(calls, 0);
  assert.equal(sessions.status()[0].phase, 'disconnected');
});

test('failed cleanup after a late connection keeps the handle for recovery', async () => {
  const late = deferred<PaidProviderConnection>(); let attempts = 0;
  const sessions = new PaidProviderSessions({ karafun: { async connect() { return late.promise; } } });
  const connecting = sessions.connect('karafun');
  await Promise.resolve();
  const disconnecting = sessions.disconnect('karafun');
  late.resolve({ async disconnect() { if (++attempts === 1) throw new Error('close failed'); } });
  await Promise.all([connecting, disconnecting]);
  assert.equal(sessions.status()[0].phase, 'recovery-required');
  await assert.rejects(sessions.connect('karafun'), /recovery/);
  await sessions.disconnect('karafun');
  assert.equal(attempts, 2);
  assert.equal(sessions.status()[0].phase, 'disconnected');
});

test('failed disconnect preserves the handle, prevents reconnect, and supports retry', async () => {
  let attempts = 0;
  const sessions = new PaidProviderSessions({ 'party-tyme': { async connect() { return { async disconnect() {
    if (++attempts === 1) throw new Error('sensitive provider detail');
  } }; } } });
  await sessions.connect('party-tyme');
  await sessions.disconnect('party-tyme');
  assert.equal(sessions.status()[1].phase, 'recovery-required');
  await assert.rejects(sessions.connect('party-tyme'), /recovery/);
  await sessions.disconnect('party-tyme');
  assert.equal(attempts, 2);
  assert.equal(sessions.status()[1].phase, 'disconnected');
});

test('simultaneous disconnect calls share one cleanup operation', async () => {
  const close = deferred<void>(); let calls = 0;
  const sessions = new PaidProviderSessions({ sunfly: { async connect() { return { async disconnect() { calls++; await close.promise; } }; } } });
  await sessions.connect('sunfly');
  const first = sessions.disconnect('sunfly'), second = sessions.disconnect('sunfly');
  assert.equal(sessions.status()[2].phase, 'disconnecting');
  close.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
