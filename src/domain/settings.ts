export type Theme = 'night' | 'day' | 'system';
export type RotationMode = 'singer' | 'fifo';
export type Layout = 'standard' | 'rotation' | 'library';
export type Settings = { appearance: Theme; autoApprove: boolean; rotationMode: RotationMode; layout: Layout; metadataFormat: MetadataFormat };

export const DEFAULT_SETTINGS: Settings = { appearance: 'system', autoApprove: true, rotationMode: 'singer', layout: 'standard', metadataFormat: 'artist-title' };

/** Validate the complete file so a typo never silently changes a show setting. */
export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be a JSON object.');
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).filter(key => !(key in DEFAULT_SETTINGS));
  if (unknown.length) throw new Error(`Unknown settings: ${unknown.join(', ')}`);
  const merged = { ...DEFAULT_SETTINGS, ...input };
  if (!['system', 'night', 'day'].includes(merged.appearance as string) || typeof merged.autoApprove !== 'boolean' || !['singer', 'fifo'].includes(merged.rotationMode as string) || !['standard', 'rotation', 'library'].includes(merged.layout as string) || !['artist-title', 'title-artist', 'filename'].includes(merged.metadataFormat as string))
    throw new Error('Invalid settings: check appearance, autoApprove, rotationMode, layout and metadataFormat.');
  return merged as Settings;
}
import type { MetadataFormat } from './metadata';
