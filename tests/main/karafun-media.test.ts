import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { KaraFunMediaCache, type KaraFunMediaDescriptor } from '../../src/main/karafun-media';
import type { KaraFunKit } from '../../src/domain/karafun-kit';

const bytes = Buffer.from('A synthetic complete kit for acquisition tests');
const scope = 'a'.repeat(64), source = { provider: 'karafun' as const, catalog: 'catalog' as const, songId: '6229' };
const md5 = createHash('md5').update(bytes).digest('hex');
const descriptor: KaraFunMediaDescriptor = { url: 'https://cdnaws.recis.io/synthetic.kit?private=dummy', expectedBytes: bytes.length, md5 };
const parse = (data: Uint8Array) => { assert.deepEqual(Buffer.from(data), bytes); return { synthetic: true } as unknown as KaraFunKit; };
async function isolated(run: (dir: string) => Promise<void>) {
  const root = await realpath(tmpdir()), dir = await mkdtemp(join(root, 'tpv-native-cache-'));
  try { await run(dir); }
  finally {
    const actual = await realpath(dir);
    assert.equal(dirname(actual), root); assert.ok(basename(actual).startsWith('tpv-native-cache-'));
    await rm(actual, { recursive: true, force: true });
  }
}
const options = () => ({ signal: new AbortController().signal });

test('authorized cache publishes exact verified bytes and reuses them only after fresh authorization', async () => isolated(async dir => {
  let downloads = 0, authorizations = 0;
  const cache = new KaraFunMediaCache(dir, { parse, fetch: async () => { downloads++; return new Response(bytes); } });
  const authorize = async () => { authorizations++; return descriptor; };
  const first = await cache.prepare(source, scope, authorize, options());
  assert.deepEqual(await readFile(first.path), bytes); assert.equal(first.md5, md5);
  assert.equal(first.fingerprint, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(first.accountScope, scope); assert.equal(first.path.includes('private='), false);
  const second = await cache.prepare(source, scope, authorize, options());
  assert.equal(second.path, first.path); assert.equal(downloads, 1); assert.equal(authorizations, 2);
  assert.equal((await readdir(dirname(first.path))).some(name => name.startsWith('.prepare-')), false);
}));

test('a cached file never bypasses an authorization refusal', async () => isolated(async dir => {
  const cache = new KaraFunMediaCache(dir, { parse, fetch: async () => new Response(bytes) });
  const first = await cache.prepare(source, scope, async () => descriptor, options());
  await assert.rejects(cache.prepare(source, scope, async () => { throw new Error('Account not entitled'); }, options()), /not entitled/);
  assert.deepEqual(await readFile(first.path), bytes);
}));

test('changed/corrupt existing cache bytes are retained while a verified repair receives a new name', async () => isolated(async dir => {
  const cache = new KaraFunMediaCache(dir, { parse, fetch: async () => new Response(bytes) });
  const first = await cache.prepare(source, scope, async () => descriptor, options());
  await writeFile(first.path, 'keep these damaged bytes');
  const repaired = await cache.prepare(source, scope, async () => descriptor, options());
  assert.notEqual(repaired.path, first.path);
  assert.equal(await readFile(first.path, 'utf8'), 'keep these damaged bytes');
  const reused = await cache.prepare(source, scope, async () => descriptor, { ...options(), previousPath: repaired.path });
  assert.equal(reused.path, repaired.path);
}));

test('partial bytes, checksum failures and invalid containers leave no published or temporary files', async () => isolated(async dir => {
  for (const [index, body] of [bytes.subarray(0, 10), Buffer.from('x'.repeat(bytes.length))].entries()) {
    const root = join(dir, `case-${index}`), cache = new KaraFunMediaCache(root, { parse, fetch: async () => new Response(body) });
    await assert.rejects(cache.prepare(source, scope, async () => descriptor, options()));
    assert.deepEqual(await readdir(join(root, scope)), []);
  }
  const root = join(dir, 'parse'), cache = new KaraFunMediaCache(root, { parse: () => { throw new Error('bad format'); }, fetch: async () => new Response(bytes) });
  await assert.rejects(cache.prepare(source, scope, async () => descriptor, options()), /could not be prepared/);
  assert.deepEqual(await readdir(join(root, scope)), []);
}));

test('private descriptors cannot direct downloads to local, credential-bearing or foreign endpoints', async () => isolated(async dir => {
  let fetches = 0;
  const cache = new KaraFunMediaCache(dir, { parse, fetch: async () => { fetches++; throw new Error('must not run'); } });
  for (const url of ['http://cdnaws.recis.io/song.kit', 'https://127.0.0.1/song.kit', 'https://user:password@cdnaws.recis.io/song.kit', 'https://recis.io.evil.test/song.kit'])
    await assert.rejects(cache.prepare(source, scope, async () => ({ ...descriptor, url }), options()));
  assert.equal(fetches, 0); assert.deepEqual(await readdir(dir), []);
}));

test('redirects outside provider CDNs are rejected without forwarding account credentials', async () => isolated(async dir => {
  let calls = 0;
  const cache = new KaraFunMediaCache(dir, { parse, fetch: async (_url, init) => {
    calls++; assert.equal(init?.credentials, 'omit'); assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return new Response(null, { status: 302, headers: { Location: 'https://example.test/steal' } });
  } });
  await assert.rejects(cache.prepare(source, scope, async () => descriptor, options()));
  assert.equal(calls, 1); assert.deepEqual(await readdir(join(dir, scope)), []);
}));

test('sign-out cancellation releases a pending response read and removes only the owned partial file', async () => isolated(async dir => {
  const abort = new AbortController(); let streaming!: () => void;
  const begun = new Promise<void>(resolve => { streaming = resolve; });
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.subarray(0, 5)); } });
  const cache = new KaraFunMediaCache(dir, { parse, fetch: async () => new Response(body) });
  const preparing = cache.prepare(source, scope, async () => descriptor, { signal: abort.signal, progress(value) { if (value.phase === 'downloading' && value.received === 5) streaming(); } });
  await begun; abort.abort();
  await assert.rejects(preparing, /cancelled/);
  assert.deepEqual(await readdir(join(dir, scope)), []);
}));

test('accounts have separate private caches even for the same recording', async () => isolated(async dir => {
  const cache = new KaraFunMediaCache(dir, { parse, fetch: async () => new Response(bytes) });
  const first = await cache.prepare(source, scope, async () => descriptor, options());
  const second = await cache.prepare(source, 'b'.repeat(64), async () => descriptor, options());
  assert.notEqual(first.path, second.path); assert.notEqual(first.accountScope, second.accountScope);
}));
