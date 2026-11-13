import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SHORTCUTS, parseShortcuts, type Shortcuts } from '../domain/shortcuts';

/** Validate before replacing, so a conflict never damages the working shortcuts. */
export function writeShortcuts(path: string, value: unknown): Shortcuts {
  const shortcuts = parseShortcuts(value), temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify(shortcuts, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* No staged file remains. */ }
    throw error;
  }
  return shortcuts;
}

export function readShortcuts(path: string): Shortcuts {
  try { return parseShortcuts(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return writeShortcuts(path, DEFAULT_SHORTCUTS);
    throw new Error(`Could not read keyboard shortcuts at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
