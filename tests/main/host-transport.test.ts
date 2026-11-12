import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostTransport, type TransportResult } from '../../src/main/host-transport';

test('simultaneous Play requests share one opening/start and a different action is refused', async () => {
  const transport = new HostTransport();
  let finish!: (result: TransportResult) => void, calls = 0;
  const start = () => { calls++; return new Promise<TransportResult>(resolve => { finish = resolve; }); };
  const first = transport.run('playPause', start);
  const second = transport.run('playPause', start);
  assert.equal(first, second); assert.equal(transport.busy(), true);
  assert.equal((await transport.run('restart', async () => { throw new Error('must not run'); })).ok, false);
  await Promise.resolve(); assert.equal(calls, 1);
  finish({ ok: true });
  assert.deepEqual(await first, { ok: true }); assert.deepEqual(await second, { ok: true }); assert.equal(transport.busy(), false);
});

test('failure releases the transport so deliberate later actions remain possible', async () => {
  const transport = new HostTransport();
  assert.deepEqual(await transport.run('restart', async () => { throw new Error('Singer display closed.'); }), { ok: false, error: 'Singer display closed.' });
  assert.equal(transport.busy(), false);
  assert.deepEqual(await transport.run('restart', async () => ({ ok: true })), { ok: true });
});
