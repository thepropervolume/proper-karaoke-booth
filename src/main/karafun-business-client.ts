/** Read-only diagnostics for the supplied KaraFun Business OpenAPI document.
 * Room/device administration is not content playback or OEM account linking.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const BASE = 'https://api.business.karafun.com';
const MAX_TOKEN_BYTES = 8192;
const MAX_RESPONSE_BYTES = 256 * 1024;
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type KaraFunBusinessEndpoint =
  | { status: 'ok'; count: number }
  | { status: 'payment-required' | 'unauthorized' | 'forbidden' | 'room-api-not-enabled' |
      'rate-limited' | 'invalid-response' | 'timed-out' | 'unavailable' };
export type KaraFunBusinessCheck =
  | { status: 'checked'; devices: KaraFunBusinessEndpoint; roomTokens: KaraFunBusinessEndpoint }
  | { status: 'invalid-credential' | 'configuration-error' };

const validToken = (value: unknown): value is string => typeof value === 'string' &&
  value.length <= MAX_TOKEN_BYTES && /^[A-Za-z0-9\-._~+/]+=*$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;

/** Read only a bounded regular file; no secret or private path leaves this module. */
export function readKaraFunBusinessToken(path: string | undefined): string {
  let fd: number | undefined;
  try {
    if (!path || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw new Error();
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_TOKEN_BYTES) throw new Error();
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const start = fstatSync(fd);
    if (!start.isFile() || start.size !== before.size || start.dev !== before.dev || start.ino !== before.ino ||
        start.mtimeMs !== before.mtimeMs || (process.platform !== 'win32' && ((start.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && start.uid !== process.getuid())))) throw new Error();
    const data = Buffer.alloc(MAX_TOKEN_BYTES + 1); let count = 0;
    while (count < data.length) { const n = readSync(fd, data, count, data.length - count, null); if (!n) break; count += n; }
    const end = fstatSync(fd), named = lstatSync(path);
    if (count !== start.size || count > MAX_TOKEN_BYTES || end.size !== start.size || end.mtimeMs !== start.mtimeMs || end.ctimeMs !== start.ctimeMs ||
        !named.isFile() || named.isSymbolicLink() || named.dev !== start.dev || named.ino !== start.ino || named.size !== start.size || named.mtimeMs !== start.mtimeMs) throw new Error();
    const token = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, count)).replace(/\r?\n$/, '');
    if (!validToken(token)) throw new Error();
    return token;
  } catch { throw new Error('Invalid configuration'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (!response.body || (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES)) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error('Invalid response');
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > MAX_RESPONSE_BYTES) throw new Error('Invalid response');
      chunks.push(part.value);
    }
  } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

function responseCount(value: unknown, kind: 'devices' | 'roomTokens'): number | null {
  if (kind === 'devices') return Array.isArray(value) && value.length <= 1000 &&
    value.every(item => record(item) && id(item.id) && (item.active === undefined || typeof item.active === 'boolean')) ? value.length : null;
  if (!record(value) || !Array.isArray(value.tokens) || value.tokens.length > 1000 || value.count !== value.tokens.length ||
      !value.tokens.every(item => record(item) && id(item.id) && id(item.device_id))) return null;
  return value.tokens.length;
}

async function inspectEndpoint(token: string, kind: 'devices' | 'roomTokens', fetchFn: FetchFn, timeoutMs: number): Promise<KaraFunBusinessEndpoint> {
  const controller = new AbortController(); let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<KaraFunBusinessEndpoint>(resolve => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); resolve({ status: 'timed-out' }); }, timeoutMs);
  });
  const work = (async (): Promise<KaraFunBusinessEndpoint> => {
    try {
      const response = await fetchFn(BASE + (kind === 'devices' ? '/device/list' : '/karafun-api-token/list'), {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      });
      if (controller.signal.aborted) { if (response.body) void response.body.cancel().catch(() => {}); return { status: 'timed-out' }; }
      if (response.status !== 200) {
        if (response.body) void response.body.cancel().catch(() => {});
        if (response.status === 401) return { status: 'unauthorized' };
        // A 402 alone does not establish credential validity or the required plan.
        if (response.status === 402) return { status: 'payment-required' };
        if (response.status === 403) return { status: kind === 'roomTokens' ? 'room-api-not-enabled' : 'forbidden' };
        if (response.status === 429) return { status: 'rate-limited' };
        return { status: 'unavailable' };
      }
      try {
        const count = responseCount(await boundedJson(response, controller.signal), kind);
        return count === null ? { status: 'invalid-response' } : { status: 'ok', count };
      } catch { return { status: timedOut ? 'timed-out' : 'invalid-response' }; }
    } catch { return { status: timedOut ? 'timed-out' : 'unavailable' }; }
  })();
  try { return await Promise.race([work, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

/** Exactly two documented GETs, without retries, redirects, writes or secret output. */
export async function inspectKaraFunBusiness(token: string, options: { fetch?: FetchFn; timeoutMs?: number } = {}): Promise<KaraFunBusinessCheck> {
  if (!validToken(token)) return { status: 'invalid-credential' };
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return { status: 'configuration-error' };
  const [devices, roomTokens] = await Promise.all(['devices', 'roomTokens'].map(kind => inspectEndpoint(token, kind as 'devices' | 'roomTokens', options.fetch ?? fetch, timeoutMs)));
  return { status: 'checked', devices, roomTokens };
}

export async function runKaraFunBusinessCheck(file: string | undefined,
  inspect: (token: string) => Promise<KaraFunBusinessCheck> = inspectKaraFunBusiness): Promise<KaraFunBusinessCheck> {
  try { return await inspect(readKaraFunBusinessToken(file)); }
  catch { return { status: 'configuration-error' }; }
}

/** Stable process codes; endpoint details remain in the structured JSON result. */
export function karaFunBusinessExitCode(result: KaraFunBusinessCheck): number {
  if (result.status !== 'checked') return 7;
  const states = [result.devices.status, result.roomTokens.status];
  if (states.every(status => status === 'ok')) return 0;
  if (states.includes('unauthorized')) return 3;
  if (states.includes('payment-required')) return 2;
  if (states.some(status => status === 'forbidden' || status === 'room-api-not-enabled')) return 8;
  if (states.includes('rate-limited')) return 4;
  if (states.includes('invalid-response')) return 6;
  return 5;
}
