/** Offline integrity inspection only: this module does not execute or download a connector. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

export type TrustedCloudflaredRelease = Readonly<{ version: string; sha256: string }>;
/** Cloudflare's 2026.10.7 release notes, Windows amd64 executable. Update deliberately from the official release. */
export const CLOUDFLARED_WINDOWS_AMD64: TrustedCloudflaredRelease = Object.freeze({
  version: '2026.10.7',
  sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343',
});
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;

/**
 * Checks the bytes of a selected Windows executable against trusted, app-owned
 * release data. The release argument must never come from a renderer or an
 * untrusted download. A later spawn by path must still address replacement races.
 */
export async function inspectCloudflaredWindows(executable: string,
  release: TrustedCloudflaredRelease = CLOUDFLARED_WINDOWS_AMD64): Promise<{ version: string; sha256: string; size: number }> {
  if (!isAbsolute(executable) || !/^(?:cloudflared|cloudflared-windows-amd64)\.exe$/i.test(basename(executable)) ||
      !/^20\d\d\.\d{1,2}\.\d{1,3}$/.test(release.version) || !/^[a-f0-9]{64}$/.test(release.sha256))
    throw new Error('Invalid connector or trusted release.');
  const before = await lstat(executable);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_EXECUTABLE_BYTES)
    throw new Error('Connector is not a supported regular file.');
  const file = await open(executable, 'r');
  try {
    const opened = await file.stat();
    const same = (a: typeof before, b: typeof before) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
    if (!opened.isFile() || !same(before, opened)) throw new Error('Connector changed during inspection.');
    const hash = createHash('sha256');
    const stream = file.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk as Buffer);
    const value = hash.digest();
    const after = await file.stat(), current = await lstat(executable);
    if (!current.isFile() || current.isSymbolicLink() || !same(before, after) || !same(before, current))
      throw new Error('Connector changed during inspection.');
    if (!timingSafeEqual(value, Buffer.from(release.sha256, 'hex'))) throw new Error('Connector does not match the trusted release.');
    return { version: release.version, sha256: value.toString('hex'), size: opened.size };
  } finally { await file.close(); }
}
