import { lstatSync } from 'node:fs';
import type { StoredMedia } from './store';
import { fingerprintMedia, type MediaIdentity } from './media-verification';

export function sameStoredMedia(expected: StoredMedia | undefined, actual: StoredMedia | undefined): boolean {
  return expected === undefined ? actual === undefined : !!actual && expected.id === actual.id && expected.path === actual.path && expected.fingerprint === actual.fingerprint;
}

/** Cheap synchronous fence for the sole-authority media commit. */
export function cachedVideoIdentityMatches(path: string, expected: MediaIdentity): boolean {
  try {
    const current = lstatSync(path);
    return current.isFile() && !current.isSymbolicLink() && current.dev === expected.dev && current.ino === expected.ino &&
      current.size === expected.size && current.mtimeMs === expected.mtimeMs && current.ctimeMs === expected.ctimeMs;
  } catch { return false; }
}

/** Only an explicit retry hashes an existing cache file. A pathname alone is
 * not evidence that its saved bytes are still the expected recording. */
export async function inspectCachedVideo(media: StoredMedia, signal: AbortSignal): Promise<{ valid: boolean; identity: MediaIdentity }> {
  try {
    const checked = await fingerprintMedia(media.path, signal);
    if (!cachedVideoIdentityMatches(media.path, checked.identity)) throw new Error('Source changed.');
    return { valid: checked.fingerprint === media.fingerprint, identity: checked.identity };
  } catch {
    throw new Error(signal.aborted ? 'Video verification was cancelled.' : 'The saved video could not be checked. Check its drive and wait for file changes to finish, then retry.');
  }
}
