import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { rootCertificates } from 'node:tls';
import { test } from 'node:test';
import { startQuickTunnelDev } from '../../src/main/quick-tunnel-dev';
import { isQuickTunnelOrigin } from '../../src/main/quick-tunnel-loopback';

const certPath = resolve('tests/fixtures/tls/test-only.crt');
const cert = readFileSync(certPath), key = readFileSync('tests/fixtures/tls/test-only.key');
const origin = 'https://alpha-beta.trycloudflare.com';
class FakeProcess extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); pid = 12345;
  exitCode: number | null = null; signalCode: NodeJS.Signals | null = null; killed = false;
  kill() { this.killed = true; this.signalCode = 'SIGTERM'; queueMicrotask(() => this.emit('exit', null, 'SIGTERM')); return true; }
}
const settings = () => ({ enabled: true, executable: join(tmpdir(), 'cloudflared.exe'), caFile: certPath, cert, key,
  handler: async (_req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => { res.writeHead(200); res.end('ok'); return true; }, onFailure: () => {} });

function fetchLocal(port: number, path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, servername: 'localhost', ca: cert, method, path, agent: false, headers }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}

test('only exact random HTTPS quick-tunnel origins are accepted', () => {
  assert.equal(isQuickTunnelOrigin(origin), true);
  for (const bad of ['http://alpha.trycloudflare.com', 'https://alpha.trycloudflare.com.evil.test', 'https://user@alpha.trycloudflare.com',
    'https://alpha.trycloudflare.com:8443', 'https://alpha.trycloudflare.com/path', 'https://alpha.trycloudflare.com?x=1', 'https://alpha.trycloudflare.com#secret'])
    assert.equal(isQuickTunnelOrigin(bad), false, bad);
});

