import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KaraFunAccount, KaraFunAccountError } from '../../src/main/karafun-account';
import { KaraFunSessionVaultError, type KaraFunRememberedSession, type KaraFunSessionStore } from '../../src/main/karafun-session-vault';
const envelope = (body = '<session/>') => new Response('<response status="ok">' + body + '</response>');
const remembered = { sessionKey: 'protected-fixture-session', clientId: '6', accountScope: 'a'.repeat(64) };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function store(initial: KaraFunRememberedSession | null = null) {
  let saved = initial && { ...initial }, available = true, saves = 0;
  const port: KaraFunSessionStore = {
    load: async () => saved && { ...saved },
    save: async value => { if (!available) return false; saved = { ...value }; saves++; return true; },
    clear: async expected => { if (expected === undefined || saved?.accountScope === expected) saved = null; },
  };
  return { port, current: () => saved, saves: () => saves, unavailable: () => { available = false; } };
}

test('remembered sign-in survives closing and restores the same cache scope after checking the provider without browser login', async () => {
  const vault = store(); let logins = 0, inspections = 0;
  const first = new KaraFunAccount({ sessionStore: vault.port, authenticate: async () => { logins++; return { sessionKey: remembered.sessionKey, clientId: '6' }; }, fetch: async () => { inspections++; return envelope(); } });
  assert.equal((await first.connect()).persistence, 'os-protected'); const scope = first.accountScope(); assert.ok(scope); assert.equal(vault.saves(), 1);
  await first.close(); assert.equal(first.status().state, 'disconnected'); assert.equal(vault.current()?.accountScope, scope);
  const restarted = new KaraFunAccount({ sessionStore: vault.port, authenticate: async () => { throw Error('Restoring must not open a sign-in browser'); }, fetch: async input => { inspections++; assert.equal(new URL(String(input)).pathname, '/session/info'); return envelope(); } });
  assert.equal((await restarted.restore()).state, 'connected'); assert.equal(restarted.status().persistence, 'os-protected');
  assert.equal(restarted.accountScope(), scope); assert.equal(logins, 1); assert.equal(inspections, 2); assert.equal(vault.saves(), 2, 'Validated restore adopts current OS encryption/key rotation.');
  assert.doesNotMatch(JSON.stringify(restarted.status()), /protected-fixture-session|accountScope|clientId/);
  await restarted.disconnect(); assert.equal(vault.current(), null);
  const afterSignOut = new KaraFunAccount({ sessionStore: vault.port, fetch: async () => { throw Error('An absent remembered session cannot make API calls'); } });
  assert.equal((await afterSignOut.restore()).state, 'disconnected');
});

test('no secure storage leaves a usable memory-only connection with a clear persistence status', async () => {
  const vault = store(); vault.unavailable();
  const account = new KaraFunAccount({ sessionStore: vault.port, authenticate: async () => ({ sessionKey: remembered.sessionKey }), fetch: async () => envelope() });
  const status = await account.connect(); assert.equal(status.state, 'connected'); assert.equal(status.persistence, 'memory-only'); assert.match(status.message!, /this launch/);
  assert.equal(vault.current(), null); await account.close();
  assert.equal((await new KaraFunAccount({ sessionStore: vault.port }).restore()).state, 'disconnected');
});

test('unverified browser sessions are never remembered and expired remembered sessions require ordinary sign-in', async () => {
  const empty = store(), refused = new KaraFunAccount({ sessionStore: empty.port, authenticate: async () => ({ sessionKey: remembered.sessionKey }), fetch: async () => new Response(null, { status: 401 }) });
  assert.equal((await refused.connect()).state, 'disconnected'); assert.equal(empty.current(), null); assert.equal(empty.saves(), 0);
  const expired = store(remembered); let browsers = 0;
  const account = new KaraFunAccount({ sessionStore: expired.port, authenticate: async () => { browsers++; return { sessionKey: 'new-fixture-session' }; }, fetch: async input => new URL(String(input)).searchParams.get('sk') === remembered.sessionKey ? new Response(null, { status: 401 }) : envelope() });
  assert.equal((await account.restore()).state, 'expired'); assert.equal(expired.current(), null); assert.equal(browsers, 0);
  assert.equal((await account.connect()).state, 'connected'); assert.equal(browsers, 1); assert.notEqual(account.accountScope(), remembered.accountScope);
});

test('temporary provider failure preserves encrypted sign-in for a later retry and never retries passwords', async () => {
  const vault = store(remembered); let outage = true, calls = 0;
  const account = new KaraFunAccount({ sessionStore: vault.port, fetch: async () => { calls++; return outage ? new Response(null, { status: 503 }) : envelope(); }, authenticate: async () => { throw Error('No browser during recovery'); } });
  const unavailable = await account.restore(); assert.equal(unavailable.state, 'disconnected'); assert.equal(unavailable.retrySavedSignIn, true); assert.match(unavailable.message!, /connection/); assert.deepEqual(vault.current(), remembered);
  outage = false; assert.equal((await account.restore()).state, 'connected'); assert.equal(account.accountScope(), remembered.accountScope); assert.equal(calls, 2); await account.close();
});

