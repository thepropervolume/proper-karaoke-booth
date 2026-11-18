import { randomUUID } from 'node:crypto';
import { isVersionAllowed, orderedFuture, type ShowState, type Version } from '../domain';
import { compileSongBlacklist } from '../domain/song-blacklist';
import { partyTymeRequest } from '../domain/partytyme-request';
import type { Settings } from '../domain/settings';
import type { PartyTymeSearchReply, PartyTymeSong } from '../domain/partytyme';
import type { KaraFunPreparation } from '../domain/karafun';
import type { PartyTymeAccount, PartyTymeAuthorization } from './partytyme-account';
import { PartyTymeMediaCache, type PartyTymePrepared } from './partytyme-media';
import { QueuedVideoDownloads } from './queued-video-downloads';
import type { StoredMedia } from './store';
type Account = Pick<PartyTymeAccount, 'status' | 'revision' | 'accountScope' | 'search' | 'requestMedia'>;
/** Receipt-based selection and account-bound preparation share the host writer. */
export class PartyTymeHost {
    private receipt: {
        id: string;
        revision: number;
        until: number;
        songs: Map<string, PartyTymeSong>;
    } | null = null;
    private searchAbort: AbortController | null = null;
    private operations = new Set<AbortController>();
    private progress = new Map<string, KaraFunPreparation>();
    private prepared = new Map<string, PartyTymePrepared>();
    private closed = false;
    private queue: QueuedVideoDownloads;
    constructor(private readonly account: Account, private readonly cache: PartyTymeMediaCache, private readonly ports: {
        state(): ShowState;
        settings(): Settings;
        media(id: string): StoredMedia | undefined;
        songSeenBefore?(version: Version): boolean;
        commit(state: ShowState, media?: StoredMedia[]): void;
        changed(): void;
    }) {
        this.queue = new QueuedVideoDownloads(async (id) => {
            await this.prepare(id);
            return null;
        });
    }
    status(): KaraFunPreparation[] {
        return [...this.progress.values()];
    }
    needsShutdownWait(): boolean {
        return this.operations.size > 0 || !!this.queue.snapshot().activeVersionId;
    }
    private report(value: KaraFunPreparation): void {
        this.progress.delete(value.versionId);
        this.progress.set(value.versionId, value);
        while (this.progress.size > 100)
            this.progress.delete(this.progress.keys().next().value!);
        this.ports.changed();
    }
    accountChanged(): void {
        this.receipt = null;
        this.searchAbort?.abort();
        for (const operation of this.operations)
            operation.abort();
        this.prepared.clear();
        this.progress.clear();
        if (this.account.status().state === 'connected') {
            const revision = this.account.revision();
            void this.queue.idle().then(() => {
                if (!this.closed && revision === this.account.revision())
                    for (const id of this.wanted())
                        this.queue.enqueue(id, true);
            });
        }
        this.sync();
        this.ports.changed();
    }
    private wanted(): string[] {
        const state = this.ports.state(), settings = this.ports.settings();
        return orderedFuture(state, settings.rotationMode, Date.now()).filter(r => ['accepted', 'staged'].includes(r.status) && isVersionAllowed(state, r.versionId, settings) && state.versions.find(v => v.id === r.versionId)?.source?.provider === 'partytyme').map(r => r.versionId);
    }
    sync(): void {
        if (!this.closed)
            this.queue.reconcile(this.account.status().state === 'connected' && this.account.status().premium ? this.wanted() : []);
    }
    retry(id: string): void {
        if (!this.account.status().premium || this.account.status().state !== 'connected')
            throw new Error('Connect a Party Tyme Premium account in Sources first.');
        if (this.ports.state().versions.find(v => v.id === id)?.source?.provider !== 'partytyme')
            throw new Error('Choose a Party Tyme recording.');
        this.queue.enqueue(id, true);
    }
    async search(input: unknown): Promise<PartyTymeSearchReply> {
        this.searchAbort?.abort();
        this.receipt = null;
        if (this.closed || this.account.status().state !== 'connected')
            return { status: 'disconnected', songs: [] };
        if (typeof input !== 'string' || input.trim().length < 2 || input.length > 200 || this.ports.state().policy.includeVersionIds !== null)
            return { status: 'ok', songs: [] };
        const abort = new AbortController(), revision = this.account.revision();
        this.searchAbort = abort;
        try {
            const results = await this.account.search(input.trim(), abort.signal), state = this.ports.state();
            if (abort.signal.aborted || revision !== this.account.revision() || this.closed || state.policy.includeVersionIds !== null)
                return { status: 'unavailable', songs: [] };
            const blacklist = compileSongBlacklist(this.ports.settings());
            const excluded = new Set(state.versions.filter(v => state.policy.excludeVersionIds.includes(v.id)).flatMap(v => v.source?.provider === 'partytyme' ? [v.source.videoId] : []));
            const songs = results.filter(song => !state.policy.ageRestricted && !excluded.has(song.videoId) && !blacklist.isBlocked(song));
            const id = randomUUID();
            this.receipt = { id, revision, until: Date.now() + 600000, songs: new Map(songs.map(song => [song.videoId, song])) };
            return { status: 'ok', searchId: id, songs };
        }
        catch {
            return {
                status: this.account.status().state === 'connected' ? 'unavailable' : 'disconnected', songs: [], message: 'Party Tyme search is unavailable. Check the account in Sources and retry.'
            };
        }
        finally {
            if (this.searchAbort === abort)
                this.searchAbort = null;
        }
    }
    request(value: unknown): {
        ok: boolean;
        versionId?: string;
        error?: string;
        notice?: string;
    } {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return { ok: false, error: 'Choose a current Party Tyme result.' };
        const input = value as Record<string, unknown>, receipt = this.receipt;
        if (Object.keys(input).some(k => !['searchId', 'videoId', 'singerId', 'requestId'].includes(k)) || !receipt || input.searchId !== receipt.id || receipt.revision !== this.account.revision() || receipt.until < Date.now() ||
            this.account.status().state !== 'connected' || !this.account.status().premium || typeof input.videoId !== 'string' || input.singerId !== null && typeof input.singerId !== 'string' || typeof input.requestId !== 'string')
            return { ok: false, error: 'Connect Party Tyme Premium and search again before queueing this recording.' };
        const song = receipt.songs.get(input.videoId);
        if (!song)
            return { ok: false, error: 'Choose a current Party Tyme result.' };
        const planned = partyTymeRequest(this.ports.state(), song, input.singerId as string | null, input.requestId, this.ports.settings(), { versionId: randomUUID(), commandId: randomUUID() }, Date.now(),
          this.ports.songSeenBefore ? { songSeenBefore: version => this.ports.songSeenBefore!(version) } : undefined);
        if (!planned.result.ok)
            return planned.result;
        this.ports.commit(planned.state);
        this.sync();
        return { ...planned.result, notice: 'Added to the queue. Party Tyme video preparation is running in the background.' };
    }
    private valid(id: string, revision: number, scope: string): boolean {
        return !this.closed && revision === this.account.revision() && scope === this.account.accountScope() && this.account.status().state === 'connected' && isVersionAllowed(this.ports.state(), id, this.ports.settings());
    }
    private async prepare(id: string, descriptor?: PartyTymeAuthorization): Promise<PartyTymePrepared> {
        const source = this.ports.state().versions.find(v => v.id === id)?.source, scope = this.account.accountScope(), revision = this.account.revision();
        if (source?.provider !== 'partytyme' || !scope || !this.valid(id, revision, scope))
            throw new Error('Connect Party Tyme in Sources before preparing this recording.');
        const abort = new AbortController();
        this.operations.add(abort);
        const baseline = this.ports.media(id);
        try {
            this.report({ versionId: id, phase: 'authorizing', received: 0, total: null });
            const authorization = descriptor ?? await this.account.requestMedia(source.videoId, abort.signal);
            if (authorization.revision !== revision || authorization.accountScope !== scope)
                throw new Error('The Party Tyme account changed. Retry.');
            const prepared = await this.cache.prepare(source.videoId, authorization, abort.signal, value => {
                if (this.valid(id, revision, scope))
                    this.report({ versionId: id, ...value });
            });
            if (!this.valid(id, revision, scope) || this.ports.state().versions.find(v => v.id === id)?.source?.provider !== 'partytyme' || JSON.stringify(this.ports.media(id)) !== JSON.stringify(baseline))
                throw new Error('The recording or account changed. Retry preparation.');
            this.ports.commit(this.ports.state(), [{ id, path: prepared.path, fingerprint: prepared.fingerprint }]);
            this.prepared.set(id, prepared);
            return prepared;
        }
        catch (error) {
            const message = error instanceof Error && /^(?:Party Tyme|The Party Tyme|Connect Party Tyme|Sign in to Party Tyme)/.test(error.message) ? error.message : 'Party Tyme preparation failed. Check storage space and retry.';
            if (!this.closed && revision === this.account.revision())
                this.report({ versionId: id, phase: 'failed', received: 0, total: null, message });
            throw new Error(message);
        }
        finally {
            this.operations.delete(abort);
        }
    }
    /** A cached file never grants access: every start/resume gets fresh approval. */
    async authorizeStart(id: string): Promise<PartyTymePrepared> {
        const source = this.ports.state().versions.find(v => v.id === id)?.source, scope = this.account.accountScope(), revision = this.account.revision();
        if (source?.provider !== 'partytyme' || !scope || !this.valid(id, revision, scope))
            throw new Error('Sign in to Party Tyme in Sources before playing this recording.');
        const abort = new AbortController();
        this.operations.add(abort);
        try {
            const authorization = await this.account.requestMedia(source.videoId, abort.signal);
            if (!this.valid(id, revision, scope) || authorization.accountScope !== scope || authorization.revision !== revision)
                throw new Error('The Party Tyme account changed. Sign in and retry.');
            const prepared = this.prepared.get(id), stored = this.ports.media(id);
            return prepared && prepared.accountScope === scope && prepared.contentKey === authorization.contentKey && stored?.path === prepared.path && stored.fingerprint === prepared.fingerprint ? prepared : await this.prepare(id, authorization);
        }
        finally {
            this.operations.delete(abort);
        }
    }
    async shutdown(): Promise<void> {
        this.closed = true;
        this.searchAbort?.abort();
        for (const operation of this.operations)
            operation.abort();
        this.receipt = null;
        this.prepared.clear();
        await this.queue.shutdown();
    }
}
