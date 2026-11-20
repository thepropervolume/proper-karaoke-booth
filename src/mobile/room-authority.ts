import { matchesCatalogQuery, validCatalogQuery } from '../domain/guest-catalog-search';
import { MobileShow } from './show';
import type { InternetGuestCall, InternetGuestReply } from '../main/internet-queue-client';
import { validMobilePhoto } from './photo-validation';
type Guest = { id: string; name: string; session: string; resume: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && v.length <= max && (empty || !!v.trim()) && !/[\x00-\x1f\x7f]/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v);
const secret = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function mobileSecret(): string { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/** A mobile room grants singer actions only. Host control and media are never in guest DTOs. */
export class MobileRoomAuthority {
  private guests = new Map<string, Guest>();
  private joins = new Map<string, { name: string; resume: string; guest: Guest }>();
  private receipts = new Map<string, { payload: string; body: Record<string, unknown> }>();
  private applausePending = new Map<string, { payload: string; promise: Promise<Record<string, unknown>> }>();
  private photoPending = new Map<string, { payload: string; promise: Promise<Record<string, unknown>> }>();
  private epoch = crypto.randomUUID();
  get missing(): { singer: string; title: string; artist: string }[] { return this.show.state().missingRequests; }
  constructor(private show: MobileShow, private changed: () => void = () => {}, private playApplause?: () => Promise<void>,
    private displayPhoto?: (dataUrl: string) => Promise<void>) {}
  reset(): void {
    this.show.forgetGuestAvailability([...this.guests.values()].map(guest => guest.id));
    this.guests.clear(); this.joins.clear(); this.receipts.clear(); this.applausePending.clear(); this.photoPending.clear(); this.epoch = crypto.randomUUID();
  }
  async dispatchPhoto(call: InternetGuestCall): Promise<InternetGuestReply> {
    const denied = (): InternetGuestReply => ({ requestId: call.requestId, status: 400, body: { error: 'Request could not be completed.' } });
    const guest = this.guests.get(call.session ?? ''), payload = call.payload;
    if (!guest || !this.displayPhoto || !record(payload) || !exact(payload, ['command']) || !record(payload.command)) return denied();
    const c = payload.command;
    if (!exact(c, ['commandId', 'showId', 'hostEpoch', 'expectedRevision', 'dataUrl']) || !id(c.commandId) ||
      c.showId !== this.show.showId || c.hostEpoch !== this.epoch || !Number.isSafeInteger(c.expectedRevision) || !validMobilePhoto(c.dataUrl)) return denied();
    const dataUrl = c.dataUrl;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
    if (this.guests.get(guest.session) !== guest || c.hostEpoch !== this.epoch) return denied();
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = `${guest.id}:${c.commandId}`, serialized = JSON.stringify(['photo', c.commandId, c.showId, c.hostEpoch, c.expectedRevision, hash]);
    const old = this.receipts.get(key);
    if (old) return old.payload === serialized ? { requestId: call.requestId, status: 200, body: old.body } : denied();
    const pending = this.photoPending.get(key);
    if (pending && pending.payload !== serialized) return denied();
    if (!pending && (this.receipts.size >= 10000 || this.photoPending.size)) return denied();
    const epoch = this.epoch, session = guest.session;
    const promise = pending?.promise ?? (async () => {
      let result: Record<string, unknown>;
      try {
        await this.displayPhoto!(dataUrl);
        if (this.epoch !== epoch || this.guests.get(session) !== guest) throw new Error('This room is no longer available.');
        this.show.awardPhoto(guest.id, `remote-photo:${key}`);
        result = { ok: true, revision: this.show.revision };
      } catch (error) {
        result = { ok: false, code: 'PHOTO', message: error instanceof Error ? error.message : 'Photo is unavailable.', revision: this.show.revision };
      }
      if (this.epoch === epoch && this.guests.get(session) === guest) this.receipts.set(key, { payload: serialized, body: result });
      return result;
    })();
    if (!pending) this.photoPending.set(key, { payload: serialized, promise });
    try { return { requestId: call.requestId, status: 200, body: await promise }; }
    finally { if (this.photoPending.get(key)?.promise === promise) this.photoPending.delete(key); }
  }
  async dispatchApplause(call: InternetGuestCall): Promise<InternetGuestReply> {
    const denied = (): InternetGuestReply => ({ requestId: call.requestId, status: 400, body: { error: 'Request could not be completed.' } });
    const guest = this.guests.get(call.session ?? ''), payload = call.payload;
    if (!guest || !this.playApplause || !record(payload) || !exact(payload, ['command']) || !record(payload.command)) return denied();
    const c = payload.command;
    if (!exact(c, ['commandId', 'showId', 'hostEpoch', 'expectedRevision']) || !id(c.commandId) ||
      c.showId !== this.show.showId || c.hostEpoch !== this.epoch || !Number.isSafeInteger(c.expectedRevision)) return denied();
    const key = `${guest.id}:${c.commandId}`, serialized = JSON.stringify(['applause', c]);
    const old = this.receipts.get(key);
    if (old) return old.payload === serialized ? { requestId: call.requestId, status: 200, body: old.body } : denied();
    const pending = this.applausePending.get(key);
    if (pending && pending.payload !== serialized) return denied();
    if (!pending && this.receipts.size >= 10000) return denied();
    const epoch = this.epoch, session = guest.session;
    const promise = pending?.promise ?? (async () => {
      let result: Record<string, unknown>;
      try {
        await this.show.applaud({ role: 'singer', singerId: guest.id }, `remote:${key}`, this.playApplause!,
          () => this.epoch === epoch && this.guests.get(session) === guest);
        result = { ok: true, revision: this.show.revision };
      } catch (error) {
        result = { ok: false, code: 'APPLAUSE', message: error instanceof Error ? error.message : 'Applause is unavailable.', revision: this.show.revision };
      }
      if (this.epoch === epoch && this.guests.get(session) === guest) this.receipts.set(key, { payload: serialized, body: result });
      return result;
    })();
    if (!pending) this.applausePending.set(key, { payload: serialized, promise });
    try { return { requestId: call.requestId, status: 200, body: await promise }; }
    finally { if (this.applausePending.get(key)?.promise === promise) this.applausePending.delete(key); }
  }
  dispatch(call: InternetGuestCall): InternetGuestReply {
    const denied = (): InternetGuestReply => ({ requestId: call.requestId, status: 400, body: { error: 'Request could not be completed.' } });
    try {
      const p = call.payload;
      if (!record(p)) return denied();
      const revision = () => this.show.revision;
      const admission = () => ({ showId: this.show.showId, hostEpoch: this.epoch, revision: revision() });
      const catalog = (offset: number, limit: number, query = '') => {
        const all = this.show.state().songs.filter(song => matchesCatalogQuery(song, query));
        return { revision: revision(), items: all.slice(offset, offset + limit).map(({ id, title, artist }) => ({ id, title, artist })), nextOffset: all.length > offset + limit ? offset + limit : null };
      };
      let body: Record<string, unknown> | null;
      if (call.operation === 'admission' && exact(p, []) && call.session === undefined) body = admission();
      else if (call.operation === 'join' && exact(p, ['joinId', 'resumeSecret', 'name', 'expectedRevision']) && call.session === undefined && id(p.joinId) && secret(p.resumeSecret) && text(p.name, 100) && Number.isSafeInteger(p.expectedRevision)) {
        const old = this.joins.get(p.joinId);
        if (old && (old.resume !== p.resumeSecret || old.name !== p.name.trim())) return denied();
        if (!old && p.expectedRevision !== revision()) return { requestId: call.requestId, status: 409, body: { error: 'REVISION_CONFLICT' } };
        if (!old && this.guests.size >= 100) return denied();
        const guest = old?.guest ?? { id: crypto.randomUUID(), name: p.name.trim(), session: mobileSecret(), resume: p.resumeSecret };
        if (!old) this.show.registerSinger(guest.id, guest.name);
        this.guests.set(guest.session, guest); this.joins.set(p.joinId, { name: guest.name, resume: guest.resume, guest });
        body = { session: guest.session, singerId: guest.id };
      } else if (call.operation === 'resume' && exact(p, ['resumeSecret']) && call.session === undefined && secret(p.resumeSecret)) {
        const guest = [...this.guests.values()].find(g => g.resume === p.resumeSecret); if (!guest) return denied();
        body = { session: guest.session, singerId: guest.id };
      } else {
        const guest = this.guests.get(call.session ?? ''); if (!guest) return denied();
        if (call.operation === 'snapshot' && exact(p, [])) {
          const state = this.show.state(), mine = state.queue.filter(r => r.singerId === guest.id);
          const requests = [...mine.filter(r => ['accepted', 'playing'].includes(r.status)), ...mine.filter(r => !['accepted', 'playing'].includes(r.status)).reverse()].slice(0, 50);
          const page = catalog(0, 50);
          const account = state.points?.accounts.find(item => item.singerId === guest.id);
          body = { ...admission(), singerId: guest.id, singerName: guest.name, catalog: page.items, catalogNextOffset: page.nextOffset,
            requests: requests.map(r => ({ id: r.id, versionId: r.songId, status: r.status })), requestsTruncated: mine.length > 50,
            unavailableUntilMs: this.show.unavailableUntil(guest.id), serverNowMs: Date.now(),
            ...(this.playApplause ? { applauseEnabled: state.applauseEnabled, applauseCredits: account?.credits ?? 3,
              ...(state.pointsEnabled ? { points: account?.points ?? 0 } : {}) } : {}),
            ...(this.displayPhoto ? { photoEnabled: true } : {}) };
        } else if (call.operation === 'catalog' && (exact(p, ['offset', 'limit']) || exact(p, ['offset', 'limit', 'query'])) && (p.query === undefined || validCatalogQuery(p.query)) && Number.isSafeInteger(p.offset) && (p.offset as number) >= 0 && Number.isInteger(p.limit) && (p.limit as number) >= 1 && (p.limit as number) <= 100) body = catalog(p.offset as number, p.limit as number, p.query as string | undefined);
        else if (call.operation === 'outcome' && exact(p, ['commandId']) && id(p.commandId)) body = this.receipts.get(`${guest.id}:${p.commandId}`)?.body ?? null;
        else if (exact(p, ['command']) && record(p.command) && id(p.command.commandId)) {
          const c = p.command, key = `${guest.id}:${c.commandId}`, serialized = JSON.stringify([call.operation, c]);
          const old = this.receipts.get(key);
          if (old) { if (old.payload !== serialized) return denied(); body = old.body; }
          else {
            if (this.receipts.size >= 10_000) return denied();
            const fail = (code: string, message: string) => ({ ok: false, code, message, revision: revision() });
            if (call.operation === 'missing-request' && exact(c, ['commandId', 'title', 'artist']) && text(c.title, 200) && text(c.artist, 200, true)) {
              if (this.missing.length >= 200) body = fail('REQUEST_LIMIT', 'The host has too many unavailable-song requests.');
              else { this.show.addMissingRequest(guest.name, c.title.trim(), c.artist.trim(), guest.id, `suggestion:${key}`); this.changed(); body = { ok: true, revision: revision() }; }
            } else {
              const field = call.operation === 'request' ? 'versionId' : call.operation === 'withdraw' ? 'requestId' : call.operation === 'availability' ? 'minutes' : '';
              if (!field || !exact(c, ['commandId', 'showId', 'hostEpoch', 'expectedRevision', field])) return denied();
              if (c.showId !== this.show.showId || c.hostEpoch !== this.epoch) body = fail('SHOW_CHANGED', 'This show changed. Rejoin the room.');
              else if (c.expectedRevision !== revision()) body = fail('REVISION_CONFLICT', 'The queue changed. Refresh and try again.');
              else {
                try {
                  if (call.operation === 'request' && id(c.versionId)) this.show.request(c.versionId, guest.name, guest.id, c.commandId as string);
                  else if (call.operation === 'withdraw' && id(c.requestId)) this.show.remove(c.requestId, guest.id);
                  else if (call.operation === 'availability' && typeof c.minutes === 'number') this.show.setAvailability(guest.id, c.minutes);
                  else return denied();
                  body = { ok: true, revision: revision() };
                } catch (error) { body = fail('REQUEST_REJECTED', error instanceof Error ? error.message : 'The request could not be added.'); }
              }
            }
            this.receipts.set(key, { payload: serialized, body });
          }
        } else return denied();
      }
      return { requestId: call.requestId, status: 200, body };
    } catch { return denied(); }
  }
}
