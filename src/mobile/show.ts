import { applyPointsEvent, newPointsLedger, type PointsEvent, type PointsLedger } from '../domain/points';
import { sameSong } from '../domain/song-identity';

/** Portable mobile show state. No provider sessions or room capabilities are persisted. */
export type MobileSong = { id: string; title: string; artist: string; provider: 'karaokenerds' | 'youtube' | 'local'; videoId?: string; fileName?: string; brand?: string; isDuet?: boolean };
export type MobileRequest = { id: string; songId: string; singer: string; singerId: string | null; coSingerId?: string | null; status: 'accepted' | 'playing' | 'completed' | 'skipped' | 'withdrawn' };
export type MobileShowState = { format: 1; name: string; songs: MobileSong[]; queue: MobileRequest[]; currentId: string | null; positionSeconds: number; favorites: string[];
  history: { songId: string; singer: string; at: number }[]; missingRequests: { singer: string; title: string; artist: string }[]; volume: number; autoAdvance: boolean; gapSeconds: number;
  applauseEnabled: boolean; pointsEnabled: boolean; singers: { id: string; name: string }[]; points: PointsLedger | null };
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || !!value.trim()) && !/[\x00-\x1f\x7f]/.test(value);
const ID = /^[A-Za-z0-9_-]{8,128}$/;
export function validMobileSong(value: unknown): value is MobileSong {
  if (!value || typeof value !== 'object') return false;
  const v = value as MobileSong;
  return text(v.id, 128) && ID.test(v.id) && text(v.title, 500) && text(v.artist, 500, true) &&
    (v.provider === 'local' ? text(v.fileName, 500) && v.videoId === undefined : ['youtube', 'karaokenerds'].includes(v.provider) && typeof v.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.videoId)) &&
    (v.brand === undefined || text(v.brand, 200)) && (v.isDuet === undefined || typeof v.isDuet === 'boolean');
}
export function newMobileShow(): MobileShowState { return { format: 1, name: 'My Karaoke Room', songs: [], queue: [], currentId: null, positionSeconds: 0, favorites: [], history: [], missingRequests: [], volume: 0.8, autoAdvance: true, gapSeconds: 5, applauseEnabled: true, pointsEnabled: true, singers: [], points: null }; }
/** Restores the queue paused. Playing is process state, never an instruction saved on disk. */
export function restoreMobileShow(value: unknown): MobileShowState {
  if (!value || typeof value !== 'object') throw new Error('Saved mobile show is invalid.');
  const v = { ...(value as MobileShowState) };
  if (v.positionSeconds === undefined) v.positionSeconds = 0;
  if (v.missingRequests === undefined) v.missingRequests = [];
  if (v.applauseEnabled === undefined) v.applauseEnabled = true;
  if (v.pointsEnabled === undefined) v.pointsEnabled = true;
  if (v.points === undefined) v.points = null;
  if (v.singers === undefined) {
    const singers = new Map<string, { id: string; name: string }>();
    if (Array.isArray(v.queue)) for (const request of v.queue) {
      if (request && typeof request.singerId === 'string' && ID.test(request.singerId))
        singers.set(request.singerId, { id: request.singerId, name: text(request.singer, 100) ? request.singer : 'Singer' });
    }
    v.singers = [...singers.values()];
  }
  if (v.format !== 1 || !text(v.name, 100) || !Array.isArray(v.songs) || v.songs.length > 2000 || !v.songs.every(validMobileSong) ||
    new Set(v.songs.map(s => s.id)).size !== v.songs.length || !Array.isArray(v.queue) || v.queue.length > 2000 ||
    !v.queue.every(r => r && text(r.id, 128) && ID.test(r.id) && v.songs.some(s => s.id === r.songId) && text(r.singer, 100, true) &&
      (r.singerId === null || text(r.singerId, 128) && ID.test(r.singerId)) &&
      (r.coSingerId === undefined || r.coSingerId === null || typeof r.coSingerId === 'string' && ID.test(r.coSingerId) &&
        r.singerId !== null && r.singerId !== r.coSingerId && v.singers.some(s => s.id === r.coSingerId)) &&
      ['accepted', 'playing', 'completed', 'skipped', 'withdrawn'].includes(r.status)) ||
    new Set(v.queue.map(r => r.id)).size !== v.queue.length || (v.currentId !== null && !v.queue.some(r => r.id === v.currentId && r.status === 'playing')) ||
    v.queue.filter(r => r.status === 'playing').length !== (v.currentId ? 1 : 0) || typeof v.positionSeconds !== 'number' || !Number.isFinite(v.positionSeconds) || v.positionSeconds < 0 || v.positionSeconds > 86400 || (!v.currentId && v.positionSeconds !== 0) || !Array.isArray(v.favorites) || v.favorites.length > 2000 ||
    !v.favorites.every(id => v.songs.some(s => s.id === id)) || !Array.isArray(v.history) || v.history.length > 1000 ||
    !v.history.every(h => h && v.songs.some(s => s.id === h.songId) && text(h.singer, 100, true) && Number.isSafeInteger(h.at) && h.at >= 0) ||
    !Array.isArray(v.missingRequests) || v.missingRequests.length > 200 || !v.missingRequests.every(r => r && text(r.singer, 100) && text(r.title, 200) && text(r.artist, 200, true)) ||
    typeof v.volume !== 'number' || !Number.isFinite(v.volume) || v.volume < 0 || v.volume > 1 || typeof v.autoAdvance !== 'boolean' ||
    !Number.isInteger(v.gapSeconds) || v.gapSeconds < 0 || v.gapSeconds > 3600 ||
    typeof v.applauseEnabled !== 'boolean' || typeof v.pointsEnabled !== 'boolean' || !Array.isArray(v.singers) ||
    v.singers.length > 2000 || !v.singers.every(s => s && ID.test(s.id) && text(s.name, 100)) ||
    new Set(v.singers.map(s => s.id)).size !== v.singers.length || !validLedger(v.points, v.singers))
    throw new Error('Saved mobile show is invalid.');
  return structuredClone(v);
}

