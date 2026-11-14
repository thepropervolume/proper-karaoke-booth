import { isLocalRecordingKey, isRecordingKey, parseRecordingKeys, validHeartVote,
  type LocalRecordingKey, type RecordingKey, type RatingStorage, type SongRating } from '../domain/song-rating';
import type { RatingsFailure, RatingsFailureCode, SongRatingVote, SongRatingsLookup } from './song-ratings-client';

export type HostRatingsLookup = {
  status: 'ready'; items: SongRating[];
  /** Compatibility flag: true only if every requested recording can be rated. Prefer the map. */
  canVote: boolean;
  canVoteByKey: Record<string, boolean>;
  storageByKey: Record<string, RatingStorage>;
  /** A shared outage never hides or disables the local part of a mixed batch. */
  globalStatus?: RatingsFailureCode;
} | RatingsFailure;
export type HostRatingVote = ({ status: 'ready'; item: SongRating; canVote: true; storage: RatingStorage }) | RatingsFailure;

interface LocalRatings {
  localSongRatings(keys: LocalRecordingKey[]): SongRating[];
  rateLocalSong(key: LocalRecordingKey, value: number | null): SongRating;
}
interface SharedRatings {
  lookup(keys: RecordingKey[]): Promise<SongRatingsLookup>;
  vote(key: RecordingKey, value: number | null): Promise<SongRatingVote>;
}

/** Host-only composition. Local fingerprints never leave the host or require a remote profile. */
export class HostSongRatings {
  constructor(private readonly local: LocalRatings, private readonly shared: () => SharedRatings) {}

  async lookup(value: unknown): Promise<HostRatingsLookup> {
    let keys: RecordingKey[];
    try { keys = parseRecordingKeys(value); } catch { return { status: 'invalid-request' }; }
    const local = keys.filter(isLocalRecordingKey), global = keys.filter(key => !isLocalRecordingKey(key));
    let items: SongRating[];
    try { items = this.local.localSongRatings(local); } catch { return { status: 'unavailable' }; }
    const canVoteByKey: Record<string, boolean> = {}, storageByKey: Record<string, RatingStorage> = {};
    for (const key of local) { canVoteByKey[key] = true; storageByKey[key] = 'local'; }
    for (const key of global) { canVoteByKey[key] = false; storageByKey[key] = 'global'; }
    let globalStatus: RatingsFailureCode | undefined;
    if (global.length) {
      let result: SongRatingsLookup;
      try { result = await this.shared().lookup(global); } catch { result = { status: 'unavailable' }; }
      if (result.status === 'ready') {
        items = [...items, ...result.items];
        for (const key of global) canVoteByKey[key] = result.canVote;
      } else {
        if (!local.length) return result;
        globalStatus = result.status;
      }
    }
    return { status: 'ready', items, canVote: keys.every(key => canVoteByKey[key]), canVoteByKey, storageByKey,
      ...(globalStatus ? { globalStatus } : {}) };
  }

  async vote(key: unknown, value: unknown): Promise<HostRatingVote> {
    if (!isRecordingKey(key) || !validHeartVote(value)) return { status: 'invalid-request' };
    if (isLocalRecordingKey(key)) {
      try { return { status: 'ready', item: this.local.rateLocalSong(key, value), canVote: true, storage: 'local' }; }
      catch { return { status: 'unavailable' }; }
    }
    // A failed remote write is never reclassified as a successful local vote.
    try {
      const result = await this.shared().vote(key, value);
      return result.status === 'ready' ? { ...result, storage: 'global' } : result;
    } catch { return { status: 'unavailable' }; }
  }
}
