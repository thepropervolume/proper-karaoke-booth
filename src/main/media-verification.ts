import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export type MediaIdentity = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
function identity(value: Stats): MediaIdentity { return { dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs }; }
function same(a: MediaIdentity, b: MediaIdentity): boolean { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function cancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Media verification was cancelled.'); }
const changed = () => Object.assign(new Error('The video file changed while it was being checked.'), { code: 'ERR_MEDIA_CHANGED_DURING_READ' });

/** Hash from an open handle and reject changes or path replacement observed during the read. */
export async function fingerprintMedia(path: string, signal?: AbortSignal): Promise<{ fingerprint: string; identity: MediaIdentity }> {
  cancelled(signal);
  let handle: FileHandle | undefined;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1) throw new Error('The video file is unavailable.');
    handle = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
    const opened = await handle.stat();
    if (!opened.isFile() || !same(identity(before), identity(opened))) throw changed();
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, signal })) hash.update(chunk as Buffer);
    cancelled(signal);
    const after = await handle.stat(), current = await lstat(path);
    if (!current.isFile() || current.isSymbolicLink() || !same(identity(opened), identity(after)) || !same(identity(opened), identity(current))) throw changed();
    return { fingerprint: hash.digest('hex'), identity: identity(after) };
  } finally { await handle?.close(); }
}

/** A cloud placeholder, media metadata change, or temporarily busy file may
 * settle after the first open. Retry once and still verify the complete hash. */
export async function fingerprintPlaybackMedia(path: string, signal: AbortSignal, read = fingerprintMedia): ReturnType<typeof fingerprintMedia> {
  try { return await read(path, signal); }
  catch (reason) {
    const code = (reason as NodeJS.ErrnoException | null)?.code;
    if (signal.aborted || !['ERR_MEDIA_CHANGED_DURING_READ', 'ERR_STREAM_PREMATURE_CLOSE', 'EBUSY', 'EAGAIN', 'EIO'].includes(code ?? '')) throw reason;
    await delay(200, undefined, { signal });
    return read(path, signal);
  }
}

/** Cheap resume check after this same playback generation has already been hashed. */
export async function mediaIdentityMatches(path: string, expected: MediaIdentity): Promise<boolean> {
  try { const current = await lstat(path); return current.isFile() && !current.isSymbolicLink() && same(identity(current), expected); }
  catch { return false; }
}

/** Verify the chosen recording before the authority's conditional update. */
export async function verifyAndRelinkMedia(
  path: string, expectedFingerprint: string, signal: AbortSignal,
  canCommit: () => boolean, commit: () => boolean,
): Promise<void> {
  let checked: Awaited<ReturnType<typeof fingerprintMedia>>;
  try { checked = await fingerprintMedia(path, signal); }
  catch { throw new Error('The selected file could not be verified. Choose a readable original MP4.'); }
  if (checked.fingerprint !== expectedFingerprint) throw new Error('The selected file does not match the original recording. No link was changed.');
  const stillMatches = await mediaIdentityMatches(path, checked.identity);
  if (!canCommit() || !stillMatches) throw new Error('The song or selected file changed while relinking. Try again after playback stops.');
  if (!commit()) throw new Error('The source link changed while relinking. Try again.');
}
