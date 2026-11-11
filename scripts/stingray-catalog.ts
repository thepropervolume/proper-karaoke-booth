/** Explicit development operator: no provider connection is made at import. */
import { runStingrayOperator, STINGRAY_EXIT_CODES } from '../src/main/stingray-operator';

async function main(): Promise<void> {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node --import tsx scripts/stingray-catalog.ts status|search');
    console.log('Set TPV_STINGRAY_CONFIG_FILE to an absolute private config file.');
    console.log('For search, set TPV_STINGRAY_SEARCH to a search phrase of 3–40 characters.');
    console.log('No playback or production authorization is implied by a successful response.');
    return;
  }
  if (process.argv.length !== 3 || !['status', 'search'].includes(process.argv[2])) {
    console.log(JSON.stringify({ status: 'configuration-error' }));
    process.exitCode = STINGRAY_EXIT_CODES['configuration-error']; return;
  }
  const query = process.argv[2] === 'search' ? process.env.TPV_STINGRAY_SEARCH ?? '' : null;
  const result = await runStingrayOperator(process.env.TPV_STINGRAY_CONFIG_FILE, query);
  console.log(JSON.stringify(result));
  process.exitCode = STINGRAY_EXIT_CODES[result.status];
}
main().catch(() => { console.log(JSON.stringify({ status: 'configuration-error' })); process.exitCode = STINGRAY_EXIT_CODES['configuration-error']; });
