import { matchesCatalogQuery, validCatalogQuery } from '../domain/guest-catalog-search';
/** Transport-independent, single-authority guest boundary. It opens no listener. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { applyCommand, isVersionAllowed, orderedFuture, visibleVersions, type Outcome, type ShowState, type SongRequest, type Version } from '../domain';
import { normalizeMissingRequest } from '../domain/missing-request';
import type { Settings, SourceId } from '../domain/settings';
import { compileSongBlacklist } from '../domain/song-blacklist';
import { applyPointsEvent, newPointsLedger } from '../domain/points';
import { recordQueuedSongs, songSeenBefore } from './song-history';
import { validPhotoDataUrl } from '../domain/photo';
import { sourceForVersion, sourceIsVisible } from '../domain/source-visibility';
import { recordingKeyFor } from '../domain/song-rating';
import { songSearchIdentity } from '../domain/song-identity';
import { guestCatalogSong, RemoteCatalog, type GuestCatalogCandidate } from './remote-catalog';
import type { Song } from '../remote/client';
import { GUEST_APPLAUSE_WINDOW_MS, guestStageText, MAX_GUEST_FULFILLMENTS, MAX_GUEST_ROTATION, projectGuestStage, type GuestSongFulfillment } from '../domain/guest-stage';
import type { PlaybackTimelineState } from '../domain/playback-timeline';

type Guest = { id: string; singerId: string; showId: string };
type Receipt = { fingerprint: string; outcome: string };
type RequestInput = { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; versionId: string };
export type RemoteQueueSettings = Pick<Settings, 'autoApprove' | 'rotationMode' | 'pauseIntervalSeconds'> &
  Partial<Pick<Settings, 'maxFutureRequestsPerSinger' | 'songBlacklist' | 'artistBlacklist' | 'applauseEnabled' | 'pointsEnabled' | 'sourceVisibility'>>;
export type RemoteApplause = (singerId: string, eventId: string, showId: string, hostEpoch: string, expectedRevision: number,
  stillAuthorized: () => boolean) => Promise<Outcome>;
export type RemotePhoto = (singerId: string, eventId: string, showId: string, hostEpoch: string, expectedRevision: number,
  dataUrl: string, stillAuthorized: () => boolean) => Promise<Outcome>;
export type RemoteStageTelemetry = () => { timeline: PlaybackTimelineState; preparingVersionIds: ReadonlySet<string>; applause?: { id: string; atMs: number; generation: string } };
const secret = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const validSecret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
// Host request IDs allow up to 500 characters; remote IDs include a guest UUID and command ID.
const validRequestId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
const denied = () => new Error('Guest access denied.');
const MAX_ROOM_GUESTS = 200;
const MAX_SNAPSHOT_REQUESTS = 50;
const MAX_SEARCH_CONTINUATIONS = 40;
const SEARCH_CONTINUATION_MS = 10 * 60_000;
const SEARCH_PAGE_DEADLINE_MS = 7500;
const MAX_PROVIDER_PAGES_PER_REQUEST = 20;

type CatalogRow = { versionId: string } | { candidate: GuestCatalogCandidate };
type YouTubeFallback = { row: CatalogRow; keys: string[] };
type RoomCatalogPage = { revision: number; items: Song[]; nextOffset: number | null };
type SearchContinuation = {
  scope: string; revision: number; expires: number; nextOffset: number | null;
  cursor: string | null | undefined; buffered: CatalogRow[]; fallback: YouTubeFallback[];
  lastPage?: { offset: number; limit: number; page: RoomCatalogPage };
};

/** Registration definitely did not commit; admission can be refreshed and retried. */
export class JoinRevisionConflict extends Error {
  constructor() { super('The show changed before registration.'); this.name = 'JoinRevisionConflict'; }
}

