/** Explicit server-side Stingray OAuth credential check. No requests on import. */
const LOGIN_URL = 'https://login.stingray.com/loginapi/oauth/deviceLogin';
const MAX_BODY = 64 * 1024;

export type StingrayAuthStatus =
  | { status: 'authenticated'; expiresInSeconds: number }
  | { status: 'invalid-configuration' | 'unauthorized' | 'rate-limited' | 'invalid-response' | 'timed-out' | 'unavailable' };
export type StingrayCredentials = { clientId: string; clientSecret: string; deviceId: string };
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function printable(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
}

export async function readStingrayJson(response: Response, limit = MAX_BODY, signal?: AbortSignal): Promise<unknown> {
  const rawLength = response.headers.get('content-length');
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > limit) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error('Invalid response');
  }
  if (!response.body) throw new Error('Invalid response');
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) throw new Error('Invalid response');
      parts.push(part.value);
    }
  } finally { signal?.removeEventListener('abort', onAbort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let position = 0;
  for (const part of parts) { bytes.set(part, position); position += part.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/**
 * Checks provider-issued client credentials with Stingray's documented device
 * login. The token is discarded; an authenticated response is not proof of
 * catalogue, account linkage, commercial rights, playback or subscription.
 */
export async function inspectStingrayCredentials(
  credentials: StingrayCredentials,
  options: { fetch?: Fetch; timeoutMs?: number } = {},
): Promise<StingrayAuthStatus> {
  if (!credentials || !printable(credentials.clientId, 512) || credentials.clientId.includes(':') ||
      !printable(credentials.clientSecret, 1024) || !printable(credentials.deviceId, 256)) return { status: 'invalid-configuration' };
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return { status: 'invalid-configuration' };
  const controller = new AbortController(); let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<StingrayAuthStatus>(resolve => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); resolve({ status: 'timed-out' }); }, timeoutMs);
  });
  const work = (async (): Promise<StingrayAuthStatus> => {
    try {
      const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, 'utf8').toString('base64');
      const response = await (options.fetch ?? fetch)(LOGIN_URL, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ deviceId: credentials.deviceId }).toString(),
      });
      if (response.status !== 200) {
        if (response.body) void response.body.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) return { status: 'unauthorized' };
        if (response.status === 429) return { status: 'rate-limited' };
        return { status: 'unavailable' };
      }
      let value: unknown;
      try { value = await readStingrayJson(response, MAX_BODY, controller.signal); } catch { return { status: timedOut ? 'timed-out' : 'invalid-response' }; }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid-response' };
      const row = value as Record<string, unknown>;
      if (!printable(row.access_token, 8192) || typeof row.token_type !== 'string' || row.token_type.toLowerCase() !== 'bearer' ||
          !Number.isSafeInteger(row.expires_in) || (row.expires_in as number) < 1 || (row.expires_in as number) > 31_536_000)
        return { status: 'invalid-response' };
      return { status: 'authenticated', expiresInSeconds: row.expires_in as number };
    } catch { return { status: timedOut ? 'timed-out' : 'unavailable' }; }
  })();
  try { return await Promise.race([work, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
