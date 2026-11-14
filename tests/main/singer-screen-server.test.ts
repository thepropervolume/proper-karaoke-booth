import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type RequestOptions } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { SingerScreenFrameHub, SingerScreenServer, isLanSingerScreenPeer } from '../../src/main/singer-screen-server';

const jpeg = (label: string) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(label), Buffer.from([0xff, 0xd9])]);
async function until(predicate: () => boolean, message = 'Condition not reached', timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() >= deadline) assert.fail(message); await delay(5); }
}
async function fixture(run: (hub: SingerScreenFrameHub, server: SingerScreenServer, port: number) => Promise<void>, options = {}) {
  const hub = new SingerScreenFrameHub(), server = new SingerScreenServer(hub, options);
  const status = await server.start({ port: 0, bind: '127.0.0.1' });
  try { assert.equal(status.state, 'listening'); await run(hub, server, status.port!); }
  finally { await server.stop(); }
}
async function read(port: number, path: string, options: RequestOptions = {}) {
  return new Promise<{ response: IncomingMessage; body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', ...options }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ response, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}
async function openStream(port: number) {
  return new Promise<{ response: IncomingMessage; frames: Buffer[]; close: () => void }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/stream' }, response => {
      const frames: Buffer[] = []; let buffered = Buffer.alloc(0), started = false;
      const boundary = Buffer.from('--tpv-singer-frame\r\n'), nextPart = Buffer.from('\r\n--tpv-singer-frame\r\n');
      response.on('error', () => {});
      response.on('data', chunk => {
        buffered = Buffer.concat([buffered, chunk]);
        for (;;) {
          if (!started) {
            if (buffered.length < boundary.length) return;
            assert.ok(buffered.subarray(0, boundary.length).equals(boundary)); buffered = buffered.subarray(boundary.length); started = true;
          }
          const index = buffered.indexOf('\r\n\r\n'); if (index < 0) return;
          assert.match(buffered.subarray(0, index).toString(), /Content-Type: image\/jpeg/);
          const end = buffered.indexOf(nextPart, index + 4);
          if (end < 0) { assert.ok(buffered.length <= 2 * 1024 * 1024 + 1024); return; }
          const length = end - index - 4; assert.ok(length > 0 && length <= 2 * 1024 * 1024);
          frames.push(Buffer.from(buffered.subarray(index + 4, end))); buffered = buffered.subarray(end + nextPart.length);
        }
      });
      resolve({ response, frames, close: () => { response.destroy(); req.destroy(); } });
    });
    req.on('error', reject); req.end();
  });
}

test('frame hub validates bounded JPEG frames, isolates publisher mutation and clears all subscribers', () => {
  const hub = new SingerScreenFrameHub(), input = jpeg('lyrics'), seen: (number | null)[] = [];
  hub.subscribe(() => { throw new Error('Consumer failed'); });
  const unsubscribe = hub.subscribe(frame => seen.push(frame?.sequence ?? null));
  hub.publish({ jpeg: input, width: 1280, height: 720 }); input.fill(0);
  assert.deepEqual(hub.current?.jpeg, jpeg('lyrics'));
  assert.equal(hub.current?.width, 1280);
  hub.clear(); assert.equal(hub.current, null); assert.deepEqual(seen, [1, null]);
  unsubscribe(); hub.publish({ jpeg: jpeg('new'), width: 100, height: 100 }); assert.equal(seen.length, 2);
  for (const invalid of [Buffer.alloc(0), jpeg('x').subarray(0, 4), Buffer.alloc(2 * 1024 * 1024 + 1)])
    assert.throws(() => hub.publish({ jpeg: invalid, width: 100, height: 100 }), /Invalid/);
  assert.throws(() => hub.publish({ jpeg: jpeg('valid'), width: Infinity, height: 100 }));
  assert.throws(() => hub.publish({ jpeg: jpeg('valid'), width: 1, height: 0 }));
});

