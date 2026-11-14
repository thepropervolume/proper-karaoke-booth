import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { ownerOnlyDiscoveryAccess } from '../control/discovery';
import type { KHostBridgeFailure, KHostBridgeHandoff, KHostBridgeSearch, KHostBridgeSong, KHostBridgeStatus } from '../domain/khost-bridge';

export type KHostBridgeProfile = { baseUrl: string; token: string };
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
const guid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeText = (value: unknown, empty = false): value is string => typeof value === 'string'
  && value.length <= 400 && (empty || value.trim().length > 0) && !/[\x00-\x1f\x7f]/.test(value);
const invalidProfile = () => new Error('Choose the owner-only connection JSON published by the enabled TPV KHost bridge plugin.');

export function parseKHostBridgeProfile(value: unknown): KHostBridgeProfile {
  try {
    if (!object(value) || Object.keys(value).sort().join(',') !== 'baseUrl,token'
      || typeof value.baseUrl !== 'string' || typeof value.token !== 'string' || !/^[a-f\d]{64}$/.test(value.token)) throw Error();
    const url = new URL(value.baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1024
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error();
    // Only canonical literal loopback, never localhost/DNS or a remotely supplied URL.
    if (value.baseUrl !== url.origin && value.baseUrl !== url.origin + '/') throw Error();
    return { baseUrl: url.origin, token: value.token };
  } catch { throw invalidProfile(); }
}

/** Verify the named and opened inode and native owner-only permissions on both sides of the read. */
export async function readKHostBridgeProfile(path: string,
  access: { verify(path: string): Promise<void> } = ownerOnlyDiscoveryAccess): Promise<KHostBridgeProfile> {
  try {
    if (!isAbsolute(path) || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) throw Error();
    const canonical = await realpath(path);
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 4096) throw Error();
    await access.verify(canonical);
    const file = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const start = await file.stat();
      if (start.dev !== before.dev || start.ino !== before.ino || start.size !== before.size || start.mtimeMs !== before.mtimeMs) throw Error();
      const bytes = Buffer.alloc(4097); let count = 0;
      while (count < bytes.length) {
        const result = await file.read(bytes, count, bytes.length - count, null);
        if (!result.bytesRead) break; count += result.bytesRead;
      }
      const end = await file.stat();
      await access.verify(canonical);
      const named = await lstat(path);
      if (count !== start.size || count > 4096 || end.size !== start.size || end.mtimeMs !== start.mtimeMs || end.ctimeMs !== start.ctimeMs
        || !named.isFile() || named.isSymbolicLink() || named.dev !== start.dev || named.ino !== start.ino
        || named.size !== start.size || named.mtimeMs !== start.mtimeMs || named.ctimeMs !== start.ctimeMs
        || await realpath(path) !== canonical) throw Error();
      return parseKHostBridgeProfile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count))));
    } finally { await file.close(); }
  } catch { throw invalidProfile(); }
}

