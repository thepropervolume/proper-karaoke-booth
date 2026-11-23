import { randomUUID } from 'node:crypto';
import { visibleVersions, type BlacklistSettings, type ShowState, type Version } from '../domain';
import type { SourceId } from '../domain/settings';
import { recordingKeyFor, type RecordingKey } from '../domain/song-rating';
import { compileSongBlacklist } from '../domain/song-blacklist';
import { sourceForVersion } from '../domain/source-visibility';
import type { Song } from '../remote/client';

export type RemoteCatalogSource = 'karaokenerds' | 'youtube' | 'karafun' | 'partytyme';
export type RemoteCatalogTrack = Pick<Version, 'artist' | 'title' | 'rating' | 'discoveryOrigin'> & {
  source: NonNullable<Version['source']>;
  reverseTitleGuess?: boolean;
};
export type RemoteCatalogProviders = {
  sources(): SourceId[];
  generation(source: RemoteCatalogSource): string;
  search(source: RemoteCatalogSource, query: string, signal: AbortSignal): Promise<RemoteCatalogTrack[]>;
  pageKaraokeNerds?(query: string, cursor: string | null, signal: AbortSignal): Promise<{ tracks: RemoteCatalogTrack[]; nextCursor: string | null }>;
};

const SEARCH_SOURCES: RemoteCatalogSource[] = ['karaokenerds', 'karafun', 'partytyme', 'youtube'];
const SEARCH_DEADLINE_MS = 5_000;
const SEARCH_CACHE_MS = 20_000;
const RESULT_LIFETIME_MS = 10 * 60_000;
const MAX_SEARCHES = 4;
const MAX_SEARCH_CACHE = 40;
const MAX_RESULT_RECEIPTS = 4_000;
const MAX_PROVIDER_ROWS = 100;

export type GuestCatalogCandidate = { track: RemoteCatalogTrack; source: RemoteCatalogSource; generation: string };
type Candidate = GuestCatalogCandidate;
type Receipt = { guestId: string; candidate: Candidate; expiresAt: number };

export function guestCatalogSong(version: Version): Song {
  const recordingId = recordingKeyFor(version.source);
  return { id: version.id, title: version.title, artist: version.artist, source: sourceForVersion(version), ...(recordingId ? { recordingId } : {}) };
}

const safeText = (value: string) => typeof value === 'string' && value.length <= 500 && !/[\x00-\x1f\x7f\ufffd]/u.test(value);
function beforeAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Guests receive bounded public metadata and a short-lived selection ID scoped
 * to their registration. Only the desktop retains the queueable identity. */
export class RemoteCatalog {
  private readonly receipts = new Map<string, Receipt>();
  private readonly pending = new Map<string, Promise<Candidate[]>>();
  private readonly cache = new Map<string, { expiry: number; candidates: Candidate[] }>();
  private readonly pendingKaraokeNerds = new Map<string, Promise<{ candidates: Candidate[]; nextCursor: string | null }>>();

  constructor(private readonly providers: RemoteCatalogProviders, private readonly now: () => number) {}

  sources(): SourceId[] { return this.providers.sources(); }

  scope(): string {
    const sources = this.sources();
    return JSON.stringify([sources, SEARCH_SOURCES.filter(source => sources.includes(source))
      .map(source => [source, this.providers.generation(source)])]);
  }

  pagesKaraokeNerds(state: ShowState): boolean {
    return !!this.providers.pageKaraokeNerds && this.sources().includes('karaokenerds') &&
      state.policy.includeVersionIds === null && !state.policy.ageRestricted;
  }

  private candidates(tracks: RemoteCatalogTrack[], source: RemoteCatalogSource, generation: string): Candidate[] {
    return tracks.slice(0, MAX_PROVIDER_ROWS).filter(track => safeText(track.title) && track.title.trim() &&
      safeText(track.artist) && sourceForVersion(track) === source && recordingKeyFor(track.source))
      .map(track => ({ track, source, generation }));
  }

  async karaokeNerdsPage(query: string, cursor: string | null, signal: AbortSignal) {
    const page = this.providers.pageKaraokeNerds;
    if (!page) return { candidates: [] as Candidate[], nextCursor: null };
    signal.throwIfAborted();
    const generation = this.providers.generation('karaokenerds');
    const key = JSON.stringify([query, cursor, generation]);
    let pending = this.pendingKaraokeNerds.get(key);
    if (!pending) {
      if (this.pendingKaraokeNerds.size >= MAX_SEARCHES) throw new Error('Karaoke Nerds search is busy. Try again.');
      const deadline = AbortSignal.timeout(SEARCH_DEADLINE_MS);
      pending = beforeAbort(page(query, cursor, deadline), deadline).then(({ tracks, nextCursor }) => {
        deadline.throwIfAborted();
        if (generation !== this.providers.generation('karaokenerds') || nextCursor !== null &&
          (nextCursor === cursor || !/^[A-Za-z0-9_-]{1,512}$/.test(nextCursor))) throw new Error('The Karaoke Nerds catalog changed.');
        return { candidates: this.candidates(tracks, 'karaokenerds', generation), nextCursor };
      }).finally(() => { this.pendingKaraokeNerds.delete(key); });
      this.pendingKaraokeNerds.set(key, pending);
    }
    return beforeAbort(pending, signal);
  }

