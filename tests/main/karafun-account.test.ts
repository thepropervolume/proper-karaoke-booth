import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KaraFunAccount, KaraFunAccountError } from '../../src/main/karafun-account';

const envelope = (value: string) => new Response(`<response status="ok">${value}</response>`, { headers: { 'content-type': 'application/xml' } });
const session = () => envelope('<session key="fixture-only-key"/>');
const tracks = () => envelope('<song id="23" len="181"><title>Popular &amp; Loud</title><artist>Sample Artist</artist></song>');
const source = { catalog: 'catalog' as const, songId: '23' };
const authorize = () => envelope('<song><stream>https://kf.assets.recis.io/song.kit?ticket=fixture-only-ticket</stream><md5>0123456789abcdef0123456789abcdef</md5><filesize>120</filesize></song>');
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('native account validates its session, enriches bounded search results and keeps all secret material private', async () => {
  const requests: string[] = [], account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-only-key', clientId: '6' }), fetch: async input => {
    const url = new URL(String(input)); requests.push(url.pathname);
    if (url.pathname === '/session/info') return session();
    if (url.pathname === '/search/top') return envelope('<list><song id="23"/><song id="23"/><community id="24"/><song id="invalid"/></list>');
    if (url.pathname === '/song/info') return tracks();
    if (url.pathname === '/song/request') return authorize();
    throw Error('Unexpected fixture endpoint');
  } });
  assert.equal((await account.connect()).state, 'connected');
  assert.match(account.accountScope()!, /^[a-f0-9]{64}$/);
  const songs = await account.search('Popular');
  assert.deepEqual(songs, [{ songId: '23', catalog: 'catalog', title: 'Popular & Loud', artist: 'Sample Artist', durationSeconds: 181, explicit: null }]);
  const descriptor = await account.requestMedia(source);
  assert.equal(descriptor.expectedBytes, 120); assert.equal(descriptor.accountScope, account.accountScope());
  assert.equal(descriptor.revision, account.revision());
  assert.deepEqual(requests, ['/session/info', '/search/top', '/song/info', '/song/request']);
  assert.doesNotMatch(JSON.stringify(account.status()), /fixture|https|sessionKey|clientId|accountScope/);
  await account.disconnect(); assert.equal(account.accountScope(), null);
});

test('concurrent connect is single-flight and a late sign-in cannot restore credentials after sign-out', async () => {
  const opened = deferred<{ sessionKey: string; dispose(): void }>(); let calls = 0, disposed = 0;
  const account = new KaraFunAccount({ authenticate: () => { calls++; return opened.promise; }, fetch: async () => session() });
  const first = account.connect(), second = account.connect(); assert.equal(calls, 1);
  await account.disconnect(); opened.resolve({ sessionKey: 'late-fixture-key', dispose: () => { disposed++; } });
  await Promise.all([first, second]); assert.equal(account.status().state, 'disconnected'); assert.equal(account.accountScope(), null); assert.equal(disposed, 1);
});

test('expired sessions revoke their account scope, notify the host, and do not retry with stored passwords', async () => {
  let disposed = 0, requests = 0; const states: string[] = [];
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key', dispose: () => { disposed++; } }), onChange: value => { states.push(value.state); }, fetch: async () => ++requests === 1 ? session() : new Response('<response status="error"><error action="restart">INVALID_SESSION</error></response>') });
  await account.connect();
  await assert.rejects(account.search('Popular'), error => error instanceof KaraFunAccountError && error.code === 'expired');
  assert.equal(requests, 2); assert.equal(disposed, 1); assert.equal(account.accountScope(), null);
  assert.deepEqual(states, ['connecting', 'connected', 'expired']);
});

