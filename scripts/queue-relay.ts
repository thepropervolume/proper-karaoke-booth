/** Private operator entrypoint. No desktop listener, provider credentials or arbitrary proxy. */
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createPool, type Pool } from 'mysql2/promise';
import { createSingerStaticHandler } from '../src/main/remote-static';
import { MySqlRelayStore } from '../src/relay/mysql-store';
import { RelayBroker } from '../src/relay/broker';
import { startQueueRelayService, type RelayOwner } from '../src/relay/http';
import { MobileAccounts } from '../src/relay/mobile-accounts';
import { MySqlMobileAccountStore } from '../src/relay/mysql-mobile-accounts';

const validPath = (value: string | undefined): value is string => !!value && isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value);
function privateValue(file: string | undefined): string {
  if (!validPath(file)) throw new Error('Invalid private account configuration.');
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4096 || (info.mode & 0o077) !== 0)
    throw new Error('Invalid private account configuration.');
  const value = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  if (!value || value.length > 1024) throw new Error('Invalid private account configuration.');
  return value;
}

async function configureAccounts(socketPath: string): Promise<{ pool: Pool; accounts: MobileAccounts } | undefined> {
  if (process.env.TPV_BOOTH_ACCOUNTS !== 'yes') return;
  let pool: Pool | undefined;
  try {
    const password = privateValue(process.env.TPV_BOOTH_ACCOUNTS_PASSWORD_FILE);
    const token = privateValue(process.env.TPV_BOOTH_ACCOUNT_MAIL_TOKEN_FILE);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid private mail configuration.');
    pool = createPool({ socketPath, database: 'tpv_booth_accounts', user: 'tpv_booth_runtime', password,
      charset: 'utf8mb4', connectionLimit: 4, waitForConnections: true, queueLimit: 32, multipleStatements: false, connectTimeout: 5000 });
    const store = new MySqlMobileAccountStore(pool);
    await store.check();
    const accounts = new MobileAccounts(store, async (email, purpose, proof) => {
      const response = await fetch('http://127.0.0.1:8769/send', { method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose, token: proof }), signal: AbortSignal.timeout(15000) });
      if (response.status !== 204) throw new Error('Account mail is unavailable.');
    });
    return { pool, accounts };
  } catch {
    if (pool) await pool.end();
    console.error('Booth account service disabled: verify private configuration and schema.');
  }
}

async function main(): Promise<void> {
  const database = process.env.TPV_QUEUE_MYSQL_DATABASE, socketPath = process.env.TPV_QUEUE_MYSQL_SOCKET, user = process.env.TPV_QUEUE_MYSQL_USER;
  const passwordFile = process.env.TPV_QUEUE_MYSQL_PASSWORD_FILE, webRoot = process.env.TPV_QUEUE_WEB_ROOT, ownersFile = process.env.TPV_QUEUE_OWNERS_FILE;
  const rawPort = process.env.TPV_QUEUE_PORT, publicOrigin = process.env.TPV_QUEUE_PUBLIC_ORIGIN;
  const screenOrigin = process.env.TPV_QUEUE_SCREEN_ORIGIN || undefined;
  if (process.argv.length !== 2 || !database || !/^[A-Za-z0-9_]{1,64}$/.test(database) || !validPath(socketPath) || !user || !/^[A-Za-z0-9_.-]{1,64}$/.test(user) ||
      !validPath(passwordFile) || !validPath(webRoot) || !validPath(ownersFile) ||
      !rawPort || !/^[1-9][0-9]{0,4}$/.test(rawPort) || Number(rawPort) > 65535 || !publicOrigin || process.env.TPV_QUEUE_TRUST_PROXY !== 'yes')
    throw new Error('Invalid relay configuration.');
  const info = lstatSync(ownersFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 64 * 1024 || (info.mode & 0o077) !== 0) throw new Error('Invalid private relay configuration.');
  const parsed: unknown = JSON.parse(readFileSync(ownersFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !('owners' in parsed) || !Array.isArray(parsed.owners))
    throw new Error('Invalid private relay configuration.');
  const passwordInfo = lstatSync(passwordFile);
  if (!passwordInfo.isFile() || passwordInfo.isSymbolicLink() || passwordInfo.size < 1 || passwordInfo.size > 4096 || (passwordInfo.mode & 0o077) !== 0)
    throw new Error('Invalid private relay configuration.');
  const password = readFileSync(passwordFile, 'utf8').replace(/\r?\n$/, '');
  if (!password || password.length > 1024) throw new Error('Invalid private relay configuration.');
  process.umask(0o077);
  const staticHandler = createSingerStaticHandler(webRoot);
  const pool = createPool({ socketPath, database, user, password, connectionLimit: 8, waitForConnections: true, queueLimit: 64,
    multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 5000 });
  let started = false;
  let mobile: Awaited<ReturnType<typeof configureAccounts>>;
  try {
    const store = new MySqlRelayStore(pool, { publicOrigin, retainedOwnerIds: (parsed.owners as RelayOwner[]).map(owner => owner.id) });
    await store.initializeRuntime();
    const broker = new RelayBroker(store);
    mobile = await configureAccounts(socketPath);
    const service = await startQueueRelayService({ publicOrigin, screenOrigin, owners: parsed.owners as RelayOwner[], broker, staticHandler, trustProxy: true,
      port: Number(rawPort), closeDependencies: async () => { await Promise.all([pool.end(), mobile?.pool.end()]); },
      isReady: () => store.isAvailable(), mobileEnabled: process.env.TPV_QUEUE_MOBILE === 'yes', mobileAccounts: mobile?.accounts,
      onFailure: () => { process.exitCode = 1; console.error('Queue relay stopped unexpectedly.'); } });
    started = true;
    console.log('Queue relay listening on loopback.');
    const stop = () => { void service.stop().catch(() => { process.exitCode = 1; console.error('Queue relay shutdown failed.'); }); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } finally { if (!started) await Promise.all([pool.end(), mobile?.pool.end()]); }
}
main().catch(() => { process.exitCode = 1; console.error('Queue relay failed to start.'); });
