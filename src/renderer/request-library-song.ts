import type { Command } from '../domain/index';
import type { CatalogRequestTrack } from '../domain/catalog-request';
import type { LibrarySearchVersion } from '../domain/unified-library';
type Result = { ok: boolean; error?: string; notice?: string; versionId?: string };

/** Catalog selection is committed and queued by the authority; the renderer never imports first. */
export function requestLibrarySong(version: LibrarySearchVersion, singerId: string, requestId: string, bridge: {
  requestCatalogTrack(input: { track: CatalogRequestTrack; singerId: string; requestId: string }): Promise<Result>;
  command(command: Command): Promise<Result>;
}): Promise<Result> {
  return version.catalogTrack ? bridge.requestCatalogTrack({ track: version.catalogTrack, singerId, requestId }) :
    bridge.command({ type: 'request', versionId: version.id, singerId, requestId });
}
