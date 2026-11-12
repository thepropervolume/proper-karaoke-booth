/** Explicit dedicated MySQL schema setup. Runtime never has DDL privileges. */
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createPool } from 'mysql2/promise';
import { initializeMySqlRelayStore } from '../src/relay/mysql-store';

async function main(): Promise<void> {
  const socketPath = process.env.TPV_QUEUE_MYSQL_SOCKET, database = process.env.TPV_QUEUE_MYSQL_DATABASE;
  const user = process.env.TPV_QUEUE_MYSQL_USER, file = process.env.TPV_QUEUE_MYSQL_PASSWORD_FILE;
  if (process.argv.length !== 3 || process.argv[2] !== 'initialize' || !socketPath || !isAbsolute(socketPath) || !database ||
      !/^[A-Za-z0-9_]{1,64}$/.test(database) || !user || !/^[A-Za-z0-9_.-]{1,64}$/.test(user) || !file || !isAbsolute(file))
    throw new Error('Invalid operator configuration.');
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size < 1 || info.size > 4096) throw new Error('Invalid private configuration.');
  const password = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  if (!password || password.length > 1024) throw new Error('Invalid private configuration.');
  const pool = createPool({ socketPath, database, user, password, connectionLimit: 2, waitForConnections: false,
    multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 5000 });
  try { await initializeMySqlRelayStore(pool); console.log(JSON.stringify({ status: 'initialized', schemaVersion: 1 })); }
  finally { await pool.end(); }
}
main().catch(() => { process.exitCode = 1; console.error('Relay schema operation failed; inspect private configuration and schema state.'); });
