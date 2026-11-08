/** Transport-independent, single-authority guest boundary. It opens no listener. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applyCommand, isVersionAllowed, visibleVersions, type Outcome, type ShowState } from '../domain';
import type { Settings } from '../domain/settings';

type Guest = { id: string; singerId: string; showId: string };
type Receipt = { fingerprint: string; outcome: string };
type RequestInput = { commandId: string; showId: string; hostEpoch: string; expectedRevision: number; versionId: string };
const secret = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const validSecret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const denied = () => new Error('Guest access denied.');

/** The client must generate its resume secret with a cryptographic RNG and keep it private. */
export class RemoteQueue {
  private readonly runId = randomUUID();
  constructor(private readonly db: DatabaseSync, private readonly settings: () => Pick<Settings, 'autoApprove' | 'rotationMode' | 'pauseIntervalSeconds'>,
    private readonly onCommitted: (state: ShowState) => void, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS remote_invitations (token_hash TEXT PRIMARY KEY, show_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_guests (id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, show_id TEXT NOT NULL, resume_hash TEXT NOT NULL UNIQUE, resume_expires INTEGER NOT NULL, join_id TEXT NOT NULL UNIQUE, join_name TEXT NOT NULL, join_revision INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_sessions (token_hash TEXT PRIMARY KEY, guest_id TEXT NOT NULL, run_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_receipts (guest_id TEXT NOT NULL, command_id TEXT NOT NULL, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY (guest_id, command_id));`);
  }
  private state(): ShowState {
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
  /** Host-only API: this reusable secret admits guests until it expires or is revoked. */
  createInvitation(ttlMs: number): string {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600000) throw new Error('Invalid invitation lifetime.');
    const token = secret(), state = this.state();
    this.transaction(() => {
      this.db.prepare('UPDATE remote_invitations SET revoked = 1 WHERE show_id = ?').run(state.showId);
      this.db.prepare('INSERT INTO remote_invitations (token_hash, show_id, expires) VALUES (?, ?, ?)').run(digest(token), state.showId, this.now() + ttlMs);
    });
    return token;
  }
  private issueSession(guestId: string): string {
    const token = secret();
    this.db.prepare('INSERT INTO remote_sessions (token_hash, guest_id, run_id, expires) VALUES (?, ?, ?, ?)').run(digest(token), guestId, this.runId, this.now() + 8 * 3600000);
    return token;
  }
  /** A valid invitation grants only the information required to join the live show. */
  admissionInfo(invitation: unknown): { showId: string; hostEpoch: string; revision: number } {
    if (!validSecret(invitation)) throw denied();
    const state = this.state();
    const invite = this.db.prepare('SELECT show_id AS showId, expires, revoked FROM remote_invitations WHERE token_hash = ?').get(digest(invitation)) as { showId: string; expires: number; revoked: number } | undefined;
    if (!invite || invite.revoked || invite.expires <= this.now() || invite.showId !== state.showId) throw denied();
    return { showId: state.showId, hostEpoch: state.hostEpoch, revision: state.revision };
  }
  /** A repeat join with the same join ID and resume secret recovers a lost join response. */
  join(invitation: unknown, joinId: unknown, resumeSecret: unknown, name: unknown, expectedRevision: unknown): { session: string; singerId: string } {
    if (!validSecret(invitation) || !validId(joinId) || !validSecret(resumeSecret) || typeof name !== 'string' || !name.trim() || name.trim().length > 100 || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw denied();
    let committed: ShowState | undefined;
    const result = this.transaction(() => {
      const state = this.state(), hash = digest(resumeSecret);
      const prior = this.db.prepare('SELECT id, singer_id AS singerId, show_id AS showId, resume_hash AS resumeHash, resume_expires AS resumeExpires, join_name AS joinName, join_revision AS joinRevision, revoked FROM remote_guests WHERE join_id = ?').get(joinId) as { id: string; singerId: string; showId: string; resumeHash: string; resumeExpires: number; joinName: string; joinRevision: number; revoked: number } | undefined;
      if (prior) {
        if (prior.revoked || prior.resumeExpires <= this.now() || prior.resumeHash !== hash || prior.joinName !== name.trim() || prior.joinRevision !== expectedRevision || prior.showId !== state.showId) throw denied();
        return { session: this.issueSession(prior.id), singerId: prior.singerId };
      }
      const invite = this.db.prepare('SELECT show_id AS showId, expires, revoked FROM remote_invitations WHERE token_hash = ?').get(digest(invitation)) as { showId: string; expires: number; revoked: number } | undefined;
      if (!invite || invite.revoked || invite.expires <= this.now() || invite.showId !== state.showId) throw denied();
      const guestId = randomUUID(), singerId = randomUUID();
      // The invite authorizes only this tightly scoped internal registration operation.
      const applied = applyCommand(state, { commandId: `remote-join-${guestId}`, showId: state.showId, hostEpoch: state.hostEpoch,
        expectedRevision: expectedRevision as number, actor: { role: 'host', id: 'remote-registration' }, command: { type: 'addSinger', singer: { id: singerId, name: name.trim() } } }, this.settings(), this.now());
      if (!applied.outcome.ok) throw new Error(applied.outcome.code);
      this.save(applied.state);
      this.db.prepare('INSERT INTO remote_guests (id, singer_id, show_id, resume_hash, resume_expires, join_id, join_name, join_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(guestId, singerId, state.showId, hash, this.now() + 24 * 3600000, joinId, name.trim(), expectedRevision as number);
      const session = this.issueSession(guestId);
      committed = applied.state;
      return { session, singerId };
    });
    if (committed) this.onCommitted(committed);
    return result;
  }
  resume(resumeSecret: unknown): { session: string; singerId: string } {
    if (!validSecret(resumeSecret)) throw denied();
    return this.transaction(() => {
      const guest = this.db.prepare('SELECT id, singer_id AS singerId, show_id AS showId, resume_expires AS resumeExpires, revoked FROM remote_guests WHERE resume_hash = ?').get(digest(resumeSecret)) as (Guest & { revoked: number; resumeExpires: number }) | undefined;
      if (!guest || guest.revoked || guest.resumeExpires <= this.now() || guest.showId !== this.state().showId) throw denied();
      return { session: this.issueSession(guest.id), singerId: guest.singerId };
    });
  }
  private authenticate(token: unknown): Guest {
    if (!validSecret(token)) throw denied();
    const row = this.db.prepare(`SELECT g.id, g.singer_id AS singerId, g.show_id AS showId FROM remote_sessions s
      JOIN remote_guests g ON g.id = s.guest_id WHERE s.token_hash = ? AND s.run_id = ? AND s.expires > ? AND s.revoked = 0 AND g.revoked = 0 AND g.resume_expires > ?`).get(digest(token), this.runId, this.now(), this.now()) as Guest | undefined;
    if (!row || row.showId !== this.state().showId) throw denied();
    return row;
  }
  /** Host-only, revokes both active and future resumed sessions. */
  revokeGuest(singerId: string): void {
    if (!validId(singerId)) throw new Error('Invalid singer ID.');
    this.db.prepare('UPDATE remote_guests SET revoked = 1 WHERE singer_id = ?').run(singerId);
  }
  revokeInvitations(): void { this.db.prepare('UPDATE remote_invitations SET revoked = 1 WHERE show_id = ?').run(this.state().showId); }
  /** Host-only: permanently close this room and all guest/resume credentials. */
  closeRoom(): void {
    const showId = this.state().showId;
    this.transaction(() => {
      this.db.prepare('UPDATE remote_invitations SET revoked = 1 WHERE show_id = ?').run(showId);
      this.db.prepare('UPDATE remote_guests SET revoked = 1 WHERE show_id = ?').run(showId);
      this.db.prepare('UPDATE remote_sessions SET revoked = 1 WHERE guest_id IN (SELECT id FROM remote_guests WHERE show_id = ?)').run(showId);
    });
  }
  snapshot(token: unknown) {
    const guest = this.authenticate(token), state = this.state();
    const catalog = this.catalog(token);
    const singerName = state.singers.find(singer => singer.id === guest.singerId)?.name ?? '';
    return { showId: state.showId, hostEpoch: state.hostEpoch, revision: state.revision, singerId: guest.singerId, singerName,
      catalog: catalog.items, catalogNextOffset: catalog.nextOffset,
      requests: state.requests.filter(r => r.singerId === guest.singerId && isVersionAllowed(state, r.versionId))
        .map(r => ({ id: r.id, versionId: r.versionId, status: r.status })) };
  }
  catalog(token: unknown, offset = 0, limit = 50) {
    this.authenticate(token);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw denied();
    const state = this.state(), versions = visibleVersions(state);
    const items = versions.slice(offset, offset + limit).map(v => ({ id: v.id, title: v.title, artist: v.artist }));
    return { revision: state.revision, items, nextOffset: offset + limit < versions.length ? offset + limit : null };
  }
  catalogItem(token: unknown, versionId: string) {
    const state = this.state(); this.authenticate(token);
    if (!isVersionAllowed(state, versionId)) return null;
    const version = state.versions.find(v => v.id === versionId)!;
    return { id: version.id, title: version.title, artist: version.artist };
  }
  /** Original outcome lookup is independent of host epoch but still requires the same guest. */
  outcome(token: unknown, commandId: unknown): Outcome | null {
    const guest = this.authenticate(token);
    if (!validId(commandId)) throw denied();
    const row = this.db.prepare('SELECT outcome FROM remote_receipts WHERE guest_id = ? AND command_id = ?').get(guest.id, commandId) as { outcome: string } | undefined;
    return row ? JSON.parse(row.outcome) as Outcome : null;
  }
  submit(token: unknown, input: unknown): Outcome {
    const guest = this.authenticate(token);
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
