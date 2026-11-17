import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { INTERNET_QUEUE_ORIGIN } from '../remote/internet-session-control';
export const MOBILE_ORIGIN = INTERNET_QUEUE_ORIGIN;
export class MobileHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(status === 409 ? 'That room address is already in use or its request expired.' : status === 429 ? 'Too many requests. Wait a moment and retry.' : 'The karaoke service is unavailable. Try again.'); }
}
/** Native HTTP is restricted to our queue authority; it is not a general URL proxy. */
export const mobileFetch: typeof fetch = async (input, init = {}) => {
  const value = input instanceof Request ? input.url : String(input), url = new URL(value, MOBILE_ORIGIN);
  if (url.origin !== MOBILE_ORIGIN || !/^\/v1\/(?:mobile\/(?:hosts|catalog|nearby)|relay\/(?:lookup\/[a-z0-9-]+|host\/(?:open|poll|reply|close)|rooms\/[a-f0-9-]+\/[a-f0-9-]+\/guest\/[a-z-]+))$/.test(url.pathname) || url.search || url.hash) throw new Error('Invalid mobile service address.');
  if (!Capacitor.isNativePlatform()) return await fetch(url.href, { ...init, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (init.signal?.aborted) throw new Error('Request cancelled.');
  const headers = Object.fromEntries(new Headers(init.headers));
  const pending = CapacitorHttp.request({ url: url.href, method: init.method ?? 'GET', headers: { ...headers, Origin: MOBILE_ORIGIN },
    ...(typeof init.body === 'string' ? { data: JSON.parse(init.body) } : {}), responseType: 'json', connectTimeout: 25_000, readTimeout: 25_000, disableRedirects: true });
  // Native networking cannot always be cancelled. Ignore late replies after a
  // mode/session change; stable command receipts handle uncertain writes.
  const reply = await new Promise<Awaited<typeof pending>>((resolve, reject) => {
    const aborted = () => reject(new Error('Request cancelled.'));
    init.signal?.addEventListener('abort', aborted, { once: true });
    void pending.then(resolve, reject).finally(() => init.signal?.removeEventListener('abort', aborted)).catch(() => {});
  });
  const body = typeof reply.data === 'string' ? reply.data : JSON.stringify(reply.data);
  if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new Error('Mobile response too large.');
  return new Response(body, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
};
export async function mobileJson(path: string, input?: unknown, options: { token?: string; signal?: AbortSignal; discovery?: boolean } = {}): Promise<unknown> {
  const response = await mobileFetch(MOBILE_ORIGIN + path, { method: input === undefined ? 'GET' : 'POST', mode: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(input === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.discovery === undefined ? {} : { 'X-TPV-Room-Discovery': options.discovery ? 'yes' : 'no' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const raw = await response.text(); let code = '';
    if (raw.length <= 2048) try { const value = JSON.parse(raw); if (typeof value?.error === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.error)) code = value.error; } catch {}
    throw new MobileHttpError(response.status, code);
  }
  if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid service response.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2 * 1024 * 1024) throw new Error('Response too large.'); chunks.push(part.value); } }
  finally { void reader.cancel().catch(() => {}); }
  const data = new Uint8Array(size); let offset = 0; for (const part of chunks) { data.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
}
