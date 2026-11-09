/** Central-operator command. The URL/key is read from a private file, never arguments. */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { CommunityCatalogStore, fetchCommunity, validateCommunityUrl } from '../src/catalog/karaokenerds';

async function main(): Promise<void> {
  const database = process.env.TPV_KARAOKENNERDS_DATABASE;
  const operation = process.argv[2];
  if (!database || !isAbsolute(database) || !['seed', 'refresh', 'status'].includes(operation) || process.argv.length !== 3)
    throw new Error('Invalid configuration.');
  if (operation !== 'seed' && !existsSync(database)) throw new Error('Catalog database is missing.');
  const store = new CommunityCatalogStore(database);
  try {
    if (operation === 'seed') {
      const snapshot = process.env.TPV_KARAOKENNERDS_INITIAL_SNAPSHOT;
      if (!snapshot || !isAbsolute(snapshot)) throw new Error('Invalid configuration.');
      store.seed(JSON.parse(readFileSync(snapshot, 'utf8')), Date.now());
      console.log(JSON.stringify({ status: 'seeded', records: store.read()?.Items.length }));
    } else if (operation === 'refresh') {
      const file = process.env.TPV_KARAOKENNERDS_CREDENTIAL_FILE;
      if (!file || !isAbsolute(file)) throw new Error('Invalid configuration.');
      const url = readFileSync(file, 'utf8').trim();
      validateCommunityUrl(url);
      const result = await store.refresh(() => fetchCommunity(url));
      console.log(JSON.stringify(result));
      if (result.status === 'failed' || result.status === 'not-initialized') process.exitCode = 1;
    } else {
      const catalog = store.read();
      console.log(JSON.stringify({ status: catalog ? 'available' : 'not-initialized', records: catalog?.Items.length ?? 0, ...store.status() }));
    }
  } finally { store.close(); }
}

main().catch(() => { console.error('Catalog operation failed; check the private configuration and database.'); process.exitCode = 1; });
