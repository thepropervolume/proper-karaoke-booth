import { createHash } from 'node:crypto';
import type { Policy } from '../domain';
import type { Settings } from '../domain/settings';
import { compileSongBlacklist } from '../domain/song-blacklist';
import type { KHostBridgeFailure, KHostBridgeHandoff, KHostBridgeSearch, KHostBridgeSong, KHostBridgeUiStatus, KHostPendingHandoff } from '../domain/khost-bridge';
import { KHostBridgeClient, readKHostBridgeProfile, type KHostBridgeProfile } from './khost-client';

type Scope = Pick<Settings, 'khostBridgeConfigFile' | 'songBlacklist' | 'artistBlacklist'> & { policy: Policy };
type Client = Pick<KHostBridgeClient, 'status' | 'search' | 'handoff' | 'handoffStatus'>;
type Context = { key: string; path: string; fingerprint: string; generation: number; client: Client };
type Attempt = { resultId: string; requestId: string; path: string; fingerprint: string; song: KHostBridgeSong;
  result: KHostBridgeHandoff; uncertain: boolean; acknowledged: boolean; inFlight: boolean };
const key = (scope: Scope) => JSON.stringify([scope.khostBridgeConfigFile, scope.policy, scope.songBlacklist, scope.artistBlacklist]);
const restricted = (scope: Scope) => scope.policy.ageRestricted || scope.policy.includeVersionIds !== null;
const guid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const outstanding = (attempt: Attempt) => !attempt.acknowledged && (attempt.uncertain ||
  (attempt.result.status === 'handed-off' && attempt.result.state === 'pending') ||
  ('mayHaveBeenAccepted' in attempt.result && attempt.result.mayHaveBeenAccepted === true));

/** A host-only authority over the current profile and the current approved rows.
 * It never promotes companion rows to TPV versions or mutates the TPV show. */
export class KHostBridgeConnection {
  private scopeKey = '';
  private generation = 0;
  private sequence = 0;
  private readSequence = 0;
  private installedRead = 0;
  private fingerprint = '';
  private client: Client | null = null;
  private rows = new Map<string, KHostBridgeSong>();
  private rowsContext: Pick<Context, 'key' | 'fingerprint' | 'generation'> | null = null;
  private attempts = new Map<string, Attempt>();
  private polls = new Map<string, Promise<KHostBridgeHandoff>>();
  private active: Attempt | null = null;
  constructor(private readonly current: () => Scope, private readonly dependencies: {
    readProfile?: (path: string) => Promise<KHostBridgeProfile>;
    createClient?: (profile: KHostBridgeProfile) => Client;
  } = {}) {}

