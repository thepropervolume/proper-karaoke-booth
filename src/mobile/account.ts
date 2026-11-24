import { MOBILE_ORIGIN, MobileHttpError, mobileJson } from './api';

export type MobileAccount = { email: string; name: string };
export type SignedInAccount = { token: string; account: MobileAccount };

const root = '/v1/mobile/account/';
const sessionKey = 'tpv-mobile-account-session';
const isToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function parseAccount(value: unknown): MobileAccount {
  const account = value as Partial<MobileAccount> | null;
  if (!account || typeof account.email !== 'string' || typeof account.name !== 'string') {
    throw new Error('Invalid account response.');
  }
  return { email: account.email, name: account.name };
}

function parseSession(value: unknown): SignedInAccount {
  const session = value as Partial<SignedInAccount> | null;
  if (!isToken(session?.token)) throw new Error('Invalid sign-in response.');
  return { token: session.token, account: parseAccount(session.account) };
}

export function knownSessionToken(): string | null {
  try {
    const token = localStorage.getItem(sessionKey);
    return isToken(token) ? token : null;
  } catch { return null; }
}

export function rememberSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(sessionKey, token);
    else localStorage.removeItem(sessionKey);
  } catch { /* Sessions remain usable without persistence. */ }
}

export function accountLinkToken(value: string): string | null {
  const input = value.trim();
  if (isToken(input)) return input;
  try {
    const link = new URL(input);
    if (link.origin !== MOBILE_ORIGIN || link.pathname !== '/app/' || link.username || link.password) return null;
    const token = new URLSearchParams(link.hash.slice(1)).get('accountLink');
    return isToken(token) ? token : null;
  } catch { return null; }
}

export async function lookupAccount(email: string, signal: AbortSignal): Promise<boolean> {
  const answer = await mobileJson(root + 'lookup', { email }, { signal }) as { registered?: unknown } | null;
  if (typeof answer?.registered !== 'boolean') throw new Error('Account lookup unavailable.');
  return answer.registered;
}

export async function signIn(email: string, password: string): Promise<SignedInAccount> {
  return parseSession(await mobileJson(root + 'login', { email, password }));
}

export async function createAccount(email: string, name: string, password: string): Promise<void> {
  const result = await mobileJson(root + 'register', { email, name, password }) as { pending?: boolean } | null;
  if (result?.pending !== true) throw new Error('Account creation unavailable.');
}

export async function readAccount(token: string, signal: AbortSignal): Promise<MobileAccount> {
  const session = await mobileJson(root + 'session', undefined, { token, signal }) as { account?: unknown } | null;
  return parseAccount(session?.account);
}

export async function signOut(token: string): Promise<void> {
  await mobileJson(root + 'logout', {}, { token });
}

export async function requestAccountLink(email: string, purpose: 'signin' | 'reset'): Promise<void> {
  await mobileJson(root + 'link', { email, purpose });
}

export async function redeemAccountLink(token: string, password?: string): Promise<SignedInAccount> {
  return parseSession(await mobileJson(root + 'link/redeem', { token, ...(password ? { password } : {}) }));
}

export function accountError(error: unknown, fallback: string): string {
  if (!(error instanceof MobileHttpError)) return fallback;
  if (error.status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (error.status === 503 || error.status === 404 && error.code !== 'ACCOUNT_NOT_FOUND') return 'Accounts are unavailable. You can still continue as a guest.';
  if (error.status === 401) return 'Those sign-in details didn’t match. Check them and try again.';
  if (error.status === 409) return 'This email already has an account. Try signing in.';
  return fallback;
}