function validLedger(value: PointsLedger | null, singers: { id: string }[]): boolean {
  if (value === null) return true;
  if (!value || value.version !== 1 || !text(value.showId, 500) || !Array.isArray(value.accounts) ||
    !Array.isArray(value.performances) || !Array.isArray(value.receipts) ||
    value.accounts.length > 2000 || value.performances.length > 2000 || value.receipts.length > 30000) return false;
  const known = new Set(singers.map(singer => singer.id));
  return value.accounts.every(account => account && known.has(account.singerId) &&
    Number.isSafeInteger(account.points) && account.points >= 0 && Number.isInteger(account.credits) && account.credits >= 0 && account.credits <= 5) &&
    new Set(value.accounts.map(account => account.singerId)).size === value.accounts.length &&
    value.performances.every(item => item && text(item.generationId, 500) && Array.isArray(item.performers) &&
      item.performers.every(id => known.has(id)) && Array.isArray(item.eligibleListeners) && item.eligibleListeners.every(id => known.has(id)) &&
      Array.isArray(item.applauders) && item.applauders.every(id => text(id, 600)) && Array.isArray(item.singerApplause) &&
      item.singerApplause.every(row => row && known.has(row.singerId) && Number.isSafeInteger(row.count) && row.count >= 0) &&
      Number.isSafeInteger(item.applauseCount) && item.applauseCount >= 0 && typeof item.finished === 'boolean') &&
    value.receipts.every(item => item && text(item.id, 500) && typeof item.event === 'string') &&
    new Set(value.receipts.map(item => item.id)).size === value.receipts.length;
}
export class MobileShow {
  revision = 0;
  readonly showId = crypto.randomUUID();
  readonly hostEpoch = crypto.randomUUID();
  private listeners = new Set<() => void>();
  private away = new Map<string, number>();
  private playing = false;
  private applauseTurn: Promise<void> = Promise.resolve();
  private applauseInFlight = new Map<string, { fingerprint: string; promise: Promise<void> }>();
  constructor(private value: MobileShowState = newMobileShow(), private now: () => number = Date.now) {}
  state(): MobileShowState { return structuredClone(this.value); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed(): void { this.revision++; for (const listener of this.listeners) listener(); }
  private ledger(): PointsLedger { return this.value.points ?? newPointsLedger(this.showId); }
  private record(ledger: PointsLedger, event: PointsEvent): PointsLedger {
    return applyPointsEvent(ledger, event, { pointsEnabled: this.value.pointsEnabled, applauseEnabled: this.value.applauseEnabled }).ledger;
  }
  private startPoints(ledger: PointsLedger, request: MobileRequest): PointsLedger {
    if (ledger.performances.some(item => item.generationId === request.id)) return ledger;
    return this.record(ledger, { type: 'start', eventId: `start:${request.id}`, generationId: request.id,
      performers: [request.singerId, request.coSingerId].filter((id): id is string => typeof id === 'string'), participants: this.value.singers.map(singer => singer.id) });
  }
  registerSinger(id: string, name: string): void {
    if (!ID.test(id) || !text(name, 100)) throw new Error('Invalid singer.');
    const existing = this.value.singers.find(singer => singer.id === id);
    if (existing) return;
    if (this.value.singers.length >= 2000) throw new Error('The singer list is full.');
    const ledger = this.record(this.ledger(), { type: 'join', eventId: `join:${id}`, singerId: id });
    this.value.singers.push({ id, name: name.trim() });
    this.value.points = ledger;
    this.changed();
  }
  setPlaybackActive(value: boolean): void { this.playing = value; }
  /** Ignore late player callbacks from a previous turn; playback state is never persisted. */
  checkpoint(requestId: string, seconds: number): void {
    if (requestId !== this.value.currentId || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400 || seconds === this.value.positionSeconds) return;
    this.value.positionSeconds = seconds;
    // Position is host-only and must not invalidate a singer's queue revision.
    for (const listener of this.listeners) listener();
  }
  add(songs: readonly MobileSong[]): void {
    if (!songs.every(validMobileSong)) throw new Error('Invalid song.');
    const known = new Set(this.value.songs.map(s => s.id));
    const fresh = songs.filter(s => !known.has(s.id) && !!known.add(s.id));
    if (this.value.songs.length + fresh.length > 2000) throw new Error('This mobile show can hold 2,000 songs.');
    if (fresh.length) { this.value.songs.push(...structuredClone(fresh)); this.changed(); }
  }
  setDuet(songId: string, isDuet: boolean): void {
    const song = this.value.songs.find(item => item.id === songId);
    if (!song || typeof isDuet !== 'boolean') throw new Error('Song is unavailable.');
    if (!isDuet && this.value.queue.some(request => request.songId === songId && request.coSingerId && ['accepted', 'playing'].includes(request.status)))
      throw new Error('Remove the co-singer from waiting performances before changing this song.');
    song.isDuet = isDuet;
    this.changed();
  }
  request(songId: string, singer = '', singerId: string | null = null, id: string = crypto.randomUUID(), coSinger = ''): string {
    if (!this.value.songs.some(s => s.id === songId) || !text(singer, 100, true) || !ID.test(id)) throw new Error('Choose an available song and a name of up to 100 characters.');
    if (this.value.queue.some(r => r.id === id)) return id;
    if (this.value.queue.length >= 2000) throw new Error('The mobile show queue is full.');
    const song = this.value.songs.find(item => item.id === songId)!;
    const name = singer.trim();
    let personId = singerId;
    if (!personId && name) personId = this.value.singers.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())?.id ?? crypto.randomUUID();
    if (personId && !ID.test(personId)) throw new Error('Invalid singer.');
    const coName = coSinger.trim();
    if (coName && (!text(coName, 100) || !personId || !song.isDuet || coName.toLocaleLowerCase() === name.toLocaleLowerCase()))
      throw new Error('Choose a different co-singer for a duet.');
    const coId = coName ? this.value.singers.find(item => item.name.toLocaleLowerCase() === coName.toLocaleLowerCase())?.id ?? crypto.randomUUID() : null;
    if (coId && coId === personId) throw new Error('Choose a different co-singer for a duet.');
    if (personId && this.value.queue.filter(r => r.singerId === personId && r.status === 'accepted').length >= (this.unavailableUntil(personId) > this.now() ? 1 : 3))
      throw new Error('You have reached your upcoming request limit. Withdraw a request first.');
    const person = personId && !this.value.singers.some(item => item.id === personId) ? { id: personId, name: name || 'Singer' } : null;
    const partner = coId && !this.value.singers.some(item => item.id === coId) ? { id: coId, name: coName } : null;
    if (this.value.singers.length + Number(!!person) + Number(!!partner) > 2000) throw new Error('The singer list is full.');
    let points = this.ledger();
    if (person) points = this.record(points, { type: 'join', eventId: `join:${person.id}`, singerId: person.id });
    if (partner) points = this.record(points, { type: 'join', eventId: `join:${partner.id}`, singerId: partner.id });
    if (personId) {
      const matches = this.value.queue.filter(request => {
        const prior = this.value.songs.find(item => item.id === request.songId);
        return !!prior && sameSong(song, prior);
      });
      const otherSang = matches.some(request => request.status === 'completed' &&
        ((request.singerId ? request.singerId !== personId : request.singer.toLocaleLowerCase() !== name.toLocaleLowerCase()) ||
          !!request.coSingerId && request.coSingerId !== personId));
      points = this.record(points, { type: 'queue', eventId: `queue:${id}`, requestId: id, singerId: personId,
        // Mobile retains only the current show, so it cannot prove lifetime novelty.
        sungEarlierThisShow: otherSang, everQueuedOrSung: true,
        isDuet: !!song.isDuet, ...(coId ? { coSingerId: coId } : {}) });
    }
    if (person) this.value.singers.push(person);
    if (partner) this.value.singers.push(partner);
    this.value.points = points;
    this.value.queue.push({ id, songId, singer: name, singerId: personId, ...(coId ? { coSingerId: coId } : {}), status: 'accepted' }); this.changed(); return id;
  }
  current(): MobileRequest | null { return this.value.queue.find(r => r.id === this.value.currentId) ?? null; }
  next(): MobileRequest | null { return this.value.queue.find(r => r.status === 'accepted' && (!r.singerId || this.unavailableUntil(r.singerId) <= this.now())) ?? null; }
  start(): MobileRequest | null {
    if (this.current()) return this.current();
    const next = this.next(); if (!next) return null;
    const ledger = this.startPoints(this.ledger(), next);
    next.status = 'playing'; this.value.currentId = next.id; this.value.positionSeconds = 0; this.value.points = ledger; this.changed(); return structuredClone(next);
  }
  finish(skipped = false): void {
    const current = this.value.queue.find(r => r.id === this.value.currentId);
    if (current) {
      const started = this.startPoints(this.ledger(), current);
      this.value.points = this.record(started, { type: 'finish', eventId: `finish:${current.id}`, generationId: current.id, completed: !skipped });
      current.status = skipped ? 'skipped' : 'completed'; if (!skipped) this.value.history.unshift({ songId: current.songId, singer: current.singer, at: this.now() });
    }
    this.playing = false;
    this.value.history = this.value.history.slice(0, 1000); this.value.currentId = null; this.value.positionSeconds = 0; this.changed();
  }
  remove(id: string, singerId?: string): void {
    const request = this.value.queue.find(r => r.id === id);
    if (!request || request.status !== 'accepted' || singerId !== undefined && request.singerId !== singerId) throw new Error('Only your waiting requests can be withdrawn.');
    request.status = 'withdrawn'; this.changed();
  }
  move(id: string, delta: -1 | 1): void {
    const waiting = this.value.queue.filter(r => r.status === 'accepted');
    const position = waiting.findIndex(r => r.id === id), other = waiting[position + delta];
    if (position < 0 || !other) return;
    const a = this.value.queue.indexOf(waiting[position]), b = this.value.queue.indexOf(other);
    [this.value.queue[a], this.value.queue[b]] = [this.value.queue[b], this.value.queue[a]]; this.changed();
  }
  favorite(id: string): void {
    if (!this.value.songs.some(s => s.id === id)) return;
    this.value.favorites = this.value.favorites.includes(id) ? this.value.favorites.filter(value => value !== id) : [...this.value.favorites, id]; this.changed();
  }
  settings(input: Partial<Pick<MobileShowState, 'name' | 'volume' | 'autoAdvance' | 'gapSeconds' | 'applauseEnabled' | 'pointsEnabled'>>): void {
    // A React snapshot may be older than a singer request. Copy settings only;
    // spreading the caller's object could silently replace the newer queue.
    this.value = restoreMobileShow({ ...this.value,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.volume === undefined ? {} : { volume: input.volume }),
      ...(input.autoAdvance === undefined ? {} : { autoAdvance: input.autoAdvance }),
      ...(input.gapSeconds === undefined ? {} : { gapSeconds: input.gapSeconds }),
      ...(input.applauseEnabled === undefined ? {} : { applauseEnabled: input.applauseEnabled }),
      ...(input.pointsEnabled === undefined ? {} : { pointsEnabled: input.pointsEnabled }) }); this.changed();
  }
  unavailableUntil(singerId: string): number { return this.away.get(singerId) ?? 0; }
  setAvailability(singerId: string, minutes: number): void {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) throw new Error('Choose 0–60 minutes.');
    this.away.set(singerId, minutes ? this.now() + minutes * 60_000 : 0); this.changed();
  }
  forgetGuestAvailability(ids: readonly string[]): void { for (const id of ids) this.away.delete(id); }
  addMissingRequest(singer: string, title: string, artist: string, singerId?: string, eventId?: string): void {
    if (this.value.missingRequests.length >= 200) throw new Error('The unavailable-song request list is full.');
    if (!text(singer, 100) || !text(title, 200) || !text(artist, 200, true)) throw new Error('Enter a song title and valid singer name.');
    if (singerId && eventId) this.value.points = this.record(this.ledger(), { type: 'suggestion', eventId, singerId });
    this.value.missingRequests.push({ singer, title, artist }); this.changed();
  }
  awardPhoto(singerId: string, eventId: string): void {
    if (!this.value.singers.some(singer => singer.id === singerId)) throw new Error('Singer is unavailable.');
    const result = this.record(this.ledger(), { type: 'photo', eventId, singerId });
    if (result !== this.value.points) { this.value.points = result; this.changed(); }
  }

  applaud(actor: { role: 'host' } | { role: 'singer'; singerId: string }, eventId: string,
    play: () => Promise<void>, authorized: () => boolean = () => true): Promise<void> {
    const fingerprint = JSON.stringify(actor), prior = this.applauseInFlight.get(eventId);
    if (prior) return prior.fingerprint === fingerprint ? prior.promise : Promise.reject(new Error('Applause ID was already used.'));
    const generation = this.playing ? this.current()?.id ?? null : null;
    const run = async () => {
      if (!authorized()) throw new Error('This room is no longer available.');
      const current = this.playing ? this.current()?.id ?? null : null;
      if (current !== generation) throw new Error('The song changed before applause started.');
      let ledger = this.ledger();
      if (current && this.current()) ledger = this.startPoints(ledger, this.current()!);
      const event: PointsEvent = { type: 'applause', eventId: `applause:${eventId}`, actor, generationId: current };
      const preview = this.record(ledger, event);
      if (preview === ledger) return;
      await play();
      if (!authorized() || (this.playing ? this.current()?.id ?? null : null) !== generation)
        throw new Error('The song or room changed during applause. No credit was spent.');
      ledger = this.ledger();
      if (generation && this.current()) ledger = this.startPoints(ledger, this.current()!);
      this.value.points = this.record(ledger, event);
      this.changed();
    };
    const promise = this.applauseTurn.then(run);
    this.applauseTurn = promise.catch(() => {});
    this.applauseInFlight.set(eventId, { fingerprint, promise });
    void promise.finally(() => this.applauseInFlight.delete(eventId)).catch(() => {});
    return promise;
  }
}
