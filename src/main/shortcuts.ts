import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_SHORTCUTS, parseShortcuts, type Shortcuts } from '../domain/shortcuts';

export function readShortcuts(path: string): Shortcuts {
  try { return parseShortcuts(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      writeFileSync(path, `${JSON.stringify(DEFAULT_SHORTCUTS, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      return parseShortcuts(DEFAULT_SHORTCUTS);
    }
    throw new Error(`Could not read keyboard shortcuts at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
