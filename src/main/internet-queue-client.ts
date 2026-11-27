/** Outbound, host-authenticated relay client. It never opens a listener or proxies URLs. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { INTERNET_QUEUE_ORIGIN, validateSessionSlug, type InternetSessionStatus } from '../remote/internet-session-control';
import { RemoteAuthorityCoordinator } from './remote-authority-coordinator';
import { JoinRevisionConflict } from './remote-queue';
import { RemoteRelayScope } from './remote-relay-scope';
import type { GuestAuthority } from './remote-guest-api';
import { MAX_PHOTO_BODY_BYTES } from '../domain/photo';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Connection = { baseUrl: typeof INTERNET_QUEUE_ORIGIN; ownerToken: string };
type Room = { roomId: string; generation: string; slug: string; publicUrl: string; expiresAt: number; pollAfterMs: number };
export type InternetGuestCall = { requestId: string; operation: string; payload: unknown; session?: string };
export type InternetGuestReply = { requestId: string; status: 200 | 400 | 409; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const OWNER = /^[A-Za-z0-9._~-]{32,256}$/;
const OPERATIONS = new Set(['admission', 'join', 'resume', 'snapshot', 'catalog', 'outcome', 'request', 'withdraw', 'availability', 'missing-request', 'applause', 'photo']);
const MAX_PAYLOAD = 8192, MAX_REPLY = 2 * 1024 * 1024, MAX_POLL = 512 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
// POSIX ownership/mode can be checked here. On Windows the installer/operator
// must provision a protected current-user + SYSTEM ACL; Node mode bits do not prove it.
const privateFile = (info: { mode: number; uid: number; isFile(): boolean }) => info.isFile() && (process.platform === 'win32' ||
  (typeof process.getuid === 'function' && info.uid === process.getuid() && (info.mode & 0o077) === 0));

/** Reuses the guest authority's allowlisted methods; no HTTP request can select a host operation. */
export function dispatchInternetGuestCall(authority: GuestAuthority, call: InternetGuestCall, invitation: () => string): InternetGuestReply {
  const denied = (): InternetGuestReply => ({ requestId: call.requestId, status: 400, body: { error: 'Request could not be completed.' } });
  try {
    if (!record(call) || typeof call.requestId !== 'string' || !UUID.test(call.requestId) ||
        Object.keys(call).some(key => !['requestId', 'operation', 'payload', 'session'].includes(key)) ||
        !record(call.payload) || bytes(call.payload) > MAX_PAYLOAD || !OPERATIONS.has(call.operation)) return denied();
    const payload = call.payload, session = call.session;
    const guest = () => { if (typeof session !== 'string' || !SECRET.test(session)) throw new Error(); return session; };
    let body: unknown;
    switch (call.operation) {
      case 'admission':
        if (!exact(payload, []) || session !== undefined) return denied();
        body = authority.admissionInfo(invitation()); break;
      case 'join':
        if (!exact(payload, ['joinId', 'resumeSecret', 'name', 'expectedRevision']) || session !== undefined) return denied();
        body = authority.join(invitation(), payload.joinId, payload.resumeSecret, payload.name, payload.expectedRevision); break;
      case 'resume':
        if (!exact(payload, ['resumeSecret']) || session !== undefined) return denied();
        body = authority.resume(payload.resumeSecret); break;
      case 'snapshot':
        if (!exact(payload, [])) return denied();
        body = authority.snapshot(guest()); break;
      case 'catalog':
        if (!(exact(payload, ['offset', 'limit']) || exact(payload, ['offset', 'limit', 'query'])) || (payload.query !== undefined && typeof payload.query !== 'string') || typeof payload.offset !== 'number' || typeof payload.limit !== 'number') return denied();
        body = authority.catalog(guest(), payload.offset, payload.limit, payload.query as string | undefined); break;
      case 'outcome':
        if (!exact(payload, ['commandId'])) return denied();
        body = authority.outcome(guest(), payload.commandId); break;
      case 'request':
        if (!exact(payload, ['command'])) return denied();
        body = authority.submit(guest(), payload.command); break;
      case 'withdraw':
        if (!exact(payload, ['command'])) return denied();
        body = authority.withdraw(guest(), payload.command); break;
      case 'availability':
        if (!exact(payload, ['command']) || !authority.setAvailability) return denied();
        body = authority.setAvailability(guest(), payload.command); break;
      case 'missing-request':
        if (!exact(payload, ['command'])) return denied();
        body = authority.submitMissing(guest(), payload.command); break;
      default: return denied();
    }
    if (bytes(body) > MAX_REPLY - 1024) return denied();
    return { requestId: call.requestId, status: 200, body };
  } catch (error) {
    if (call.operation === 'join' && error instanceof JoinRevisionConflict) return { requestId: call.requestId, status: 409, body: { error: 'REVISION_CONFLICT' } };
    return denied();
  }
}

