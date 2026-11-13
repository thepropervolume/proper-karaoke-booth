/** Explicit loopback-only lifecycle for the read-only catalog service. */
import { createServer, type Server } from 'node:http';
import { createCatalogHttpHandler, type CatalogReader } from './karaokenerds-http';

export type RunningCatalogService = { port: number; stop: () => Promise<void> };

/** Does not listen until called; the service always binds to IPv4 loopback. */
export async function startCatalogService(options: {
  port: number; token: string; reader: CatalogReader; closeDependencies: () => Promise<void>; onFailure?: () => void;
  publicReadEnabled?: boolean; now?: () => number;
}): Promise<RunningCatalogService> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535 || typeof options.closeDependencies !== 'function')
    throw new Error('Invalid catalog service configuration.');
  const handler = createCatalogHttpHandler({ token: options.token, reader: options.reader,
    publicReadEnabled: options.publicReadEnabled, now: options.now });
  const server: Server = createServer(handler);
  server.maxConnections = 32;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 2_000;
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', ready); server.listen(options.port, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    server.close(); throw new Error('Invalid catalog listener.');
  }
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    try {
      await new Promise<void>((resolve, reject) => {
        const force = setTimeout(() => server.closeAllConnections(), 5_000);
        force.unref();
        server.close(error => { clearTimeout(force); error ? reject(error) : resolve(); });
        server.closeIdleConnections();
      });
    } finally { await options.closeDependencies(); }
  })();
  server.on('error', () => { options.onFailure?.(); void stop().catch(() => {}); });
  return { port: address.port, stop };
}
