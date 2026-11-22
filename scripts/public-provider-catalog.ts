import { createPublicProviderCatalogServer, PUBLIC_PROVIDER_CATALOG_PORT } from '../src/relay/public-provider-catalog';

const server = createPublicProviderCatalogServer();
server.once('error', () => { process.exitCode = 1; console.error('Public provider catalog could not start.'); });
server.listen(PUBLIC_PROVIDER_CATALOG_PORT, '127.0.0.1', () => console.log('Public provider catalog listening on loopback.'));
const stop = () => server.close(() => { process.exitCode = 0; });
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
