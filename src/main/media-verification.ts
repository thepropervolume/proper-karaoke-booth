import { createHash } from 'node:crypto';
import { open, stat, type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export type MediaIdentity = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
function identity(value: Stats): MediaIdentity { return { dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs }; }
function same(a: MediaIdentity, b: MediaIdentity): boolean { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function cancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Media verification was cancelled.'); }

/** Hash from an open handle and reject changes or path replacement observed during the read. */
export async function fingerprintMedia(path: string, signal?: AbortSignal): Promise<{ fingerprint: string; identity: MediaIdentity }> {
  cancelled(signal);
  let handle: FileHandle | undefined;
  try {
    const before = await stat(path);
    if (!before.isFile() || before.size < 1) throw new Error('The video file is unavailable.');
    handle = await open(path, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || !same(identity(before), identity(opened))) throw new Error('The video file changed while it was being checked.');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, signal })) hash.update(chunk as Buffer);
    cancelled(signal);
    const after = await handle.stat(), current = await stat(path);
    if (!current.isFile() || !same(identity(opened), identity(after)) || !same(identity(opened), identity(current))) throw new Error('The video file changed while it was being checked.');
    return { fingerprint: hash.digest('hex'), identity: identity(after) };
  } finally { await handle?.close(); }
}

/** Cheap resume check after this same playback generation has already been hashed. */
export async function mediaIdentityMatches(path: string, expected: MediaIdentity): Promise<boolean> {
  try { const current = await stat(path); return current.isFile() && same(identity(current), expected); }
  catch { return false; }
}
