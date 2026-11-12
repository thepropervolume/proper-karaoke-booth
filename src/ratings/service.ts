import { createServer } from 'node:http';
import { createRatingsHttpHandler, type RatingsHttpOptions } from './http';

export async function startRatingsService(options: RatingsHttpOptions & { port: number; closeDependencies: () => Promise<void>; onFailure?: () => void }) {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Invalid ratings listener.');
  const server = createServer({ maxHeaderSize: 8192 }, createRatingsHttpHandler(options));
  server.maxConnections = 32; server.headersTimeout = 10_000; server.requestTimeout = 15_000; server.keepAliveTimeout = 2_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(options.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Invalid ratings listener.');
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    try { await new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => server.closeAllConnections(), 5_000); force.unref();
      server.close(error => { clearTimeout(force); error ? reject(error) : resolve(); }); server.closeIdleConnections();
    }); } finally { await options.closeDependencies(); }
  })();
  server.on('error', () => { options.onFailure?.(); void stop().catch(() => {}); });
  return { port: address.port, stop };
}
