import type { LibraryResultMetadata } from '../domain/library-result-fields';
import type { SongResult } from './unified-song-results';

function formatCode(prefix: string, identifier: string): string {
  return identifier.toUpperCase().startsWith(prefix + '-') ? identifier : `${prefix}-${identifier}`;
}

/** Use version identifiers within their own catalogs, even when titles and artists match. */
export function djCodeForLibraryResult(row: SongResult, metadata?: LibraryResultMetadata): string {
  if (row.resultProvider === 'local') return metadata?.djCatalogNumber || metadata?.filenameDjCode ||
    [row.djCode, row.trackNumber].filter(Boolean).join('-');
  if (row.source?.provider === 'karafun') return formatCode(row.source.catalog === 'community' ? 'KFUN-C' : 'KFUN', row.source.songId);
  if (row.source?.provider === 'partytyme') return formatCode('PT', row.source.videoId);
  if (row.source?.provider === 'youtube') {
    if (row.resultProvider !== 'karaokenerds') return formatCode('YT', row.source.videoId);
    // The shared search feed includes the brand code when known. Its stable recording ID is the video ID.
    const brand = row.catalogBrandCode?.toUpperCase() || (row.source.brandSlug?.toLowerCase() === 'thepropervolume' ? 'PVOL' : 'KN');
    return formatCode(brand, row.source.videoId);
  }
  if (row.catalogOnly) {
    const prefixes = { karafun: 'KFUN', partytyme: 'PT', sunfly: 'SF', stingray: 'SR' };
    const identifier = row.catalogOnly.providerSku || row.catalogOnly.id;
    return formatCode(prefixes[row.catalogOnly.provider], identifier);
  }
  return '';
}
