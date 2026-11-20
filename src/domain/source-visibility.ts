import type { Version } from './index';
import type { SourceId, SourceVisibility } from './settings';

/** Determine discovery origin without confusing cached provider media with imports. */
export function sourceForVersion(version: Pick<Version, 'source' | 'discoveryOrigin'> & { catalogTrack?: unknown }): SourceId {
  if (version.source?.provider === 'karafun') return 'karafun';
  if (version.source?.provider === 'partytyme') return 'partytyme';
  if (version.catalogTrack || version.source?.provider === 'youtube' && (version.source.brandSlug || version.discoveryOrigin === 'karaokenerds')) return 'karaokenerds';
  return version.source?.provider === 'youtube' ? 'youtube' : 'local';
}

export function sourceIsVisible(version: Pick<Version, 'source' | 'discoveryOrigin'> & { catalogTrack?: unknown }, visibility?: Partial<SourceVisibility>): boolean {
  return visibility?.[sourceForVersion(version)] !== false;
}
