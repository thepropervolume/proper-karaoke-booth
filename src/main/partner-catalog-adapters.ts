/** Main-process metadata adapters. No media, licence or playback calls are made. */
import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { ProviderCatalogSearchResult, ProviderCatalogSong, ProviderCatalogStatus } from '../domain/provider-catalog';
import { StingrayCatalogClient } from './stingray-client';
import { runStingrayOperator } from './stingray-operator';
import { inspectSunflyCatalogPage, type SunflyCatalogItem } from './sunfly-catalog-client';
import { readSunflyAccessKey } from './sunfly-operator';

type Partner = 'stingray' | 'sunfly';
type Status = ProviderCatalogSearchResult['status'];
type SearchRow = { song: ProviderCatalogSong; searchable: string };
type Snapshot = { rows: SearchRow[]; expiresAt: number };
type SnapshotResult = { status: 'ok'; rows: SearchRow[] } | { status: Exclude<Status, 'ok'> };
type Dependencies = {
  stingray?: typeof runStingrayOperator;
  sunflyKey?: typeof readSunflyAccessKey;
  sunflyPage?: typeof inspectSunflyCatalogPage;
  now?: () => number;
  /** Bounded test seams; normal callers use the defaults below. */
  snapshotTimeoutMs?: number;
  snapshotMaxPages?: number;
  snapshotMaxItems?: number;
};

