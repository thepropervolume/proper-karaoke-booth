import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { validProviderQuery, type ProviderCatalogSearchResult } from '../domain/provider-catalog';
import { KaraFunCatalogClient } from '../main/karafun-catalog-client';
import { PartyTymeCatalogClient } from '../main/partytyme-catalog-client';

export const PUBLIC_PROVIDER_CATALOG_PORT = 8768;
const MAX_RESULTS = 50;
const MAX_SEARCHES = 12;
const CATALOG_IDS = { karafun: /^\d{1,12}$/, partytyme: /^PH\d{3,9}$/ } as const;
type Source = keyof typeof CATALOG_IDS;
type Provider = { search(query: string): Promise<ProviderCatalogSearchResult> };
type Catalogs = Record<Source, Provider>;

function parseSearch(request: IncomingMessage): { source: Source; query: string } | null {
  const target = request.url;
  if (!target?.startsWith('/search?') || target.length > 2600 || target.includes('#')) return null;
  const params = new URLSearchParams(target.slice('/search?'.length));
  if ([...params.keys()].length !== 2) return null;
  const source = params.get('source'), query = params.get('q');
  if (!(source === 'karafun' || source === 'partytyme') || !validProviderQuery(query) || query.includes('\ufffd') ||
      source === 'partytyme' && query.trim().length > 160) return null;
  return { source, query: query.trim() };
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

/** Run beside the loopback-only relay. Only this worker fetches fixed, public provider documents. */
export function createPublicProviderCatalogServer(catalogs: Catalogs = { karafun: new KaraFunCatalogClient(), partytyme: new PartyTymeCatalogClient() }) {
  let searches = 0;
  return createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1000 }, async (request, response) => {
    // The fixed host header prevents a browser from reaching the loopback service with a third-party name.
    if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.host !== `127.0.0.1:${request.socket.localPort}` ||
        request.headers.origin || request.headers.authorization || request.headers.cookie || request.headers['transfer-encoding'] ||
        request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0') {
      response.setHeader('Connection', 'close');
      return reply(response, 400, { error: 'INVALID_REQUEST' });
    }
    if (request.method !== 'GET') return reply(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const input = parseSearch(request);
    if (!input) return reply(response, 400, { error: 'INVALID_REQUEST' });
    if (searches >= MAX_SEARCHES) return reply(response, 503, { error: 'CATALOG_UNAVAILABLE' });
    searches++;
    try {
      const result = await catalogs[input.source].search(input.query);
      if (result.status === 'invalid-input') return reply(response, 400, { error: 'INVALID_REQUEST' });
      if (result.status !== 'ok' || result.provider !== input.source) return reply(response, 503, { error: 'CATALOG_UNAVAILABLE' });
      // Party Tyme Pro IDs identify that public edition. They cannot authorize consumer playback.
      const seen = new Set<string>();
      const items = result.songs.slice(0, MAX_RESULTS).flatMap(({ provider, id, title, artist }) => {
        if (provider !== input.source || !CATALOG_IDS[input.source].test(id) || seen.has(id) ||
            !title.trim() || title.length > 500 || (artist?.length ?? 0) > 500 || /[\x00-\x1f\x7f\ufffd]/u.test(title + (artist ?? ''))) return [];
        seen.add(id);
        return [{ id, title, artist: artist ?? '' }];
      });
      reply(response, 200, { items });
    } catch {
      reply(response, 503, { error: 'CATALOG_UNAVAILABLE' });
    } finally {
      searches--;
    }
  });
}
