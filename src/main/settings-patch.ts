import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../domain/settings';

/** Merge only supplied fields against the latest authority value. Call this
 * inside SettingsUpdateQueue, before applying output or other side effects. */
export function applySettingsPatch(current: Settings, value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Settings must be a JSON object.');
  const patch = value as Record<string, unknown>;
  const unknown = Object.keys(patch).filter(key => !Object.hasOwn(DEFAULT_SETTINGS, key));
  if (unknown.length) throw new Error(`Unknown settings: ${unknown.join(', ')}`);
  return parseSettings({ ...current, ...patch });
}
