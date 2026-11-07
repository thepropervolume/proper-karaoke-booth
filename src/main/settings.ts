import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../domain/settings';

export function readSettings(path: string): Settings {
  try { return parseSettings(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      mkdirSync(dirname(path), { recursive: true });
      writeSettings(path, DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    throw new Error(`Could not read settings at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeSettings(path: string, value: unknown): Settings {
  const settings = parseSettings(value);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* no temporary file remains */ }
    throw error;
  }
  return settings;
}