test('an old delayed search cannot return rows after account replacement or expire the replacement session', async () => {
  const response = deferred<Response>(); let count = 0;
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key' }), fetch: async input => new URL(String(input)).pathname === '/search/top' ? response.promise : (++count, session()) });
  await account.connect(); const oldScope = account.accountScope(); const oldSearch = account.search('Popular');
  await account.disconnect(); await account.connect(); assert.notEqual(account.accountScope(), oldScope);
  response.resolve(new Response('<response status="error"><error>INVALID_SESSION</error></response>'));
  await assert.rejects(oldSearch); assert.equal(account.status().state, 'connected'); assert.equal(count, 2);
});

test('caller cancellation cancels a stalled response reader and retains the valid signed-in session', async () => {
  let cancelled = false, first = true; const pending = deferred<void>();
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key' }), fetch: async () => {
    if (first) { first = false; return session(); }
    return new Response(new ReadableStream<Uint8Array>({ start() { pending.resolve(); }, cancel() { cancelled = true; } }));
  } });
  await account.connect(); const stop = new AbortController(), search = account.search('Popular', stop.signal); await pending.promise; stop.abort();
  await assert.rejects(search, error => error instanceof KaraFunAccountError && error.code === 'cancelled');
  assert.equal(cancelled, true); assert.equal(account.status().state, 'connected');
});

test('unconfirmed community recordings, malformed IDs and unsafe media descriptors are refused without losing local show authority', async () => {
  let reply = authorize(), calls = 0;
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key' }), fetch: async input => { calls++; return new URL(String(input)).pathname === '/session/info' ? session() : reply; } });
  await account.connect();
  await assert.rejects(account.requestMedia({ catalog: 'community', songId: '23' }));
  await assert.rejects(account.requestMedia({ catalog: 'catalog', songId: '../23' })); assert.equal(calls, 1);
  for (const url of ['http://kf.assets.recis.io/a.kit', 'https://attacker.invalid/a.kit', 'https://user:pass@kf.assets.recis.io/a.kit']) {
    reply = envelope(`<song><stream>${url}</stream><md5>0123456789abcdef0123456789abcdef</md5></song>`);
    await assert.rejects(account.requestMedia(source), error => error instanceof KaraFunAccountError && error.code === 'invalid-response');
  }
  reply = new Response('account private error fixture-only-key https://provider.invalid/private', { status: 403 });
  await assert.rejects(account.requestMedia(source), error => error instanceof KaraFunAccountError && error.code === 'not-entitled' && !error.message.includes('fixture-only-key'));
  assert.equal(account.status().state, 'connected');
});

test('failed official authentication or invalid session material is disposed and never leaked in public status', async () => {
  for (const bad of [{ sessionKey: 'private credential with spaces' }, { sessionKey: 'fixture-key', clientId: 'spoofed-client' }]) {
    let disposed = 0, calls = 0;
    const account = new KaraFunAccount({ authenticate: async () => ({ ...bad, dispose: () => { disposed++; } }), fetch: async () => { calls++; return session(); } });
    assert.equal((await account.connect()).state, 'disconnected'); assert.equal(calls, 0); assert.equal(disposed, 1);
    assert.doesNotMatch(JSON.stringify(account.status()), /private credential|spoofed-client|fixture-key/);
  }
  const account = new KaraFunAccount({ authenticate: async () => { throw new Error('private password and private session key'); } });
  const status = await account.connect(); assert.equal(status.state, 'disconnected'); assert.doesNotMatch(JSON.stringify(status), /private password|private session/);
});

test('public status is a detached projection, observer failures do not break sign-in, and new sign-ins get distinct scopes', async () => {
  let disposed = 0;
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key', dispose: () => { disposed++; } }), fetch: async () => session(), onChange: () => { throw new Error('closed view'); } });
  await account.connect(); const scope = account.accountScope(); const revision = account.revision();
  const copy = account.status(); copy.state = 'expired'; copy.message = 'mutated'; assert.equal(account.status().state, 'connected'); assert.equal(account.status().message, undefined);
  await account.disconnect(); assert.equal(disposed, 1); assert.equal(account.accountScope(), null); assert.ok(account.revision() > revision);
  await account.connect(); assert.notEqual(account.accountScope(), scope); await account.disconnect(); assert.equal(disposed, 2);
});