/** Catalog lookup, applause and photos can wait for an external authority. */
export async function dispatchInternetGuestCallAsync(authority: GuestAuthority, call: InternetGuestCall, invitation: () => string): Promise<InternetGuestReply> {
  if (call.operation === 'catalog' && authority.searchCatalog && record(call.payload) && call.payload.query) {
    const denied: InternetGuestReply = { requestId: call.requestId, status: 400, body: { error: 'Request could not be completed.' } };
    const payload = call.payload;
    try {
      if (typeof call.requestId !== 'string' || !UUID.test(call.requestId) ||
        Object.keys(call).some(key => !['requestId', 'operation', 'payload', 'session'].includes(key)) ||
        !exact(payload, ['offset', 'limit', 'query']) || typeof payload.query !== 'string' || bytes(payload) > MAX_PAYLOAD ||
        typeof payload.offset !== 'number' || typeof payload.limit !== 'number' || typeof call.session !== 'string' || !SECRET.test(call.session)) return denied;
      const body = await authority.searchCatalog(call.session, payload.offset, payload.limit, payload.query);
      return bytes(body) > MAX_REPLY - 1024 ? denied : { requestId: call.requestId, status: 200, body };
    } catch { return denied; }
  }
  if (call.operation !== 'applause' && call.operation !== 'photo') return dispatchInternetGuestCall(authority, call, invitation);
  const denied = (): InternetGuestReply => ({ requestId: call.requestId, status: 400, body: { error: 'Request could not be completed.' } });
  try {
    if (!record(call) || typeof call.requestId !== 'string' || !UUID.test(call.requestId) ||
        Object.keys(call).some(key => !['requestId', 'operation', 'payload', 'session'].includes(key)) ||
        !record(call.payload) || !exact(call.payload, ['command']) || bytes(call.payload) > (call.operation === 'photo' ? MAX_PHOTO_BODY_BYTES : MAX_PAYLOAD) ||
        typeof call.session !== 'string' || !SECRET.test(call.session)) return denied();
    if (call.operation === 'photo' ? !authority.submitPhoto : !authority.applaud) return denied();
    const body = call.operation === 'photo'
      ? await authority.submitPhoto!(call.session, call.payload.command)
      : await authority.applaud!(call.session, call.payload.command);
    if (bytes(body) > MAX_REPLY - 1024) return denied();
    return { requestId: call.requestId, status: 200, body };
  } catch { return denied(); }
}

class ConnectionFileError extends Error {}
class ShowRecoveryError extends Error {}

