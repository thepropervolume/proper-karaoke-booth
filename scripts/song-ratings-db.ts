/** Explicit operator-only schema initialization; runtime never imports this. */
import { ratingsPoolFromEnvironment } from '../src/ratings/config';
import { initializeMySqlRatingsStore, checkMySqlRatingsStore } from '../src/ratings/mysql-store';
async function main() {
  if (process.argv.length !== 3 || !['init', 'check'].includes(process.argv[2])) throw new Error('Invalid ratings operator command.');
  const pool = ratingsPoolFromEnvironment();
  try {
    if (process.argv[2] === 'init') await initializeMySqlRatingsStore(pool);
    else await checkMySqlRatingsStore(pool);
    console.log('Ratings schema verified.');
  } finally { await pool.end(); }
}
main().catch(() => { process.exitCode = 1; console.error('Ratings schema operation failed.'); });
