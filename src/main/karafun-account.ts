import { randomBytes } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { KaraFunAccountStatus, KaraFunSong } from '../domain/karafun';
import type { KaraFunSource } from '../domain/streaming-source';
import { karaFunElements, karaFunEnvelopeOk, karaFunSignedRequest, karaFunValue, parseKaraFunXml, type KaraFunXml } from './karafun-account-protocol';
import { KaraFunSessionVaultError, type KaraFunRememberedSession, type KaraFunSessionStore } from './karafun-session-vault';

/** Private account material is never an IPC DTO, show-state field or cache sidecar. */
export type KaraFunAccountSession = { sessionKey: string; clientId?: string; dispose?(): Promise<void> | void };
export type KaraFunMediaAuthorization = { url: string; expectedBytes: number | null; md5: string; accountScope: string; revision: number };
export class KaraFunAccountError extends Error {
  constructor(readonly code: 'disconnected' | 'expired' | 'cancelled' | 'unavailable' | 'invalid-response' | 'invalid-request' | 'not-supported' | 'not-entitled', message: string) { super(message); this.name = 'KaraFunAccountError'; }
}
const messages = {
  disconnected: 'Connect your KaraFun account in Sources before using this recording.', expired: 'Your KaraFun session needs attention. Sign in again in Sources.',
  cancelled: 'KaraFun sign-in or request was cancelled.', unavailable: 'KaraFun could not be reached. Check the connection and retry.',
  'invalid-response': 'KaraFun returned an unsupported or incomplete response. Retry or reconnect the account.',
  'invalid-request': 'Choose a valid KaraFun catalog recording.', 'not-supported': 'KaraFun community recordings are not connected for native playback yet.',
  'not-entitled': 'KaraFun did not authorize this recording. Check the account subscription and recording availability.'
} as const;
const failure = (code: keyof typeof messages) => new KaraFunAccountError(code, messages[code]);
class KaraFunRouteUnauthorized extends KaraFunAccountError {
  constructor() { super('expired', messages.expired); }
}
const songId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,11}$/.test(value);
const text = (value: string | null, empty = false): value is string => value !== null && value.length <= 500 && (empty || !!value.trim()) && !/[\x00-\x1f\x7f\ufffd]/.test(value);