test('a cancelled sign-in cannot open a native session or publish connected after the caller aborts', async () => {
  const ready = deferred<{ sessionKey: string; dispose(): void }>(); let disposed = 0, calls = 0;
  const account = new KaraFunAccount({ authenticate: () => ready.promise, fetch: async () => { calls++; return session(); } });
  const controller = new AbortController(), connected = account.connect(undefined, controller.signal); controller.abort();
  ready.resolve({ sessionKey: 'fixture-key', dispose: () => { disposed++; } }); await connected;
  assert.equal(calls, 0); assert.equal(disposed, 1); assert.equal(account.status().state, 'disconnected'); assert.equal(account.accountScope(), null);
});

test('HTTP authorization failures have distinct session and recording effects and never expose provider bodies', async () => {
  let status = 403, disposed = 0, expired = false;
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key', dispose: () => { disposed++; } }),
    fetch: async input => new URL(String(input)).pathname === '/session/info'
      ? (expired ? new Response(null, { status: 401 }) : session()) : new Response('private provider fixture-key', { status }) });
  await account.connect(); const scope = account.accountScope();
  await assert.rejects(account.search('Popular'), error => error instanceof KaraFunAccountError && error.code === 'unavailable' && !error.message.includes('fixture-key'));
  assert.equal(account.accountScope(), scope); assert.equal(disposed, 0);
  status = 401;
  await assert.rejects(account.search('Popular'), { code: 'unavailable' });
  assert.equal(account.accountScope(), scope);
  assert.equal(disposed, 0);
  expired = true;
  await assert.rejects(account.search('Popular'), { code: 'expired' });
  assert.equal(account.status().state, 'expired'); assert.equal(account.accountScope(), null); assert.equal(disposed, 1);
  for (const status of [402, 403]) {
    let first = true;
    const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key' }), fetch: async () => { if (first) { first = false; return session(); } return new Response('private billing fixture-key', { status }); } });
    await account.connect(); const scope = account.accountScope();
    await assert.rejects(account.requestMedia(source), error => error instanceof KaraFunAccountError && error.code === 'not-entitled' && !error.message.includes('fixture-key'));
    assert.equal(account.status().state, 'connected'); assert.equal(account.accountScope(), scope); await account.disconnect();
  }
});

test('temporary API failure preserves account state and a later search can recover without password retries', async () => {
  let temporary = true, logins = 0;
  const account = new KaraFunAccount({ authenticate: async () => { logins++; return { sessionKey: 'fixture-key' }; }, fetch: async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/session/info') return session();
    if (temporary) return new Response('private provider fixture-key', { status: 503 });
    return path === '/search/top' ? envelope('<list><song id="23"/></list>') : tracks();
  } });
  await account.connect(); const scope = account.accountScope(); await assert.rejects(account.search('Popular'), { code: 'unavailable' });
  assert.equal(account.status().state, 'connected'); assert.equal(account.accountScope(), scope);
  temporary = false; assert.equal((await account.search('Popular')).length, 1); assert.equal(logins, 1); await account.disconnect();
});

