import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** This owner-local window state is independent of the editable preferences. */
export function readSingerDisplayId(path: string): number | null {
  try {
    if (statSync(path).size > 1024) return null;
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return record.version === 1 && Number.isSafeInteger(record.displayId) ? record.displayId as number : null;
  } catch { return null; }
}

export function writeSingerDisplayId(path: string, displayId: number): void {
  if (!Number.isSafeInteger(displayId)) throw new Error('Invalid singer display identity.');
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: 1, displayId }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch { /* Successful rename leaves no temporary file. */ }
  }
}
