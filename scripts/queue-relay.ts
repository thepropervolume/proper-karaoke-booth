/** Private operator entrypoint. No desktop listener, provider credentials or arbitrary proxy. */
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createPool } from 'mysql2/promise';
import { createSingerStaticHandler } from '../src/main/remote-static';
import { MySqlRelayStore } from '../src/relay/mysql-store';
import { RelayBroker } from '../src/relay/broker';
import { startQueueRelayService, type RelayOwner } from '../src/relay/http';

const validPath = (value: string | undefined): value is string => !!value && isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value);
async function main(): Promise<void> {
  const database = process.env.TPV_QUEUE_MYSQL_DATABASE, socketPath = process.env.TPV_QUEUE_MYSQL_SOCKET, user = process.env.TPV_QUEUE_MYSQL_USER;
  const passwordFile = process.env.TPV_QUEUE_MYSQL_PASSWORD_FILE, webRoot = process.env.TPV_QUEUE_WEB_ROOT, ownersFile = process.env.TPV_QUEUE_OWNERS_FILE;
  const rawPort = process.env.TPV_QUEUE_PORT, publicOrigin = process.env.TPV_QUEUE_PUBLIC_ORIGIN;
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
  try {
    const store = new MySqlRelayStore(pool, { publicOrigin });
    await store.initializeRuntime();
    const broker = new RelayBroker(store);
    const service = await startQueueRelayService({ publicOrigin, owners: parsed.owners as RelayOwner[], broker, staticHandler, trustProxy: true,
      port: Number(rawPort), closeDependencies: () => pool.end(), isReady: () => store.isAvailable(), mobileEnabled: process.env.TPV_QUEUE_MOBILE === 'yes',
      onFailure: () => { process.exitCode = 1; console.error('Queue relay stopped unexpectedly.'); } });
    started = true;
    console.log('Queue relay listening on loopback.');
    const stop = () => { void service.stop().catch(() => { process.exitCode = 1; console.error('Queue relay shutdown failed.'); }); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } finally { if (!started) await pool.end(); }
}
main().catch(() => { process.exitCode = 1; console.error('Queue relay failed to start.'); });
