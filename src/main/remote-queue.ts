/** Transport-independent, single-authority guest boundary. It opens no listener. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyCommand, isVersionAllowed, visibleVersions, type Outcome, type ShowState } from '../domain';
import { normalizeMissingRequest } from '../domain/missing-request';
import type { Settings } from '../domain/settings';

type Guest = { id: string; singerId: string; showId: string };
type Receipt = { fingerprint: string; outcome: string };
type RequestInput = { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; versionId: string };
const secret = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const validSecret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const denied = () => new Error('Guest access denied.');
const MAX_ROOM_GUESTS = 200;
const MAX_SNAPSHOT_REQUESTS = 50;

/** Registration definitely did not commit; admission can be refreshed and retried. */
export class JoinRevisionConflict extends Error {
  constructor() { super('The show changed before registration.'); this.name = 'JoinRevisionConflict'; }
}

/** The client must generate its resume secret with a cryptographic RNG and keep it private. */
export class RemoteQueue {
  private readonly runId = randomUUID();
  private relayScopesInitialized = false;
  constructor(private readonly db: DatabaseSync, private readonly settings: () => Pick<Settings, 'autoApprove' | 'rotationMode' | 'pauseIntervalSeconds'>,
    private readonly onCommitted: (state: ShowState) => void, private readonly now: () => number = Date.now,
    private readonly assertAuthority: (cleanup?: boolean) => void = () => {}) {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_invitations (token_hash TEXT PRIMARY KEY, show_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_guests (id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, show_id TEXT NOT NULL, resume_hash TEXT NOT NULL UNIQUE, resume_expires INTEGER NOT NULL, join_id TEXT NOT NULL UNIQUE, join_name TEXT NOT NULL, join_revision INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_invitation_scopes (token_hash TEXT PRIMARY KEY, scope_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_guest_scopes (guest_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_sessions (token_hash TEXT PRIMARY KEY, guest_id TEXT NOT NULL, run_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_receipts (guest_id TEXT NOT NULL, command_id TEXT NOT NULL, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY (guest_id, command_id));
      CREATE TABLE IF NOT EXISTS missing_song_requests (id TEXT PRIMARY KEY, singer TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_missing_song_owners (request_id TEXT PRIMARY KEY, guest_id TEXT NOT NULL, singer_id TEXT NOT NULL, show_id TEXT NOT NULL);`);
  }
  private state(cleanup = false): ShowState {
    this.assertAuthority(cleanup);
    const row = this.db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: string } | undefined;
    if (!row) throw new Error('Show is unavailable.');
    return JSON.parse(row.value) as ShowState;
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
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
        if (prior.revoked || prior.resumeExpires <= this.now() || prior.resumeHash !== hash || prior.joinName !== name.trim() || prior.joinRevision !== expectedRevision || prior.showId !== state.showId || this.guestScope(prior.id) !== scope) throw denied();
        return { session: this.issueSession(prior.id), singerId: prior.singerId };
      }
      const invite = this.db.prepare('SELECT show_id AS showId, expires, revoked FROM remote_invitations WHERE token_hash = ?').get(digest(invitation)) as { showId: string; expires: number; revoked: number } | undefined;
      if (!invite || invite.revoked || invite.expires <= this.now() || invite.showId !== state.showId || this.invitationScope(digest(invitation)) !== scope) throw denied();
      const count = this.db.prepare("SELECT COUNT(*) AS count FROM remote_guests WHERE show_id = ? AND revoked = 0 AND resume_expires > ? AND COALESCE((SELECT scope_id FROM remote_guest_scopes WHERE guest_id = remote_guests.id), '') = ?").get(state.showId, this.now(), scope) as { count: number };
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
      if (!guest || guest.revoked || guest.resumeExpires <= this.now() || guest.showId !== this.state().showId || this.guestScope(guest.id) !== scope) throw denied();
      return { session: this.issueSession(guest.id), singerId: guest.singerId };
    });
  }
  private authenticate(token: unknown, scope = ''): Guest {
    if (!validSecret(token)) throw denied();
    const row = this.db.prepare(`SELECT g.id, g.singer_id AS singerId, g.show_id AS showId FROM remote_sessions s
      JOIN remote_guests g ON g.id = s.guest_id WHERE s.token_hash = ? AND s.run_id = ? AND s.expires > ? AND s.revoked = 0 AND g.revoked = 0 AND g.resume_expires > ?`).get(digest(token), this.runId, this.now(), this.now()) as Guest | undefined;
    if (!row || row.showId !== this.state().showId || this.guestScope(row.id) !== scope) throw denied();
    return row;
  }
  /** Host-only bounded list. Guest access expires with the private resume credential. */
  listGuests(scope = ''): { singerId: string; name: string }[] {
    this.assertAuthority();
    const rows = this.db.prepare("SELECT singer_id AS singerId, join_name AS name FROM remote_guests WHERE show_id = ? AND revoked = 0 AND resume_expires > ? AND COALESCE((SELECT scope_id FROM remote_guest_scopes WHERE guest_id = remote_guests.id), '') = ? ORDER BY rowid LIMIT ?")
      .all(this.state().showId, this.now(), scope, MAX_ROOM_GUESTS + 1) as { singerId: string; name: string }[];
    if (rows.length > MAX_ROOM_GUESTS) throw new Error('Remote guest list needs recovery.');
    return rows.map(({ singerId, name }) => ({ singerId, name }));
  }
  /** Host-only, revokes both active and future resumed sessions. */
  revokeGuest(singerId: string, scope = ''): void {
    this.assertAuthority();
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
    const catalog = this.catalog(token, 0, 50, scope);
    const singerName = state.singers.find(singer => singer.id === guest.singerId)?.name ?? '';
    // Preserve active requests even when they are older than recent completed or
    // removed requests. The bound also applies to malformed/legacy state with
    // more active requests than the domain currently permits.
    const active: { index: number; request: ShowState['requests'][number] }[] = [];
    const recent: typeof active = [];
    let visibleCount = 0;
    for (let index = state.requests.length - 1; index >= 0; index--) {
      const request = state.requests[index];
      if (request.singerId !== guest.singerId || !isVersionAllowed(state, request.versionId)) continue;
      visibleCount++;
      const target = ['pending', 'accepted', 'staged', 'playing'].includes(request.status) ? active : recent;
      if (target.length < MAX_SNAPSHOT_REQUESTS) target.push({ index, request });
    }
    const selected = [...active, ...recent.slice(0, MAX_SNAPSHOT_REQUESTS - active.length)].sort((a, b) => a.index - b.index);
    return { showId: state.showId, hostEpoch: state.hostEpoch, revision: state.revision, singerId: guest.singerId, singerName,
      catalog: catalog.items, catalogNextOffset: catalog.nextOffset,
      requests: selected.map(({ request }) => ({ id: request.id, versionId: request.versionId, status: request.status })),
      requestsTruncated: visibleCount > selected.length };
  }
  catalog(token: unknown, offset = 0, limit = 50, scope = '') {
    this.authenticate(token, scope);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw denied();
    const state = this.state(), versions = visibleVersions(state);
    const items = versions.slice(offset, offset + limit).map(v => ({ id: v.id, title: v.title, artist: v.artist }));
    return { revision: state.revision, items, nextOffset: offset + limit < versions.length ? offset + limit : null };
  }
  catalogItem(token: unknown, versionId: string, scope = '') {
    const state = this.state(); this.authenticate(token, scope);
    if (!isVersionAllowed(state, versionId)) return null;
    const version = state.versions.find(v => v.id === versionId)!;
    return { id: version.id, title: version.title, artist: version.artist };
  }
  /** Original outcome lookup is independent of host epoch but still requires the same guest. */
  outcome(token: unknown, commandId: unknown, scope = ''): Outcome | null {
    const guest = this.authenticate(token, scope);
    if (!validId(commandId)) throw denied();
    const row = this.db.prepare('SELECT outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, commandId) as { outcome: string } | undefined;
    return row ? JSON.parse(row.outcome) as Outcome : null;
  }
  /** A guest can ask for a missing song only under their authenticated singer name. */
  submitMissing(token: unknown, input: unknown, scope = ''): Outcome {
    const guest = this.authenticate(token, scope);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw denied();
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(k => !['commandId', 'title', 'artist'].includes(k)) || !validId(value.commandId) || typeof value.title !== 'string' || typeof value.artist !== 'string') throw denied();
    const { commandId, title, artist } = value as { commandId: string; title: string; artist: string };
    const fingerprint = digest(JSON.stringify(['missing-song', title, artist]));
    return this.transaction(() => {
      const state = this.state();
      const prior = this.db.prepare('SELECT fingerprint, outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, commandId) as Receipt | undefined;
      if (prior) return prior.fingerprint === fingerprint ? JSON.parse(prior.outcome) as Outcome : { ok: false, code: 'COMMAND_ID_REUSED', message: 'Command ID was reused with different content', revision: state.revision };
      const singer = state.singers.find(item => item.id === guest.singerId);
      const request = normalizeMissingRequest({ singer: singer?.name, title, artist });
      if (!request) throw denied();
      const outcome: Outcome = { ok: true, revision: state.revision };
      const requestId = randomUUID();
      this.db.prepare('INSERT INTO missing_song_requests (id, singer, title, artist, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(requestId, request.singer, request.title, request.artist, new Date(this.now()).toISOString());
      this.db.prepare('INSERT INTO remote_missing_song_owners (request_id, guest_id, singer_id, show_id) VALUES (?, ?, ?, ?)')
        .run(requestId, guest.id, guest.singerId, guest.showId);
      this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)')
        .run(guest.id, commandId, fingerprint, JSON.stringify(outcome));
      return outcome;
    });
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
      const state = this.state();
      const applied = applyCommand(state, { commandId: `remote-${guest.id}-${request.commandId}`, showId: request.showId, hostEpoch: request.hostEpoch,
        expectedRevision: request.expectedRevision, actor: { role: 'singer', id: guest.singerId },
        command: { type: 'request', requestId: `remote-${guest.id}-${request.commandId}`, singerId: guest.singerId, versionId: request.versionId } }, this.settings(), this.now());
      this.save(applied.state);
      this.db.prepare('INSERT INTO remote_receipts (guest_id, command_id, fingerprint, outcome) VALUES (?, ?, ?, ?)').run(guest.id, request.commandId, fingerprint, JSON.stringify(applied.outcome));
      committed = applied.state;
      return applied.outcome;
    });
    if (committed) this.onCommitted(committed);
    return outcome;
  }
}