/** Talks only to our optional plugin, never to KaraFun or KHost's private UI circuit. */
export class KHostBridgeClient {
  private readonly profile: KHostBridgeProfile;
  private readonly fetch: Fetch;
  private readonly timeoutMs: number;
  constructor(options: KHostBridgeProfile & { fetch?: Fetch; timeoutMs?: number }) {
    this.profile = parseKHostBridgeProfile({ baseUrl: options.baseUrl, token: options.token });
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) throw invalidProfile();
  }
  private async request(path: string, body?: Record<string, string>): Promise<{ data: unknown } | KHostBridgeFailure> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error()); }, this.timeoutMs); });
    const operation = async () => {
      const response = await this.fetch(this.profile.baseUrl + path, { method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + this.profile.token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
      if (response.headers.get('x-tpv-khost-bridge') !== '1' || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
        return { status: 'protocol-error' } as const;
      const reader = response.body?.getReader();
      if (!reader) return { status: 'protocol-error' } as const;
      const chunks: Uint8Array[] = []; let total = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          total += next.value.byteLength;
          if (total > 128 * 1024) { await reader.cancel(); return { status: 'protocol-error' } as const; }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      let data: unknown;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return { status: 'protocol-error' } as const; }
      if (response.status === 401 || response.status === 403) return { status: 'unauthorized' } as const;
      if (response.status === 429) return { status: 'busy' } as const;
      if (!response.ok) {
        const errors = ['invalid-request', 'expired-result', 'handoff-unavailable', 'provider-unavailable', 'idempotency-conflict', 'unknown-request', 'sign-in-required'] as const;
        return object(data) && errors.some(error => error === data.status)
          ? { status: data.status as typeof errors[number] } : { status: 'unavailable' } as const;
      }
      return { data };
    };
    try { return await Promise.race([operation(), deadline]); }
    catch { return { status: 'unavailable' }; }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  async status(): Promise<KHostBridgeStatus> {
    const result = await this.request('/v1/status'); if (!('data' in result)) return result;
    const value = result.data;
    if (!object(value) || value.application !== 'tpv-khost-bridge' || value.apiVersion !== 1 || value.companion !== 'KHost'
      || value.provider !== 'karafun' || typeof value.providerAvailable !== 'boolean' || value.externalPlayback !== true
      || value.embeddedPlayback !== false || value.acquisition !== false) return { status: 'protocol-error' };
    return { status: 'ready', companion: 'KHost', provider: 'karafun', providerAvailable: value.providerAvailable,
      externalPlayback: true, embeddedPlayback: false, acquisition: false };
  }
  async search(query: unknown): Promise<KHostBridgeSearch> {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/.test(query)) return { status: 'invalid-request' };
    const result = await this.request('/v1/search', { query: query.trim() }); if (!('data' in result)) return result;
    const value = result.data;
    if (!object(value) || value.status !== 'ready' || value.externalPlayback !== true || value.embeddedPlayback !== false
      || !Array.isArray(value.songs) || value.songs.length > 20) return { status: 'protocol-error' };
    const songs: KHostBridgeSong[] = [];
    for (const item of value.songs) {
      if (!object(item) || !guid(item.resultId) || typeof item.providerSongId !== 'string' || !/^(?:community:)?\d{1,18}$/.test(item.providerSongId)
        || !safeText(item.title) || !safeText(item.artist, true) || typeof item.canHandoff !== 'boolean'
        || !(item.durationSeconds === null || (typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds)
          && item.durationSeconds > 0 && item.durationSeconds <= 86400))) return { status: 'protocol-error' };
      songs.push({ resultId: item.resultId.toLowerCase(), providerSongId: item.providerSongId, title: item.title, artist: item.artist,
        durationSeconds: item.durationSeconds, canHandoff: item.canHandoff });
    }
    if (new Set(songs.map(song => song.resultId)).size !== songs.length) return { status: 'protocol-error' };
    return { status: 'ready', songs, externalPlayback: true, embeddedPlayback: false };
  }
  private handoffResult(result: { data: unknown } | KHostBridgeFailure, requestId: string): KHostBridgeHandoff {
    if (!('data' in result)) return { ...result, requestId, ...(['unavailable', 'protocol-error'].includes(result.status) ? { mayHaveBeenAccepted: true } : {}) };
    const value = result.data;
    if (!object(value) || value.status !== 'handed-off' || value.requestId !== requestId
      || !['pending', 'complete', 'failed'].includes(value.state as string) || value.playback !== 'external-khost' || value.queueMayHaveChanged !== true)
      return { status: 'protocol-error', requestId, mayHaveBeenAccepted: true };
    return { status: 'handed-off', requestId, state: value.state as 'pending' | 'complete' | 'failed', playback: 'external-khost', queueMayHaveChanged: true };
  }
  async handoff(resultId: unknown, requestId: unknown): Promise<KHostBridgeHandoff> {
    if (!guid(resultId) || !guid(requestId)) return { status: 'invalid-request' };
    const id = requestId.toLowerCase();
    return this.handoffResult(await this.request('/v1/handoff', { resultId: resultId.toLowerCase(), requestId: id }), id);
  }
  async handoffStatus(requestId: unknown): Promise<KHostBridgeHandoff> {
    if (!guid(requestId)) return { status: 'invalid-request' };
    const id = requestId.toLowerCase();
    return this.handoffResult(await this.request('/v1/handoffs/' + id), id);
  }
}