test('explicit opt-in supervises the connector and binds only its exact public origin', async () => {
  const child = new FakeProcess(); let childArgs: string[] = [], spawnOptions: any;
  let announce!: () => void;
  const spawned = new Promise<void>(resolve => { announce = resolve; });
  const fakeSpawn = ((_file: string, args: string[], options: unknown) => { childArgs = args; spawnOptions = options; announce(); return child as unknown as ChildProcess; });
  await assert.rejects(startQuickTunnelDev({ ...settings(), enabled: false }, fakeSpawn), /disabled/);
  let failures = 0;
  const starting = startQuickTunnelDev({ ...settings(), onFailure: () => { failures++; } }, fakeSpawn);
  await spawned;
  assert.equal(spawnOptions.shell, false); assert.equal(spawnOptions.windowsHide, true);
  assert.ok(!childArgs.includes('--no-tls-verify'));
  const url = new URL(childArgs[childArgs.indexOf('--url') + 1]);
  assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(spawnOptions.env.TUNNEL_TOKEN, undefined);
  const configPath = childArgs[childArgs.indexOf('--config') + 1];
  assert.equal(existsSync(configPath), true);
  assert.equal((await fetchLocal(Number(url.port), '/singer/', { host: new URL(origin).host })).status, 403);
  child.stderr.write('https://not-the-real-one.trycloudflare.com\n');
  child.stderr.write('Your quick Tunnel has been created! Visit it at:\n');
  child.stderr.write(`| ${origin} |\n`);
  const session = await starting;
  assert.equal(session.origin, origin);
  const goodHost = new URL(origin).host;
  assert.equal((await fetchLocal(Number(url.port), '/singer/', { host: goodHost })).status, 200);
  assert.equal((await fetchLocal(Number(url.port), '/singer/', { host: 'evil.example' })).status, 403);
  assert.equal((await fetchLocal(Number(url.port), '/singer/', { host: goodHost, origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetchLocal(Number(url.port), '/api/v1/snapshot', { host: goodHost }, 'POST')).status, 403);
  assert.equal((await fetchLocal(Number(url.port), '/api/v1/snapshot', { host: goodHost, origin }, 'POST')).status, 200);
  assert.equal((await fetchLocal(Number(url.port), '/api/v1/host/close', { host: goodHost, origin }, 'POST')).status, 404);
  assert.equal((await fetchLocal(Number(url.port), '/singer/?invite=secret', { host: goodHost })).status, 400);
  await Promise.all([session.stop(), session.stop()]);
  assert.equal(child.killed, true); assert.equal(failures, 0); assert.equal(existsSync(configPath), false);
  await assert.rejects(fetchLocal(Number(url.port), '/singer/', { host: goodHost }));
});

test('an untrusted local certificate prevents starting the connector', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-untrusted-'));
  let spawned = false;
  try {
    const caFile = join(dir, 'ca.pem'); writeFileSync(caFile, rootCertificates[0]);
    await assert.rejects(startQuickTunnelDev({ ...settings(), caFile }, () => { spawned = true; return new FakeProcess() as unknown as ChildProcess; }), /not trusted/);
    assert.equal(spawned, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a spoofed public hostname never becomes active and startup times out safely', async () => {
  const child = new FakeProcess(); let port = 0, spawned!: () => void;
  const ready = new Promise<void>(resolve => { spawned = resolve; });
  const fakeSpawn = ((_file: string, args: string[]) => { port = Number(new URL(args[args.indexOf('--url') + 1]).port); spawned(); return child as unknown as ChildProcess; });
  const pending = startQuickTunnelDev({ ...settings(), startupTimeoutMs: 100 }, fakeSpawn);
  await ready; child.stderr.write('Your quick Tunnel has been created!\nhttps://alpha.trycloudflare.com.evil.test\n');
  await assert.rejects(pending, /did not become ready/);
  assert.equal(child.killed, true);
  await assert.rejects(fetchLocal(port, '/singer/', { host: new URL(origin).host }));
});

test('anonymous requests are rate limited without trusting forwarded addresses', async () => {
  const child = new FakeProcess(); let port = 0, spawned!: () => void;
  const ready = new Promise<void>(resolve => { spawned = resolve; });
  const fakeSpawn = ((_file: string, args: string[]) => { port = Number(new URL(args[args.indexOf('--url') + 1]).port); spawned(); return child as unknown as ChildProcess; });
  const pending = startQuickTunnelDev(settings(), fakeSpawn);
  await ready; child.stderr.write(`Your quick Tunnel has been created!\n${origin}\n`);
  const session = await pending;
  try {
    for (let n = 0; n < 120; n++) assert.equal((await fetchLocal(port, '/singer/', { host: new URL(origin).host, 'x-forwarded-for': `192.0.2.${n % 255}` })).status, 200);
    assert.equal((await fetchLocal(port, '/singer/', { host: new URL(origin).host, 'x-forwarded-for': '192.0.2.254' })).status, 429);
  } finally { await session.stop(); }
});

test('abort during startup stops the connector and loopback service', async () => {
  const child = new FakeProcess(), controller = new AbortController(); let port = 0, spawned!: () => void;
  const ready = new Promise<void>(resolve => { spawned = resolve; });
  const fakeSpawn = ((_file: string, args: string[]) => { port = Number(new URL(args[args.indexOf('--url') + 1]).port); spawned(); return child as unknown as ChildProcess; });
  const pending = startQuickTunnelDev({ ...settings(), signal: controller.signal }, fakeSpawn);
  await ready; controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(child.killed, true);
  await assert.rejects(fetchLocal(port, '/singer/', { host: new URL(origin).host }));
});

test('unexpected connector exit closes the origin gate and reports failure', async () => {
  const child = new FakeProcess(); let port = 0, spawned!: () => void, failed!: () => void;
  const ready = new Promise<void>(resolve => { spawned = resolve; });
  const failure = new Promise<void>(resolve => { failed = resolve; });
  const fakeSpawn = ((_file: string, args: string[]) => { port = Number(new URL(args[args.indexOf('--url') + 1]).port); spawned(); return child as unknown as ChildProcess; });
  const pending = startQuickTunnelDev({ ...settings(), onFailure: failed }, fakeSpawn);
  await ready; child.stderr.write(`Your quick Tunnel has been created!\n${origin}\n`);
  const session = await pending;
  child.exitCode = 1; child.emit('exit', 1, null);
  await failure; await session.stop();
  await assert.rejects(fetchLocal(port, '/singer/', { host: new URL(origin).host }));
});

test('failed process termination is retryable and the loopback gate remains closed', async () => {
  const child = new FakeProcess(); let port = 0, spawned!: () => void, attempts = 0;
  const originalKill = child.kill.bind(child);
  child.kill = () => ++attempts === 1 ? false : originalKill();
  const ready = new Promise<void>(resolve => { spawned = resolve; });
  const fakeSpawn = ((_file: string, args: string[]) => { port = Number(new URL(args[args.indexOf('--url') + 1]).port); spawned(); return child as unknown as ChildProcess; });
  const pending = startQuickTunnelDev(settings(), fakeSpawn);
  await ready; child.stderr.write(`Your quick Tunnel has been created!\n${origin}\n`);
  const session = await pending;
  await assert.rejects(session.stop(), /cleanup failed/);
  await assert.rejects(fetchLocal(port, '/singer/', { host: new URL(origin).host }));
  await session.stop();
  assert.equal(attempts, 2); assert.equal(child.killed, true);
});

test('failure while the temporary directory is being created removes the late directory', async () => {
  let release!: () => void, announce!: () => void, reportError!: () => void, directory = '', spawned = false, gateClosed = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const prepared = new Promise<void>(resolve => { announce = resolve; });
  const runtime = {
    makeTemp: (async (prefix: string) => { directory = await mkdtemp(prefix); announce(); await gate; return directory; }) as typeof mkdtemp,
    openGate: (async (options: { onError: () => void }) => { reportError = options.onError; return { port: 1, bindOrigin: () => {}, close: async () => { gateClosed++; } }; }) as typeof import('../../src/main/quick-tunnel-loopback').startQuickTunnelLoopback,
  };
  const fakeSpawn = (() => { spawned = true; return new FakeProcess() as unknown as ChildProcess; });
  const pending = startQuickTunnelDev(settings(), fakeSpawn, runtime);
  await prepared; reportError(); release();
  await assert.rejects(pending, /cancelled/);
  assert.equal(gateClosed, 1); assert.equal(spawned, false); assert.equal(existsSync(directory), false);
});

test('repeated child process errors do not escape the supervisor', async () => {
  const child = new FakeProcess(); let spawned!: () => void, failed!: () => void;
  const ready = new Promise<void>(resolve => { spawned = resolve; });
  const failure = new Promise<void>(resolve => { failed = resolve; });
  const fakeSpawn = (() => { spawned(); return child as unknown as ChildProcess; });
  const pending = startQuickTunnelDev({ ...settings(), onFailure: failed }, fakeSpawn);
  await ready; child.stderr.write(`Your quick Tunnel has been created!\n${origin}\n`);
  const session = await pending;
  child.emit('error', new Error('first')); child.emit('error', new Error('second'));
  await failure; await session.stop(); assert.equal(child.killed, true);
});