export class KaraFunAccount {
  private current: KaraFunAccountStatus = { state: 'disconnected', revision: 0, persistence: 'memory-only' };
  private listeners = new Set<(value: KaraFunAccountStatus) => void>();
  private material: KaraFunAccountSession | null = null;
  private scope: string | null = null;
  private signingIn: Promise<KaraFunAccountStatus> | null = null;
  private controller: AbortController | null = null;
  private persistence: KaraFunAccountStatus['persistence'] = 'memory-only';
  constructor(private readonly dependencies: {
    onChange?: (value: KaraFunAccountStatus) => void;
    authenticate?: (parent?: BrowserWindow, signal?: AbortSignal) => Promise<KaraFunAccountSession>;
    fetch?: typeof fetch; clock?: () => number; timeoutMs?: number;
    sessionStore?: KaraFunSessionStore;
  } = {}) {}
  status(): KaraFunAccountStatus { return { ...this.current }; }
  revision(): number { return this.current.revision; }
  accountScope(): string | null { return this.current.state === 'connected' ? this.scope : null; }
  subscribe(callback: (value: KaraFunAccountStatus) => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  private publish(state: KaraFunAccountStatus['state'], message?: string, retrySavedSignIn = false): void {
    this.current = { state, revision: this.current.revision + 1, persistence: this.persistence,
      ...(message ? { message } : {}), ...(retrySavedSignIn ? { retrySavedSignIn } : {}) };
    for (const callback of [this.dependencies.onChange, ...this.listeners]) try { callback?.(this.status()); } catch { /* A view cannot invalidate an account operation. */ }
  }
  private async forget(): Promise<void> { const material = this.material; this.material = null; this.scope = null; try { await material?.dispose?.(); } catch {} }
  async disconnect(): Promise<KaraFunAccountStatus> {
    this.controller?.abort(); this.controller = null; this.signingIn = null;
    // Enqueue forgetting before any new connection can save its own session.
    const clearing = this.dependencies.sessionStore?.clear().then(() => true, () => false);
    this.persistence = 'memory-only'; this.publish('disconnected'); await this.forget();
    if (await clearing === false) this.publish('disconnected', 'Signed out for this launch. Saved sign-in could not be removed.');
    return this.status();
  }
  /** App shutdown disposes the live browser/session but preserves OS protection. */
  async close(): Promise<void> {
    this.controller?.abort(); this.controller = null; this.signingIn = null;
    this.persistence = 'memory-only'; this.publish('disconnected'); await this.forget();
  }
  signOut(): Promise<KaraFunAccountStatus> { return this.disconnect(); }
  signIn(parent?: BrowserWindow, signal?: AbortSignal): Promise<KaraFunAccountStatus> { return this.connect(parent, signal); }
  /** Startup restores only an already accepted owned session, then validates it.
   * It never opens a browser, resumes a show or retries a password. */
  restore(signal?: AbortSignal): Promise<KaraFunAccountStatus> {
    if (this.current.state === 'connected' || !this.dependencies.sessionStore) return Promise.resolve(this.status());
    if (this.signingIn) return this.signingIn;
    const controller = new AbortController(); this.controller = controller;
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    this.persistence = 'memory-only'; this.publish('connecting'); const revision = this.revision();
    const task = (async () => {
      let saved: KaraFunRememberedSession | null = null;
      let canRetry = false;
      try {
        saved = await this.dependencies.sessionStore!.load(combined);
        if (combined.aborted || revision !== this.revision()) return this.status();
        if (!saved) { this.publish('disconnected'); return this.status(); }
        if (!/^[A-Za-z0-9._~-]{1,4096}$/.test(saved.sessionKey) || !/^[a-f0-9]{64}$/.test(saved.accountScope) ||
            saved.clientId !== undefined && !/^\d{1,5}$/.test(saved.clientId)) throw failure('invalid-response');
        canRetry = true;
        const response = await this.read('session/info', saved.clientId ? { client: saved.clientId } : {}, saved.sessionKey, combined);
        if (!karaFunEnvelopeOk(response)) throw failure('expired');
        if (combined.aborted || revision !== this.revision()) return this.status();
        // Re-encrypt after validation so safeStorage key rotation can be adopted.
        try { await this.dependencies.sessionStore!.save(saved, combined); } catch { /* Existing encrypted record remains usable. */ }
        if (combined.aborted || revision !== this.revision()) return this.status();
        this.material = { sessionKey: saved.sessionKey, ...(saved.clientId ? { clientId: saved.clientId } : {}) };
        this.scope = saved.accountScope; this.persistence = 'os-protected'; this.publish('connected');
      } catch (error) {
        if (combined.aborted || revision !== this.revision()) return this.status();
        if (error instanceof KaraFunAccountError && error.code === 'expired') {
          try { await this.dependencies.sessionStore!.clear(saved?.accountScope); } catch {}
          if (revision === this.revision()) this.publish('expired', messages.expired);
        } else if (canRetry) {
          this.publish('disconnected', 'Saved sign-in could not be checked. Check the connection and retry.', true);
        } else if (error instanceof KaraFunSessionVaultError && error.code === 'unavailable') {
          this.publish('disconnected', 'Secure storage is temporarily unavailable. Unlock it and retry your saved sign-in.', true);
        } else {
          this.publish('disconnected', 'Saved sign-in could not be opened. Sign in again.');
        }
      } finally { if (this.controller === controller) this.controller = null; }
      return this.status();
    })();
    this.signingIn = task; void task.finally(() => { if (this.signingIn === task) this.signingIn = null; }); return task;
  }
  connect(parent?: BrowserWindow, signal?: AbortSignal): Promise<KaraFunAccountStatus> {
    if (this.current.state === 'connected') return Promise.resolve(this.status());
    if (this.signingIn) return this.signingIn;
    const controller = new AbortController(); this.controller = controller;
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const retrySaved = this.current.retrySavedSignIn === true;
    this.publish('connecting'); const revision = this.revision();
    const task = (async () => {
      let material: KaraFunAccountSession | null = null;
      let savedScope: string | null = null;
      try {
        if (combined.aborted || revision !== this.revision()) throw failure('cancelled');
        const authenticate = this.dependencies.authenticate ?? (async (parent, signal) => (await import('./karafun-account-auth')).authenticateKaraFunAccount(parent, signal));
        material = await authenticate(parent, combined);
        if (!material || !/^[A-Za-z0-9._~-]{1,4096}$/.test(material.sessionKey) || material.clientId !== undefined && !/^\d{1,5}$/.test(material.clientId)) throw failure('invalid-response');
        if (combined.aborted || revision !== this.revision()) throw failure('cancelled');
        const response = await this.read('session/info', material.clientId ? { client: material.clientId } : {}, material.sessionKey, combined);
        if (!karaFunEnvelopeOk(response)) throw failure('expired');
        if (combined.aborted || revision !== this.revision()) throw failure('cancelled');
        const scope = randomBytes(32).toString('hex'); let remembered = false;
        if (this.dependencies.sessionStore) {
          savedScope = scope;
          try { remembered = await this.dependencies.sessionStore.save({ sessionKey: material.sessionKey,
            ...(material.clientId ? { clientId: material.clientId } : {}), accountScope: scope }, combined); } catch { /* Sign-in still works for this launch. */ }
        }
        if (combined.aborted || revision !== this.revision()) throw failure('cancelled');
        let replacedPrevious = true;
        if (this.dependencies.sessionStore && !remembered) {
          // The new account is valid, but cannot be saved. Avoid restoring an
          // older account without telling the host on the next launch.
          replacedPrevious = await this.dependencies.sessionStore.clear().then(() => true, () => false);
        }
        if (combined.aborted || revision !== this.revision()) throw failure('cancelled');
        this.material = material; material = null; this.scope = scope; this.persistence = remembered ? 'os-protected' : 'memory-only';
        this.publish('connected', this.dependencies.sessionStore && !remembered
          ? replacedPrevious ? 'Signed in for this launch. Secure storage is unavailable.' : 'Signed in for this launch. A previous saved sign-in could not be replaced.'
          : undefined);
        return this.status();
      } catch (error) {
        try { await material?.dispose?.(); } catch {}
        if (savedScope) try { await this.dependencies.sessionStore?.clear(savedScope); } catch {}
        if (revision === this.revision()) {
          const message = error instanceof KaraFunAccountError ? error.message : combined.aborted ? messages.cancelled : messages.unavailable;
          this.publish('disconnected', message, retrySaved);
        }
        return this.status();
      } finally { if (this.controller === controller) this.controller = null; }
    })();
    this.signingIn = task; void task.finally(() => { if (this.signingIn === task) this.signingIn = null; }); return task;
  }
  // Capture scope AND revision before a provider request; checking both after
  // awaits prevents a late response from a previous sign-in authorizing playback.
  private context(): { material: KaraFunAccountSession; scope: string; revision: number } {
    if (this.current.state !== 'connected' || !this.material || !this.scope) throw failure(this.current.state === 'expired' ? 'expired' : 'disconnected');
    return { material: this.material, scope: this.scope, revision: this.revision() };
  }
  private assertCurrent(context: { scope: string; revision: number }): void { if (context.scope !== this.accountScope() || context.revision !== this.revision()) throw failure('expired'); }
  private async read(path: string, query: Record<string, string>, sessionKey: string, caller?: AbortSignal): Promise<KaraFunXml> {
    const signal = caller ? AbortSignal.any([caller, AbortSignal.timeout(this.dependencies.timeoutMs ?? 15_000)]) : AbortSignal.timeout(this.dependencies.timeoutMs ?? 15_000);
    try {
      signal.throwIfAborted(); const request = karaFunSignedRequest(path, query, sessionKey, Math.floor((this.dependencies.clock?.() ?? Date.now()) / 1000));
      const response = await (this.dependencies.fetch ?? fetch)(request.url, { method: 'GET', headers: request.headers, redirect: 'manual', signal });
      if (response.status === 401) {
        void response.body?.cancel().catch(() => {});
        throw path === 'session/info' ? failure('expired') : new KaraFunRouteUnauthorized();
      }
      if ((response.status === 403 || response.status === 402) && path === 'song/request') {
        void response.body?.cancel().catch(() => {}); throw failure('not-entitled');
      }
      // A generic 403 may be a gateway denial. Keep the saved session unless
      // KaraFun explicitly rejects it with 401 or an invalid-session response.
      if (!response.ok || response.status >= 300) { void response.body?.cancel().catch(() => {}); throw failure('unavailable'); }
      let size = 0; const chunks: Uint8Array[] = [];
      if (!response.body) throw failure('invalid-response');
      const reader = response.body.getReader(), cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        while (true) { signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted(); if (part.done) break; size += part.value.byteLength; if (size > 2 * 1024 * 1024) throw failure('invalid-response'); chunks.push(part.value); }
      } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
      const xml = parseKaraFunXml(Buffer.concat(chunks).toString('utf8'));
      if (!karaFunEnvelopeOk(xml)) {
        const error = karaFunElements(xml, 'error')[0];
        if (error && (error.text.trim() === 'INVALID_SESSION' || error.attributes.action?.toLowerCase() === 'restart')) throw failure('expired');
        throw failure(path === 'song/request' ? 'not-entitled' : 'unavailable');
      }
      return xml;
    } catch (error) {
      if (error instanceof KaraFunAccountError) throw error;
      throw failure(caller?.aborted ? 'cancelled' : signal.aborted ? 'unavailable' : 'invalid-response');
    }
  }
  private async operation<T>(task: (context: ReturnType<KaraFunAccount['context']>) => Promise<T>): Promise<T> {
    const context = this.context();
    try { const value = await task(context); this.assertCurrent(context); return value; }
    catch (error) {
      if (error instanceof KaraFunRouteUnauthorized && context.scope === this.accountScope()) {
        // A route can deny a request while the account session is still valid.
        // Check the accepted session before deleting the encrypted sign-in.
        let expired = false;
        try {
          const { clientId, sessionKey } = context.material;
          await this.read('session/info', clientId ? { client: clientId } : {}, sessionKey);
        } catch (reason) { expired = reason instanceof KaraFunAccountError && reason.code === 'expired'; }
        this.assertCurrent(context);
        if (!expired) throw failure('unavailable');
      }
      if (error instanceof KaraFunAccountError && error.code === 'expired' && context.scope === this.accountScope()) {
        this.persistence = 'memory-only'; this.publish('expired', messages.expired); await this.forget();
        try { await this.dependencies.sessionStore?.clear(context.scope); } catch {}
      }
      throw error instanceof KaraFunAccountError ? error : failure('invalid-response');
    }
  }
  search(query: string, signal?: AbortSignal): Promise<KaraFunSong[]> {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/.test(query)) return Promise.reject(failure('invalid-request'));
    return this.operation(async context => {
      const results = await this.read('search/top', { query: query.trim(), offset: '0' }, context.material.sessionKey, signal); this.assertCurrent(context);
      const list = karaFunElements(results, 'list')[0];
      const ids = [...new Set((list?.children ?? []).filter(node => node.name === 'song').map(node => node.attributes.id).filter(songId))].slice(0, 20);
      if (!ids.length) return [];
      const records = await this.read('song/info', { song: ids.join(',') }, context.material.sessionKey, signal); this.assertCurrent(context);
      const songs: KaraFunSong[] = [], seen = new Set<string>();
      for (const node of karaFunElements(records, 'song')) {
        const id = node.attributes.id, title = karaFunValue(node, 'title'), artist = karaFunValue(node, 'artist') ?? '';
        if (!songId(id) || !ids.includes(id) || seen.has(id) || !text(title) || !text(artist, true)) continue;
        const seconds = Number(karaFunValue(node, 'len')), explicit = karaFunValue(node, 'explicit');
        songs.push({ songId: id, catalog: 'catalog', title: title.trim(), artist: artist.trim(), durationSeconds: Number.isFinite(seconds) && seconds > 0 && seconds <= 86400 ? seconds : null,
          explicit: explicit === '1' || explicit?.toLowerCase() === 'true' ? true : explicit === '0' || explicit?.toLowerCase() === 'false' ? false : null }); seen.add(id);
      }
      return songs;
    });
  }
  requestMedia(source: Pick<KaraFunSource, 'catalog' | 'songId'>, signal?: AbortSignal): Promise<KaraFunMediaAuthorization> {
    if (!source || !songId(source.songId) || !['catalog', 'community'].includes(source.catalog)) return Promise.reject(failure('invalid-request'));
    if (source.catalog !== 'catalog') return Promise.reject(failure('not-supported'));
    return this.operation(async context => {
      const reply = await this.read('song/request', { song: source.songId, offline: 'play' }, context.material.sessionKey, signal); this.assertCurrent(context);
      const songs = karaFunElements(reply, 'song');
      if (songs.length > 1 || songs[0]?.attributes.id !== undefined && songs[0].attributes.id !== source.songId) throw failure('invalid-response');
      const song = songs[0] ?? reply, stream = karaFunValue(song, 'stream'), md5 = karaFunValue(song, 'md5'), rawSize = karaFunValue(song, 'filesize');
      if (!stream || stream.length > 8192 || !md5 || !/^[a-f0-9]{32}$/i.test(md5)) throw failure('invalid-response');
      let url: URL; try { url = new URL(stream); } catch { throw failure('invalid-response'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !['karafun.com', 'recis.io', 'amazonaws.com'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) throw failure('invalid-response');
      if (rawSize !== null && !/^[1-9]\d*$/.test(rawSize)) throw failure('invalid-response');
      const bytes = rawSize === null ? null : Number(rawSize);
      if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 512 * 1024 * 1024)) throw failure('invalid-response');
      return { url: url.href, expectedBytes: bytes, md5: md5.toLowerCase(), accountScope: context.scope, revision: context.revision };
    });
  }
}
export { KaraFunAccount as KaraFunAccountService };