/** The client must generate its resume secret with a cryptographic RNG and keep it private. */
export class RemoteQueue {
  private readonly runId = randomUUID();
  private relayScopesInitialized = false;
  private authorityFault = false;
  private readonly guestFulfillments?: StatementSync;
  private readonly catalogContinuations = new Map<string, SearchContinuation>();
  constructor(private readonly db: DatabaseSync, private readonly settings: () => RemoteQueueSettings,
    private readonly onCommitted: (state: ShowState) => void, private readonly now: () => number = Date.now,
    private readonly assertAuthority: (cleanup?: boolean) => void = () => {},
    private readonly onUncertainCommit: () => void = () => {},
    private readonly onApplause?: RemoteApplause, private readonly onPhoto?: RemotePhoto, private readonly remoteCatalog?: RemoteCatalog,
    private readonly stageTelemetry?: RemoteStageTelemetry) {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_invitations (token_hash TEXT PRIMARY KEY, show_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_guests (id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, show_id TEXT NOT NULL, resume_hash TEXT NOT NULL UNIQUE, resume_expires INTEGER NOT NULL, join_id TEXT NOT NULL UNIQUE, join_name TEXT NOT NULL, join_revision INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_invitation_scopes (token_hash TEXT PRIMARY KEY, scope_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_guest_scopes (guest_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_sessions (token_hash TEXT PRIMARY KEY, guest_id TEXT NOT NULL, run_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_receipts (guest_id TEXT NOT NULL, command_id TEXT NOT NULL, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY (guest_id, command_id));
      CREATE TABLE IF NOT EXISTS missing_song_requests (id TEXT PRIMARY KEY, singer TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_missing_song_owners (request_id TEXT PRIMARY KEY, guest_id TEXT NOT NULL, singer_id TEXT NOT NULL, show_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS song_queue_history (identity TEXT PRIMARY KEY NOT NULL);`);
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='missing_song_request_reviews'").get()) {
      // Return only authenticated ownership matches, even when two singers use
      // the same display name. Notice payloads need no notes or guest IDs.
      this.guestFulfillments = db.prepare(`SELECT request.id, request.title FROM remote_missing_song_owners owner
        JOIN missing_song_requests request ON request.id=owner.request_id
        JOIN missing_song_request_reviews review ON review.request_id=owner.request_id
        WHERE owner.guest_id=? AND owner.singer_id=? AND owner.show_id=? AND review.status='fulfilled'
        ORDER BY review.updated_at DESC, request.id LIMIT ?`);
    }
  }
  private requireAuthority(cleanup = false): void {
    if (this.authorityFault) throw new Error('Show authority needs recovery. Restart the application before making further changes.');
    this.assertAuthority(cleanup);
  }
  private state(cleanup = false): ShowState {
    this.requireAuthority(cleanup);
    const row = this.db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string } | undefined;
    if (!row) throw new Error('Show is unavailable.');
    return JSON.parse(row.value) as ShowState;
  }
  private transaction<T>(operation: () => T): T {
    if (this.authorityFault) throw new Error('Show authority needs recovery. Restart the application before making further changes.');
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) {
      try { this.db.exec('ROLLBACK'); }
      catch {
        // A failed rollback means the transaction may already have committed.
        // Block every authority before notifying the host; otherwise an older
        // in-memory show can overwrite an acknowledged guest request.
        this.authorityFault = true;
        try {
          const result: unknown = this.onUncertainCommit();
          if (result && typeof result === 'object' && 'then' in result) void Promise.resolve(result).catch(() => {});
        } catch { /* The recovery latch remains set. */ }
        throw new Error('Show authority needs recovery. Restart the application before making further changes.');
      }
      throw error;
    }
  }
  private save(state: ShowState): void {
    this.db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(state));
  }
  private invitationScope(hash: string): string {
    return (this.db.prepare('SELECT scope_id AS scopeId FROM remote_invitation_scopes WHERE token_hash = ?').get(hash) as { scopeId: string } | undefined)?.scopeId ?? '';
  }
  private guestScope(id: string): string {
    return (this.db.prepare('SELECT scope_id AS scopeId FROM remote_guest_scopes WHERE guest_id = ?').get(id) as { scopeId: string } | undefined)?.scopeId ?? '';
  }
  /** Called by trusted host code before the first relay scope of this process is made available. */
  beginRelayScope(): string {
    const showId = this.state().showId;
    if (!this.relayScopesInitialized) {
      this.transaction(() => {
        this.db.prepare('UPDATE remote_invitations SET revoked = 1 WHERE show_id = ? AND token_hash IN (SELECT token_hash FROM remote_invitation_scopes)').run(showId);
        this.db.prepare('UPDATE remote_guests SET revoked = 1 WHERE show_id = ? AND id IN (SELECT guest_id FROM remote_guest_scopes)').run(showId);
        this.db.prepare('UPDATE remote_sessions SET revoked = 1 WHERE guest_id IN (SELECT id FROM remote_guests WHERE show_id = ? AND id IN (SELECT guest_id FROM remote_guest_scopes))').run(showId);
      });
      this.relayScopesInitialized = true;
    }
    return `relay-${randomUUID()}`;
  }
  /** Host-only API: this reusable secret admits guests until it expires or is revoked. */
  createInvitation(ttlMs: number, scope = ''): string {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600000) throw new Error('Invalid invitation lifetime.');
    const token = secret(), state = this.state();
    this.transaction(() => {
      this.db.prepare("UPDATE remote_invitations SET revoked = 1 WHERE show_id = ? AND COALESCE((SELECT scope_id FROM remote_invitation_scopes WHERE token_hash = remote_invitations.token_hash), '') = ?").run(state.showId, scope);
      const hash = digest(token);
      this.db.prepare('INSERT INTO remote_invitations (token_hash, show_id, expires) VALUES (?, ?, ?)').run(hash, state.showId, this.now() + ttlMs);
      if (scope) this.db.prepare('INSERT INTO remote_invitation_scopes (token_hash, scope_id) VALUES (?, ?)').run(hash, scope);
    });
    return token;
  }
  private issueSession(guestId: string): string {
    const token = secret();
    this.db.prepare('INSERT INTO remote_sessions (token_hash, guest_id, run_id, expires) VALUES (?, ?, ?, ?)').run(digest(token), guestId, this.runId, this.now() + 8 * 3600000);
    return token;
  }
  /** A valid invitation grants only the information required to join the live show. */
  admissionInfo(invitation: unknown, scope = ''): { showId: string; hostEpoch: string; revision: number } {
    if (!validSecret(invitation)) throw denied();
    const state = this.state();
    const invite = this.db.prepare('SELECT show_id AS showId, expires, revoked FROM remote_invitations WHERE token_hash = ?').get(digest(invitation)) as { showId: string; expires: number; revoked: number } | undefined;
    if (!invite || invite.revoked || invite.expires <= this.now() || invite.showId !== state.showId || this.invitationScope(digest(invitation)) !== scope) throw denied();
    return { showId: state.showId, hostEpoch: state.hostEpoch, revision: state.revision };
  }
  /** A repeat join with the same join ID and resume secret recovers a lost join response. */
  join(invitation: unknown, joinId: unknown, resumeSecret: unknown, name: unknown, expectedRevision: unknown, scope = ''): { session: string; singerId: string } {
    if (!validSecret(invitation) || !validId(joinId) || !validSecret(resumeSecret) || typeof name !== 'string' || !name.trim() || name.trim().length > 100 || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw denied();
    let committed: ShowState | undefined;
    const result = this.transaction(() => {
      const state = this.state(), hash = digest(resumeSecret);
      const prior = this.db.prepare('SELECT id, singer_id AS singerId, show_id AS showId, resume_hash AS resumeHash, resume_expires AS resumeExpires, join_name AS joinName, join_revision AS joinRevision, revoked FROM remote_guests WHERE join_id = ?').get(joinId) as { id: string; singerId: string; showId: string; resumeHash: string; resumeExpires: number; joinName: string; joinRevision: number; revoked: number } | undefined;
      if (prior) {
        if (prior.revoked || prior.resumeExpires <= this.now() || prior.resumeHash !== hash || prior.joinName !== name.trim() || prior.joinRevision !== expectedRevision || prior.showId !== state.showId || !state.singers.some(s => s.id === prior.singerId && !s.archived) || this.guestScope(prior.id) !== scope) throw denied();
        return { session: this.issueSession(prior.id), singerId: prior.singerId };
      }
      const invite = this.db.prepare('SELECT show_id AS showId, expires, revoked FROM remote_invitations WHERE token_hash = ?').get(digest(invitation)) as { showId: string; expires: number; revoked: number } | undefined;
      if (!invite || invite.revoked || invite.expires <= this.now() || invite.showId !== state.showId || this.invitationScope(digest(invitation)) !== scope) throw denied();
      const archivedIds = JSON.stringify(state.singers.filter(singer => singer.archived).map(singer => singer.id));
      const count = this.db.prepare("SELECT COUNT(*) AS count FROM remote_guests WHERE show_id = ? AND revoked = 0 AND resume_expires > ? AND COALESCE((SELECT scope_id FROM remote_guest_scopes WHERE guest_id = remote_guests.id), '') = ? AND singer_id NOT IN (SELECT value FROM json_each(?))").get(state.showId, this.now(), scope, archivedIds) as { count: number };
      if (count.count >= MAX_ROOM_GUESTS) throw new Error('Guest limit reached.');
      const guestId = randomUUID(), singerId = randomUUID();
      // The invite authorizes only this tightly scoped internal registration operation.
      const applied = applyCommand(state, { commandId: `remote-join-${guestId}`, showId: state.showId, hostEpoch: state.hostEpoch,
        expectedRevision: expectedRevision as number, actor: { role: 'host', id: 'remote-registration' }, command: { type: 'addSinger', singer: { id: singerId, name: name.trim() } } }, this.settings(), this.now());
      if (!applied.outcome.ok) {
        if (applied.outcome.code === 'REVISION_CONFLICT') throw new JoinRevisionConflict();
        throw new Error(applied.outcome.code);
      }
      this.save(applied.state);
      this.db.prepare('INSERT INTO remote_guests (id, singer_id, show_id, resume_hash, resume_expires, join_id, join_name, join_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(guestId, singerId, state.showId, hash, this.now() + 24 * 3600000, joinId, name.trim(), expectedRevision as number);
      if (scope) this.db.prepare('INSERT INTO remote_guest_scopes (guest_id, scope_id) VALUES (?, ?)').run(guestId, scope);
      const session = this.issueSession(guestId);
      committed = applied.state;
      return { session, singerId };
    });
    if (committed) this.onCommitted(committed);
    return result;
  }
  resume(resumeSecret: unknown, scope = ''): { session: string; singerId: string } {
    if (!validSecret(resumeSecret)) throw denied();
    return this.transaction(() => {
      const guest = this.db.prepare('SELECT id, singer_id AS singerId, show_id AS showId, resume_expires AS resumeExpires, revoked FROM remote_guests WHERE resume_hash = ?').get(digest(resumeSecret)) as (Guest & { revoked: number; resumeExpires: number }) | undefined;
      if (!guest || guest.revoked || guest.resumeExpires <= this.now() || guest.showId !== this.state().showId || !this.state().singers.some(s => s.id === guest.singerId && !s.archived) || this.guestScope(guest.id) !== scope) throw denied();
      return { session: this.issueSession(guest.id), singerId: guest.singerId };
    });
  }
  private authenticate(token: unknown, scope = ''): Guest {
    if (!validSecret(token)) throw denied();
    const row = this.db.prepare(`SELECT g.id, g.singer_id AS singerId, g.show_id AS showId FROM remote_sessions s
      JOIN remote_guests g ON g.id = s.guest_id WHERE s.token_hash = ? AND s.run_id = ? AND s.expires > ? AND s.revoked = 0 AND g.revoked = 0 AND g.resume_expires > ?`).get(digest(token), this.runId, this.now(), this.now()) as Guest | undefined;
    if (!row || row.showId !== this.state().showId || !this.state().singers.some(s => s.id === row.singerId && !s.archived) || this.guestScope(row.id) !== scope) throw denied();
    return row;
  }
  /** Host-only bounded list. Guest access expires with the private resume credential. */
  listGuests(scope = ''): { singerId: string; name: string }[] {
    this.requireAuthority();
    const state = this.state(), archivedIds = JSON.stringify(state.singers.filter(singer => singer.archived).map(singer => singer.id));
    const rows = this.db.prepare("SELECT singer_id AS singerId, join_name AS name FROM remote_guests WHERE show_id = ? AND revoked = 0 AND resume_expires > ? AND COALESCE((SELECT scope_id FROM remote_guest_scopes WHERE guest_id = remote_guests.id), '') = ? AND singer_id NOT IN (SELECT value FROM json_each(?)) ORDER BY rowid LIMIT ?")
      .all(state.showId, this.now(), scope, archivedIds, MAX_ROOM_GUESTS + 1) as { singerId: string; name: string }[];
    if (rows.length > MAX_ROOM_GUESTS) throw new Error('Remote guest list needs recovery.');
    return rows.map(({ singerId, name }) => ({ singerId, name }));
  }
  /** Host-only, revokes both active and future resumed sessions. */
  revokeGuest(singerId: string, scope = ''): void {
    this.requireAuthority();
    if (!validId(singerId)) throw new Error('Invalid singer ID.');
    this.db.prepare("UPDATE remote_guests SET revoked = 1 WHERE singer_id = ? AND show_id = ? AND COALESCE((SELECT scope_id FROM remote_guest_scopes WHERE guest_id = remote_guests.id), '') = ?").run(singerId, this.state().showId, scope);
  }
  revokeInvitations(scope = ''): void { this.db.prepare("UPDATE remote_invitations SET revoked = 1 WHERE show_id = ? AND COALESCE((SELECT scope_id FROM remote_invitation_scopes WHERE token_hash = remote_invitations.token_hash), '') = ?").run(this.state().showId, scope); }
  /** Host-only: permanently close this room and all guest/resume credentials. */
  closeRoom(scope = ''): void {
    const showId = this.state(true).showId;
    this.transaction(() => {
      this.db.prepare("UPDATE remote_invitations SET revoked = 1 WHERE show_id = ? AND COALESCE((SELECT scope_id FROM remote_invitation_scopes WHERE token_hash = remote_invitations.token_hash), '') = ?").run(showId, scope);
      this.db.prepare("UPDATE remote_guests SET revoked = 1 WHERE show_id = ? AND COALESCE((SELECT scope_id FROM remote_guest_scopes WHERE guest_id = remote_guests.id), '') = ?").run(showId, scope);
      this.db.prepare("UPDATE remote_sessions SET revoked = 1 WHERE guest_id IN (SELECT id FROM remote_guests WHERE show_id = ? AND COALESCE((SELECT scope_id FROM remote_guest_scopes WHERE guest_id = remote_guests.id), '') = ?)").run(showId, scope);
    });
  }
  snapshot(token: unknown, scope = '') {
    const guest = this.authenticate(token, scope), state = this.state();
    const catalog = this.catalog(token, 0, 50, '', scope);
    const visible = new Map(visibleVersions(state, this.settings()).map(version => [version.id, version]));
    const singerName = state.singers.find(singer => singer.id === guest.singerId)?.name ?? '';
    // Preserve active requests even when they are older than recent completed or
    // removed requests. The bound also applies to malformed/legacy state with
    // more active requests than fit in one bounded snapshot (including unlimited mode).
    const active: { index: number; request: ShowState['requests'][number] }[] = [];
    const recent: typeof active = [];
    let visibleCount = 0;
    for (let index = state.requests.length - 1; index >= 0; index--) {
      const request = state.requests[index];
      if (request.singerId !== guest.singerId || !visible.has(request.versionId)) continue;
      visibleCount++;
      const target = ['pending', 'accepted', 'staged', 'playing'].includes(request.status) ? active : recent;
      if (target.length < MAX_SNAPSHOT_REQUESTS) target.push({ index, request });
    }
    const selected = [...active, ...recent.slice(0, MAX_SNAPSHOT_REQUESTS - active.length)].sort((a, b) => a.index - b.index);
    const account = state.points?.accounts.find(item => item.singerId === guest.singerId);
    const preferences = this.settings();
    const stage = this.stageTelemetry ? this.guestStage(state, preferences, visible, guest) : null;
    return { showId: state.showId, hostEpoch: state.hostEpoch, revision: state.revision, singerId: guest.singerId, singerName,
      ...(stage ? { stage } : {}),
      unavailableUntilMs: state.singers.find(s => s.id === guest.singerId)?.unavailableUntilMs ?? 0, serverNowMs: this.now(),
      catalog: catalog.items, catalogNextOffset: catalog.nextOffset,
      ...(this.remoteCatalog ? { sources: this.remoteCatalog.sources() } : {}),
      requests: selected.map(({ request }) => {
        const version = visible.get(request.versionId);
        const metadata = this.remoteCatalog && version && !!version.title.trim() && version.title.length <= 500 && version.artist.length <= 500 &&
          !/[\x00-\x1f\x7f\ufffd]/u.test(version.title + version.artist);
        return { id: request.id, versionId: request.versionId, status: request.status,
          ...(metadata ? { title: version.title, artist: version.artist } : {}) };
      }),
      requestsTruncated: visibleCount > selected.length,
      ...(this.onPhoto ? { photoEnabled: true } : {}),
      ...(this.onApplause ? { applauseEnabled: preferences.applauseEnabled !== false, applauseCredits: account?.credits ?? 3,
        ...(preferences.pointsEnabled !== false ? { points: account?.points ?? 0 } : {}) } : {}) };
  }
  private guestStage(state: ShowState, settings: RemoteQueueSettings, visible: Map<string, Version>, guest: Guest) {
    const telemetry = this.stageTelemetry?.();
    const names = new Map(state.singers.map(singer => [singer.id, singer.name]));
    const describe = (request: SongRequest) => {
      const version = visible.get(request.versionId);
      if (!version || !sourceIsVisible(version, settings.sourceVisibility) ||
          !guestStageText(version.title, 500) || !guestStageText(version.artist, 500, true)) return null;
      const singer = [request.singerId, request.coSingerId].flatMap(id => {
        const name = id ? names.get(id) : undefined;
        return guestStageText(name, 100) ? [name] : [];
      }).join(' & ');
      return { version, title: version.title, artist: version.artist, singer };
    };
    const all = orderedFuture(state, settings.rotationMode, this.now()).flatMap(request => {
      const song = describe(request);
      return song ? [{ title: song.title, artist: song.artist, singer: song.singer,
        status: telemetry?.preparingVersionIds.has(request.versionId) ? 'preparing' : 'queued',
        ...(request.singerId === guest.singerId && guestStageText(request.id, 500) ? { ownRequestId: request.id } : {}) }] : [];
    });
    const request = state.requests.find(row => row.id === state.playback?.requestId);
    const current = request && describe(request);
    const timeline = telemetry?.timeline;
    const playing = current && state.playback && /^[A-Za-z0-9_-]{8,128}$/.test(current.version.id) ? {
      title: current.title, artist: current.artist, singer: current.singer, versionId: current.version.id, status: state.playback.status,
      source: sourceForVersion(current.version),
      recordingId: recordingKeyFor(current.version.source) ?? undefined,
      ...(timeline && timeline.generation === state.playback.generationId && !timeline.seeking && timeline.duration > 0 && timeline.duration <= 86400 ? {
        timing: { position: timeline.position, duration: timeline.duration }
      } : {})
    } : null;
    const fulfilledSuggestions = this.guestFulfillments?.all(guest.id, guest.singerId, guest.showId, MAX_GUEST_FULFILLMENTS)
      .filter((row): row is GuestSongFulfillment => guestStageText(row.id, 100) && guestStageText(row.title, 200));
    const pulse = telemetry?.applause;
    const age = pulse ? this.now() - pulse.atMs : Infinity;
    const applause = playing && pulse?.generation === state.playback?.generationId && age >= 0 && age < GUEST_APPLAUSE_WINDOW_MS ? pulse : undefined;
    return projectGuestStage({ nowPlaying: playing, ...(applause ? { applause } : {}), ...(fulfilledSuggestions ? { fulfilledSuggestions } : {}),
      queue: all.slice(0, MAX_GUEST_ROTATION).map((row, index) => ({ ...row, position: index + 1 })),
      queueTruncated: all.length > MAX_GUEST_ROTATION });
  }
  private catalogVersions(state: ShowState, query: string, settings: RemoteQueueSettings, sources?: Set<SourceId>) {
    return visibleVersions(state, settings).filter(version => sourceIsVisible(version, settings.sourceVisibility) &&
      (!sources || sources.has(sourceForVersion(version))) && matchesCatalogQuery(version, query));
  }
  private catalogSong(version: ShowState['versions'][number]): Song {
    return this.remoteCatalog ? guestCatalogSong(version) : { id: version.id, title: version.title, artist: version.artist };
  }
  catalog(token: unknown, offset = 0, limit = 50, query = '', scope = '') {
    this.authenticate(token, scope);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !validCatalogQuery(query)) throw denied();
    const state = this.state(), settings = this.settings(), sources = this.remoteCatalog ? new Set(this.remoteCatalog.sources()) : undefined;
    const versions = this.catalogVersions(state, query, settings, sources);
    const items = versions.slice(offset, offset + limit).map(version => this.catalogSong(version));
    return { revision: state.revision, items, nextOffset: offset + limit < versions.length ? offset + limit : null };
  }
  async searchCatalog(token: unknown, offset = 0, limit = 50, query = '', scope = '') {
    if (!this.remoteCatalog || query.trim().length < 2) return this.catalog(token, offset, limit, query, scope);
    const guest = this.authenticate(token, scope), current = this.state();
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !validCatalogQuery(query)) throw denied();
    const key = JSON.stringify([guest.id, scope, query.trim()]);
    if (this.remoteCatalog.pagesKaraokeNerds(current) || offset > 0 && this.catalogContinuations.has(key))
      return this.paginatedCatalog(token, offset, limit, query.trim(), scope, key, current);
    const candidates = await this.remoteCatalog.search(query, current);
    this.authenticate(token, scope);
    const state = this.state();
    const { primary, fallback } = this.catalogRows(state, this.settings(), query, candidates);
    const results = [...primary, ...fallback.map(entry => entry.row)];
    return this.projectCatalogPage(guest.id, state, offset, limit, results.slice(offset, offset + limit), offset + limit < results.length);
  }

  private catalogRows(state: ShowState, settings: RemoteQueueSettings, query: string, candidates: GuestCatalogCandidate[]) {
    const catalog = this.remoteCatalog!;
    const local = this.catalogVersions(state, query, settings, new Set(catalog.sources()));
    const seen = new Set(local.map(version => recordingKeyFor(version.source)));
    const visible = catalog.visible(state, candidates, settings)
      .filter(candidate => {
        const key = recordingKeyFor(candidate.track.source);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    const saved = local.map(version => ({ source: sourceForVersion(version), row: { versionId: version.id } as CatalogRow, track: version }));
    const discovered = visible.map(candidate => ({ source: candidate.source, track: candidate.track, row: { candidate } as CatalogRow }));
    const otherVersions = new Set([...saved, ...discovered].filter(row => row.source !== 'youtube')
      .map(({ track }) => songSearchIdentity(track.artist, track.title)).filter(key => key !== null));
    const savedYouTube = saved.filter(({ source, track }) => source === 'youtube' && !otherVersions.has(songSearchIdentity(track.artist, track.title) ?? ''));
    const existingYouTube = new Set(savedYouTube.map(({ track }) => songSearchIdentity(track.artist, track.title)).filter(key => key !== null));
    const externalYouTube = discovered.filter(row => row.source === 'youtube').flatMap(({ row, track }) => {
      const identity = songSearchIdentity(track.artist, track.title);
      const reverse = track.reverseTitleGuess ? songSearchIdentity(track.title, track.artist) : null;
      const keys = [identity, reverse].filter(key => key !== null);
      return keys.some(key => otherVersions.has(key) || existingYouTube.has(key)) ? [] : [{ row, keys }];
    });
    return {
      primary: [...saved, ...discovered].filter(row => row.source !== 'youtube').map(entry => entry.row),
      fallback: [...savedYouTube.map(({ row, track }) => ({ row,
        keys: [songSearchIdentity(track.artist, track.title)].filter(key => key !== null) })), ...externalYouTube],
    };
  }

  private projectCatalogPage(guestId: string, state: ShowState, offset: number, limit: number, rows: CatalogRow[], hasMore: boolean): RoomCatalogPage {
    const saved = new Set(rows.flatMap(row => 'versionId' in row ? [row.versionId] : []));
    const versions = new Map(state.versions.filter(version => saved.has(version.id)).map(version => [version.id, version]));
    const items = rows.map(row => 'candidate' in row ? this.remoteCatalog!.issue(guestId, row.candidate) : this.catalogSong(versions.get(row.versionId)!));
    return { revision: state.revision, items, nextOffset: hasMore ? offset + limit : null };
  }

  private catalogScope(state: ShowState): string {
    const settings = this.settings();
    return digest(JSON.stringify([state.showId, state.hostEpoch, state.revision, state.policy, this.remoteCatalog!.scope(),
      settings.songBlacklist, settings.artistBlacklist, settings.sourceVisibility]));
  }

  private saveCatalogContinuation(key: string, continuation: SearchContinuation) {
    this.catalogContinuations.delete(key);
    this.catalogContinuations.set(key, { ...continuation, expires: this.now() + SEARCH_CONTINUATION_MS });
    while (this.catalogContinuations.size > MAX_SEARCH_CONTINUATIONS) this.catalogContinuations.delete(this.catalogContinuations.keys().next().value!);
  }

  /** Only the next authorized offset is accepted, so an arbitrary high offset
   * cannot make Booth walk the provider catalog. The provider cursor stays here. */
  private async paginatedCatalog(token: unknown, offset: number, limit: number, query: string, scope: string, key: string, initial: ShowState): Promise<RoomCatalogPage> {
    const catalog = this.remoteCatalog!, guest = this.authenticate(token, scope);
    const initialScope = this.catalogScope(initial);
    const previous = this.catalogContinuations.get(key);
    const changed = (current: ShowState) => ({ revision: current.revision, items: [], nextOffset: null });
    const settings = this.settings(), signal = AbortSignal.timeout(SEARCH_PAGE_DEADLINE_MS);
    let next: SearchContinuation;
    if (offset > 0 || previous?.nextOffset === 0 && previous.expires > this.now() && previous.scope === initialScope) {
      if (previous && previous.revision !== initial.revision) return changed(initial);
      if (!previous || previous.expires <= this.now() || previous.scope !== initialScope) throw denied();
      if (previous.lastPage?.offset === offset && previous.lastPage.limit === limit) return previous.lastPage.page;
      if (previous.nextOffset !== offset) throw denied();
      next = { ...previous };
    } else {
      const candidates = await catalog.search(query, initial);
      const { primary, fallback } = this.catalogRows(initial, settings, query, candidates);
      next = { scope: initialScope, revision: initial.revision, expires: 0, nextOffset: 0, cursor: undefined, buffered: primary, fallback };
    }
    this.authenticate(token, scope);
    let current = this.state();
    if (initial.revision !== current.revision) return changed(current);
    if (initialScope !== this.catalogScope(current)) throw denied();

    const buffered = [...next.buffered];
    const localKeys = new Set(this.catalogVersions(initial, query, settings).map(version => recordingKeyFor(version.source)));
    let fetched = 0;
    try {
      while (buffered.length <= limit && next.cursor !== null) {
        if (++fetched > MAX_PROVIDER_PAGES_PER_REQUEST) throw new Error('Karaoke Nerds search is still filtering rows. Retry to continue.');
        const chunk = await catalog.karaokeNerdsPage(query, next.cursor ?? null, signal);
        this.authenticate(token, scope);
        current = this.state();
        if (initial.revision !== current.revision) return changed(current);
        if (initialScope !== this.catalogScope(current)) throw denied();
        const eligible = catalog.visible(current, chunk.candidates, settings).filter(candidate =>
          !localKeys.has(recordingKeyFor(candidate.track.source)));
        const identities = new Set(eligible.map(({ track }) => songSearchIdentity(track.artist, track.title)));
        buffered.push(...eligible.map(candidate => ({ candidate })));
        next.fallback = next.fallback.filter(entry => !entry.keys.some(identity => identities.has(identity)));
        next.cursor = chunk.nextCursor;
      }
    } catch (error) {
      this.authenticate(token, scope);
      current = this.state();
      if (initial.revision !== current.revision) return changed(current);
      // A retry of the same offset can finish scanning filtered rows without
      // refetching already checked provider pages or skipping visible rows.
      if (initialScope === this.catalogScope(current) && this.catalogContinuations.get(key) === previous)
        this.saveCatalogContinuation(key, { ...next, buffered });
      throw error;
    }
    if (next.cursor === null && next.fallback.length) {
      buffered.push(...next.fallback.map(entry => entry.row));
      next.fallback = [];
    }
    const rows = buffered.slice(0, limit);
    const page = this.projectCatalogPage(guest.id, current, offset, limit, rows, buffered.length > limit);
    next = { ...next, buffered: buffered.slice(limit), nextOffset: page.nextOffset, expires: this.now() + SEARCH_CONTINUATION_MS,
      lastPage: { offset, limit, page } };
    this.saveCatalogContinuation(key, next);
    return page;
  }
  catalogItem(token: unknown, versionId: string, scope = '') {
    const state = this.state(); this.authenticate(token, scope);
    const settings = this.settings(), version = state.versions.find(v => v.id === versionId);
    if (!version || !isVersionAllowed(state, versionId, settings) || !sourceIsVisible(version, settings.sourceVisibility) ||
      this.remoteCatalog && !this.remoteCatalog.sources().includes(sourceForVersion(version))) return null;
    return this.catalogSong(version);
  }
  /** Original outcome lookup is independent of host epoch but still requires the same guest. */
  outcome(token: unknown, commandId: unknown, scope = ''): Outcome | null {
    const guest = this.authenticate(token, scope);
    if (!validId(commandId)) throw denied();
    const row = this.db.prepare('SELECT outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, commandId) as { outcome: string } | undefined;
    return row ? JSON.parse(row.outcome) as Outcome : null;
  }
  /** The host owns mixing and scoring; bind the singer to the authenticated guest. */
  async applaud(token: unknown, input: unknown, scope = ''): Promise<Outcome> {
    const guest = this.authenticate(token, scope);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw denied();
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 4 || Object.keys(value).some(k => !['commandId', 'showId', 'hostEpoch', 'expectedRevision'].includes(k)) ||
        !validId(value.commandId) || !validId(value.showId) || !validId(value.hostEpoch) ||
        !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) throw denied();
    const command = value as { commandId: string; showId: string; hostEpoch: string; expectedRevision: number };
    const fingerprint = digest(JSON.stringify(['applause', command.showId, command.hostEpoch, command.expectedRevision]));
    const existing = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, command.commandId) as Receipt | undefined;
    if (existing) return existing.fingerprint === fingerprint ? JSON.parse(existing.outcome) as Outcome :
      { ok: false, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: this.state().revision };
    if (!this.onApplause) return { ok: false, code: 'UNAVAILABLE', message: 'Applause is unavailable.', revision: this.state().revision };
    const stillAuthorized = () => {
      try { return this.authenticate(token, scope).id === guest.id; }
      catch { return false; }
    };
    const result = await this.onApplause(guest.singerId, `remote-${guest.id}-${command.commandId}`, command.showId, command.hostEpoch, command.expectedRevision, stillAuthorized);
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, command.commandId) as Receipt | undefined;
      if (prior) return prior.fingerprint === fingerprint ? JSON.parse(prior.outcome) as Outcome :
        { ok: false, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: this.state().revision };
      this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)')
        .run(guest.id, command.commandId, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  /** Photo bytes are delivered only to the display callback, never saved in receipts. */
  async submitPhoto(token: unknown, input: unknown, scope = ''): Promise<Outcome> {
    const guest = this.authenticate(token, scope);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw denied();
    const value = input as Record<string, unknown>;
    if (Object.keys(value).length !== 5 || Object.keys(value).some(k => !['commandId', 'showId', 'hostEpoch', 'expectedRevision', 'dataUrl'].includes(k)) ||
        !validId(value.commandId) || !validId(value.showId) || !validId(value.hostEpoch) ||
        !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || !validPhotoDataUrl(value.dataUrl)) throw denied();
    const command = value as { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; dataUrl: string };
    const fingerprint = digest(JSON.stringify(['photo', command.showId, command.hostEpoch, command.expectedRevision, digest(command.dataUrl)]));
    const existing = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, command.commandId) as Receipt | undefined;
    if (existing) return existing.fingerprint === fingerprint ? JSON.parse(existing.outcome) as Outcome :
      { ok: false, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: this.state().revision };
    if (!this.onPhoto) return { ok: false, code: 'UNAVAILABLE', message: 'Photo sharing is unavailable.', revision: this.state().revision };
    const stillAuthorized = () => {
      try { return this.authenticate(token, scope).id === guest.id; }
      catch { return false; }
    };
    const result = await this.onPhoto(guest.singerId, `remote-photo-${guest.id}-${command.commandId}`,
      command.showId, command.hostEpoch, command.expectedRevision, command.dataUrl, stillAuthorized);
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, command.commandId) as Receipt | undefined;
      if (prior) return prior.fingerprint === fingerprint ? JSON.parse(prior.outcome) as Outcome :
        { ok: false, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: this.state().revision };
      this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)')
        .run(guest.id, command.commandId, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  /** A guest can ask for a missing song only under their authenticated singer name. */
  submitMissing(token: unknown, input: unknown, scope = ''): Outcome {
    const guest = this.authenticate(token, scope);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw denied();
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(k => !['commandId', 'title', 'artist'].includes(k)) || !validId(value.commandId) || typeof value.title !== 'string' || typeof value.artist !== 'string') throw denied();
    const { commandId, title, artist } = value as { commandId: string; title: string; artist: string };
    const fingerprint = digest(JSON.stringify(['missing-song', title, artist]));
    let committed: ShowState | undefined;
    const result = this.transaction(() => {
      const state = this.state();
      const prior = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, commandId) as Receipt | undefined;
      if (prior) return prior.fingerprint === fingerprint ? JSON.parse(prior.outcome) as Outcome : { ok: false, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: state.revision };
      const singer = state.singers.find(item => item.id === guest.singerId);
      const request = normalizeMissingRequest({ singer: singer?.name, title, artist });
      if (!request) throw denied();
      const settings = this.settings(), blocked = compileSongBlacklist({ songBlacklist: settings.songBlacklist ?? [], artistBlacklist: settings.artistBlacklist ?? [] }).isBlocked(request);
      let outcome: Outcome = blocked ? { ok: false, code: 'NOT_AVAILABLE', message: 'Song is not available', revision: state.revision } : { ok: true, revision: state.revision };
      if (!blocked) {
        const requestId = randomUUID();
        this.db.prepare('INSERT INTO missing_song_requests (id, singer, title, artist, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(requestId, request.singer, request.title, request.artist, new Date(this.now()).toISOString());
        this.db.prepare('INSERT INTO remote_missing_song_owners (request_id, guest_id, singer_id, show_id) VALUES (?, ?, ?, ?)')
          .run(requestId, guest.id, guest.singerId, guest.showId);
        const points = applyPointsEvent(state.points ?? newPointsLedger(state.showId), {
          type: 'suggestion', eventId: `remote-missing-${guest.id}-${commandId}`, singerId: guest.singerId,
        }, { pointsEnabled: settings.pointsEnabled !== false, applauseEnabled: settings.applauseEnabled !== false });
        if (points.applied) {
          state.points = points.ledger;
          state.revision++;
          this.save(state);
          committed = state;
          outcome = { ok: true, revision: state.revision };
        }
      }
      this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)')
        .run(guest.id, commandId, fingerprint, JSON.stringify(outcome));
      return outcome;
    });
    if (committed) this.onCommitted(committed);
    return result;
  }
  /** Withdraw only an authenticated singer's pending or queued request. */
  withdraw(token: unknown, input: unknown, scope = ''): Outcome {
    const guest = this.authenticate(token, scope);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw denied();
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(k => !['commandId', 'showId', 'hostEpoch', 'expectedRevision', 'requestId'].includes(k)) ||
        !validId(value.commandId) || !validId(value.showId) || !validId(value.hostEpoch) || !validRequestId(value.requestId) ||
        !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) throw denied();
    const command = value as { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; requestId: string };
    const fingerprint = digest(JSON.stringify(['withdraw', command.showId, command.hostEpoch, command.expectedRevision, command.requestId]));
    let committed: ShowState | undefined;
    const outcome = this.transaction(() => {
      const prior = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, command.commandId) as Receipt | undefined;
      if (prior) return prior.fingerprint === fingerprint ? JSON.parse(prior.outcome) as Outcome : { ok: false as const, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: this.state().revision };
      const applied = applyCommand(this.state(), { commandId: `remote-${guest.id}-${command.commandId}`, showId: command.showId, hostEpoch: command.hostEpoch,
        expectedRevision: command.expectedRevision, actor: { role: 'singer', id: guest.singerId }, command: { type: 'withdrawRequest', requestId: command.requestId } }, this.settings(), this.now());
      this.save(applied.state);
      this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)').run(guest.id, command.commandId, fingerprint, JSON.stringify(applied.outcome));
      committed = applied.state;
      return applied.outcome;
    });
    if (committed) this.onCommitted(committed);
    return outcome;
  }
  /** Only the authenticated singer may mark their own future availability. */
  setAvailability(token: unknown, input: unknown, scope = ''): Outcome {
    const guest = this.authenticate(token, scope);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw denied();
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(k => !['commandId', 'showId', 'hostEpoch', 'expectedRevision', 'minutes'].includes(k)) ||
        !validId(value.commandId) || !validId(value.showId) || !validId(value.hostEpoch) ||
        !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 ||
        !Number.isInteger(value.minutes) || (value.minutes as number) < 0 || (value.minutes as number) > 60) throw denied();
    const command = value as { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; minutes: number };
    const fingerprint = digest(JSON.stringify(['availability', command.showId, command.hostEpoch, command.expectedRevision, command.minutes]));
    let committed: ShowState | undefined;
    const outcome = this.transaction(() => {
      const prior = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, command.commandId) as Receipt | undefined;
      if (prior) return prior.fingerprint === fingerprint ? JSON.parse(prior.outcome) as Outcome : { ok: false as const, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: this.state().revision };
      const applied = applyCommand(this.state(), { commandId: `remote-${guest.id}-${command.commandId}`, showId: command.showId, hostEpoch: command.hostEpoch,
        expectedRevision: command.expectedRevision, actor: { role: 'singer', id: guest.singerId }, command: { type: 'setSingerAvailability', singerId: guest.singerId, minutes: command.minutes } }, this.settings(), this.now());
      this.save(applied.state);
      this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)').run(guest.id, command.commandId, fingerprint, JSON.stringify(applied.outcome));
      committed = applied.state;
      return applied.outcome;
    });
    if (committed) this.onCommitted(committed);
    return outcome;
  }
  submit(token: unknown, input: unknown, scope = ''): Outcome {
    const guest = this.authenticate(token, scope);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw denied();
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(k => !['commandId', 'showId', 'hostEpoch', 'expectedRevision', 'versionId'].includes(k)) || !validId(value.commandId) || !validId(value.showId) || !validId(value.hostEpoch) || !validId(value.versionId) || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) throw denied();
    const request = value as RequestInput;
    const fingerprint = digest(JSON.stringify([request.showId, request.hostEpoch, request.expectedRevision, request.versionId]));
    let committed: ShowState | undefined;
    const outcome = this.transaction(() => {
      const prior = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, request.commandId) as Receipt | undefined;
      if (prior) return prior.fingerprint === fingerprint ? JSON.parse(prior.outcome) as Outcome : { ok: false as const, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: this.state().revision };
      const state = this.state(), preferences = this.settings(), version = state.versions.find(item => item.id === request.versionId);
      const reject = (refused: Outcome) => {
        this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)').run(guest.id, request.commandId, fingerprint, JSON.stringify(refused));
        return refused;
      };
      const sameState = request.showId === state.showId && request.hostEpoch === state.hostEpoch && request.expectedRevision === state.revision;
      if (version && sameState && (!sourceIsVisible(version, preferences.sourceVisibility) ||
        this.remoteCatalog && !this.remoteCatalog.sources().includes(sourceForVersion(version)))) {
        return reject({ ok: false, code: 'NOT_AVAILABLE', message: 'This source is unavailable in the host’s room.', revision: state.revision });
      }
      const online = !version && sameState ? this.remoteCatalog?.resolve(request.versionId, guest.id, state, preferences) : null;
      const commandId = `remote-${guest.id}-${request.commandId}`;
      let staged = state;
      if (online && !online.existing) {
        // The authenticated search supplied this version. Persist it only if
        // the same singer request also passes the queue and show policy.
        const addition = applyCommand(state, { commandId: `remote-catalog-${guest.id}-${request.commandId}`, showId: state.showId, hostEpoch: state.hostEpoch,
          expectedRevision: state.revision, actor: { role: 'host', id: 'remote-catalog' },
          command: { type: 'addVersion', version: online.version } }, preferences, this.now());
        if (!addition.outcome.ok) return reject(addition.outcome);
        staged = addition.state;
      }
      const applied = applyCommand(staged, { commandId, showId: request.showId, hostEpoch: request.hostEpoch,
        expectedRevision: online ? staged.revision : request.expectedRevision, actor: { role: 'singer', id: guest.singerId },
        command: { type: 'request', requestId: commandId, singerId: guest.singerId, versionId: online?.version.id ?? request.versionId } }, preferences, this.now(),
        { songSeenBefore: version => songSeenBefore(this.db, version) });
      if (staged !== state && !applied.outcome.ok) return reject({ ...applied.outcome, revision: state.revision });
      recordQueuedSongs(this.db, state, applied.state);
      this.save(applied.state);
      this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)').run(guest.id, request.commandId, fingerprint, JSON.stringify(applied.outcome));
      committed = applied.state;
      return applied.outcome;
    });
    if (committed) this.onCommitted(committed);
    return outcome;
  }
}
