import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

import { EMPTY_SINGER_PROFILE, parseSingerProfileDetails, type SingerProfileDetails } from '../domain/singer-profile-details';

const MINUTE = 60_000;
const LINK_LIFETIME = 30 * MINUTE;
const SESSION_LIFETIME = 30 * 24 * 60 * MINUTE;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export type BoothAccount = { id: number; email: string; name: string; passwordHash: string };
export type AccountLink = { email: string; type: 'register' | 'signin' | 'reset'; name: string | null;
  passwordHash: string | null; accountId: number | null; expires: number };
export type AccountSession = { tokenHash: string; expires: number };
export interface AccountStore {
  profileDetails?(accountId: number): Promise<SingerProfileDetails | null>;
  saveProfileDetails?(accountId: number, details: SingerProfileDetails): Promise<void>;
  account(email: string): Promise<BoothAccount | null>;
  session(tokenHash: string, now: number): Promise<BoothAccount | null>;
  addSession(account: BoothAccount, session: AccountSession, now: number): Promise<boolean>;
  removeSession(tokenHash: string): Promise<void>;
  addLink(tokenHash: string, link: AccountLink, now: number): Promise<void>;
  removeLink(tokenHash: string): Promise<void>;
  link(tokenHash: string, now: number): Promise<AccountLink | null>;
  redeem(tokenHash: string, link: AccountLink, newPasswordHash: string | null, session: AccountSession, now: number): Promise<BoothAccount | null>;
}
export type AccountMailer = (email: string, type: AccountLink['type'], token: string) => Promise<void>;
type Take = (key: string, limit: number, period?: number) => boolean;
type Reply = { status: number; body: unknown };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const mint = () => randomBytes(32).toString('base64url');
const reply = (status: number, body: unknown): Reply => ({ status, body });
const fault = (status: number, error: string) => reply(status, { error });
const profile = ({ email, name }: BoothAccount) => ({ email, name });
const sameKeys = (input: Record<string, unknown>, keys: string) => Object.keys(input).sort().join(',') === keys;
const canonicalEmail = (input: unknown) => {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  const at = email.indexOf('@');
  return email.length <= 254 && at > 0 && at <= 64 && EMAIL.test(email) ? email : null;
};
const passwordUsable = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && [...value].length <= 128;
const passwordValid = (value: unknown): value is string => passwordUsable(value) && [...value].length >= 12;
const DUMMY = 'v1:' + randomBytes(16).toString('hex') + ':' + randomBytes(64).toString('hex');

// Keep concurrent memory-hard operations within the relay's systemd memory budget.
let activeProofs = 0;
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
}
async function encodePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return 'v1:' + salt.toString('hex') + ':' + derived.toString('hex');
}
async function matchesPassword(password: string, encoded: string): Promise<boolean> {
  if (!/^v1:[0-9a-f]{32}:[0-9a-f]{128}$/.test(encoded)) throw new Error('Invalid password verifier.');
  const [, salt, expected] = encoded.split(':');
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'hex')), Buffer.from(expected, 'hex'));
}
async function prove<T>(operation: () => Promise<T>): Promise<T | null> {
  if (activeProofs >= 3) return null;
  activeProofs++;
  try { return await operation(); }
  finally { activeProofs--; }
}
function issueSession(now: number) {
  const token = mint();
  return { token, record: { tokenHash: hash(token), expires: now + SESSION_LIFETIME } };
}

export class MobileAccounts {
  constructor(private readonly store: AccountStore, private readonly mail: AccountMailer, private readonly now = Date.now) {}

