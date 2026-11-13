/** Explicit read-only development operator. Credentials are never arguments. */
import { inspectSunflyCatalogPage, type SunflyCatalogQuery } from '../src/main/sunfly-catalog-client';
import { readSunflyAccessKey } from '../src/main/sunfly-operator';

const exits = { ok: 0, unauthorized: 3, 'rate-limited': 4, unavailable: 5, 'timed-out': 5,
  'invalid-response': 6, 'invalid-input': 7, 'configuration-error': 7 } as const;

async function main(): Promise<void> {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node --import tsx scripts/sunfly-catalog.ts changes');
    console.log('Set TPV_SUNFLY_ACCESS_KEY_FILE to a private key file. Optional: TPV_SUNFLY_CURSOR, TPV_SUNFLY_DIRECTORY_ID, TPV_SUNFLY_LIMIT.');
    console.log('Reads one catalog change page; it does not cache, download, license, or play media.');
    return;
  }
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'changes') throw new Error('Invalid command');
    const key = readSunflyAccessKey(process.env.TPV_SUNFLY_ACCESS_KEY_FILE);
    const query: SunflyCatalogQuery = {};
    const since = process.env.TPV_SUNFLY_CURSOR, directory = process.env.TPV_SUNFLY_DIRECTORY_ID, limit = process.env.TPV_SUNFLY_LIMIT;
    if (since !== undefined) query.since = since;
    if (directory !== undefined) { if (!/^[1-9]\d*$/.test(directory)) throw new Error('Invalid directory'); query.directoryId = Number(directory); }
    if (limit !== undefined) { if (!/^[1-9]\d*$/.test(limit)) throw new Error('Invalid limit'); query.limit = Number(limit); }
    const result = await inspectSunflyCatalogPage(key, query);
    console.log(JSON.stringify(result));
    process.exitCode = exits[result.status];
  } catch {
    console.log(JSON.stringify({ status: 'configuration-error' }));
    process.exitCode = exits['configuration-error'];
  }
}

void main();
