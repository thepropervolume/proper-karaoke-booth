import { randomUUID } from 'node:crypto';
import { isVersionAllowed, orderedFuture, type ShowState } from '../domain';
import { compileSongBlacklist } from '../domain/song-blacklist';
import { karaFunRequest } from '../domain/karafun-request';
import type { Settings } from '../domain/settings';
import type { KaraFunPreparation, KaraFunSearchReply, KaraFunSong } from '../domain/karafun';
import type { KaraFunSource } from '../domain/streaming-source';
import type { KaraFunAccount } from './karafun-account';
import { KaraFunMediaCache, KaraFunMediaError, type KaraFunPreparedMedia } from './karafun-media';
import { QueuedVideoDownloads } from './queued-video-downloads';
import type { StoredMedia } from './store';

type Account = Pick<KaraFunAccount, 'status' | 'revision' | 'accountScope' | 'search' | 'requestMedia'>;
const sourceKey = (source: KaraFunSource) => `${source.catalog}:${source.songId}`;
/** The host authority owns search receipts, queue commits and private acquisition. */
export class KaraFunHost {
  // A renderer selects a short-lived receipt, not arbitrary provider metadata
  // or a download URL. Only songs returned for the current account may be queued.
  private receipts: { id: string; revision: number; until: number; songs: Map<string, KaraFunSong> } | null = null;
  private searchAbort: AbortController | null = null;
  private operations = new Set<AbortController>();
  private prepared = new Map<string, KaraFunPreparedMedia>();
  private progress = new Map<string, KaraFunPreparation>();
  private closed = false;
  private queue: QueuedVideoDownloads;
  constructor(private readonly account: Account, private readonly cache: KaraFunMediaCache, private readonly ports: {
    state(): ShowState; settings(): Settings; media(id: string): StoredMedia | undefined;
    commit(state: ShowState, media?: StoredMedia[]): void; changed(): void;
  }) {
    this.queue = new QueuedVideoDownloads(async id => { await this.prepare(id); return null; });
  }
  status(): KaraFunPreparation[] { return [...this.progress.values()]; }
  needsShutdownWait(): boolean { return this.operations.size > 0 || !!this.queue.snapshot().activeVersionId; }
  private report(value: KaraFunPreparation): void {
    this.progress.delete(value.versionId); this.progress.set(value.versionId, value);
    while (this.progress.size > 100) this.progress.delete(this.progress.keys().next().value!);
    this.ports.changed();
  }
  accountChanged(): void {
    this.receipts = null; this.searchAbort?.abort();
    for (const operation of this.operations) operation.abort();
    this.prepared.clear(); this.progress.clear();
    // A new session can retry an earlier expired/failed preparation once.
    if (this.account.status().state === 'connected') {
      const revision = this.account.revision();
      void this.queue.idle().then(() => { if (!this.closed && revision === this.account.revision()) for (const id of this.wanted()) this.queue.enqueue(id, true); });
    }
    this.sync(); this.ports.changed();
  }
  private wanted(): string[] {
    const state = this.ports.state(), settings = this.ports.settings();
    return orderedFuture(state, settings.rotationMode, Date.now()).filter(request =>
      ['accepted', 'staged'].includes(request.status) && isVersionAllowed(state, request.versionId, settings) &&
      state.versions.find(version => version.id === request.versionId)?.source?.provider === 'karafun').map(request => request.versionId);
  }
  sync(): void {
    if (this.closed) return;
    this.queue.reconcile(this.account.status().state === 'connected' ? this.wanted() : []);
  }
  retry(id: string): void {
    if (this.account.status().state !== 'connected') throw new Error('Sign in to KaraFun in Sources first.');
    if (this.ports.state().versions.find(version => version.id === id)?.source?.provider !== 'karafun') throw new Error('Choose a KaraFun recording.');
    this.queue.enqueue(id, true);
  }
  async search(input: unknown): Promise<KaraFunSearchReply> {
    this.searchAbort?.abort(); this.receipts = null;
    if (this.closed || this.account.status().state !== 'connected') return { status: 'disconnected', songs: [] };
    if (typeof input !== 'string' || input.trim().length < 2 || input.length > 250) return { status: 'ok', songs: [] };
    // Show allowlists expose only approved library versions, never fresh external
    // identities. Local allowed rows remain available through the host library.
    if (this.ports.state().policy.includeVersionIds !== null) return { status: 'ok', songs: [] };
    const abort = new AbortController(), revision = this.account.revision(); this.searchAbort = abort;
    try {
      const results = await this.account.search(input.trim(), abort.signal);
      const state = this.ports.state();
      if (state.policy.includeVersionIds !== null) return { status: 'ok', songs: [] };
      const blacklist = compileSongBlacklist(this.ports.settings());
      const excludedIds = new Set(state.policy.excludeVersionIds);
      const excludedSources = new Set(state.versions.flatMap(version => version.source?.provider === 'karafun' && excludedIds.has(version.id)
        ? [sourceKey(version.source)] : []));
      const songs = results.filter(song =>
        !excludedSources.has(sourceKey({ ...song, provider: 'karafun' })) && !blacklist.isBlocked(song) &&
        (!state.policy.ageRestricted || song.explicit === false)).slice(0, 1000);
      if (abort.signal.aborted || revision !== this.account.revision() || this.closed) return { status: 'unavailable', songs: [] };
      const id = randomUUID();
      this.receipts = { id, revision, until: Date.now() + 600_000, songs: new Map(songs.map(song => [sourceKey({ ...song, provider: 'karafun' }), song])) };
      return { status: 'ok', searchId: id, songs };
    } catch { return { status: this.account.status().state === 'connected' ? 'unavailable' : 'disconnected', songs: [], message: 'KaraFun search is unavailable. Check the account in Sources and retry.' }; }
    finally { if (this.searchAbort === abort) this.searchAbort = null; }
  }
  request(value: unknown): { ok: boolean; versionId?: string; error?: string; notice?: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Choose a current KaraFun search result.' };
    const input = value as Record<string, unknown>, receipt = this.receipts;
    if (Object.keys(input).some(key => !['searchId', 'songId', 'catalog', 'singerId', 'requestId'].includes(key)) ||
        !receipt || receipt.id !== input.searchId || receipt.revision !== this.account.revision() || receipt.until < Date.now() ||
        this.account.status().state !== 'connected' || typeof input.songId !== 'string' || typeof input.catalog !== 'string' ||
        (input.singerId !== null && typeof input.singerId !== 'string') || typeof input.requestId !== 'string') return { ok: false, error: 'Search KaraFun again before requesting this recording.' };
    const song = receipt.songs.get(`${input.catalog}:${input.songId}`);
    if (!song) return { ok: false, error: 'Choose a current KaraFun search result.' };
    const planned = karaFunRequest(this.ports.state(), { songId: song.songId, catalog: song.catalog, title: song.title, artist: song.artist, explicit: song.explicit },
      input.singerId, input.requestId, this.ports.settings(), { versionId: randomUUID(), commandId: randomUUID() }, Date.now());
    if (!planned.result.ok) return planned.result;
    this.ports.commit(planned.state); this.sync();
    return { ...planned.result, notice: 'Added to the TPV queue. KaraFun preparation runs in the background; press Play when ready.' };
  }
  private valid(id: string, source: KaraFunSource, revision: number, scope: string): boolean {
    const current = this.ports.state().versions.find(version => version.id === id)?.source;
    return !this.closed && revision === this.account.revision() && scope === this.account.accountScope() &&
      this.account.status().state === 'connected' && current?.provider === 'karafun' && sourceKey(current) === sourceKey(source) &&
      isVersionAllowed(this.ports.state(), id, this.ports.settings());
  }
  private async prepare(id: string, existingOnly = false): Promise<KaraFunPreparedMedia> {
    const source = this.ports.state().versions.find(version => version.id === id)?.source;
    const revision = this.account.revision(), scope = this.account.accountScope();
    if (source?.provider !== 'karafun' || !scope || !this.valid(id, source, revision, scope)) throw new Error('Sign in to KaraFun and check the show policy before preparing this song.');
    const abort = new AbortController(); this.operations.add(abort);
    const baseline = this.ports.media(id);
    try {
      const prepared = await this.cache.prepare(source, scope, async signal => {
        const descriptor = await this.account.requestMedia(source, signal);
        if (descriptor.revision !== revision || descriptor.accountScope !== scope) throw new Error('The KaraFun account changed. Retry preparation.');
        return descriptor;
      }, { signal: abort.signal, previousPath: baseline?.path, existingOnly, progress: value => {
        if (this.valid(id, source, revision, scope)) this.report({ versionId: id, ...value });
      } });
      if (!this.valid(id, source, revision, scope) || JSON.stringify(this.ports.media(id)) !== JSON.stringify(baseline)) throw new Error('The recording or account changed during preparation. Retry the song.');
      this.ports.commit(this.ports.state(), [{ id, path: prepared.path, fingerprint: prepared.fingerprint }]);
      this.prepared.set(id, prepared);
      while (this.prepared.size > 1 && (this.prepared.size > 2 || [...this.prepared.values()].reduce((sum, item) => sum + item.bytes, 0) > 128 * 1024 * 1024))
        this.prepared.delete(this.prepared.keys().next().value!);
      return prepared;
    } catch (error) {
      if (!this.closed && revision === this.account.revision()) {
        this.report({ versionId: id, phase: 'failed', received: 0, total: null, message: error instanceof Error ? error.message : 'KaraFun preparation failed. Retry the song.' });
      }
      throw error;
    } finally { this.operations.delete(abort); }
  }
  /** A fresh account descriptor authorizes each performance; a disk path never does. */
  async authorizeStart(id: string, pinned?: KaraFunPreparedMedia): Promise<KaraFunPreparedMedia> {
    const source = this.ports.state().versions.find(version => version.id === id)?.source;
    const scope = this.account.accountScope(), revision = this.account.revision();
    if (source?.provider !== 'karafun' || !scope || !this.valid(id, source, revision, scope)) throw new Error('Sign in to KaraFun in Sources before playing this recording.');
    const prepared = pinned ?? this.prepared.get(id);
    const stored = this.ports.media(id);
    if (!prepared || prepared.accountScope !== scope || stored?.path !== prepared.path || stored.fingerprint !== prepared.fingerprint) {
      this.prepared.delete(id);
      try { return await this.prepare(id, true); }
      catch (error) {
        if (!(error instanceof KaraFunMediaError) || error.code !== 'cache-miss') throw error;
        this.retry(id); throw new Error('Preparing this KaraFun song. Follow progress in Sources, then press Play when ready.');
      }
    }
    const abort = new AbortController(); this.operations.add(abort);
    try {
      const descriptor = await this.account.requestMedia(source, abort.signal);
      if (!this.valid(id, source, revision, scope) || descriptor.revision !== revision || descriptor.accountScope !== scope) throw new Error('The KaraFun account changed. Sign in and retry.');
      if (descriptor.md5.toLowerCase() !== prepared.md5 || descriptor.expectedBytes !== null && descriptor.expectedBytes !== prepared.bytes) {
        this.prepared.delete(id); this.retry(id); throw new Error('This recording changed. It is being prepared again; press Play when ready.');
      }
      return prepared;
    } finally { this.operations.delete(abort); }
  }
  async shutdown(): Promise<void> {
    this.closed = true; this.searchAbort?.abort(); for (const operation of this.operations) operation.abort();
    this.receipts = null; this.prepared.clear(); await this.queue.shutdown();
  }
}
