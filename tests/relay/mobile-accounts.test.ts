import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { RelayBroker } from '../../src/relay/broker';
import { RelayRateLimits, startQueueRelayService } from '../../src/relay/http';
import { MobileAccounts, type AccountLink, type AccountSession, type AccountStore, type BoothAccount } from '../../src/relay/mobile-accounts';
import { RelayStore } from '../../src/relay/store';

class MemoryAccounts implements AccountStore {
  constructor(private readonly accounts = new Map<string, BoothAccount>(), private readonly links = new Map<string, AccountLink>(),
    private readonly sessions = new Map<string, AccountSession & { email: string }>()) {}

  async account(email: string) { return this.accounts.get(email) ?? null; }
  async session(tokenHash: string, now: number) {
    const session = this.sessions.get(tokenHash);
    return session && session.expires > now ? this.account(session.email) : null;
  }
  async addSession(account: BoothAccount, session: AccountSession) {
    this.sessions.set(session.tokenHash, { ...session, email: account.email });
    return true;
  }
  async removeSession(digest: string) { this.sessions.delete(digest); }
  async addLink(digest: string, link: AccountLink) { this.links.set(digest, link); }
  async removeLink(digest: string) { this.links.delete(digest); }
  async link(digest: string, now: number) {
    const link = this.links.get(digest);
    return link && link.expires > now ? link : null;
  }
  async redeem(digest: string, link: AccountLink, newHash: string | null, session: AccountSession, now: number) {
    if (await this.link(digest, now) !== link) return null;
    if (link.type === 'register') {
      if (this.accounts.has(link.email) || !link.name || !link.passwordHash) return null;
      this.accounts.set(link.email, { id: this.accounts.size + 1, email: link.email, name: link.name, passwordHash: link.passwordHash });
    }
    const account = await this.account(link.email);
    if (!account) return null;
    if (newHash) {
      account.passwordHash = newHash;
      for (const [hash, entry] of this.sessions) if (entry.email === link.email) this.sessions.delete(hash);
      for (const [hash, entry] of this.links) if (entry.email === link.email) this.links.delete(hash);
    }
    this.links.delete(digest);
    await this.addSession(account, session);
    return account;
  }
}