test('an ambiguous 403 and a cancelled new sign-in preserve the same remembered account for retry', async () => {
  const vault = store(remembered); let blocked = true, logins = 0;
  const account = new KaraFunAccount({ sessionStore: vault.port,
    fetch: async () => blocked ? new Response('temporary gateway denial', { status: 403 }) : envelope(),
    authenticate: async () => { logins++; throw new KaraFunAccountError('cancelled', 'Sign-in cancelled.'); } });
  assert.equal((await account.restore()).retrySavedSignIn, true);
  assert.deepEqual(vault.current(), remembered);
  assert.equal((await account.connect()).retrySavedSignIn, true);
  assert.deepEqual(vault.current(), remembered);
  blocked = false;
  assert.equal((await account.restore()).state, 'connected');
  assert.equal(account.accountScope(), remembered.accountScope);
  assert.equal(logins, 1);
});

test('locked operating-system storage can be retried without opening a login window', async () => {
  const vault = store(remembered); let locked = true;
  const account = new KaraFunAccount({ sessionStore: { ...vault.port, load: async () => {
    if (locked) throw new KaraFunSessionVaultError('unavailable');
    return vault.port.load();
  } }, fetch: async () => envelope(), authenticate: async () => { throw Error('No browser during recovery'); } });
  const unavailable = await account.restore();
  assert.equal(unavailable.retrySavedSignIn, true);
  assert.match(unavailable.message!, /Secure storage/);
  locked = false;
  assert.equal((await account.restore()).state, 'connected');
  assert.deepEqual(vault.current(), remembered);
});

test('a late restore cannot reconnect or inspect a saved credential after explicit sign-out', async () => {
  const vault = store(remembered), pending = deferred<KaraFunRememberedSession | null>(); let calls = 0;
  const account = new KaraFunAccount({ sessionStore: { ...vault.port, load: async () => pending.promise }, fetch: async () => { calls++; return envelope(); } });
  const restoring = account.restore(); await account.disconnect(); pending.resolve(remembered); await restoring;
  assert.equal(account.status().state, 'disconnected'); assert.equal(account.accountScope(), null); assert.equal(vault.current(), null); assert.equal(calls, 0);
});

test('stale rejected restore cannot expire a replacement connection or clear its protected session', async () => {
  const vault = store(remembered), pending = deferred<Response>(); let calls = 0;
  const account = new KaraFunAccount({ sessionStore: vault.port, authenticate: async () => ({ sessionKey: 'replacement-fixture-session' }), fetch: async () => ++calls === 1 ? pending.promise : envelope() });
  const restoring = account.restore(); await new Promise(resolve => setTimeout(resolve, 0));
  await account.disconnect(); await account.connect(); const replacement = vault.current();
  pending.resolve(new Response(null, { status: 401 })); await restoring;
  assert.equal(account.status().state, 'connected'); assert.deepEqual(vault.current(), replacement); assert.equal(account.accountScope(), replacement?.accountScope); await account.close();
});

test('sign-out during a delayed protected save cannot leave a forgotten login on disk', async () => {
  const vault = store(), started = deferred<void>(), proceed = deferred<void>();
  const account = new KaraFunAccount({ sessionStore: { ...vault.port, save: async value => { started.resolve(); await proceed.promise; return vault.port.save(value); } }, authenticate: async () => ({ sessionKey: remembered.sessionKey }), fetch: async () => envelope() });
  const connecting = account.connect(); await started.promise; await account.disconnect(); proceed.resolve(); await connecting;
  assert.equal(vault.current(), null); assert.equal(account.status().state, 'disconnected');
});

test('corrupt or unavailable remembered material never exposes secrets or opens the sign-in browser automatically', async () => {
  for (const saved of [{ ...remembered, accountScope: 'bad' }, { ...remembered, sessionKey: 'password with spaces' }]) {
    let requests = 0;
    const account = new KaraFunAccount({ sessionStore: { load: async () => saved, save: async () => true, clear: async () => {} }, fetch: async () => { requests++; return envelope(); } });
    const result = await account.restore(); assert.equal(result.state, 'disconnected'); assert.equal(requests, 0); assert.doesNotMatch(JSON.stringify(result), /password with spaces|protected-fixture-session/);
  }
  const account = new KaraFunAccount({ sessionStore: { load: async () => { throw Error('private path and private key'); }, save: async () => false, clear: async () => {} } });
  assert.doesNotMatch(JSON.stringify(await account.restore()), /private path|private key/);
});

test('a live expired remembered session is removed and revoked without disturbing a newer account scope', async () => {
  const vault = store(remembered); let first = true;
  const account = new KaraFunAccount({ sessionStore: vault.port, fetch: async () => { if (first) { first = false; return envelope(); } return new Response(null, { status: 401 }); } });
  await account.restore(); await assert.rejects(account.search('Popular'), error => error instanceof KaraFunAccountError && error.code === 'expired');
  assert.equal(account.status().state, 'expired'); assert.equal(account.accountScope(), null); assert.equal(vault.current(), null);
});