test('LAN peer classification excludes public internet addresses and trusts no forwarding headers', () => {
  for (const value of ['127.0.0.1', '10.1.2.3', '172.16.5.6', '172.31.255.2', '192.168.1.2', '169.254.1.1', '100.64.1.1', '::1', 'fc01::1', 'fe80::1%en0', '::ffff:192.168.1.2']) assert.equal(isLanSingerScreenPeer(value), true, value);
  for (const value of [undefined, '', 'example.com', '8.8.8.8', '45.79.137.117', '172.32.0.1', '100.128.0.1', '2001:4860:4860::8888', '0.0.0.0']) assert.equal(isLanSingerScreenPeer(value), false, value);
});

test('visual page fits its viewport, serves only its static assets and exposes no host API', async () => fixture(async (_hub, server, port) => {
  const page = await read(port, '/'); assert.equal(page.response.statusCode, 200);
  assert.match(page.body, /Live singer display/); assert.match(page.body, /Audio plays on the host/);
  assert.equal(page.response.headers['cross-origin-resource-policy'], 'same-origin');
  assert.match(String(page.response.headers['content-security-policy']), /default-src 'none'/);
  const css = await read(port, '/screen.css'); assert.match(css.body, /height:100dvh/); assert.match(css.body, /object-fit:contain/);
  const js = await read(port, '/screen.js'); assert.match(js.body, /frameAvailable/); assert.doesNotMatch(js.body, /localStorage|cookie|tpv-media/);
  const status = JSON.parse((await read(port, '/status')).body);
  assert.deepEqual(Object.keys(status).sort(), ['frameAvailable', 'streamId', 'viewers']);
  assert.equal(status.frameAvailable, false); assert.equal(status.viewers, 0); assert.match(status.streamId, /^[a-f0-9-]{36}$/);
  for (const route of ['/host', '/api', '/show.sqlite', '/settings.json', '/control-api.json', '/tpv-media']) assert.equal((await read(port, route)).response.statusCode, 404);
  assert.equal((await read(port, '/', { method: 'HEAD' })).body, '');
  assert.equal(server.status().urls[0], `http://127.0.0.1:${port}`);
}));

test('host, origin, method and body validation reject unintended access', async () => fixture(async (_hub, _server, port) => {
  for (const host of [`attacker.example:${port}`, `127.0.0.1:${port + 1}`, `example.com@127.0.0.1:${port}`]) assert.equal((await read(port, '/', { headers: { Host: host } })).response.statusCode, 403);
  assert.equal((await read(port, '/status', { headers: { Origin: 'https://attacker.example' } })).response.statusCode, 403);
  assert.equal((await read(port, '/status', { headers: { Origin: `http://127.0.0.1:${port}` } })).response.statusCode, 200);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await read(port, '/', { method })).response.statusCode, 405);
  assert.equal((await read(port, '/', { headers: { 'Content-Length': '1' } })).response.statusCode, 400);
  assert.equal((await read(port, '//attacker.example/')).response.statusCode, 400);
}));

test('multiple browser streams receive the same frames and clear replaces old lyrics with black', async () => fixture(async (hub, server, port) => {
  const a = await openStream(port), b = await openStream(port);
  try {
    await until(() => a.frames.length === 1 && b.frames.length === 1);
    const idle = a.frames[0]; assert.deepEqual(idle, b.frames[0]);
    assert.equal(server.status().viewers, 2);
    hub.publish({ jpeg: jpeg('same-lyrics'), width: 640, height: 360 });
    await until(() => a.frames.length === 2 && b.frames.length === 2);
    assert.deepEqual(a.frames[1], jpeg('same-lyrics')); assert.deepEqual(b.frames[1], a.frames[1]);
    assert.equal(JSON.parse((await read(port, '/status')).body).frameAvailable, true);
    hub.clear(); await until(() => a.frames.length === 3 && b.frames.length === 3);
    assert.deepEqual(a.frames[2], idle); assert.equal(JSON.parse((await read(port, '/status')).body).frameAvailable, false);
    a.close(); await until(() => server.status().viewers === 1);
    const replacement = await openStream(port);
    try { await until(() => replacement.frames.length === 1); assert.deepEqual(replacement.frames[0], idle); }
    finally { replacement.close(); }
  } finally { a.close(); b.close(); }
}));