async function readConnection(file: string, requirePrivate = true): Promise<Connection> {
  const validFile = (info: Stats) => requirePrivate ? privateFile(info) : info.isFile();
  try {
    if (!isAbsolute(file)) throw new Error();
    const before = await lstat(file);
    if (!before.isFile() || before.size < 1 || before.size > 8192) throw new Error();
    if (!validFile(before)) throw new ConnectionFileError('The connection file must belong to your user account and be private. Use Choose Connection File to install it again.');
    const handle = await open(file, process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let data: Buffer;
    try {
      const stat = await handle.stat();
      if (!validFile(stat) || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs) throw new Error();
      const bounded = Buffer.alloc(8193);
      const { bytesRead } = await handle.read(bounded, 0, bounded.length, 0);
      if (bytesRead !== stat.size) throw new Error();
      data = bounded.subarray(0, bytesRead);
      const after = await handle.stat(), named = await lstat(file);
      if (!validFile(after) || !validFile(named) || data.length > 8192 || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs ||
          named.isSymbolicLink() || named.dev !== stat.dev || named.ino !== stat.ino || named.size !== stat.size || named.mtimeMs !== stat.mtimeMs || named.ctimeMs !== stat.ctimeMs) throw new Error();
    } finally { await handle.close(); }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    if (!record(parsed) || !exact(parsed, ['baseUrl', 'ownerToken']) || parsed.baseUrl !== INTERNET_QUEUE_ORIGIN || typeof parsed.ownerToken !== 'string' || !OWNER.test(parsed.ownerToken)) throw new Error();
    return { baseUrl: INTERNET_QUEUE_ORIGIN, ownerToken: parsed.ownerToken };
  } catch (error) {
    if (error instanceof ConnectionFileError) throw error;
    if (requirePrivate && (error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new ConnectionFileError(process.platform === 'win32'
      ? 'This computer needs a private internet-session connection file. Ask the room administrator to provision this device.'
      : 'This computer needs its own internet-session connection file. Ask the room administrator for one, then choose it here.');
    throw new ConnectionFileError('The connection file could not be read or is invalid. Ask the room administrator for a valid file for this computer.');
  }
}

class RelayFailure extends Error {
  constructor(readonly retryable: boolean, readonly code = 0) { super('The internet session connection is unavailable.'); }
}

/** Bounded JSON on a single trusted HTTPS origin. Redirects and arbitrary proxy targets are forbidden. */
async function post(fetcher: Fetcher, config: Connection, operation: 'open' | 'poll' | 'reply' | 'close' | 'screen', payload: unknown,
  signal: AbortSignal, timeoutMs: number, maxResponse = MAX_POLL): Promise<unknown> {
  const controller = new AbortController();
  let rejectAbort!: (reason: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new RelayFailure(true)); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RelayFailure(true)); }, timeoutMs); });
  const work = (async () => {
    try {
      const response = await fetcher(`${config.baseUrl}/v1/relay/host/${operation}`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.ownerToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new RelayFailure(true); }
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new RelayFailure(response.status === 429 || response.status >= 500, response.status); }
      if (response.status === 204) return null;
      if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length') ?? 0) > maxResponse) throw new RelayFailure(false);
      const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > maxResponse || controller.signal.aborted) throw new RelayFailure(false);
          parts.push(part.value);
        }
      } finally { controller.signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (controller.signal.aborted) throw new RelayFailure(true);
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, size))) as unknown;
    } catch (error) { throw error instanceof RelayFailure ? error : new RelayFailure(true); }
  })();
  try { return await Promise.race([work, timeout, cancelled]); }
  finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

function room(value: unknown, slug: string): Room {
  if (!record(value) || typeof value.roomId !== 'string' || !UUID.test(value.roomId) || typeof value.generation !== 'string' || !UUID.test(value.generation) ||
      value.slug !== slug || value.publicUrl !== `${INTERNET_QUEUE_ORIGIN}/${slug}` || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= Date.now() ||
      !Number.isSafeInteger(value.pollAfterMs) || (value.pollAfterMs as number) < 0 || (value.pollAfterMs as number) > 20000) throw new RelayFailure(false);
  return value as Room;
}
function calls(value: unknown, current: Room): InternetGuestCall[] {
  if (!record(value) || !exact(value, ['roomId', 'generation', 'requests']) || value.roomId !== current.roomId || value.generation !== current.generation || !Array.isArray(value.requests) || value.requests.length > 8) throw new RelayFailure(false);
  const ids = new Set<string>();
  for (const item of value.requests) {
    if (!record(item) || Object.keys(item).some(key => !['requestId', 'operation', 'payload', 'session'].includes(key)) || typeof item.requestId !== 'string' || !UUID.test(item.requestId) || ids.has(item.requestId) ||
        typeof item.operation !== 'string' || !OPERATIONS.has(item.operation) || !record(item.payload) ||
        bytes(item.payload) > (item.operation === 'photo' ? MAX_PHOTO_BODY_BYTES : MAX_PAYLOAD) ||
        item.session !== undefined && (typeof item.session !== 'string' || !SECRET.test(item.session))) throw new RelayFailure(false);
    ids.add(item.requestId);
  }
  return value.requests as InternetGuestCall[];
}
async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
  });
}

export type InternetQueueClientOptions = {
  coordinator: RemoteAuthorityCoordinator;
  configurationFile: string;
  publish?: (value: InternetSessionStatus) => void;
  onMissingRequest?: () => void;
  writeClipboard?: (value: string) => void;
  fetch?: Fetcher;
  /** Deterministic bounded delays for integration tests; normal operation uses 1–15 seconds. */
  reconnectDelayMs?: number;
  /** A bounded JPEG from the singer display only, never the host desktop. */
  screenFrame?: () => Buffer | null;
};