  private sync(): Scope {
    const scope = this.current(), next = key(scope);
    if (next !== this.scopeKey) {
      this.scopeKey = next; ++this.generation; this.rows.clear(); this.rowsContext = null;
      if (this.active && this.active.path !== scope.khostBridgeConfigFile) this.active.uncertain = true;
    }
    return scope;
  }
  cancelSearch(): void { ++this.sequence; this.rows.clear(); this.rowsContext = null; }
  invalidate(): void {
    this.cancelSearch(); ++this.generation; this.installedRead = ++this.readSequence;
    this.fingerprint = ''; this.client = null;
    this.sync();
  }
  private pending(): KHostPendingHandoff | null {
    const attempt = this.active;
    return attempt && outstanding(attempt) ? { requestId: attempt.requestId, title: attempt.song.title,
      artist: attempt.song.artist, uncertain: attempt.uncertain, sending: attempt.inFlight, result: { ...attempt.result } } : null;
  }
  private matches(context: Context): boolean {
    this.sync();
    return context.key === this.scopeKey && context.generation === this.generation && context.fingerprint === this.fingerprint;
  }
  private async connect(allowRestricted = false): Promise<Context | KHostBridgeFailure> {
    const scope = this.sync(), captured = this.scopeKey;
    if (!scope.khostBridgeConfigFile) return { status: 'not-configured' };
    if (!allowRestricted && restricted(scope)) return { status: 'policy-blocked' };
    const sequence = ++this.readSequence;
    let profile: KHostBridgeProfile;
    try { profile = await (this.dependencies.readProfile ?? readKHostBridgeProfile)(scope.khostBridgeConfigFile); }
    catch {
      if (sequence >= this.installedRead) {
        this.installedRead = sequence; ++this.generation; this.fingerprint = ''; this.client = null;
        this.rows.clear(); this.rowsContext = null; if (this.active) this.active.uncertain = true;
      }
      return { status: 'configuration-error' };
    }
    if (captured !== key(this.sync())) return { status: 'unavailable' };
    const fingerprint = createHash('sha256').update(JSON.stringify([profile.baseUrl, profile.token])).digest('hex');
    if (sequence < this.installedRead && fingerprint !== this.fingerprint) return { status: 'unavailable' };
    if (!this.client || fingerprint !== this.fingerprint) {
      this.client = (this.dependencies.createClient ?? (value => new KHostBridgeClient(value)))(profile);
      this.fingerprint = fingerprint; ++this.generation; this.rows.clear(); this.rowsContext = null;
      if (this.active && this.active.fingerprint !== fingerprint) this.active.uncertain = true;
    }
    this.installedRead = Math.max(this.installedRead, sequence);
    return { key: captured, path: scope.khostBridgeConfigFile, fingerprint, generation: this.generation, client: this.client };
  }
  private async stillCurrent(context: Context, allowRestricted = false): Promise<boolean> {
    if (!this.matches(context)) return false;
    const now = await this.connect(allowRestricted);
    return 'client' in now && this.matches(context) && now.fingerprint === context.fingerprint;
  }
  async status(): Promise<KHostBridgeUiStatus> {
    const context = await this.connect();
    if (!('client' in context)) return { configured: !!this.current().khostBridgeConfigFile, connection: context, pending: this.pending() };
    let result;
    try { result = await context.client.status(); } catch { result = { status: 'unavailable' } as const; }
    const connection = await this.stillCurrent(context) ? result : { status: 'unavailable' } as const;
    return { configured: !!this.current().khostBridgeConfigFile, connection, pending: this.pending() };
  }
  async search(query: unknown): Promise<KHostBridgeSearch> {
    const sequence = ++this.sequence; this.rows.clear(); this.rowsContext = null;
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/.test(query)) return { status: 'invalid-request' };
    const context = await this.connect(); if (!('client' in context)) return context;
    let result: KHostBridgeSearch;
    try { result = await context.client.search(query.trim()); } catch { return { status: 'unavailable' }; }
    if (sequence !== this.sequence || !await this.stillCurrent(context) || sequence !== this.sequence) return { status: 'unavailable' };
    if (result.status !== 'ready') return result;
    const blacklist = compileSongBlacklist(this.current());
    const songs = result.songs.filter(song => !blacklist.isBlocked(song));
    this.rowsContext = { key: context.key, fingerprint: context.fingerprint, generation: context.generation };
    for (const song of songs) this.rows.set(song.resultId, Object.freeze({ ...song }));
    return { ...result, songs: songs.map(song => ({ ...song })) };
  }
  private unknown(requestId?: string): KHostBridgeHandoff { return { status: 'unknown-request', ...(requestId ? { requestId } : {}) }; }
  async handoff(input: unknown): Promise<KHostBridgeHandoff> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'requestId,resultId') return { status: 'invalid-request' };
    const value = input as { resultId?: unknown; requestId?: unknown };
    if (!guid(value.resultId) || !guid(value.requestId)) return { status: 'invalid-request' };
    const resultId = value.resultId.toLowerCase(), requestId = value.requestId.toLowerCase();
    const previous = this.attempts.get(requestId);
    if (previous) return previous.resultId === resultId ? this.handoffStatus(requestId) : { status: 'idempotency-conflict', requestId };
    const context = await this.connect(); if (!('client' in context)) return context;
    // Nothing may await between this last authority check/reservation and dispatch.
    if (!this.matches(context)) return { status: 'unavailable' };
    if (this.active && outstanding(this.active)) return { status: 'busy', requestId: this.active.requestId };
    const row = this.rows.get(resultId), scope = this.current();
    if (restricted(scope)) return { status: 'policy-blocked' };
    if (!row || !this.rowsContext || this.rowsContext.key !== context.key || this.rowsContext.fingerprint !== context.fingerprint
      || this.rowsContext.generation !== context.generation) return { status: 'expired-result' };
    if (compileSongBlacklist(scope).isBlocked(row)) return { status: 'expired-result' };
    if (!row.canHandoff) return { status: 'handoff-unavailable' };
    if (this.attempts.size >= 100) {
      const settled = [...this.attempts].find(([, attempt]) => !outstanding(attempt));
      if (!settled) return { status: 'busy' }; this.attempts.delete(settled[0]);
    }
    const attempt: Attempt = { resultId, requestId, path: context.path, fingerprint: context.fingerprint, song: { ...row },
      result: { status: 'unavailable', requestId, mayHaveBeenAccepted: true }, uncertain: true, acknowledged: false, inFlight: true };
    this.attempts.set(requestId, attempt); this.active = attempt;
    let result: KHostBridgeHandoff;
    try { result = await context.client.handoff(resultId, requestId); }
    catch { result = { status: 'unavailable', requestId, mayHaveBeenAccepted: true }; }
    if (!await this.stillCurrent(context)) result = { status: 'unavailable', requestId, mayHaveBeenAccepted: true };
    attempt.inFlight = false;
    attempt.result = result;
    attempt.uncertain = 'mayHaveBeenAccepted' in result && result.mayHaveBeenAccepted === true;
    if (!outstanding(attempt) && this.active === attempt) this.active = null;
    return { ...result };
  }
  async handoffStatus(value: unknown): Promise<KHostBridgeHandoff> {
    if (!guid(value)) return { status: 'invalid-request' };
    const requestId = value.toLowerCase(), attempt = this.attempts.get(requestId);
    if (!attempt) return this.unknown(requestId);
    if (attempt.inFlight) return { status: 'unavailable', requestId, mayHaveBeenAccepted: true };
    const existing = this.polls.get(requestId);
    if (existing) return existing;
    const pending = this.observe(attempt);
    this.polls.set(requestId, pending);
    try { return await pending; }
    finally { if (this.polls.get(requestId) === pending) this.polls.delete(requestId); }
  }
  private async observe(attempt: Attempt): Promise<KHostBridgeHandoff> {
    const { requestId } = attempt;
    // A read-only observation remains useful after policy changes. It is still
    // bound to the original selected path and credential contents; no new action.
    const context = await this.connect(true);
    if (!('client' in context) || context.path !== attempt.path || context.fingerprint !== attempt.fingerprint) {
      attempt.uncertain = true;
      return { status: 'configuration-error', requestId, mayHaveBeenAccepted: true };
    }
    let result: KHostBridgeHandoff;
    try { result = await context.client.handoffStatus(requestId); }
    catch { result = { status: 'unavailable', requestId, mayHaveBeenAccepted: true }; }
    if (!await this.stillCurrent(context, true)) result = { status: 'unavailable', requestId, mayHaveBeenAccepted: true };
    attempt.result = result;
    attempt.uncertain = result.status !== 'handed-off';
    if (!outstanding(attempt) && this.active === attempt) this.active = null;
    return { ...result };
  }
  acknowledgeHandoff(value: unknown): boolean {
    if (!guid(value) || !this.active || value.toLowerCase() !== this.active.requestId || !this.active.uncertain || this.active.inFlight) return false;
    this.active.acknowledged = true; this.active = null; return true;
  }
}
