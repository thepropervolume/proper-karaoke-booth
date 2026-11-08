import { createGuestApiHandler } from './remote-guest-api';
import type { RemoteRelayScope } from './remote-relay-scope';
import type { SingerStaticHandler } from './remote-static';

/** Use only behind a gate that enforces exact public Host and Origin. */
export function createRelayGuestHandler(scope: RemoteRelayScope, staticHandler: SingerStaticHandler) {
  const api = createGuestApiHandler(scope.authority);
  return async (request: Parameters<SingerStaticHandler>[0], response: Parameters<SingerStaticHandler>[1]) =>
    request.method === 'GET' ? staticHandler(request, response) : api(request, response);
}