export class InternetQueueClient {
  private state: InternetSessionStatus['state'] = 'stopped';
  private readonly suggestedSlug = `karaoke-${randomBytes(3).toString('hex')}`;
  private slug: string | null = null;
  private message = 'Start a session to invite singers.';
  private config: Connection | undefined;
  private currentRoom: Room | undefined;
  private scope: RemoteRelayScope | undefined;
  private invitation = '';
  private invitationCreated = 0;
  private controller: AbortController | undefined;
  private opening: Promise<void> | undefined;
  private polling: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private configuring = false;
  private pendingOpen: { slug: string; openId: string } | undefined;
  private disposed = false;
  private epoch = 0;
  private screen: { id: string; secret: string; controller: AbortController; sequence: number; viewerOrigin: string; ready: boolean } | undefined;
  constructor(private readonly options: InternetQueueClientOptions) {
    if (!isAbsolute(options.configurationFile) || options.reconnectDelayMs !== undefined && (!Number.isInteger(options.reconnectDelayMs) || options.reconnectDelayMs < 0 || options.reconnectDelayMs > 15000)) throw new Error('Invalid internet-session options.');
    options.coordinator.onFailure(() => {
      this.controller?.abort(); this.closeScope(); this.state = 'failed'; this.message = 'The show needs recovery. Restart the app before opening another session.'; this.changed();
    });
  }
  status(): InternetSessionStatus {
    let guests: InternetSessionStatus['guests'] = [];
    if (this.scope && this.state === 'online') { try { guests = this.scope.guests().map(({ singerId, name }) => ({ singerId, name })); } catch {} }
    return { available: !this.disposed, state: this.state, suggestedSlug: this.suggestedSlug, slug: this.slug,
      joinUrl: this.state === 'online' ? this.currentRoom?.publicUrl ?? null : null, guests, message: this.message,
      canImportConnection: process.platform !== 'win32' && this.state === 'stopped',
      screenActive: !!this.screen, screenUrl: this.screen?.ready && this.state === 'online' && this.currentRoom ? `${this.screen.viewerOrigin}/${this.currentRoom.slug}/screen#${this.screen.secret}` : null };
  }
  get screenSharing(): boolean { return !!this.screen; }
  async startScreen(): Promise<void> {
    if (this.screen || this.state !== 'online' || !this.currentRoom || !this.config || !this.options.screenFrame) throw new Error('Start an internet session before sharing the singer screen.');
    const room = this.currentRoom, config = this.config, controller = new AbortController();
    const screen = { id: randomUUID(), secret: randomBytes(32).toString('base64url'), controller, sequence: 0, viewerOrigin: INTERNET_QUEUE_ORIGIN as string, ready: false }; this.screen = screen; this.changed();
    try {
      const ack = await post(this.options.fetch ?? fetch, config, 'screen', { roomId: room.roomId, generation: room.generation, streamId: screen.id, action: 'start', viewerDigest: createHash('sha256').update(screen.secret).digest('hex') }, controller.signal, 5000);
      if (!record(ack) || ack.ok !== true || !(exact(ack, ['ok']) || exact(ack, ['ok', 'viewerOrigin']) && ack.viewerOrigin === 'https://booth.thepropervolume.com')) throw new Error('Invalid screen-sharing response.');
      if (this.screen !== screen || this.state !== 'online') throw new Error();
      if (ack.viewerOrigin) screen.viewerOrigin = ack.viewerOrigin as string;
      screen.ready = true; this.changed();
      void this.publishScreen(screen, room, config);
    } catch {
      if (this.screen === screen) { this.screen = undefined; this.changed(); }
      controller.abort(); throw new Error('Internet screen sharing is unavailable. The relay may need an update, or the connection may be down.');
    }
  }
  private async publishScreen(screen: NonNullable<InternetQueueClient['screen']>, room: Room, config: Connection): Promise<void> {
    let missingSince = Date.now();
    while (this.screen === screen && !screen.controller.signal.aborted && this.state === 'online') {
      try {
        const frame = this.options.screenFrame?.();
        if (frame && frame.length <= 256 * 1024) { await post(this.options.fetch ?? fetch, config, 'screen', { roomId: room.roomId, generation: room.generation,
          streamId: screen.id, action: 'frame', sequence: ++screen.sequence, frame: frame.toString('base64') }, screen.controller.signal, 5000); missingSince = Date.now(); }
        else if (Date.now() - missingSince >= 3000) throw new Error('Singer-screen capture is unavailable.');
        await sleep(1000, screen.controller.signal);
      } catch { break; }
    }
    if (this.screen === screen) { this.screen = undefined; screen.controller.abort(); this.message = 'Internet screen stopped because its connection or capture was lost. Try sharing again.'; this.changed(); }
  }
  async stopScreen(): Promise<void> {
    const screen = this.screen, room = this.currentRoom, config = this.config;
    if (!screen) return;
    this.screen = undefined; screen.controller.abort(); this.changed();
    if (!room || !config) return;
    const payload = { roomId: room.roomId, generation: room.generation, streamId: screen.id, action: 'stop' };
    for (let attempt = 0; ; attempt++) {
      try { await post(this.options.fetch ?? fetch, config, 'screen', payload, new AbortController().signal, 3000); break; }
      catch (error) { if (attempt) throw error; }
    }
  }
  copyScreenLink(): void {
    const link = this.status().screenUrl;
    if (!link || !this.options.writeClipboard) throw new Error('The singer-screen link is unavailable.');
    this.options.writeClipboard(link);
  }
  private changed(): void { try { this.options.publish?.(this.status()); } catch {} }
  private closeScope(): boolean {
    if (!this.scope) return true;
    try { this.scope.close(); this.scope = undefined; this.invitation = ''; return true; } catch { return false; }
  }
  private live(controller: AbortController, epoch: number): boolean { return !controller.signal.aborted && !this.disposed && this.epoch === epoch; }
  async importConnection(file: string): Promise<void> {
    if (process.platform === 'win32' || this.disposed || this.configuring || this.state !== 'stopped' || this.opening || this.stopping)
      throw new Error('End the internet session before choosing a connection file.');
    this.configuring = true;
    const target = this.options.configurationFile, directory = dirname(target);
    const temporary = join(directory, `.internet-connection-${randomUUID()}.tmp`);
    try {
      const config = await readConnection(file, false);
      const parent = await lstat(directory);
      // App data can be readable, but other users must be unable to replace the file.
      if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o022) !== 0 || this.disposed || this.status().state !== 'stopped')
        throw new Error('The app data folder must belong to your user account and be writable only by you.');
      await writeFile(temporary, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
      this.message = 'Connection file installed. Start a session to invite singers.';
      this.changed();
    } catch (error) {
      if (error instanceof ConnectionFileError) throw error;
      throw new Error('Could not install the connection file. Check that your app data folder is private and writable.');
    } finally {
      await unlink(temporary).catch(() => {});
      this.configuring = false;
    }
  }
  private async connect(controller: AbortController, epoch: number): Promise<void> {
    if (!this.config || !this.pendingOpen || !this.live(controller, epoch)) throw new RelayFailure(false);
    if (!this.closeScope()) throw new RelayFailure(false);
    try {
      this.scope = new RemoteRelayScope(this.options.coordinator.getAuthority(), { guests: () => this.changed(), missing: this.options.onMissingRequest });
    } catch { throw new ShowRecoveryError(); }
    const value = await post(this.options.fetch ?? fetch, this.config, 'open', this.pendingOpen, controller.signal, 10000);
    const opened = room(value, this.pendingOpen.slug);
    this.currentRoom = opened; this.pendingOpen = undefined;
    if (!this.live(controller, epoch)) throw new RelayFailure(false);
    this.state = 'online'; this.message = 'Session online. Share the singer link to invite your guests.'; this.changed();
  }
  async start(input: unknown): Promise<void> {
    if (this.disposed || this.configuring || this.opening || this.polling || this.stopping || !['stopped', 'failed'].includes(this.state) || this.scope || this.currentRoom || this.pendingOpen) throw new Error('End the previous session before starting another.');
    if (!record(input) || !exact(input, ['slug']) || validateSessionSlug(input.slug)) throw new Error('Choose a valid session name.');
    const slug = input.slug as string, controller = new AbortController(), epoch = ++this.epoch;
    this.controller = controller; this.slug = slug; this.state = 'starting'; this.message = 'Starting your internet session…'; this.changed();
    const work = (async () => {
      try {
        this.config = await readConnection(this.options.configurationFile);
        if (!this.live(controller, epoch)) return;
        this.pendingOpen = { slug, openId: randomUUID() };
        await this.connect(controller, epoch);
        if (!this.live(controller, epoch)) return;
        const polling = this.poll(controller, epoch); this.polling = polling;
        void polling.finally(() => { if (this.polling === polling) this.polling = undefined; }).catch(() => {});
      } catch (error) {
        this.closeScope();
        if (controller.signal.aborted) return;
        const rejected = error instanceof RelayFailure && !error.retryable && error.code >= 400 && error.code < 500;
        if (rejected || error instanceof ShowRecoveryError) this.pendingOpen = undefined;
        this.state = error instanceof ShowRecoveryError || this.pendingOpen || this.scope ? 'failed' : 'stopped';
        if (error instanceof ConnectionFileError) this.message = error.message;
        else if (error instanceof ShowRecoveryError) this.message = 'The show needs recovery. Restart Booth before opening another session.';
        else if (error instanceof RelayFailure && error.code === 409) this.message = 'That session name is already in use. Choose another name.';
        else if (error instanceof RelayFailure && (error.code === 401 || error.code === 403)) this.message = 'The relay rejected this device’s connection file. Ask the room administrator for a replacement.';
        else this.message = this.pendingOpen ? 'The relay could not confirm the room opened. End this attempt and try again once you are online.'
          : 'The relay could not open a room. Check your network connection and try again.';
        this.changed(); throw new Error(this.message);
      }
    })();
    this.opening = work;
    try { await work; } finally { if (this.opening === work) this.opening = undefined; }
  }
  private privateInvitation(): string {
    if (!this.scope) throw new Error('Session is closed.');
    if (!this.invitation || Date.now() - this.invitationCreated >= 30 * 60 * 1000) {
      this.invitation = this.scope.createInvitation(3600000); this.invitationCreated = Date.now();
    }
    return this.invitation;
  }
  private async poll(controller: AbortController, epoch: number): Promise<void> {
    let retry = 0;
    while (this.live(controller, epoch)) {
      try {
        if (!this.currentRoom || !this.scope || !this.config || this.currentRoom.expiresAt <= Date.now()) throw new RelayFailure(false);
        const current = this.currentRoom;
        const value = await post(this.options.fetch ?? fetch, this.config, 'poll', { roomId: current.roomId, generation: current.generation }, controller.signal, 25000);
        if (!this.live(controller, epoch)) return;
        const batch = calls(value, current), pending: Promise<InternetGuestReply>[] = [];
        if (this.state === 'reconnecting') { this.state = 'online'; this.message = 'Session online. Singers can reconnect and check their saved requests.'; this.changed(); }
        for (const call of batch) {
          if (!this.live(controller, epoch) || !this.scope || this.state !== 'online') return;
          const response = dispatchInternetGuestCallAsync(this.scope.authority, call, () => this.privateInvitation());
          // Independent catalog lookups should share the same relay deadline,
          // without making an applause or queue command wait for each provider.
          pending.push(call.operation === 'catalog' ? response : Promise.resolve(await response));
          if (!this.live(controller, epoch)) return;
        }
        const responses = await Promise.all(pending);
        if (!this.live(controller, epoch)) return;
        if (responses.length) {
          const chunks: InternetGuestReply[][] = []; let chunk: InternetGuestReply[] = [];
          for (const response of responses) {
            if (bytes({ roomId: current.roomId, generation: current.generation, responses: [...chunk, response] }) > MAX_REPLY) {
              if (!chunk.length) throw new RelayFailure(false);
              chunks.push(chunk); chunk = [];
            }
            chunk.push(response);
          }
          if (chunk.length) chunks.push(chunk);
          for (const responses of chunks) {
            const payload = { roomId: current.roomId, generation: current.generation, responses };
            // Reuse exactly the same batch after a lost acknowledgement. The relay's
            // digest receipt prevents an acknowledged reply from being applied twice.
            for (let attempt = 0; ; attempt++) {
              try {
                const ack = await post(this.options.fetch ?? fetch, this.config, 'reply', payload, controller.signal, 10000);
                if (!record(ack) || !exact(ack, ['ok']) || ack.ok !== true) throw new RelayFailure(false);
                if (this.state === 'reconnecting') { this.state = 'online'; this.message = 'Session online. Singers can reconnect and check their saved requests.'; this.changed(); }
                break;
              } catch (error) {
                if (error instanceof RelayFailure && error.code === 409) break; // expired RPC tombstone; its durable command receipt remains recoverable
                if (!this.live(controller, epoch) || !(error instanceof RelayFailure) || !error.retryable || attempt >= 2) throw error;
                this.state = 'reconnecting'; this.message = 'Connection lost. Reconnecting… Your requests remain saved.'; this.changed();
                await sleep(250, controller.signal);
              }
            }
          }
        } else await sleep(Math.max(100, current.pollAfterMs), controller.signal);
        retry = 0;
      } catch (error) {
        if (!this.live(controller, epoch)) return;
        // A temporary outage must preserve the authority scope and generation so
        // singers can recover their original receipts. No dispatch occurs until a
        // successful bounded poll restores the online state.
        if (!(error instanceof RelayFailure) || !error.retryable && error.code !== 409) {
          this.closeScope(); controller.abort(); this.state = 'failed';
          this.message = error instanceof RelayFailure && error.code === 410 ? 'This session has ended. Choose End Session before starting again.' : 'The session needs to be ended before it can reconnect.';
          this.changed(); return;
        }
        this.state = 'reconnecting'; this.message = 'Connection lost. Reconnecting… Your requests remain saved.'; this.changed();
        await sleep(this.options.reconnectDelayMs ?? Math.min(15000, 1000 * 2 ** Math.min(retry++, 4)), controller.signal);
      }
    }
  }
  copyLink(): void {
    if (this.state !== 'online' || !this.currentRoom || !this.options.writeClipboard) throw new Error('The singer link is unavailable.');
    this.options.writeClipboard(this.currentRoom.publicUrl);
  }
  revokeGuest(singerId: unknown): void {
    if (this.state !== 'online' || !this.scope || typeof singerId !== 'string' || !UUID.test(singerId)) throw new Error('Singer access is unavailable.');
    this.scope.revokeGuest(singerId); this.changed();
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.state = 'stopping'; this.message = 'Ending your internet session…';
    this.controller?.abort(); ++this.epoch;
    const revoked = this.closeScope(); this.changed();
    const work = (async () => {
      try {
        await this.stopScreen().catch(() => {});
        await this.opening?.catch(() => {}); await this.polling?.catch(() => {});
        if (!revoked && !this.closeScope()) throw new Error();
        if (this.pendingOpen && this.config) {
          // Recover a lost open response using the same operation ID, solely to close it.
          try {
            const value = await post(this.options.fetch ?? fetch, this.config, 'open', this.pendingOpen, new AbortController().signal, 5000);
            this.currentRoom = room(value, this.pendingOpen.slug);
          } catch (error) { if (!(error instanceof RelayFailure) || ![404, 410].includes(error.code)) throw error; }
          this.pendingOpen = undefined;
        }
        if (this.currentRoom && this.config) {
          try { await post(this.options.fetch ?? fetch, this.config, 'close', { roomId: this.currentRoom.roomId, generation: this.currentRoom.generation }, new AbortController().signal, 5000); }
          catch (error) { if (!(error instanceof RelayFailure) || ![404, 410].includes(error.code)) throw error; }
        }
        this.currentRoom = undefined; this.pendingOpen = undefined; this.config = undefined;
        this.state = 'stopped'; this.message = 'Session ended. Internet singers no longer have access.';
      } catch {
        this.state = 'failed'; this.message = 'Singer access is blocked locally, but the server could not confirm the session ended. Try End Session again.';
        throw new Error('Session cleanup is incomplete.');
      } finally { this.changed(); }
    })();
    this.stopping = work;
    void work.finally(() => { if (this.stopping === work) this.stopping = undefined; }).catch(() => {});
    return work;
  }
  needsShutdownWait(): boolean { return !!this.opening || !!this.polling || !!this.scope || !!this.currentRoom || !!this.pendingOpen || !!this.stopping; }
  async shutdown(timeoutMs = 5000): Promise<boolean> {
    this.disposed = true;
    const task = this.stop().then(() => true, () => false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([task, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, Math.min(10000, timeoutMs))); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
}