  async search(query: string, state: ShowState): Promise<Candidate[]> {
    if (query.trim().length < 2 || state.policy.includeVersionIds !== null) return [];
    const available = new Set(this.sources());
    const sources = SEARCH_SOURCES.filter(source => available.has(source) && (source !== 'karaokenerds' || !this.providers.pageKaraokeNerds) &&
      (!state.policy.ageRestricted || source === 'karafun')).map(source => ({ source, generation: this.providers.generation(source) }));
    const key = JSON.stringify([query.trim(), sources, state.policy.ageRestricted]);
    const cached = this.cache.get(key);
    if (cached && cached.expiry > this.now()) return cached.candidates;
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (!sources.length || this.pending.size >= MAX_SEARCHES) return [];
    const abort = new AbortController(), completed = new Map<RemoteCatalogSource, Candidate[]>();
    const collect = () => sources.flatMap(({ source }) => completed.get(source) ?? []);
    const work = Promise.all(sources.map(async ({ source, generation }) => {
      try {
        const tracks = await this.providers.search(source, query.trim(), abort.signal);
        if (!abort.signal.aborted) completed.set(source, this.candidates(tracks, source, generation));
      } catch { /* The other enabled catalogs remain searchable. */ }
    })).then(collect);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Candidate[]>(resolve => {
      deadline = setTimeout(() => { abort.abort(); resolve(collect()); }, SEARCH_DEADLINE_MS);
    });
    const operation = Promise.race([work, timeout]).then(candidates => {
      if (candidates.length) {
        this.cache.delete(key);
        this.cache.set(key, { candidates, expiry: this.now() + SEARCH_CACHE_MS });
        while (this.cache.size > MAX_SEARCH_CACHE) this.cache.delete(this.cache.keys().next().value!);
      }
      return candidates;
    }).finally(() => { clearTimeout(deadline); this.pending.delete(key); });
    this.pending.set(key, operation);
    return operation;
  }

  visible(state: ShowState, candidates: Candidate[], blacklist: BlacklistSettings): Candidate[] {
    if (!candidates.length) return [];
    const enabled = new Set(this.sources());
    const exact = new Map<RecordingKey, Version | null>();
    for (const version of state.versions) {
      const key = recordingKeyFor(version.source);
      if (key) exact.set(key, exact.has(key) ? null : version);
    }
    const visible = new Set(visibleVersions(state, blacklist).map(version => version.id));
    const blocked = compileSongBlacklist({ songBlacklist: blacklist.songBlacklist ?? [], artistBlacklist: blacklist.artistBlacklist ?? [] });
    return candidates.filter(({ track, source, generation }) => {
      if (!enabled.has(source) || this.providers.generation(source) !== generation || blocked.isBlocked(track) ||
          state.policy.ageRestricted && track.rating !== 'clean') return false;
      const key = recordingKeyFor(track.source)!;
      const existing = exact.get(key);
      if (existing === undefined) return state.policy.includeVersionIds === null;
      return !!existing && sourceForVersion(existing) === source && visible.has(existing.id);
    });
  }

  issue(guestId: string, candidate: Candidate): Song {
    const id = randomUUID();
    const { artist, title, source } = candidate.track;
    const recordingId = recordingKeyFor(source)!;
    this.receipts.set(id, { guestId, candidate, expiresAt: this.now() + RESULT_LIFETIME_MS });
    while (this.receipts.size > MAX_RESULT_RECEIPTS) this.receipts.delete(this.receipts.keys().next().value!);
    return { id, title, artist, source: candidate.source, recordingId };
  }

  /** Re-read source, subscription and show policy before a selection can queue. */
  resolve(id: string, guestId: string, state: ShowState, blacklist: BlacklistSettings): { version: Version; existing: boolean } | null {
    const receipt = this.receipts.get(id);
    if (!receipt || receipt.guestId !== guestId || receipt.expiresAt <= this.now() ||
      !this.visible(state, [receipt.candidate], blacklist).length) return null;
    const { track } = receipt.candidate;
    const key = recordingKeyFor(track.source);
    const existing = state.versions.find(version => recordingKeyFor(version.source) === key);
    const { title, artist, rating, source, discoveryOrigin } = track;
    return existing ? { version: existing, existing: true } : {
      version: { id: randomUUID(), title, artist, rating, source, ...(discoveryOrigin ? { discoveryOrigin } : {}) }, existing: false,
    };
  }
}
