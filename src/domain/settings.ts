export type Theme = 'night' | 'day' | 'system';
export type RotationMode = 'singer' | 'fifo';
export type Layout = 'standard' | 'rotation' | 'library';
export type Settings = { appearance: Theme; autoApprove: boolean; rotationMode: RotationMode; maxFutureRequestsPerSinger: number; layout: Layout; metadataFormat: MetadataFormat; metadataTemplates: string[]; masterVolume: number; audioOutputId: string; showNextSingers: boolean; showDisplayLogo: boolean; singerDisplayFullscreen: boolean; pauseIntervalSeconds: number; karaokeNerdsCacheDirectory: string; karaokeNerdsAutoCache: boolean; karaokeNerdsBrands: string[]; karaokeNerdsArtists: string[] };

export const DEFAULT_SETTINGS: Settings = { appearance: 'system', autoApprove: true, rotationMode: 'singer', maxFutureRequestsPerSinger: 3, layout: 'standard', metadataFormat: 'artist-title', metadataTemplates: [], masterVolume: 1, audioOutputId: '', showNextSingers: false, showDisplayLogo: true, singerDisplayFullscreen: false, pauseIntervalSeconds: 0, karaokeNerdsCacheDirectory: '', karaokeNerdsAutoCache: false, karaokeNerdsBrands: [], karaokeNerdsArtists: [] };

function validateCacheSelections(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error(`Invalid Karaoke Nerds ${label} list.`);
  const seen = new Set<string>();
  return value.map(entry => {
    if (typeof entry !== 'string' || /[\x00-\x1f\x7f]/.test(entry)) throw new Error(`Invalid Karaoke Nerds ${label} entry.`);
    const name = entry.trim(), key = name.toLocaleLowerCase('en-US');
    if (!name || name.length > 200 || seen.has(key)) throw new Error(`Invalid or duplicate Karaoke Nerds ${label} entry.`);
    seen.add(key);
    return name;
  });
}

/** Validate the complete file so a typo never silently changes a show setting. */
export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be a JSON object.');
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter(key => !(key in DEFAULT_SETTINGS));
  if (unknown.length) throw new Error(`Unknown settings: ${unknown.join(', ')}`);
  const merged = { ...DEFAULT_SETTINGS, ...input };
  if (!['system', 'night', 'day'].includes(merged.appearance as string) || typeof merged.autoApprove !== 'boolean' || !['singer', 'fifo'].includes(merged.rotationMode as string) || !Number.isInteger(merged.maxFutureRequestsPerSinger) || (merged.maxFutureRequestsPerSinger as number) < 0 || (merged.maxFutureRequestsPerSinger as number) > 50 || !['standard', 'rotation', 'library'].includes(merged.layout as string) || !['artist-title', 'title-artist', 'filename'].includes(merged.metadataFormat as string) || typeof merged.masterVolume !== 'number' || !Number.isFinite(merged.masterVolume) || merged.masterVolume < 0 || merged.masterVolume > 1 || typeof merged.audioOutputId !== 'string' || merged.audioOutputId.length > 1024 || typeof merged.showNextSingers !== 'boolean' || typeof merged.showDisplayLogo !== 'boolean' || typeof merged.singerDisplayFullscreen !== 'boolean' || !Number.isInteger(merged.pauseIntervalSeconds) || (merged.pauseIntervalSeconds as number) < 0 || (merged.pauseIntervalSeconds as number) > 300)
    throw new Error('Invalid settings: check appearance, queue, library, audio and singer display options.');
  const metadataTemplates = validateMetadataTemplates(merged.metadataTemplates);
  const directory = merged.karaokeNerdsCacheDirectory;
  if (typeof directory !== 'string' || directory.length > 4096 || /[\x00-\x1f\x7f]/.test(directory) ||
      (directory !== '' && !/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(directory)) ||
      typeof merged.karaokeNerdsAutoCache !== 'boolean')
    throw new Error('Invalid Karaoke Nerds video-cache settings: use an absolute directory.');
  const karaokeNerdsBrands = validateCacheSelections(merged.karaokeNerdsBrands, 'brand');
  const karaokeNerdsArtists = validateCacheSelections(merged.karaokeNerdsArtists, 'artist');
  return { ...merged, metadataTemplates, karaokeNerdsBrands, karaokeNerdsArtists } as Settings;
}
import { validateMetadataTemplates, type MetadataFormat } from './metadata';