test('the first idle JPEG has the next complete MIME header without waiting for a second capture', async () => fixture(async (hub, _server, port) => {
  const image = jpeg('one-deduplicated-idle-frame'); hub.publish({ jpeg: image, width: 640, height: 360 });
  const received: Buffer[] = [];
  const requestHandle = request({ hostname: '127.0.0.1', port, path: '/stream' });
  let response: IncomingMessage | undefined;
  requestHandle.on('response', value => { response = value; value.on('data', chunk => received.push(chunk)); value.on('error', () => {}); });
  requestHandle.on('error', () => {}); requestHandle.end();
  try {
    const boundary = Buffer.from('--tpv-singer-frame\r\nContent-Type: image/jpeg\r\n\r\n');
    await until(() => Buffer.concat(received).subarray(-boundary.length).equals(boundary), 'First JPEG was not followed by the next complete MIME header.');
    const bytes = Buffer.concat(received);
    assert.ok(bytes.subarray(0, boundary.length).equals(boundary));
    assert.equal(bytes.indexOf(image), bytes.indexOf('\r\n\r\n') + 4);
    assert.equal(bytes.indexOf(image) + image.length + 2 + boundary.length, bytes.length);
    assert.equal(hub.current?.sequence, 1, 'The browser receives complete framing without publishing a fake new frame.');
  } finally { response?.destroy(); requestHandle.destroy(); }
}));

test('viewer limit is explicit and a disconnected browser releases its place', async () => fixture(async (_hub, server, port) => {
  const first = await openStream(port);
  try { assert.equal((await read(port, '/stream')).response.statusCode, 503); }
  finally { first.close(); }
  await until(() => server.status().viewers === 0);
  const second = await openStream(port); second.close();
}, { maxViewers: 1 }));

test('large frames do not endlessly resend after normal drain and a slow viewer cannot retain unlimited frames', async () => fixture(async (hub, server, port) => {
  const viewer = await openStream(port);
  try {
    await until(() => viewer.frames.length === 1);
    const large = Buffer.alloc(1024 * 1024, 0x11); large.writeUInt16BE(0xffd8, 0); large.writeUInt16BE(0xffd9, large.length - 2);
    hub.publish({ jpeg: large, width: 1280, height: 720 });
    await until(() => viewer.frames.length >= 2);
    await delay(40); assert.equal(viewer.frames.length, 2, 'Drain must not create an unbounded repeat loop.');
    viewer.response.pause();
    for (let index = 0; index < 32 && server.status().viewers; index++) { hub.publish({ jpeg: large, width: 1280, height: 720 }); await delay(15); }
    await until(() => server.status().viewers === 0, 'Slow viewer was not disconnected', 5000);
  } finally { viewer.close(); }
}, { slowClientMs: 100 }));

test('rapid start/stop and reconfiguration serialize listener ownership and release the old port', async () => {
  const hub = new SingerScreenFrameHub(), server = new SingerScreenServer(hub);
  const start = server.start({ bind: '127.0.0.1', port: 0 }); const stop = server.stop();
  await start; await stop; assert.equal(server.status().state, 'stopped');
  try {
    const first = await server.start({ bind: '127.0.0.1', port: 0 });
    const stream = await openStream(first.port!);
    const next = await server.start({ bind: '127.0.0.1', port: 0 }); stream.close();
    assert.notEqual(next.port, first.port); assert.equal(server.status().viewers, 0);
    const probe = createServer(); await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(first.port!, '127.0.0.1', resolve); });
    await new Promise<void>(resolve => probe.close(() => resolve()));
  } finally { await server.stop(); }
});

