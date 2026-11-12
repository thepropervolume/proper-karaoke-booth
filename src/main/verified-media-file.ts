import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import type { MediaIdentity } from './media-verification';

const matches = (actual: MediaIdentity, expected: MediaIdentity) => actual.dev === expected.dev && actual.ino === expected.ino &&
  actual.size === expected.size && actual.mtimeMs === expected.mtimeMs && actual.ctimeMs === expected.ctimeMs;

export class VerifiedMediaFileError extends Error {
  constructor() { super('The song file changed or became unavailable after verification.'); this.name = 'VerifiedMediaFileError'; }
}

/** Open a new range on the verified file, never a replacement at its pathname.
 * The caller owns the returned handle and must stream from it or close it. */
export async function openVerifiedMediaFile(path: string, expected: MediaIdentity): Promise<FileHandle> {
  let file: FileHandle | undefined;
  try {
    if (!Number.isSafeInteger(expected.size) || expected.size < 1) throw new VerifiedMediaFileError();
    const named = await lstat(path);
    if (!named.isFile() || named.isSymbolicLink() || !matches(named, expected)) throw new VerifiedMediaFileError();
    file = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
    const opened = await file.stat(), current = await lstat(path);
    if (!opened.isFile() || !matches(opened, expected) || !current.isFile() || current.isSymbolicLink() || !matches(current, expected))
      throw new VerifiedMediaFileError();
    return file;
  } catch {
    await file?.close().catch(() => {});
    throw new VerifiedMediaFileError();
  }
}