const LABELS = { stingray: 'Stingray', sunfly: 'Sunfly' } as const;
const MAX_RESULTS = 20;
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROFILES = 4;
const MAX_TEXT_CHARS = 16 * 1024 * 1024;
const TEXT = /^[^\x00-\x1f\x7f\ufffd]*$/u;
const fold = (value: string): string => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
function validAccessKey(value: string): boolean {
  // A JSON credential wrapper or ordinary email:password login is never a
  // Sunfly raw access key. Refuse obvious wrong-provider files before HTTP.
  const colon = value.indexOf(':');
  return /^[\x21-\x7e]{1,1024}$/.test(value) && !/^[{\[]/.test(value) &&
    !(colon > 0 && value.slice(0, colon).includes('@'));
}

function response(provider: Partner, status: Status, songs: ProviderCatalogSong[] = [], detail?: string): ProviderCatalogSearchResult {
  const label = LABELS[provider];
  const messages: Record<Status, string> = {
    ok: `${label} catalog search only. Playback is not available.`,
    'not-configured': `${label} needs a valid private provider-issued catalog profile. Choose a profile in Sources.`,
    'invalid-input': provider === 'stingray' ? 'Stingray search needs 3–40 characters.' : 'Sunfly search needs 3–128 characters.',
    unauthorized: `${label} refused catalog access. Check the provider-issued credential and account access.`,
    'rate-limited': `${label} has limited catalog requests. Try again later; no automatic retry was made.`,
    unavailable: `${label} catalog is unavailable. Try again later.`,
    'timed-out': `${label} catalog did not finish in time. Try again later.`,
    'invalid-response': `${label} returned an invalid or incomplete catalog response. No partial results are shown.`,
  };
  return { provider, label, status, songs, message: detail ?? messages[status] };
}

function validSong(song: { id: unknown; title: unknown; artist: unknown; durationSeconds: unknown }): boolean {
  const field = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && TEXT.test(value);
  return field(song.id, 256) && field(song.title, 2048) &&
    (song.artist === null || field(song.artist, 2048)) &&
    (song.durationSeconds === null || typeof song.durationSeconds === 'number' && Number.isFinite(song.durationSeconds) && song.durationSeconds >= 0 && song.durationSeconds <= 1_000_000);
}

/** Validate only the selected local credential file. This never contacts a provider. */
export async function getPartnerCatalogStatus(provider: Partner, profilePath: string | undefined): Promise<ProviderCatalogStatus> {
  if (provider !== 'stingray' && provider !== 'sunfly') throw new Error('Unknown partner catalog.');
  let configured = false;
  try {
    if (provider === 'sunfly') configured = validAccessKey(readSunflyAccessKey(profilePath));
    else {
      // Reuse the strict private-file reader with a local-only client. A valid
      // shape is configuration readiness, not a successful provider login.
      const result = await runStingrayOperator(profilePath, null, key => {
        const validation = new StingrayCatalogClient(key);
        return {
          connect: async device => typeof device.deviceId === 'string' && device.deviceId.length > 0 && device.deviceId.length <= 256 && TEXT.test(device.deviceId) &&
            (device.languageCode === 'en' || device.languageCode === 'fr') && /^[A-Z]{2}$/.test(device.countryCode) ? 'ok' : 'invalid-input',
          searchSongs: async () => ({ status: 'invalid-input' }),
          disconnect: () => validation.disconnect(),
        };
      });
      configured = result.status === 'ok';
    }
  } catch { /* Never expose a credential or a private path in status. */ }
  const label = LABELS[provider];
  return { provider, label, configured, searchAvailable: configured, playbackAvailable: false,
    message: configured ? `${label} profile configured; API access is not yet verified. Search only; playback is pending.` :
      `${label} needs a valid private provider-issued developer ${provider === 'sunfly' ? 'access-key file' : 'catalog JSON profile'}. An ordinary account login is not a developer key.` };
}

/**
 * Sunfly documents a changes feed, not a text-search endpoint. Search therefore
 * starts only after every page has been read into a complete in-memory snapshot.
 * Incomplete, looping, oversized or timed-out scans never become empty matches.
 * Snapshots are retained for at most 24 hours in this app process, keyed by the
 * selected private file and credential digest. Nothing is written beside keys.
 */
export function createPartnerCatalogSearch(dependencies: Dependencies = {}):
  (provider: Partner, profilePath: string | undefined, query: string) => Promise<ProviderCatalogSearchResult> {
  const stingray = dependencies.stingray ?? runStingrayOperator;
  const readKey = dependencies.sunflyKey ?? readSunflyAccessKey;
  const readPage = dependencies.sunflyPage ?? inspectSunflyCatalogPage;
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.snapshotTimeoutMs ?? 30_000;
  const maxPages = dependencies.snapshotMaxPages ?? 256;
  const maxItems = dependencies.snapshotMaxItems ?? 100_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
      !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 256 ||
      !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 100_000) throw new Error('Invalid partner catalog bounds.');
  const cache = new Map<string, Snapshot>();
  const active = new Map<string, Promise<SnapshotResult>>();
  const failures = new Map<string, { status: Exclude<Status, 'ok'>; expiresAt: number }>();

  const loadSnapshot = (identity: string, key: string): Promise<SnapshotResult> => {
    const pending = active.get(identity);
    if (pending) return pending;
    // Bound retained snapshots even if profiles are changed repeatedly.
    while (cache.size >= MAX_PROFILES && !cache.has(identity)) cache.delete(cache.keys().next().value!);
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = now() + timeoutMs;
    const timeout = new Promise<SnapshotResult>(resolve => {
      timer = setTimeout(() => { expired = true; resolve({ status: 'timed-out' }); }, timeoutMs);
    });
    const scan = (async (): Promise<SnapshotResult> => {
      let since: string | undefined;
      let count = 0;
      const records = new Map<number, Pick<SunflyCatalogItem, 'id' | 'title' | 'artist'>>();
      let textChars = 0;
      try {
        for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
          if (expired || now() >= deadline) return { status: 'timed-out' };
          const page = await readPage(key, { since, limit: 500 }, { timeoutMs: Math.max(1, Math.min(10_000, deadline - now())) });
          if (expired || now() >= deadline) return { status: 'timed-out' };
          if (page.status !== 'ok') return { status: page.status };
          count += page.items.length;
          if (count > maxItems || since !== undefined && (Date.parse(page.nextCursor) < Date.parse(since) ||
              page.hasMore && Date.parse(page.nextCursor) === Date.parse(since))) return { status: 'invalid-response' };
          for (const item of page.items) {
            const old = records.get(item.id);
            if (old) textChars -= (old.title?.length ?? 0) + (old.artist?.length ?? 0);
            if (item.deleted) records.delete(item.id);
            else {
              const song = { id: String(item.id), title: item.title, artist: item.artist, durationSeconds: null };
              if (!validSong(song) || [item.title, item.artist].some(value => value?.includes(key) || value && /https?:\/\//iu.test(value))) return { status: 'invalid-response' };
              textChars += item.title!.length + (item.artist?.length ?? 0);
              if (textChars > MAX_TEXT_CHARS) return { status: 'invalid-response' };
              records.set(item.id, { id: item.id, title: item.title, artist: item.artist });
            }
          }
          await yieldTurn();
          if (expired || now() >= deadline) return { status: 'timed-out' };
          if (!page.hasMore) {
            const rows: SearchRow[] = [];
            for (const item of records.values()) {
              if (rows.length % 512 === 0) {
                await yieldTurn();
                if (expired || now() >= deadline) return { status: 'timed-out' };
              }
              rows.push({ song: { provider: 'sunfly', id: String(item.id), title: item.title!, artist: item.artist,
                durationSeconds: null, language: null, webUrl: null, playbackAvailable: false },
                searchable: fold(`${item.artist ?? ''} ${item.title}`) });
            }
            rows.sort((a, b) => a.song.title.localeCompare(b.song.title, 'en') || (a.song.artist ?? '').localeCompare(b.song.artist ?? '', 'en') || a.song.id.localeCompare(b.song.id, 'en'));
            await yieldTurn();
            if (expired || now() >= deadline) return { status: 'timed-out' };
            cache.set(identity, { rows, expiresAt: now() + SNAPSHOT_TTL_MS });
            return { status: 'ok', rows };
          }
          since = page.nextCursor;
        }
        return { status: 'invalid-response' };
      } catch { return { status: expired ? 'timed-out' : 'unavailable' }; }
    })();
    const job = Promise.race([scan, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
      if (active.get(identity) === job) active.delete(identity);
    });
    active.set(identity, job);
    return job;
  };

  return async (provider, profilePath, query) => {
    if (provider !== 'stingray' && provider !== 'sunfly') throw new Error('Unknown partner catalog.');
    if (typeof query !== 'string' || !TEXT.test(query) || query.trim().length < 3 || query.trim().length > (provider === 'stingray' ? 40 : 128)) return response(provider, 'invalid-input');
    const normalized = fold(query.trim()).trim();
    if (!normalized) return response(provider, 'invalid-input');
    if (!profilePath) return response(provider, 'not-configured');
    if (provider === 'stingray') {
      try {
        const result = await stingray(profilePath, query.trim());
        if (result.status === 'configuration-error') return response(provider, 'not-configured');
        if (result.status !== 'ok') return response(provider, result.status);
        if (!Array.isArray(result.songs) || result.songs.length > 100 || !result.songs.every(validSong)) return response(provider, 'invalid-response');
        return response(provider, 'ok', result.songs.slice(0, MAX_RESULTS).map(song => ({
          provider, id: song.id, title: song.title, artist: song.artist, durationSeconds: song.durationSeconds,
          language: null, webUrl: null, playbackAvailable: false,
        })));
      } catch { return response(provider, 'unavailable'); }
    }
    let key: string;
    try {
      key = readKey(profilePath);
      if (!validAccessKey(key)) return response(provider, 'not-configured');
    } catch { return response(provider, 'not-configured'); }
    const identity = createHash('sha256').update(profilePath).update('\0').update(key).digest('hex');
    const saved = cache.get(identity);
    const recentFailure = failures.get(identity);
    if (recentFailure && recentFailure.expiresAt > now()) return response(provider, recentFailure.status);
    const snapshot: SnapshotResult = saved && saved.expiresAt > now() ? { status: 'ok', rows: saved.rows } : await loadSnapshot(identity, key);
    if (snapshot.status !== 'ok') {
      // Typing another query must not immediately repeat an unsuccessful full
      // scan. A changed credential has a different identity and is checked anew.
      while (failures.size >= MAX_PROFILES && !failures.has(identity)) failures.delete(failures.keys().next().value!);
      failures.set(identity, { status: snapshot.status, expiresAt: now() + 30_000 });
      return response(provider, snapshot.status);
    }
    failures.delete(identity);
    const terms = normalized.split(/\s+/u), matches: ProviderCatalogSong[] = [];
    let index = 0;
    for (const row of snapshot.rows) {
      if (++index % 1024 === 0) await yieldTurn();
      if (terms.every(term => row.searchable.includes(term))) {
        matches.push({ ...row.song });
        if (matches.length === MAX_RESULTS) break;
      }
    }
    return response(provider, 'ok', matches, 'Search of the complete Sunfly catalog snapshot, cached in this app for up to 24 hours. Playback is not available.');
  };
}

export const searchPartnerCatalog = createPartnerCatalogSearch();
