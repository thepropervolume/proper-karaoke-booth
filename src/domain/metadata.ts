export type MetadataFormat = 'artist-title' | 'title-artist' | 'filename';

/** Only the supplied filename stem is parsed; source files are never changed. */
export function metadataFromFilename(stem: string, format: MetadataFormat): { title: string; artist: string } {
  const label = stem.trim();
  const split = label.indexOf(' - ');
  if (format === 'filename' || split <= 0 || !label.slice(split + 3).trim()) return { title: label, artist: '' };
  const first = label.slice(0, split).trim();
  const second = label.slice(split + 3).trim();
  return format === 'title-artist' ? { title: first, artist: second } : { title: second, artist: first };
}
