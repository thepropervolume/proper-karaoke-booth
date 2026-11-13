/** Read-only account inspection for Sunfly's documented protected v2 API.
 * This is not a playback or licence implementation and does not persist credentials.
 */
const SUNFLY_ACCOUNT_URL = 'https://api.sunflykaraoke.com/api/v2/me';
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export type SunflyAccountStatus =
  | { status: 'active' }
  | { status: 'inactive' }
  | { status: 'unauthorized' }
  | { status: 'rate-limited' }
  | { status: 'invalid-response' }
  | { status: 'timed-out' }
  | { status: 'unavailable' }
  | { status: 'invalid-credential' };

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function accountResponse(value: unknown): 'active' | 'inactive' | null {
  if (!record(value) || ('success' in value && value.success !== true) || !record(value.result)) return null;
  const result = value.result;
  if (result.apiVersion !== 2 || typeof result.subscriptionActive !== 'boolean' ||
      !Array.isArray(result.players) || result.players.length > 100 ||
      !result.players.every(player => typeof player === 'string' && player.length > 0 && player.length <= 128) ||
      !Array.isArray(result.catalogues) || result.catalogues.length > 10_000 ||
      !result.catalogues.every(catalogue => record(catalogue) && Number.isSafeInteger(catalogue.id) &&
        (catalogue.id as number) > 0 && typeof catalogue.name === 'string' &&
        catalogue.name.length > 0 && catalogue.name.length <= 512 && typeof catalogue.entitled === 'boolean')) return null;
  // An active account is only a report of the subscription state; it does not
  // authorize playback or establish rights for any particular recording.
  return result.subscriptionActive ? 'active' : 'inactive';
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error('invalid response');
  }
  if (!response.body) throw new Error('invalid response');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('invalid response');
      chunks.push(part.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    // This is safe even when the body is already complete; don't wait for an
    // uncooperative peer to acknowledge cancellation.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

export async function inspectSunflyAccount(
  accessKey: string,
  options: { fetch?: FetchFn; timeoutMs?: number } = {},
): Promise<SunflyAccountStatus> {
  // Reject malformed header values before any network request; never include
  // the value in an error, URL, or result.
  if (typeof accessKey !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(accessKey)) return { status: 'invalid-credential' };
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return { status: 'unavailable' };
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SunflyAccountStatus>(resolve => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); resolve({ status: 'timed-out' }); }, timeoutMs);
  });
  const work = (async (): Promise<SunflyAccountStatus> => {
    try {
      const response = await (options.fetch ?? fetch)(SUNFLY_ACCOUNT_URL, {
        method: 'GET',
        headers: { 'X-Sunfly-Access-Key': accessKey, Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      if (response.status !== 200) {
        if (response.body) void response.body.cancel().catch(() => {});
        if (response.status === 401) return { status: 'unauthorized' };
        if (response.status === 429) return { status: 'rate-limited' };
        return { status: 'unavailable' };
      }
      try {
        const state = accountResponse(await boundedJson(response, controller.signal));
        return { status: state ?? 'invalid-response' };
      } catch { return { status: timedOut ? 'timed-out' : 'invalid-response' }; }
    } catch { return { status: timedOut ? 'timed-out' : 'unavailable' }; }
  })();
  try { return await Promise.race([work, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
