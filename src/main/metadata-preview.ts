import { metadataFromPath, type MetadataFormat } from '../domain/metadata';
import type { Version } from '../domain';

export type MetadataProposal = { id: string; filename: string; oldArtist: string; oldTitle: string; artist: string; title: string; ambiguous: boolean };

/** Preview only. Older imports have no manual-edit provenance, so every change requires explicit host review. */
export function previewMetadata(versions: readonly Version[], media: (id: string) => { path: string } | undefined,
  templates: readonly string[], fallback: MetadataFormat): MetadataProposal[] {
  const proposals: MetadataProposal[] = [];
  for (const version of versions) {
    if (version.source) continue;
    const path = media(version.id)?.path;
    if (!path || !/\.mp4$/i.test(path)) continue;
    const parsed = metadataFromPath(path, templates, fallback);
    if (!parsed.matchedTemplate || (parsed.artist === version.artist && parsed.title === version.title)) continue;
    proposals.push({ id: version.id, filename: path.split(/[\\/]/).pop() ?? '', oldArtist: version.artist,
      oldTitle: version.title, artist: parsed.artist, title: parsed.title, ambiguous: parsed.ambiguous });
  }
  return proposals;
}
