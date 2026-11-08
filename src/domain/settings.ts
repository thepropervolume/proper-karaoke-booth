export type Theme = 'night' | 'day' | 'system';
export type RotationMode = 'singer' | 'fifo';
export type Layout = 'standard' | 'rotation' | 'library';
export type Settings = { appearance: Theme; autoApprove: boolean; rotationMode: RotationMode; maxFutureRequestsPerSinger: number; layout: Layout; metadataFormat: MetadataFormat; metadataTemplates: string[]; masterVolume: number; audioOutputId: string; showNextSingers: boolean; showDisplayLogo: boolean; singerDisplayFullscreen: boolean; pauseIntervalSeconds: number };

export const DEFAULT_SETTINGS: Settings = { appearance: 'system', autoApprove: true, rotationMode: 'singer', maxFutureRequestsPerSinger: 3, layout: 'standard', metadataFormat: 'artist-title', metadataTemplates: [], masterVolume: 1, audioOutputId: '', showNextSingers: false, showDisplayLogo: true, singerDisplayFullscreen: false, pauseIntervalSeconds: 0 };

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
  return { ...merged, metadataTemplates } as Settings;
}
import { validateMetadataTemplates, type MetadataFormat } from './metadata';
