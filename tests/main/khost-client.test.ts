import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { KHostBridgeClient, parseKHostBridgeProfile, readKHostBridgeProfile } from '../../src/main/khost-client';
import { ownerOnlyDiscoveryAccess } from '../../src/control/discovery';

const profile = { baseUrl: 'http://127.0.0.1:4052', token: 'a'.repeat(64) };
const resultId = randomUUID(), requestId = randomUUID();
const status = { application: 'tpv-khost-bridge', apiVersion: 1, companion: 'KHost', provider: 'karafun',
  providerAvailable: true, externalPlayback: true, embeddedPlayback: false, acquisition: false };
const song = { resultId, providerSongId: '12345', title: 'Song', artist: 'Artist', durationSeconds: 180, canHandoff: true };
const search = { status: 'ready', songs: [song], externalPlayback: true, embeddedPlayback: false };
const handoff = { status: 'handed-off', requestId, state: 'pending', playback: 'external-khost', queueMayHaveChanged: true };
const json = (value: unknown, code = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value),
  { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-TPV-KHost-Bridge': '1', ...headers } });

test('KHost profile accepts only canonical literal loopback and its own random token', () => {
  assert.deepEqual(parseKHostBridgeProfile(profile), profile);
  assert.deepEqual(parseKHostBridgeProfile({ ...profile, baseUrl: profile.baseUrl + '/' }), profile);
  for (const baseUrl of ['https://127.0.0.1:4052', 'http://localhost:4052', 'http://127.1:4052', 'http://[::1]:4052',
    'http://127.0.0.1', 'http://127.0.0.1:80', 'http://127.0.0.1:4052/v1', 'http://127.0.0.1:4052?token=private',
    'http://user:password@127.0.0.1:4052', 'http://127.0.0.1:4052#fragment', 'http://192.168.1.2:4052'])
    assert.throws(() => parseKHostBridgeProfile({ ...profile, baseUrl }));
  for (const value of [null, [], { ...profile, password: 'private' }, { ...profile, token: 'short' }, { ...profile, token: 'X'.repeat(64) }])
    assert.throws(() => parseKHostBridgeProfile(value));
});

test('status is authenticated without redirects/cookies and never advertises native playback', async () => {
  let calls = 0;
  const client = new KHostBridgeClient({ ...profile, fetch: async (url, options) => {
    calls++; assert.equal(url, profile.baseUrl + '/v1/status'); assert.equal(options?.method, 'GET');
    assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer ' + profile.token);
    assert.equal(options?.body, undefined); return json({ ...status, password: 'untrusted ignored data' });
  } });
  const result = await client.status(); assert.equal(result.status, 'ready'); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /password|untrusted|aaaaaa|127\.0\.0\.1/);
  if (result.status === 'ready') { assert.equal(result.embeddedPlayback, false); assert.equal(result.acquisition, false); }
});

test('search projects only bounded metadata and never downloads or queues', async () => {
  const calls: { url: string; method: string }[] = [];
  const client = new KHostBridgeClient({ ...profile, fetch: async (url, options) => {
    calls.push({ url: String(url), method: options?.method ?? '' }); assert.deepEqual(JSON.parse(options?.body as string), { query: 'Artist Song' });
    return json({ ...search, songs: [{ ...song, sourcePath: '/private/media.kit', token: 'secret' }] });
  } });
  assert.deepEqual(await client.search(' Artist Song '), search);
  assert.deepEqual(calls, [{ url: profile.baseUrl + '/v1/search', method: 'POST' }]);
});

test('invalid queries and IDs never contact the companion', async () => {
  let calls = 0;
  const client = new KHostBridgeClient({ ...profile, fetch: async () => { calls++; return json({}); } });
  for (const query of ['', 'x', 'a'.repeat(201), 'song\nprivate', null, 10]) assert.deepEqual(await client.search(query), { status: 'invalid-request' });
  assert.deepEqual(await client.handoff('../song', requestId), { status: 'invalid-request' });
  assert.deepEqual(await client.handoff(resultId, 'wrong-id'), { status: 'invalid-request' });
  assert.deepEqual(await client.handoffStatus('http://remote.example'), { status: 'invalid-request' });
  assert.equal(calls, 0);
});

test('explicit handoff keeps one caller request ID and polling does not replay it', async () => {
  const calls: string[] = [];
  const client = new KHostBridgeClient({ ...profile, fetch: async (url, options) => {
    calls.push(options?.method + ' ' + url);
    if (options?.method === 'POST') assert.deepEqual(JSON.parse(options.body as string), { resultId, requestId });
    return json({ ...handoff, state: options?.method === 'POST' ? 'pending' : 'complete' }, options?.method === 'POST' ? 202 : 200);
  } });
  assert.deepEqual(await client.handoff(resultId, requestId), handoff);
  assert.deepEqual(await client.handoffStatus(requestId), { ...handoff, state: 'complete' });
  assert.deepEqual(calls, ['POST ' + profile.baseUrl + '/v1/handoff', 'GET ' + profile.baseUrl + '/v1/handoffs/' + requestId]);
});

test('ambiguous handoff failure retains the request ID and never automatically retries', async () => {
  let calls = 0;
  const client = new KHostBridgeClient({ ...profile, fetch: async () => { calls++; throw Error('private ' + profile.token); } });
  assert.deepEqual(await client.handoff(resultId, requestId), { status: 'unavailable', requestId, mayHaveBeenAccepted: true });
  assert.equal(calls, 1);
});