  async handle(action: string, method: string, body: unknown, bearer: string | undefined, ip: string, take: Take): Promise<Reply> {
    if (action === 'profile') {
      if (method !== 'GET' && method !== 'POST') return fault(405, 'METHOD_NOT_ALLOWED');
      if (!take('booth-profile:' + method + ':' + ip, method === 'POST' ? 12 : 80)) return fault(429, 'RATE_LIMITED');
      const account = bearer && await this.store.session(hash(bearer), this.now());
      if (!account) return fault(401, 'UNAUTHORIZED');
      if (!this.store.profileDetails || !this.store.saveProfileDetails) return fault(503, 'PROFILE_UNAVAILABLE');
      if (method === 'GET') return reply(200, { profile: await this.store.profileDetails(account.id) ?? EMPTY_SINGER_PROFILE });
      const details = parseSingerProfileDetails(body);
      if (!details) return fault(400, 'INVALID_PROFILE');
      await this.store.saveProfileDetails(account.id, details);
      return reply(200, { profile: details });
    }
    if (action === 'session' && method === 'GET') {
      if (!take('booth-session:' + ip, 120)) return fault(429, 'RATE_LIMITED');
      const account = bearer && await this.store.session(hash(bearer), this.now());
      return account ? reply(200, { account: profile(account) }) : fault(401, 'UNAUTHORIZED');
    }
    if (method !== 'POST') return fault(405, 'METHOD_NOT_ALLOWED');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fault(400, 'INVALID_REQUEST');
    const input = body as Record<string, unknown>;
    const now = this.now();
    if (!take('booth-account-ip:' + ip, 36) || !take('booth-account-global', 360)) return fault(429, 'RATE_LIMITED');
    if (action === 'logout') {
      if (!bearer || !sameKeys(input, '')) return fault(401, 'UNAUTHORIZED');
      await this.store.removeSession(hash(bearer));
      return reply(200, { ok: true });
    }
    if (action === 'link/redeem') {
      if (!(sameKeys(input, 'token') || sameKeys(input, 'password,token')) || typeof input.token !== 'string' || !PROOF.test(input.token))
        return fault(400, 'INVALID_LINK');
      const digest = hash(input.token);
      const link = await this.store.link(digest, now);
      if (!link) return fault(400, 'INVALID_LINK');
      if (!take('booth-redeem:' + digest, 8, LINK_LIFETIME)) return fault(429, 'RATE_LIMITED');
      let passwordHash: string | null = null;
      if (link.type !== 'signin' && !passwordValid(input.password)) return fault(400, link.type === 'register' ? 'VERIFY_PASSWORD_REQUIRED' : 'PASSWORD_REQUIRED');
      if (link.type === 'register' && passwordValid(input.password)) {
        const verified = await prove(() => matchesPassword(input.password as string, link.passwordHash ?? DUMMY));
        if (verified === null) return fault(429, 'RATE_LIMITED');
        if (!verified) return fault(401, 'INVALID_CREDENTIALS');
      } else if (link.type === 'reset' && passwordValid(input.password)) {
        passwordHash = await prove(() => encodePassword(input.password as string));
        if (!passwordHash) return fault(429, 'RATE_LIMITED');
      }
      const session = issueSession(this.now());
      const account = await this.store.redeem(digest, link, passwordHash, session.record, this.now());
      return account ? reply(200, { token: session.token, account: profile(account) }) : fault(400, 'INVALID_LINK');
    }
    const email = canonicalEmail(input.email);
    if (!email) return fault(400, 'INVALID_EMAIL');
    const identity = hash(email);
    if (action === 'lookup' && sameKeys(input, 'email')) {
      if (!take('booth-lookup:' + ip, 12) || !take('booth-lookup-hour:' + ip, 60, 60 * MINUTE))
        return fault(429, 'RATE_LIMITED');
      return reply(200, { registered: Boolean(await this.store.account(email)) });
    }
    if (action === 'login' && sameKeys(input, 'email,password') && passwordUsable(input.password)) {
      if (!take('booth-login-ip:' + ip, 12) || !take('booth-login-email:' + identity, 10, 15 * MINUTE))
        return fault(429, 'RATE_LIMITED');
      const account = await this.store.account(email);
      const verified = await prove(() => matchesPassword(input.password as string, account?.passwordHash ?? DUMMY));
      if (verified === null) return fault(429, 'RATE_LIMITED');
      if (!verified || !account) return fault(401, 'INVALID_CREDENTIALS');
      const session = issueSession(this.now());
      if (!await this.store.addSession(account, session.record, this.now())) return fault(401, 'INVALID_CREDENTIALS');
      return reply(200, { token: session.token, account: profile(account) });
    }
    if (action === 'register' && sameKeys(input, 'email,name,password')) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || [...name].length > 60 || /[\x00-\x1f\x7f]/.test(name)) return fault(400, 'INVALID_NAME');
      if (!passwordValid(input.password)) return fault(400, 'INVALID_PASSWORD');
      if (!this.canSend(ip, identity, take)) return fault(429, 'RATE_LIMITED');
      if (await this.store.account(email)) return fault(409, 'EMAIL_REGISTERED');
      const passwordHash = await prove(() => encodePassword(input.password as string));
      if (!passwordHash) return fault(429, 'RATE_LIMITED');
      await this.send({ email, name, passwordHash, type: 'register', accountId: null, expires: now + LINK_LIFETIME }, now);
      return reply(202, { pending: true });
    }
    if (action === 'link' && sameKeys(input, 'email,purpose') && (input.purpose === 'signin' || input.purpose === 'reset')) {
      if (!this.canSend(ip, identity, take)) return fault(429, 'RATE_LIMITED');
      const account = await this.store.account(email);
      if (account) await this.send({ email, type: input.purpose, accountId: account.id, name: null, passwordHash: null, expires: now + LINK_LIFETIME }, now);
      return reply(202, { ok: true });
    }
    return fault(400, 'INVALID_REQUEST');
  }

  private canSend(ip: string, identity: string, take: Take): boolean {
    return take('booth-mail-ip:' + ip, 8, 60 * MINUTE) && take('booth-mail-email:' + identity, 4, 60 * MINUTE) &&
      take('booth-mail-global', 90, 60 * MINUTE);
  }

  private async send(link: AccountLink, now: number) {
    const token = mint();
    const digest = hash(token);
    await this.store.addLink(digest, link, now);
    try { await this.mail(link.email, link.type, token); }
    catch (error) {
      await this.store.removeLink(digest);
      throw error;
    }
  }
}