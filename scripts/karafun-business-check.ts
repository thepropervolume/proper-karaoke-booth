/** Explicit development diagnostic; no playback, room changes or credential writes. */
import { karaFunBusinessExitCode, runKaraFunBusinessCheck } from '../src/main/karafun-business-client';

async function main(): Promise<void> {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node --import tsx scripts/karafun-business-check.ts status');
    console.log('Set TPV_KARAFUN_BUSINESS_TOKEN_FILE to an absolute path to a private bearer-token file.');
    console.log('Makes two read-only Business API checks. Output contains statuses/counts, never account details. This does not enable karaoke playback.');
    console.log('Exit codes: 0 both checks succeeded; 2 payment-required; 3 unauthorized; 4 rate-limited; 5 unavailable/timeout; 6 invalid response; 7 configuration/credential error; 8 restricted API access.');
    return;
  }
  if (process.argv.length !== 3 || process.argv[2] !== 'status') {
    console.log(JSON.stringify({ status: 'configuration-error' })); process.exitCode = 7; return;
  }
  const result = await runKaraFunBusinessCheck(process.env.TPV_KARAFUN_BUSINESS_TOKEN_FILE);
  console.log(JSON.stringify(result)); process.exitCode = karaFunBusinessExitCode(result);
}
main().catch(() => { console.log(JSON.stringify({ status: 'configuration-error' })); process.exitCode = 7; });