test('companion errors are bounded public statuses with no raw error detail', async () => {
  for (const [code, error, expected] of [[401, 'unauthorized', 'unauthorized'], [429, 'busy', 'busy'],
    [409, 'expired-result', 'expired-result'], [409, 'idempotency-conflict', 'idempotency-conflict'],
    [503, 'raw private stack trace', 'unavailable']] as const) {
    const client = new KHostBridgeClient({ ...profile, fetch: async () => json({ status: error, token: profile.token }, code) });
    assert.deepEqual(await client.search('song'), { status: expected });
  }
});

test('wrong protocol identities and capability claims fail closed', async () => {
  for (const value of [{ ...status, apiVersion: 2 }, { ...status, application: 'another-service' },
    { ...status, embeddedPlayback: true }, { ...status, acquisition: true }, { ...status, provider: 'unknown' }]) {
    assert.deepEqual(await new KHostBridgeClient({ ...profile, fetch: async () => json(value) }).status(), { status: 'protocol-error' });
  }
  assert.deepEqual(await new KHostBridgeClient({ ...profile, fetch: async () => json(status, 200, { 'X-TPV-KHost-Bridge': 'other' }) }).status(), { status: 'protocol-error' });
});

test('malformed, excessive and duplicate search rows cannot reach the renderer', async () => {
  for (const songs of [[{ ...song, title: '<bad>\nprivate' }], [{ ...song, providerSongId: 'http://private.example' }],
    [{ ...song, durationSeconds: -1 }], [{ ...song, durationSeconds: 'Infinity' }], [{ ...song, resultId: 'not-a-guid' }],
    [{ ...song, canHandoff: 'yes' }], [song, song], Array.from({ length: 21 }, () => ({ ...song, resultId: randomUUID() }))]) {
    assert.deepEqual(await new KHostBridgeClient({ ...profile, fetch: async () => json({ ...search, songs }) }).search('song'), { status: 'protocol-error' });
  }
});

test('oversized and invalid response bodies are rejected without returning them', async () => {
  for (const response of [json({ huge: 'a'.repeat(140_000) }), new Response('bad json', { headers: { 'Content-Type': 'application/json', 'X-TPV-KHost-Bridge': '1' } }),
    new Response('private html', { headers: { 'Content-Type': 'text/html', 'X-TPV-KHost-Bridge': '1' } })]) {
    assert.deepEqual(await new KHostBridgeClient({ ...profile, fetch: async () => response }).status(), { status: 'protocol-error' });
  }
});

test('deadlines bound an uncooperative companion transport and abort its request', async () => {
  let signal: AbortSignal | null | undefined;
  const client = new KHostBridgeClient({ ...profile, timeoutMs: 20, fetch: async (_url, options) => {
    signal = options?.signal; return new Promise<Response>(() => {});
  } });
  assert.deepEqual(await client.status(), { status: 'unavailable' }); assert.equal(signal?.aborted, true);
});

async function fixture(run: (path: string, directory: string) => Promise<void>) {
  const root = await realpath(tmpdir()), directory = await realpath(await mkdtemp(join(root, 'tpv-khost-client-test-')));
  try { await run(join(directory, 'connection.json'), directory); }
  finally {
    const actual = await realpath(directory);
    assert.equal(dirname(actual), root); assert.ok(basename(actual).startsWith('tpv-khost-client-test-'));
    await rm(actual, { recursive: true, force: true });
  }
}
test('a real native owner-only profile can be read and extra fields are rejected', async () => fixture(async path => {
  await writeFile(path, JSON.stringify(profile), { mode: 0o600 }); await ownerOnlyDiscoveryAccess.protect(path, false);
  assert.deepEqual(await readKHostBridgeProfile(path), profile);
  await writeFile(path, JSON.stringify({ ...profile, password: 'private' }));
  await assert.rejects(readKHostBridgeProfile(path), /owner-only connection JSON/);
}));
test('read refuses a profile swapped during the asynchronous permission check', async () => fixture(async (path, directory) => {
  await writeFile(path, JSON.stringify(profile), { mode: 0o600 }); let reads = 0;
  await assert.rejects(readKHostBridgeProfile(path, { verify: async () => {
    if (++reads === 1) { await rename(path, join(directory, 'old.json')); await writeFile(path, JSON.stringify(profile)); }
  } }), /owner-only connection JSON/);
}));
test('non-owner permission verification failures never reveal the token or path', async () => fixture(async path => {
  await writeFile(path, JSON.stringify(profile), { mode: 0o600 });
  await assert.rejects(readKHostBridgeProfile(path, { verify: async () => { throw Error(path + ' ' + profile.token); } }),
    error => error instanceof Error && !error.message.includes(path) && !error.message.includes(profile.token));
}));
test('profile symlinks are refused', { skip: process.platform === 'win32' ? 'POSIX symlink creation fixture' : false }, async () => fixture(async (path, directory) => {
  const target = join(directory, 'target.json'); await writeFile(target, JSON.stringify(profile), { mode: 0o600 }); await symlink(target, path);
  await assert.rejects(readKHostBridgeProfile(path), /owner-only connection JSON/);
}));
