/** Operator process; secrets are supplied by a private environment, never arguments. */
import path from 'node:path';
import { lstatSync, readFileSync } from 'node:fs';
import { createPool } from 'mysql2/promise';
import { MySqlCommunityCatalogStore } from '../src/catalog/karaokenerds-mysql';
import { createMySqlCatalogReader } from '../src/catalog/karaokenerds-mysql-reader';
import { startCatalogService } from '../src/catalog/karaokenerds-service';

function privateFile(name: string): string {
  const filename = process.env[name];
  if (!filename || !path.isAbsolute(filename) || /[\x00-\x1f\x7f]/.test(filename)) throw new Error('Invalid private configuration.');
  const info = lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4096 ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('Invalid private configuration.');
  return readFileSync(filename, 'utf8').replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  const socket = process.env.TPV_KN_MYSQL_SOCKET;
  const database = process.env.TPV_KN_MYSQL_DATABASE;
  const user = process.env.TPV_KN_MYSQL_USER;
  const rawPort = process.env.TPV_KN_SERVICE_PORT;
  if (!socket || !path.isAbsolute(socket) || /[\x00-\x1f\x7f]/.test(socket) || !database || !/^[A-Za-z0-9_]{1,64}$/.test(database) ||
      !user || !/^[A-Za-z0-9_.-]{1,64}$/.test(user) ||
      !rawPort || !/^[0-9]{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535 || process.argv.length !== 2)
    throw new Error('Invalid catalog service configuration.');
  const password = privateFile('TPV_KN_MYSQL_PASSWORD_FILE'), token = privateFile('TPV_KN_SERVICE_TOKEN_FILE');
  if (!password || password.length > 1024 || !/^[A-Za-z0-9._~-]{32,256}$/.test(token)) throw new Error('Invalid private configuration.');
  const pool = createPool({ socketPath: socket, database, user, password, connectionLimit: 2, waitForConnections: false,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false, connectTimeout: 5_000 });
  let started = false;
  try {
    const store = new MySqlCommunityCatalogStore(pool);
    const reader = createMySqlCatalogReader(store);
    // Ensure the database is provisioned and initialized before opening a socket.
    // Warm the same projection the listener will use for its first request.
    await reader.status();
    const service = await startCatalogService({ port: Number(rawPort), token, reader,
      publicReadEnabled: process.env.TPV_KN_PUBLIC_READ_ENABLED === 'yes',
      closeDependencies: () => pool.end(), onFailure: () => { process.exitCode = 1; console.error('Catalog service stopped unexpectedly.'); } });
    started = true;
    console.log(`Catalog service listening on loopback port ${service.port}.`);
    const stop = () => { void service.stop().catch(() => { process.exitCode = 1; console.error('Catalog service shutdown failed.'); }); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } finally { if (!started) await pool.end(); }
}

main().catch(() => { process.exitCode = 1; console.error('Catalog service failed to start.'); });
