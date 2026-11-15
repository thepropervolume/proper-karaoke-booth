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

test('Stop at intent cancels a not-yet-entered Play without invoking an asynchronous opener', async () => {
  const transport = new HostTransport(); let entered = false;
  const pending = transport.run('playPause', async () => { entered = true; return { ok: true }; });
  transport.cancel();
  assert.equal((await pending).ok, false); assert.equal(entered, false);
});

test('Stop during display readiness prevents delayed Play while concurrent clicks still share one operation', async () => {
  const transport = new HostTransport(); let ready!: () => void, generations = 0, opens = 0;
  const pending = transport.run('playPause', async current => {
    opens++; await new Promise<void>(resolve => { ready = resolve; });
    if (!current()) return { ok: false, error: 'Playback was cancelled.' };
    generations++; return { ok: true };
  });
  const repeated = transport.run('playPause', async () => { throw Error('Must share the opener.'); });
  assert.equal(pending, repeated); await Promise.resolve(); assert.equal(opens, 1);
  transport.cancel(); ready();
  assert.equal((await pending).ok, false); assert.equal((await repeated).ok, false); assert.equal(generations, 0);
  assert.equal((await transport.run('playPause', async current => { if (current()) generations++; return { ok: current() }; })).ok, true);
  assert.equal(generations, 1);
});

test('Pause while Previous awaits its seek never resumes the paused performance after acknowledgment', async () => {
  const transport = new HostTransport(); let acknowledge!: () => void, resumed = false;
  const restart = transport.run('restart', async current => {
    await new Promise<void>(resolve => { acknowledge = resolve; });
    if (!current()) return { ok: false, error: 'Playback was cancelled.' };
    resumed = true; return { ok: true };
  });
  await Promise.resolve(); transport.cancel(); acknowledge();
  assert.equal((await restart).ok, false); assert.equal(resumed, false);
});

test('direct start and resume captures share cancellation with coalesced host transport operations', () => {
  const transport = new HostTransport(), pendingStart = transport.capture(), pendingResume = transport.capture();
  assert.equal(pendingStart(), true); transport.cancel();
  assert.equal(pendingStart(), false); assert.equal(pendingResume(), false); assert.equal(transport.capture()(), true);
});
