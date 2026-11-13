import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { inspectSunflyAccount, type SunflyAccountStatus } from './sunfly-client';

const MAX_KEY_BYTES = 1026; // Maximum 1024-character key plus an optional CRLF.

export function readSunflyAccessKey(path: string | undefined): string {
  if (!path || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw new Error('Invalid configuration');
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Invalid configuration');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size < 1 || info.size > MAX_KEY_BYTES ||
        (before.ino && info.ino && (before.ino !== info.ino || before.dev !== info.dev)) ||
        (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 ||
          (typeof process.getuid === 'function' && info.uid !== process.getuid())))) throw new Error('Invalid configuration');
    const data = Buffer.alloc(MAX_KEY_BYTES + 1);
    let count = 0;
    while (count < data.length) {
      const n = readSync(fd, data, count, data.length - count, null);
      if (!n) break;
      count += n;
    }
    if (count > MAX_KEY_BYTES) throw new Error('Invalid configuration');
    return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, count)).replace(/\r?\n$/, '');
  } finally { closeSync(fd); }
}

export const SUNFLY_STATUS_EXIT_CODES: Record<SunflyAccountStatus['status'] | 'configuration-error', number> = {
  active: 0, inactive: 2, unauthorized: 3, 'rate-limited': 4,
  unavailable: 5, 'timed-out': 5, 'invalid-response': 6, 'invalid-credential': 7, 'configuration-error': 7,
};

export type SunflyOperatorResult = SunflyAccountStatus | { status: 'configuration-error' };

/** Read the access key locally; only the classified status leaves this boundary. */
export async function runSunflyStatus(
  file: string | undefined,
  inspect: (key: string) => Promise<SunflyAccountStatus> = inspectSunflyAccount,
): Promise<SunflyOperatorResult> {
  try { return await inspect(readSunflyAccessKey(file)); }
  catch { return { status: 'configuration-error' }; }
}
