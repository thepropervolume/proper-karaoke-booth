/** Explicit server-side operator commands. Credentials are read from private files, never argv. */
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createPool, type PoolOptions } from 'mysql2/promise';
import { fetchCommunity, validateCommunityUrl } from '../src/catalog/karaokenerds';
import { initializeMySqlCatalog, MySqlCommunityCatalogStore, parseCatalogRefreshGate } from '../src/catalog/karaokenerds-mysql';

function privateFile(name: string, maxBytes: number): string {
  const file = process.env[name];
  if (!file || !isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file)) throw new Error('Invalid private configuration.');
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maxBytes || (process.platform !== 'win32' && (info.mode & 0o077) !== 0))
    throw new Error('Invalid private configuration.');
  return readFileSync(file, 'utf8');
}

function mysqlConfig(): PoolOptions {
  const socketPath = process.env.TPV_KN_MYSQL_SOCKET, host = process.env.TPV_KN_MYSQL_HOST ?? '127.0.0.1';
  const database = process.env.TPV_KN_MYSQL_DATABASE, user = process.env.TPV_KN_MYSQL_USER;
  const rawPort = process.env.TPV_KN_MYSQL_PORT ?? '3306', port = Number(rawPort);
  if (!database || !/^[A-Za-z0-9_]{1,64}$/.test(database) || !user || !/^[A-Za-z0-9_.-]{1,64}$/.test(user) ||
      !/^\d{1,5}$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      (socketPath ? !isAbsolute(socketPath) : !['127.0.0.1', '::1', 'localhost'].includes(host)))
    throw new Error('Invalid private configuration.');
  const password = process.env.TPV_KN_MYSQL_PASSWORD_FILE ? privateFile('TPV_KN_MYSQL_PASSWORD_FILE', 4096).replace(/\r?\n$/, '') : '';
  return { ...(socketPath ? { socketPath } : { host, port }), database, user, password, connectionLimit: 3,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false, connectTimeout: 10_000 };
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (process.argv.length !== 3 || !['initialize', 'import', 'seed-readonly', 'status', 'refresh', 'recover-refresh'].includes(operation)) throw new Error('Invalid operation.');
  if (operation === 'seed-readonly' && process.env.TPV_KN_REFRESH_DISABLED !== 'yes') throw new Error('Read-only snapshot seeding requires disabled refresh.');
  const pool = createPool(mysqlConfig());
  try {
    if (operation === 'initialize') {
      await initializeMySqlCatalog(pool);
      console.log(JSON.stringify({ status: 'initialized' }));
    } else {
      const store = new MySqlCommunityCatalogStore(pool);
      if (operation === 'seed-readonly') {
        const raw = JSON.parse(privateFile('TPV_KN_RAW_SNAPSHOT_FILE', 128 * 1024 * 1024)) as unknown;
        await store.seedReadOnlyCatalog(raw);
        console.log(JSON.stringify({ status: 'seeded-readonly', refreshEnabled: false }));
      } else if (operation === 'import') {
        if (process.env.TPV_KN_LEGACY_UPDATER_STOPPED !== 'yes') throw new Error('Stop the legacy updater first.');
        const exported = JSON.parse(privateFile('TPV_KN_SQLITE_EXPORT_FILE', 128 * 1024 * 1024)) as unknown;
        await store.importCatalog(exported);
        console.log(JSON.stringify({ status: 'imported' }));
      } else if (operation === 'status') {
        const data = await store.read();
        console.log(JSON.stringify({ status: data ? 'available' : 'not-initialized', records: data?.Items.length ?? 0, ...await store.status() }));
      } else if (operation === 'recover-refresh') {
        if (process.env.TPV_KN_CONFIRMED_UPDATER_STOPPED !== 'yes') throw new Error('Stop the interrupted updater first.');
        console.log(JSON.stringify({ status: 'recovered', ...await store.recoverInterruptedRefresh() }));
      } else {
        if (process.env.TPV_KN_SINGLE_UPDATER_CONFIRMED !== 'yes') throw new Error('Single updater must be confirmed.');
        const endpoint = privateFile('TPV_KN_UPSTREAM_URL_FILE', 16_384).trim();
        validateCommunityUrl(endpoint);
        const handoff = process.env.TPV_KN_REFRESH_GATE_FILE === undefined ? undefined
          : parseCatalogRefreshGate(JSON.parse(privateFile('TPV_KN_REFRESH_GATE_FILE', 1024)));
        const response = await store.refresh(() => fetchCommunity(endpoint), handoff);
        console.log(JSON.stringify(response));
        if (response.status === 'failed' || response.status === 'not-initialized' || response.status === 'recovery-required') process.exitCode = 1;
      }
    }
  } finally { await pool.end(); }
}

main().catch(() => { console.error('Catalog operation failed; check private configuration, database permissions and updater state.'); process.exitCode = 1; });
