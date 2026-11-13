import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectKaraFunBusiness, karaFunBusinessExitCode, runKaraFunBusinessCheck } from '../../src/main/karafun-business-client';

const secret = 'fixture.private.business_token';
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const checked = (devices: any, roomTokens = devices) => ({ status: 'checked' as const, devices, roomTokens });

test('uses only the two documented official GETs and returns counts without account details', async () => {
  const calls: string[] = [];
  const result = await inspectKaraFunBusiness(secret, { fetch: async (input, init) => {
    const url = String(input); calls.push(url);
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${secret}`); assert.equal(url.includes(secret), false);
    return url.endsWith('/device/list') ? json([{ id: 123, name: 'Private room', active: false }]) : json({ tokens: [{ id: 789, device_id: 123, name: 'Private token', token: 'server-should-not-return-this' }], count: 1 });
  } });
  assert.deepEqual(calls.sort(), ['https://api.business.karafun.com/device/list', 'https://api.business.karafun.com/karafun-api-token/list']);
  assert.deepEqual(result, checked({ status: 'ok', count: 1 })); assert.equal(karaFunBusinessExitCode(result), 0);
  assert.doesNotMatch(JSON.stringify(result), /Private|123|789|server-should|fixture/);
});

test('402 and endpoint-specific 403 do not claim a valid credential or playback access', async () => {
  const result = await inspectKaraFunBusiness(secret, { fetch: async input => new Response(`private ${secret}`, { status: String(input).endsWith('/device/list') ? 402 : 403 }) });
  assert.deepEqual(result, checked({ status: 'payment-required' }, { status: 'room-api-not-enabled' })); assert.equal(karaFunBusinessExitCode(result), 2);
  const forbidden = await inspectKaraFunBusiness(secret, { fetch: async () => new Response('private account details', { status: 403 }) });
  assert.deepEqual(forbidden, checked({ status: 'forbidden' }, { status: 'room-api-not-enabled' })); assert.equal(karaFunBusinessExitCode(forbidden), 8);
});

test('classifies auth, rate limit and redirects with no retries or provider details', async () => {
  for (const [status, expected, exit] of [[401, 'unauthorized', 3], [429, 'rate-limited', 4], [302, 'unavailable', 5], [500, 'unavailable', 5]] as const) {
    let calls = 0;
    const result = await inspectKaraFunBusiness(secret, { fetch: async () => { calls++; return new Response(secret, { status }); } });
    assert.deepEqual(result, checked({ status: expected })); assert.equal(calls, 2); assert.equal(karaFunBusinessExitCode(result), exit); assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('invalid header credentials and timeout configuration never cause a network request', async () => {
  let calls = 0; const fetch = async () => { calls++; throw new Error('unexpected'); };
  for (const token of ['', 'Bearer abc', 'a\nb', 'a\rb', 'a b', 'x'.repeat(8193), 'nonascii-ö']) {
    assert.deepEqual(await inspectKaraFunBusiness(token, { fetch }), { status: 'invalid-credential' });
  }
  for (const timeoutMs of [0, Infinity, 60001]) assert.deepEqual(await inspectKaraFunBusiness(secret, { fetch, timeoutMs }), { status: 'configuration-error' });
  assert.equal(calls, 0);
});

test('rejects malformed schemas, bodies, oversized data and mismatched token counts', async () => {
  const malformed = await inspectKaraFunBusiness(secret, { fetch: async input => String(input).endsWith('/device/list') ? json([{ id: 'bad' }]) : json({ tokens: [], count: 3 }) });
  assert.deepEqual(malformed, checked({ status: 'invalid-response' })); assert.equal(karaFunBusinessExitCode(malformed), 6);
  for (const body of ['{', 'x'.repeat(256 * 1024 + 1)]) assert.deepEqual(await inspectKaraFunBusiness(secret, { fetch: async () => new Response(body) }), checked({ status: 'invalid-response' }));
  assert.deepEqual(await inspectKaraFunBusiness(secret, { fetch: async () => new Response('{}', { headers: { 'content-length': String(256 * 1024 + 1) } }) }), checked({ status: 'invalid-response' }));
});

test('timeouts bound both a hung request and a streaming response without exposing errors', async () => {
  assert.deepEqual(await inspectKaraFunBusiness(secret, { timeoutMs: 10, fetch: async () => new Promise<Response>(() => {}) }), checked({ status: 'timed-out' }));
  let cancelled = 0;
  const result = await inspectKaraFunBusiness(secret, { timeoutMs: 10, fetch: async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled++; } })) });
  assert.deepEqual(result, checked({ status: 'timed-out' })); assert.equal(cancelled, 2);
  assert.deepEqual(await inspectKaraFunBusiness(secret, { fetch: async () => { throw new Error(secret); } }), checked({ status: 'unavailable' }));
});

test('reads a bounded private token file only for the injected inspector; rejects unsafe files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-karafun-check-')), file = join(dir, 'token'); let calls = 0;
  const inspect = async (token: string) => { calls++; assert.equal(token, secret); return checked({ status: 'ok', count: 0 }); };
  try {
    writeFileSync(file, secret + '\r\n', { mode: 0o600 }); assert.deepEqual(await runKaraFunBusinessCheck(file, inspect), checked({ status: 'ok', count: 0 }));
    for (const invalid of [undefined, 'relative', dir, join(dir, 'missing')]) assert.deepEqual(await runKaraFunBusinessCheck(invalid, inspect), { status: 'configuration-error' });
    if (process.platform !== 'win32') {
      const link = join(dir, 'link'); symlinkSync(file, link); assert.deepEqual(await runKaraFunBusinessCheck(link, inspect), { status: 'configuration-error' });
      chmodSync(file, 0o644); assert.deepEqual(await runKaraFunBusinessCheck(file, inspect), { status: 'configuration-error' }); chmodSync(file, 0o600);
    }
    for (const value of [Buffer.alloc(8193, 65), Buffer.from('a\nb'), Buffer.from([0xff])]) { writeFileSync(file, value); assert.deepEqual(await runKaraFunBusinessCheck(file, inspect), { status: 'configuration-error' }); }
    assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI help, invalid arguments and missing configuration never expose supplied values', () => {
  const args = ['--import', 'tsx', 'scripts/karafun-business-check.ts'];
  const help = spawnSync(process.execPath, [...args, '--help'], { encoding: 'utf8', env: { ...process.env, TPV_KARAFUN_BUSINESS_TOKEN_FILE: 'never-read-this' } });
  assert.equal(help.status, 0); assert.match(help.stdout, /TPV_KARAFUN_BUSINESS_TOKEN_FILE/); assert.doesNotMatch(help.stdout + help.stderr, /never-read-this/);
  const bad = spawnSync(process.execPath, [...args, secret], { encoding: 'utf8' }); assert.equal(bad.status, 7); assert.deepEqual(JSON.parse(bad.stdout), { status: 'configuration-error' }); assert.equal((bad.stdout + bad.stderr).includes(secret), false);
  const missing = spawnSync(process.execPath, [...args, 'status'], { encoding: 'utf8', env: { ...process.env, TPV_KARAFUN_BUSINESS_TOKEN_FILE: '' } }); assert.equal(missing.status, 7); assert.deepEqual(JSON.parse(missing.stdout), { status: 'configuration-error' });
});
