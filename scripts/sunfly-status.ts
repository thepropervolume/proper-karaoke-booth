/** Explicit, read-only development operator; never accept credentials as arguments. */
import { runSunflyStatus, SUNFLY_STATUS_EXIT_CODES } from '../src/main/sunfly-operator';

async function main(): Promise<void> {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node --import tsx scripts/sunfly-status.ts status');
    console.log('Set TPV_SUNFLY_ACCESS_KEY_FILE to an absolute path to a private access-key file.');
    console.log('Output is JSON; this inspects account status and does not enable playback.');
    return;
  }
  if (process.argv.length !== 3 || process.argv[2] !== 'status') {
    console.log(JSON.stringify({ status: 'configuration-error' }));
    process.exitCode = SUNFLY_STATUS_EXIT_CODES['configuration-error'];
    return;
  }
  const result = await runSunflyStatus(process.env.TPV_SUNFLY_ACCESS_KEY_FILE);
  console.log(JSON.stringify(result));
  process.exitCode = SUNFLY_STATUS_EXIT_CODES[result.status];
}

main().catch(() => {
  console.log(JSON.stringify({ status: 'configuration-error' }));
  process.exitCode = SUNFLY_STATUS_EXIT_CODES['configuration-error'];
});
