import { PROVIDER_CATALOG_IDS, type ProviderCatalogId } from './provider-catalog';
export type Theme = 'night' | 'day' | 'system';
export type AccentColor = 'blue' | 'pink' | 'purple';
export const ACCENT_COLORS: readonly AccentColor[] = ['blue', 'pink', 'purple'];
export function nextAccentColor(current: AccentColor): AccentColor {
  return ACCENT_COLORS[(ACCENT_COLORS.indexOf(current) + 1) % ACCENT_COLORS.length];
}
export type RotationMode = 'singer' | 'fifo';
export type Layout = 'standard' | 'rotation' | 'library';
export type LyricBackdrop = 'default' | 'none' | 'custom';
export type Settings = { appearance: Theme; accentColor: AccentColor; autoApprove: boolean; localControlEnabled: boolean; rotationMode: RotationMode; maxFutureRequestsPerSinger: number; layout: Layout; metadataFormat: MetadataFormat; metadataTemplates: string[]; masterVolume: number; audioOutputId: string; autoBumper: boolean; autoBumperTrackId: string; showNextSingers: boolean; showDisplayLogo: boolean; singerDisplayFullscreen: boolean; lyricBackdrop: LyricBackdrop; lyricBackdropFile: string; pauseIntervalSeconds: number; karaokeNerdsCacheDirectory: string; ytDlpExecutable: string; providerCatalogEnabled: boolean; providerCatalogProfiles: Record<ProviderCatalogId, string>; sharedCatalogEnabled: boolean; sharedCatalogConfigFile: string; ratingProfileConfigFile: string; karaokeNerdsAutoCache: boolean; karaokeNerdsBrands: string[]; karaokeNerdsArtists: string[] };

