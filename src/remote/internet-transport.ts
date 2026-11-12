import { JoinRevisionConflict, type GuestTransport } from './client';
import { INTERNET_QUEUE_ORIGIN, validateSessionSlug } from './internet-session-control';
import { parseGuestAdmission, parseGuestCatalog, parseGuestJoin, parseGuestOutcome, parseGuestOutcomeLookup, parseGuestSnapshot } from './guest-response';

export type InternetSingerRoom = { roomId: string; generation: string; slug: string; expiresAt: number; online: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export class InternetSessionEnded extends Error {}

async function json(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('Invalid session response.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > maxBytes) throw new Error('Invalid session response.'); chunks.push(item.value); }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as unknown;
}

async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('The show did not respond.')); }, timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function lookupInternetSingerRoom(slug: string, fetcher: Fetcher = fetch): Promise<InternetSingerRoom> {
  if (validateSessionSlug(slug)) throw new Error('Invalid session address.');
  return await bounded(async signal => {
    const response = await fetcher(`${INTERNET_QUEUE_ORIGIN}/v1/relay/lookup/${slug}`, {
      method: 'GET', credentials: 'omit', mode: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
    });
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('This session is unavailable.'); }
    const value = await json(response, 8192);
    if (!record(value) || typeof value.roomId !== 'string' || !UUID.test(value.roomId) || typeof value.generation !== 'string' || !UUID.test(value.generation) ||
        value.slug !== slug || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= Date.now() || typeof value.online !== 'boolean') throw new Error('This session is unavailable.');
    return { roomId: value.roomId, generation: value.generation, slug, expiresAt: value.expiresAt as number, online: value.online };
  }, 10000);
}

/** This adapter is permanently scoped to one room and generation, never to a reusable slug. */
export function internetGuestTransport(room: InternetSingerRoom, options: { fetch?: Fetcher; onEnded?: () => void } = {}): GuestTransport {
  if (!UUID.test(room.roomId) || !UUID.test(room.generation) || validateSessionSlug(room.slug)) throw new Error('Invalid session.');
  const base = `${INTERNET_QUEUE_ORIGIN}/v1/relay/rooms/${room.roomId}/${room.generation}/guest/`;
  let ended = false;
  const post = async <T,>(operation: string, payload: unknown, parse: (value: unknown) => T, session?: string): Promise<T> => {
    if (ended || room.expiresAt <= Date.now()) throw new InternetSessionEnded();
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).byteLength > 8192 || session !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(session)) throw new Error('Invalid singer request.');
    return await bounded(async signal => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (session) headers.Authorization = `Bearer ${session}`;
      const response = await (options.fetch ?? fetch)(base + operation, { method: 'POST', headers, body, credentials: 'omit', mode: 'same-origin',
        cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal });
      if (response.status === 410) {
        void response.body?.cancel().catch(() => {}); ended = true; options.onEnded?.(); throw new InternetSessionEnded();
      }
      if (!response.ok) {
        if (operation === 'join' && response.status === 409) {
          const value = await json(response, 8192);
          if (record(value) && Object.keys(value).length === 1 && value.error === 'REVISION_CONFLICT') throw new JoinRevisionConflict();
        } else void response.body?.cancel().catch(() => {});
        throw new Error('The show could not confirm this request.');
      }
      return parse(await json(response, 2 * 1024 * 1024));
    }, 20000);
  };
  return {
    admission: () => post('admission', {}, parseGuestAdmission),
    join: (_invitation, joinId, resumeSecret, name, expectedRevision) => post('join', { joinId, resumeSecret, name, expectedRevision }, parseGuestJoin),
    resume: resumeSecret => post('resume', { resumeSecret }, parseGuestJoin),
    snapshot: session => post('snapshot', {}, parseGuestSnapshot, session),
    catalog: (session, offset, limit) => post('catalog', { offset, limit }, value => parseGuestCatalog(value, offset, limit), session),
    submit: (session, command) => post('request', { command }, parseGuestOutcome, session),
    withdraw: (session, command) => post('withdraw', { command }, parseGuestOutcome, session),
    setAvailability: (session, command) => post('availability', { command }, parseGuestOutcome, session),
    submitMissing: (session, command) => post('missing-request', { command }, parseGuestOutcome, session),
    outcome: (session, commandId) => post('outcome', { commandId }, parseGuestOutcomeLookup, session),
  };
}
