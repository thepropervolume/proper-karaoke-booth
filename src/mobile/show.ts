/** Portable mobile show state. No provider sessions or room capabilities are persisted. */
export type MobileSong = { id: string; title: string; artist: string; provider: 'karaokenerds' | 'youtube' | 'local'; videoId?: string; fileName?: string; brand?: string };
export type MobileRequest = { id: string; songId: string; singer: string; singerId: string | null; status: 'accepted' | 'playing' | 'completed' | 'skipped' | 'withdrawn' };
export type MobileShowState = { format: 1; name: string; songs: MobileSong[]; queue: MobileRequest[]; currentId: string | null; favorites: string[];
  history: { songId: string; singer: string; at: number }[]; missingRequests: { singer: string; title: string; artist: string }[]; volume: number; autoAdvance: boolean; gapSeconds: number };
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || !!value.trim()) && !/[\x00-\x1f\x7f]/.test(value);
const ID = /^[A-Za-z0-9_-]{8,128}$/;
export function validMobileSong(value: unknown): value is MobileSong {
  if (!value || typeof value !== 'object') return false;
  const v = value as MobileSong;
  return text(v.id, 128) && ID.test(v.id) && text(v.title, 500) && text(v.artist, 500, true) &&
    (v.provider === 'local' ? text(v.fileName, 500) && v.videoId === undefined : ['youtube', 'karaokenerds'].includes(v.provider) && typeof v.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.videoId)) &&
    (v.brand === undefined || text(v.brand, 200));
}
export function newMobileShow(): MobileShowState { return { format: 1, name: 'My Karaoke Room', songs: [], queue: [], currentId: null, favorites: [], history: [], missingRequests: [], volume: 0.8, autoAdvance: true, gapSeconds: 5 }; }
/** Restores the queue paused. Playing is process state, never an instruction saved on disk. */
export function restoreMobileShow(value: unknown): MobileShowState {
  if (!value || typeof value !== 'object') throw new Error('Saved mobile show is invalid.');
  const v = { ...(value as MobileShowState) };
  if (v.missingRequests === undefined) v.missingRequests = [];
  if (v.format !== 1 || !text(v.name, 100) || !Array.isArray(v.songs) || v.songs.length > 2000 || !v.songs.every(validMobileSong) ||
    new Set(v.songs.map(s => s.id)).size !== v.songs.length || !Array.isArray(v.queue) || v.queue.length > 2000 ||
    !v.queue.every(r => r && text(r.id, 128) && ID.test(r.id) && v.songs.some(s => s.id === r.songId) && text(r.singer, 100, true) &&
      (r.singerId === null || text(r.singerId, 128) && ID.test(r.singerId)) && ['accepted', 'playing', 'completed', 'skipped', 'withdrawn'].includes(r.status)) ||
    new Set(v.queue.map(r => r.id)).size !== v.queue.length || (v.currentId !== null && !v.queue.some(r => r.id === v.currentId && r.status === 'playing')) ||
    v.queue.filter(r => r.status === 'playing').length !== (v.currentId ? 1 : 0) || !Array.isArray(v.favorites) || v.favorites.length > 2000 ||
    !v.favorites.every(id => v.songs.some(s => s.id === id)) || !Array.isArray(v.history) || v.history.length > 1000 ||
    !v.history.every(h => h && v.songs.some(s => s.id === h.songId) && text(h.singer, 100, true) && Number.isSafeInteger(h.at) && h.at >= 0) ||
    !Array.isArray(v.missingRequests) || v.missingRequests.length > 200 || !v.missingRequests.every(r => r && text(r.singer, 100) && text(r.title, 200) && text(r.artist, 200, true)) ||
    typeof v.volume !== 'number' || !Number.isFinite(v.volume) || v.volume < 0 || v.volume > 1 || typeof v.autoAdvance !== 'boolean' ||
    !Number.isInteger(v.gapSeconds) || v.gapSeconds < 0 || v.gapSeconds > 3600) throw new Error('Saved mobile show is invalid.');
  return structuredClone(v);
}
export class MobileShow {
  revision = 0;
  readonly showId = crypto.randomUUID();
  readonly hostEpoch = crypto.randomUUID();
  private listeners = new Set<() => void>();
  private away = new Map<string, number>();
  constructor(private value: MobileShowState = newMobileShow(), private now: () => number = Date.now) {}
  state(): MobileShowState { return structuredClone(this.value); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private changed(): void { this.revision++; for (const listener of this.listeners) listener(); }
  add(songs: readonly MobileSong[]): void {
    if (!songs.every(validMobileSong)) throw new Error('Invalid song.');
    const known = new Set(this.value.songs.map(s => s.id));
    const fresh = songs.filter(s => !known.has(s.id) && !!known.add(s.id));
    if (this.value.songs.length + fresh.length > 2000) throw new Error('This mobile show can hold 2,000 songs.');
    if (fresh.length) { this.value.songs.push(...structuredClone(fresh)); this.changed(); }
  }
  request(songId: string, singer = '', singerId: string | null = null, id: string = crypto.randomUUID()): string {
    if (!this.value.songs.some(s => s.id === songId) || !text(singer, 100, true) || !ID.test(id)) throw new Error('Choose an available song and a name of up to 100 characters.');
    if (this.value.queue.some(r => r.id === id)) return id;
    if (this.value.queue.length >= 2000) throw new Error('The mobile show queue is full.');
    if (singerId && this.value.queue.filter(r => r.singerId === singerId && r.status === 'accepted').length >= (this.unavailableUntil(singerId) > this.now() ? 1 : 3))
      throw new Error('You have reached your upcoming request limit. Withdraw a request first.');
    this.value.queue.push({ id, songId, singer: singer.trim(), singerId, status: 'accepted' }); this.changed(); return id;
  }
  current(): MobileRequest | null { return this.value.queue.find(r => r.id === this.value.currentId) ?? null; }
  next(): MobileRequest | null { return this.value.queue.find(r => r.status === 'accepted' && (!r.singerId || this.unavailableUntil(r.singerId) <= this.now())) ?? null; }
  start(): MobileRequest | null {
    if (this.current()) return this.current();
    const next = this.next(); if (!next) return null;
    next.status = 'playing'; this.value.currentId = next.id; this.changed(); return structuredClone(next);
  }
  finish(skipped = false): void {
    const current = this.value.queue.find(r => r.id === this.value.currentId);
    if (current) { current.status = skipped ? 'skipped' : 'completed'; if (!skipped) this.value.history.unshift({ songId: current.songId, singer: current.singer, at: this.now() }); }
    this.value.history = this.value.history.slice(0, 1000); this.value.currentId = null; this.changed();
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
  settings(input: Pick<MobileShowState, 'name' | 'volume' | 'autoAdvance' | 'gapSeconds'>): void {
    // A React snapshot may be older than a singer request. Copy settings only;
    // spreading the caller's object could silently replace the newer queue.
    const { name, volume, autoAdvance, gapSeconds } = input;
    this.value = restoreMobileShow({ ...this.value, name, volume, autoAdvance, gapSeconds }); this.changed();
  }
  unavailableUntil(singerId: string): number { return this.away.get(singerId) ?? 0; }
  setAvailability(singerId: string, minutes: number): void {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) throw new Error('Choose 0–60 minutes.');
    this.away.set(singerId, minutes ? this.now() + minutes * 60_000 : 0); this.changed();
  }
  forgetGuestAvailability(ids: readonly string[]): void { for (const id of ids) this.away.delete(id); }
  addMissingRequest(singer: string, title: string, artist: string): void {
    if (this.value.missingRequests.length >= 200) throw new Error('The unavailable-song request list is full.');
    if (!text(singer, 100) || !text(title, 200) || !text(artist, 200, true)) throw new Error('Enter a song title and valid singer name.');
    this.value.missingRequests.push({ singer, title, artist }); this.changed();
  }
}