test('Booth sign-up verifies ownership, link sign-in is single use, reset revokes old sessions', async () => {
  const store = new MemoryAccounts();
  const mail: { email: string; type: AccountLink['type']; token: string }[] = [];
  let now = 1;
  const limits = new RelayRateLimits(() => now);
  const service = new MobileAccounts(store, async (email, type, token) => { mail.push({ email, type, token }); }, () => now);
  const call = (action: string, body?: unknown, token?: string) => service.handle(action, body ? 'POST' : 'GET',
    body, token, '127.0.0.1', (key, count, period) => limits.take(key, count, period));
  const email = 'singer@example.test', name = 'Guest Singer', password = 'test-only long password';
  assert.deepEqual((await call('lookup', { email })).body, { registered: false });
  const register = await call('register', { email: email.toUpperCase(), name, password });
  assert.equal(register.status, 202);
  assert.deepEqual(register.body, { pending: true });
  assert.equal((await call('login', { email, password })).status, 401);
  assert.equal(await store.account(email), null);
  assert.equal(mail[0].email, email);
  assert.equal(mail[0].type, 'register');
  assert.match(mail[0].token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual((await call('link/redeem', { token: mail[0].token })).body, { error: 'VERIFY_PASSWORD_REQUIRED' });
  assert.equal((await call('link/redeem', { token: mail[0].token, password: 'incorrect long password' })).status, 401);
  const signedIn = await call('link/redeem', { token: mail[0].token, password });
  assert.equal(signedIn.status, 200);
  const first = signedIn.body as { token: string; account: { name: string; email: string } };
  assert.deepEqual(first.account, { name, email });
  assert.notEqual((await store.account(email))?.passwordHash, password);
  assert.deepEqual((await call('lookup', { email })).body, { registered: true });
  assert.deepEqual((await call('session', undefined, first.token)).body, { account: { name, email } });
  assert.equal((await call('link/redeem', { token: mail[0].token, password })).status, 400);

  assert.equal((await call('link', { email, purpose: 'signin' })).status, 202);
  const signInProof = mail[1].token;
  assert.equal((await call('link/redeem', { token: signInProof })).status, 200);
  assert.equal((await call('link/redeem', { token: signInProof })).status, 400);
  assert.equal((await call('link', { email, purpose: 'reset' })).status, 202);
  const resetProof = mail[2].token;
  assert.deepEqual((await call('link/redeem', { token: resetProof })).body, { error: 'PASSWORD_REQUIRED' });
  assert.equal((await call('link/redeem', { token: resetProof, password: 'new secured password' })).status, 200);
  assert.equal((await call('session', undefined, first.token)).status, 401);
  assert.equal((await call('login', { email, password })).status, 401);
  const latest = await call('login', { email, password: 'new secured password' });
  assert.equal(latest.status, 200);
  const lastToken = (latest.body as { token: string }).token;
  assert.equal((await call('logout', {}, lastToken)).status, 200);
  assert.equal((await call('session', undefined, lastToken)).status, 401);

  now += 60 * 60_000;
  await call('link', { email, purpose: 'signin' });
  now += 30 * 60_000;
  assert.equal((await call('link/redeem', { token: mail[3].token })).status, 400);
  assert.deepEqual((await call('link', { email: 'absent@example.test', purpose: 'signin' })).body, { ok: true });
  assert.equal(mail.length, 4);
});

test('account HTTP routes allow exact native origins without widening the room origin boundary', async () => {
  const origin = 'https://queue.example.test';
  const roomDb = new DatabaseSync(':memory:');
  const broker = new RelayBroker(new RelayStore(roomDb, { publicOrigin: origin }));
  const ownerHash = createHash('sha256').update('owner').digest('hex');
  const relay = await startQueueRelayService({ port: 0, publicOrigin: origin, owners: [{ id: randomUUID(), tokenSha256: ownerHash }],
    staticHandler: async () => false, mobileAccounts: new MobileAccounts(new MemoryAccounts(), async () => {}), mobileEnabled: true,
    broker, closeDependencies: () => roomDb.close() });
  async function call(path: string, method: string, caller?: string) {
    const body = method === 'POST' ? JSON.stringify({ email: 'new@example.test' }) : undefined;
    return new Promise<{ status?: number; allow: string | string[] | undefined; body: string }>((resolve, reject) => {
      const message = request({ host: '127.0.0.1', port: relay.port, path, method, headers: { Host: 'queue.example.test',
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...(caller ? { Origin: caller } : {}) } }, response => {
        let bytes = '';
        response.setEncoding('utf8').on('data', chunk => { bytes += chunk; }).on('end', () => {
          resolve({ status: response.statusCode, allow: response.headers['access-control-allow-origin'], body: bytes });
        });
      });
      message.on('error', reject).end(body);
    });
  }
  try {
    assert.deepEqual(JSON.parse((await call('/v1/mobile/account/status', 'GET')).body), { enabled: true });
    assert.equal((await call('/v1/mobile/account/session', 'GET')).status, 401);
    for (const native of ['capacitor://localhost', 'https://localhost']) {
      const preflight = await call('/v1/mobile/account/lookup', 'OPTIONS', native);
      assert.equal(preflight.status, 204);
      assert.equal(preflight.allow, native);
      const lookup = await call('/v1/mobile/account/lookup', 'POST', native);
      assert.equal(lookup.status, 200);
      assert.equal(lookup.allow, native);
      assert.deepEqual(JSON.parse(lookup.body), { registered: false });
      assert.equal((await call('/v1/mobile/catalog', 'POST', native)).status, 403);
    }
    for (const denied of ['https://localhost.evil.test', 'http://localhost', 'null', undefined])
      assert.equal((await call('/v1/mobile/account/lookup', 'POST', denied)).status, 403);
  } finally { await relay.stop(); }
});