export const DEFAULT_SETTINGS: Settings = { appearance: 'system', accentColor: 'blue', autoApprove: true, localControlEnabled: false, rotationMode: 'singer', maxFutureRequestsPerSinger: 3, layout: 'standard', metadataFormat: 'artist-title', metadataTemplates: [], masterVolume: 1, audioOutputId: '', autoBumper: false, autoBumperTrackId: 'builtin-ambient', showNextSingers: false, showDisplayLogo: true, singerDisplayFullscreen: false, lyricBackdrop: 'default', lyricBackdropFile: '', pauseIntervalSeconds: 0, karaokeNerdsCacheDirectory: '', ytDlpExecutable: '', providerCatalogEnabled: true, providerCatalogProfiles: { karafun: '', partytyme: '', sunfly: '', stingray: '' }, sharedCatalogEnabled: true, sharedCatalogConfigFile: '', ratingProfileConfigFile: '', karaokeNerdsAutoCache: false, karaokeNerdsBrands: [], karaokeNerdsArtists: [] };

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
  const unknown = Object.keys(input).filter(key => !Object.hasOwn(DEFAULT_SETTINGS, key));
  if (unknown.length) throw new Error(`Unknown settings: ${unknown.join(', ')}`);
  const merged = { ...DEFAULT_SETTINGS, ...input };
  if (!ACCENT_COLORS.includes(merged.accentColor as AccentColor)) throw new Error('Invalid accent color: choose blue, pink or purple.');
  if (typeof merged.autoBumper !== 'boolean' || typeof merged.autoBumperTrackId !== 'string' || !merged.autoBumperTrackId.trim() || merged.autoBumperTrackId.length > 128 || /[\x00-\x1f\x7f]/.test(merged.autoBumperTrackId)) throw new Error('Invalid automatic bumper settings.');
  if (!['system', 'night', 'day'].includes(merged.appearance as string) || typeof merged.autoApprove !== 'boolean' || !['singer', 'fifo'].includes(merged.rotationMode as string) || !Number.isInteger(merged.maxFutureRequestsPerSinger) || (merged.maxFutureRequestsPerSinger as number) < 0 || (merged.maxFutureRequestsPerSinger as number) > 50 || !['standard', 'rotation', 'library'].includes(merged.layout as string) || !['artist-title', 'title-artist', 'filename'].includes(merged.metadataFormat as string) || typeof merged.masterVolume !== 'number' || !Number.isFinite(merged.masterVolume) || merged.masterVolume < 0 || merged.masterVolume > 1 || typeof merged.audioOutputId !== 'string' || merged.audioOutputId.length > 1024 || typeof merged.showNextSingers !== 'boolean' || typeof merged.showDisplayLogo !== 'boolean' || typeof merged.singerDisplayFullscreen !== 'boolean' || !Number.isInteger(merged.pauseIntervalSeconds) || (merged.pauseIntervalSeconds as number) < 0 || (merged.pauseIntervalSeconds as number) > 300)
    throw new Error('Invalid settings: check appearance, queue, library, audio and singer display options.');
  if (typeof merged.sharedCatalogEnabled !== 'boolean' || typeof merged.sharedCatalogConfigFile !== 'string' || merged.sharedCatalogConfigFile.length > 4096 || /[\x00-\x1f\x7f]/.test(merged.sharedCatalogConfigFile) ||
      (merged.sharedCatalogConfigFile !== '' && !/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(merged.sharedCatalogConfigFile))) throw new Error('Invalid shared catalog settings: choose an absolute private configuration path.');
  if (!['default', 'none', 'custom'].includes(merged.lyricBackdrop) || typeof merged.lyricBackdropFile !== 'string' || merged.lyricBackdropFile.length > 4096 || /[\x00-\x1f\x7f]/.test(merged.lyricBackdropFile) ||
      (merged.lyricBackdropFile !== '' && (!/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(merged.lyricBackdropFile) || !/\.mp4$/i.test(merged.lyricBackdropFile))) ||
      (merged.lyricBackdrop === 'custom' && !merged.lyricBackdropFile)) throw new Error('Invalid lyric backdrop: choose the default, solid background, or an absolute custom MP4 path.');
  if (typeof merged.ratingProfileConfigFile !== 'string' || merged.ratingProfileConfigFile.length > 4096 || /[\x00-\x1f\x7f]/.test(merged.ratingProfileConfigFile) || (merged.ratingProfileConfigFile !== '' && !/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(merged.ratingProfileConfigFile))) throw new Error('Invalid rating profile configuration: choose an absolute private JSON file path.');
  if (typeof merged.localControlEnabled !== 'boolean') throw new Error('Invalid local control setting: use true or false.');
  if (typeof merged.providerCatalogEnabled !== 'boolean') throw new Error('Invalid provider catalog setting: use true or false.');
  const profiles = merged.providerCatalogProfiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles) || Object.keys(profiles).length !== PROVIDER_CATALOG_IDS.length ||
      PROVIDER_CATALOG_IDS.some(id => !Object.hasOwn(profiles, id) || typeof profiles[id] !== 'string' || profiles[id].length > 4096 ||
        /[\x00-\x1f\x7f]/.test(profiles[id]) || (profiles[id] !== '' && !/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(profiles[id])))) {
    throw new Error('Invalid provider catalog profiles: choose absolute private credential file paths.');
  }
  const metadataTemplates = validateMetadataTemplates(merged.metadataTemplates);
  if (typeof merged.ytDlpExecutable !== 'string' || merged.ytDlpExecutable.length > 4096 || /[\x00-\x1f\x7f]/.test(merged.ytDlpExecutable) ||
      (merged.ytDlpExecutable !== '' && !/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(merged.ytDlpExecutable))) throw new Error('Invalid yt-dlp executable: use an absolute path or leave blank for PATH.');
  const directory = merged.karaokeNerdsCacheDirectory;
  if (typeof directory !== 'string' || directory.length > 4096 || /[\x00-\x1f\x7f]/.test(directory) ||
      (directory !== '' && !/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(directory)) ||
      typeof merged.karaokeNerdsAutoCache !== 'boolean')
    throw new Error('Invalid Karaoke Nerds video-cache settings: use an absolute directory.');
  const karaokeNerdsBrands = validateCacheSelections(merged.karaokeNerdsBrands, 'brand');
  const karaokeNerdsArtists = validateCacheSelections(merged.karaokeNerdsArtists, 'artist');
  return { ...merged, providerCatalogProfiles: { ...profiles }, metadataTemplates, karaokeNerdsBrands, karaokeNerdsArtists } as Settings;
}
import { validateMetadataTemplates, type MetadataFormat } from './metadata';