test('bounded search enrichment ignores unrelated or malformed records and preserves unknown classifications', async () => {
  const requests: URL[] = [];
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key' }), fetch: async input => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname === '/session/info') return session();
    if (url.pathname === '/search/top') return envelope('<list>' + Array.from({ length: 30 }, (_, i) => `<song id="${i + 1}"/>`).join('') + '<community id="99"/></list>');
    return envelope('<song id="1" title="Clean" artist="Artist" len="180" explicit="0"/><song id="1" title="Duplicate"/><song id="2" title="Explicit" explicit="true" len="Infinity"/><song id="3" title="Unknown" explicit="possibly"/><song id="4" title=""/><song id="99" title="Unrequested"/><song id="invalid" title="Bad ID"/>');
  } });
  await account.connect();
  const results = await account.search('  Popular  ');
  assert.deepEqual(results.map(item => [item.songId, item.title, item.explicit, item.durationSeconds]), [['1', 'Clean', false, 180], ['2', 'Explicit', true, null], ['3', 'Unknown', null, null]]);
  assert.equal(requests.find(url => url.pathname === '/search/top')!.searchParams.get('query'), 'Popular');
  assert.equal(requests.find(url => url.pathname === '/song/info')!.searchParams.get('song')!.split(',').length, 20);
  const before = requests.length;
  for (const query of ['', 'x', 'a\nquery', 'q'.repeat(201)]) await assert.rejects(account.search(query), { code: 'invalid-request' });
  assert.equal(requests.length, before); await account.disconnect();
});

test('recording authorization rejects conflicting song identities, duplicate descriptors and malformed declared size', async () => {
  let reply = authorize();
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key' }), fetch: async input => new URL(String(input)).pathname === '/session/info' ? session() : reply });
  await account.connect();
  const fields = '<stream>https://kf.assets.recis.io/song.kit?ticket=fixture-only-ticket</stream><md5>0123456789abcdef0123456789abcdef</md5>';
  for (const value of [`<song id="24">${fields}</song>`, `<song id="23">${fields}</song><song id="24">${fields}</song>`, `<song>${fields}<md5>ffffffffffffffffffffffffffffffff</md5></song>`, ...['-1', 'NaN', '120.5', '0', '9007199254740993'].map(size => `<song>${fields}<filesize>${size}</filesize></song>`)]) {
    reply = envelope(value); await assert.rejects(account.requestMedia(source), error => error instanceof KaraFunAccountError && error.code === 'invalid-response');
  }
  reply = envelope(`<song id="23">${fields}</song>`); assert.equal((await account.requestMedia(source)).expectedBytes, null);
  assert.equal(account.status().state, 'connected'); await account.disconnect();
});

test('media URLs must use exact permitted HTTPS domain suffixes without userinfo, ports or fragments', async () => {
  let reply = authorize();
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key' }), fetch: async input => new URL(String(input)).pathname === '/session/info' ? session() : reply });
  await account.connect();
  for (const url of ['file:///private/song.kit', 'http://kf.assets.recis.io/a.kit', 'https://karafun.com.attacker.invalid/a.kit', 'https://evilrecis.io/a.kit', 'https://user:password@recis.io/a.kit', 'https://recis.io:444/a.kit', 'https://recis.io/a.kit#fragment']) {
    reply = envelope(`<song><stream>${url}</stream><md5>0123456789abcdef0123456789abcdef</md5></song>`);
    await assert.rejects(account.requestMedia(source), { code: 'invalid-response' });
  }
  for (const url of ['https://kf.assets.recis.io/a.kit', 'https://media.karafun.com/a.kit', 'https://bucket.s3.amazonaws.com/a.kit']) {
    reply = envelope(`<song><stream>${url}</stream><md5>0123456789ABCDEF0123456789ABCDEF</md5></song>`);
    assert.equal((await account.requestMedia(source)).md5, '0123456789abcdef0123456789abcdef');
  }
  await account.disconnect();
});

test('oversized native API responses cancel their reader, produce sanitized errors and keep the account connected', async () => {
  let cancelled = false, first = true;
  const account = new KaraFunAccount({ authenticate: async () => ({ sessionKey: 'fixture-key' }), fetch: async () => {
    if (first) { first = false; return session(); }
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }));
  } });
  await account.connect(); await assert.rejects(account.search('Popular'), { code: 'invalid-response' });
  assert.equal(cancelled, true); assert.equal(account.status().state, 'connected'); await account.disconnect();
});
