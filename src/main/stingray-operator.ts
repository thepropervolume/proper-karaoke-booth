/** Controlled server-side operator; credentials remain in a private file and memory. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { StingrayCatalogClient, type StingrayDevice, type StingraySong, type StingrayStatus } from './stingray-client';

type Config = { apiKey: string; deviceId: string; languageCode: 'en' | 'fr'; countryCode: string };
function configuration(path: string | undefined): Config {
  if (!path || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw new Error('Invalid configuration');
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Invalid configuration');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size < 1 || info.size > 8192 ||
        (before.ino && info.ino && (before.ino !== info.ino || before.dev !== info.dev)) ||
        (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 ||
          (typeof process.getuid === 'function' && info.uid !== process.getuid())))) throw new Error('Invalid configuration');
    const bytes = Buffer.alloc(8193); let count = 0;
    while (count < bytes.length) { const n = readSync(fd, bytes, count, bytes.length - count, null); if (!n) break; count += n; }
    if (count > 8192) throw new Error('Invalid configuration');
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid configuration');
    const c = value as Record<string, unknown>;
    if (Object.keys(c).sort().join(',') !== 'apiKey,countryCode,deviceId,languageCode' ||
        typeof c.apiKey !== 'string' || typeof c.deviceId !== 'string' ||
        (c.languageCode !== 'en' && c.languageCode !== 'fr') || typeof c.countryCode !== 'string') throw new Error('Invalid configuration');
    return c as Config;
  } finally { closeSync(fd); }
}

type Client = Pick<StingrayCatalogClient, 'connect' | 'searchSongs' | 'disconnect'>;
export type StingrayOperatorResult = { status: StingrayStatus | 'configuration-error'; songs?: StingraySong[] };

/** Actual network traffic happens only when this function is explicitly called. */
export async function runStingrayOperator(path: string | undefined, query: string | null,
  create: (key: string) => Client = key => new StingrayCatalogClient(key)): Promise<StingrayOperatorResult> {
  let client: Client | undefined;
  try {
    const config = configuration(path);
    client = create(config.apiKey);
    const device: StingrayDevice = { deviceId: config.deviceId, languageCode: config.languageCode, countryCode: config.countryCode };
    const status = await client.connect(device);
    if (status !== 'ok' || query === null) return { status };
    return await client.searchSongs(query);
  } catch { return { status: 'configuration-error' }; }
  finally { client?.disconnect(); }
}

export const STINGRAY_EXIT_CODES: Record<StingrayStatus | 'configuration-error', number> = {
  ok: 0, 'invalid-input': 2, unauthorized: 3, 'rate-limited': 4, unavailable: 5,
  'timed-out': 5, 'invalid-response': 6, 'configuration-error': 7,
};
