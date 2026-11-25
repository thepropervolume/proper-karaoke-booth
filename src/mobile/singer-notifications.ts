import type { GuestSnapshot } from '../remote/client';
import type { GuestRotationEntry } from '../domain/guest-stage';
import type { DiscoveredRoom } from './discovery';

export type SingerNoticePreferences = { enabled: boolean; turn: 0 | 1 | 2 | 3; nearby: boolean; ready: boolean };
export const DEFAULT_SINGER_NOTICE_PREFERENCES: SingerNoticePreferences = { enabled: false, turn: 2, nearby: false, ready: true };
export type SingerNotice = { title: string; body: string };
type Sample = {
  snapshot?: GuestSnapshot | null;
  nearby: readonly DiscoveredRoom[];
  joined: boolean;
  active: boolean;
};
type OwnRow = GuestRotationEntry & { ownRequestId: string };

export function parseSingerNoticePreferences(value: string | null): SingerNoticePreferences {
  try {
    const data: unknown = value ? JSON.parse(value) : null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...DEFAULT_SINGER_NOTICE_PREFERENCES };
    const prefs = data as Record<string, unknown>;
    return { enabled: prefs.enabled === true, nearby: prefs.nearby === true, ready: prefs.ready !== false,
      turn: prefs.turn === 0 || prefs.turn === 1 || prefs.turn === 2 || prefs.turn === 3 ? prefs.turn : DEFAULT_SINGER_NOTICE_PREFERENCES.turn };
  } catch { return { ...DEFAULT_SINGER_NOTICE_PREFERENCES }; }
}

function displayLabel(value: string): string {
  const safe = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const characters = [...safe];
  return characters.length > 110 ? characters.slice(0, 109).join('') + '…' : safe;
}
function nameReady(names: readonly string[]): string {
  if (names.length === 1) return displayLabel(names[0]) + ' is available.';
  return names.length + ' of your requests are available.';
}
function recordBounded(seen: Set<string>, id: string): void {
  seen.add(id);
  if (seen.size > 256) seen.delete(seen.values().next().value!);
}

/** Uses only fresh, validated room snapshots or the native Wi-Fi discovery results. */
export class SingerNoticeTracker {
  private readonly nearbySeen = new Set<string>();
  private sampledNearby = false;
  private show: string | null = null;
  private revision = -1;
  private serverTime = -1;
  private previous = new Map<string, OwnRow>();
  private readonly reminded = new Set<string>();
  private readonly preparedSeen = new Set<string>();
  private readonly knownFulfillments = new Set<string>();

  observe(sample: Sample, prefs: SingerNoticePreferences): SingerNotice[] {
    if (!sample.joined) this.clearShow();
    if (!sample.active) {
      // A resumed app establishes a new discovery baseline. No Wi-Fi alert is
      // derived from room observations that might have arrived while hidden.
      this.sampledNearby = false;
      return [];
    }
    if (sample.joined) return sample.snapshot ? this.roomNotices(sample.snapshot, prefs) : [];
    return this.nearbyNotices(sample.nearby, prefs);
  }

  private clearShow(): void {
    this.show = null;
    this.revision = -1;
    this.serverTime = -1;
    this.previous.clear();
    this.reminded.clear();
    this.preparedSeen.clear();
    this.knownFulfillments.clear();
  }

  private nearbyNotices(rooms: readonly DiscoveredRoom[], prefs: SingerNoticePreferences): SingerNotice[] {
    const fresh: DiscoveredRoom[] = [];
    for (const room of rooms) {
      if (room.method !== 'bonjour' || this.nearbySeen.has(room.instance)) continue;
      recordBounded(this.nearbySeen, room.instance);
      if (this.sampledNearby) fresh.push(room);
    }
    this.sampledNearby = true;
    if (!prefs.enabled || !prefs.nearby || !fresh.length) return [];
    return [{ title: 'Karaoke Room Nearby', body: fresh.length === 1 ? displayLabel(fresh[0].name) + ' is open.' : fresh.length + ' karaoke rooms are open nearby.' }];
  }

  private roomNotices(snapshot: GuestSnapshot, prefs: SingerNoticePreferences): SingerNotice[] {
    const stage = snapshot.stage;
    if (!stage) return [];
    const show = JSON.stringify([snapshot.showId, snapshot.hostEpoch, snapshot.singerId]);
    const baseline = this.show !== show;
    if (baseline) {
      this.clearShow();
      this.show = show;
    }
    if (snapshot.revision < this.revision || (snapshot.serverNowMs !== undefined && snapshot.revision === this.revision &&
        snapshot.serverNowMs < this.serverTime)) return [];
    this.revision = snapshot.revision;
    this.serverTime = snapshot.serverNowMs ?? -1;
    const rows = stage.queue.filter((row): row is OwnRow => typeof row.ownRequestId === 'string');
    const available: string[] = [];
    const prepared: OwnRow[] = [];
    for (const row of rows) {
      if (row.status === 'queued' && this.previous.get(row.ownRequestId)?.status === 'preparing' && !this.preparedSeen.has(row.ownRequestId)) {
        recordBounded(this.preparedSeen, row.ownRequestId);
        prepared.push(row);
      }
    }
    for (const request of stage.fulfilledSuggestions ?? []) {
      if (this.knownFulfillments.has(request.id)) continue;
      recordBounded(this.knownFulfillments, request.id);
      if (!baseline) available.push(request.title);
    }
    const next = rows.find(row => row.status === 'queued');
    const prior = next && this.previous.get(next.ownRequestId);
    this.previous = new Map(rows.map(row => [row.ownRequestId, row]));
    if (baseline || !prefs.enabled) return [];
    const notices: SingerNotice[] = [];
    const approaching = next && prefs.turn > 0 && next.position <= prefs.turn && !this.reminded.has(next.ownRequestId) &&
      (!prior || prior.position > prefs.turn || prior.status === 'preparing');
    if (approaching && next) {
      recordBounded(this.reminded, next.ownRequestId);
      notices.push({ title: next.position === 1 ? 'You’re Up Next' : 'Your Turn is Coming Up', body:
        next.position === 1 ? displayLabel(next.title) + ' is next in the queue.' :
          displayLabel(next.title) + ' is #' + next.position + ' in the upcoming queue.' });
    }
    if (prefs.ready) {
      available.push(...prepared.filter(row => !approaching || row.ownRequestId !== next?.ownRequestId).map(row => row.title));
      if (available.length) notices.push({ title: 'Song Request Available', body: nameReady(available) });
    }
    return notices;
  }
}