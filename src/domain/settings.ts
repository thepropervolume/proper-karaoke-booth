export type Theme = 'night' | 'day' | 'system';
export type RotationMode = 'singer' | 'fifo';
export type Layout = 'standard' | 'rotation' | 'library';
export type Settings = { appearance: Theme; autoApprove: boolean; rotationMode: RotationMode; layout: Layout; metadataFormat: MetadataFormat; metadataTemplates: string[]; masterVolume: number; showNextSingers: boolean; showDisplayLogo: boolean };

export const DEFAULT_SETTINGS: Settings = { appearance: 'system', autoApprove: true, rotationMode: 'singer', layout: 'standard', metadataFormat: 'artist-title', metadataTemplates: [], masterVolume: 1, showNextSingers: false, showDisplayLogo: true };

/** Validate the complete file so a typo never silently changes a show setting. */
export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be a JSON object.');
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter(key => !(key in DEFAULT_SETTINGS));
  if (unknown.length) throw new Error(`Unknown settings: ${unknown.join(', ')}`);
  const merged = { ...DEFAULT_SETTINGS, ...input };
  if (!['system', 'night', 'day'].includes(merged.appearance as string) || typeof merged.autoApprove !== 'boolean' || !['singer', 'fifo'].includes(merged.rotationMode as string) || !['standard', 'rotation', 'library'].includes(merged.layout as string) || !['artist-title', 'title-artist', 'filename'].includes(merged.metadataFormat as string) || typeof merged.masterVolume !== 'number' || !Number.isFinite(merged.masterVolume) || merged.masterVolume < 0 || merged.masterVolume > 1 || typeof merged.showNextSingers !== 'boolean' || typeof merged.showDisplayLogo !== 'boolean')
    throw new Error('Invalid settings: check appearance, autoApprove, rotationMode, layout, metadataFormat, masterVolume and singer display options.');
  const metadataTemplates = validateMetadataTemplates(merged.metadataTemplates);
  return { ...merged, metadataTemplates } as Settings;
}
import { validateMetadataTemplates, type MetadataFormat } from './metadata';