test('a restarted listener changes its public stream generation while repeated start on the same listener does not', async () => {
  const server = new SingerScreenServer(new SingerScreenFrameHub());
  try {
    const first = await server.start({ bind: '127.0.0.1', port: 0 }), port = first.port!;
    const id = JSON.parse((await read(port, '/status', { agent: false })).body).streamId;
    await server.start({ bind: '127.0.0.1', port });
    assert.equal(JSON.parse((await read(port, '/status', { agent: false })).body).streamId, id);
    await server.stop(); await server.start({ bind: '127.0.0.1', port });
    assert.notEqual(JSON.parse((await read(port, '/status', { agent: false })).body).streamId, id);
  } finally { await server.stop(); }
});

test('the browser waits for a slow first image and reconnects when a listener restarts without resetting a pending image download', async () => fixture(async (_hub, _server, port) => {
  const source = (await read(port, '/screen.js')).body;
  let streamId = 'first-listener', nextId = 0;
  const listeners = new Map<string, () => void>(), timers = new Map<number, { callback: () => void; delay: number }>();
  const image = { naturalWidth: 0, complete: false, src: '/stream', addEventListener: (name: string, callback: () => void) => listeners.set(name, callback) };
  const waiting = { hidden: false }, message = { textContent: '' };
  const fire = (milliseconds: number) => {
    const found = [...timers].find(([, timer]) => timer.delay === milliseconds); assert.ok(found, `Missing ${milliseconds}ms timer.`);
    timers.delete(found[0]); found[1].callback();
  };
  runInNewContext(source, { document: { getElementById: (id: string) => id === 'screen' ? image : id === 'waiting' ? waiting : message },
    fetch: async () => ({ ok: true, json: async () => ({ frameAvailable: true, viewers: 1, streamId }) }), AbortController, Date,
    setTimeout: (callback: () => void, milliseconds: number) => { const id = ++nextId; timers.set(id, { callback, delay: milliseconds }); return id; },
    clearTimeout: (id: number) => timers.delete(id) });
  await delay(0);
  assert.ok(![...timers.values()].some(timer => timer.delay === 1500), 'An initial image still downloading must not be restarted.');
  assert.equal(image.src, '/stream');
  image.naturalWidth = 640; image.complete = true; listeners.get('load')!(); streamId = 'restarted-listener';
  fire(1000); await delay(0); assert.equal(waiting.hidden, false); fire(1500);
  assert.match(image.src, /^\/stream\?retry=/);
  image.naturalWidth = 0; image.complete = false; fire(1000); await delay(0);
  assert.ok(![...timers.values()].some(timer => timer.delay === 1500), 'The replacement image must be allowed to finish downloading.');
  image.naturalWidth = 640; image.complete = true; listeners.get('load')!(); fire(1000); await delay(0);
  assert.equal(waiting.hidden, true);
}));

test('port conflicts fail with an actionable error and a later start can recover', async () => fixture(async (_hub, _server, port) => {
  const other = new SingerScreenServer(new SingerScreenFrameHub());
  try {
    await assert.rejects(other.start({ bind: '127.0.0.1', port }), /already in use.*another port/);
    assert.equal(other.status().error, 'port-in-use');
    assert.equal((await other.start({ bind: '127.0.0.1', port: 0 })).state, 'listening');
    assert.equal(other.status().error, undefined);
  } finally { await other.stop(); }
}));

test('invalid start options never replace an existing listener', async () => fixture(async (_hub, server, port) => {
  await assert.rejects(server.start({ port: -1 }), /valid local/);
  await assert.rejects(server.start({ port: 4051, bind: 'attacker.example' }), /valid local/);
  assert.equal(server.status().port, port); assert.equal((await read(port, '/status')).response.statusCode, 200);
}));
