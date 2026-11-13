/** No enrollment or migration runs in the network-facing runtime. */
import { ratingsPoolFromEnvironment } from '../src/ratings/config';
import { MySqlRatingsStore, checkMySqlRatingsStore } from '../src/ratings/mysql-store';
import { startRatingsService } from '../src/ratings/service';

async function main() {
  const port = process.env.TPV_RATINGS_PORT;
  if (process.argv.length !== 2 || !port || !/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Invalid ratings configuration.');
  const pool = ratingsPoolFromEnvironment(); let started = false;
  try {
    await checkMySqlRatingsStore(pool);
    const service = await startRatingsService({ port: Number(port), allowedHost: 'apps.thepropervolume.com', store: new MySqlRatingsStore(pool), closeDependencies: () => pool.end(),
      onFailure: () => { process.exitCode = 1; console.error('Ratings service stopped unexpectedly.'); } });
    started = true;
    console.log(`Ratings service listening on loopback port ${service.port}.`);
    const stop = () => { void service.stop().catch(() => { process.exitCode = 1; console.error('Ratings shutdown failed.'); }); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } finally { if (!started) await pool.end(); }
}
main().catch(() => { process.exitCode = 1; console.error('Ratings service failed to start.'); });
