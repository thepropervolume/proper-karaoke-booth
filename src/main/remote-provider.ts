/** Opt-in LAN provider. Constructing it never creates an authority or opens a socket. */
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { open } from 'node:fs/promises';
import { isIP } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { basename, isAbsolute } from 'node:path';
import { checkServerIdentity, connect } from 'node:tls';
import type { ShowState } from '../domain';
import type { Settings } from '../domain/settings';
import type { RemoteInterface } from '../remote/host-control';
import { RemoteRoomOpenError, type HostRoomProvider, type RemoteRoom } from './remote-host-lifecycle';
import { startLanTransport, type LanTransport, type LanTransportOptions } from './remote-https';
import type { RemoteQueue } from './remote-queue';
import type { SingerStaticHandler } from './remote-static';
import type { Store } from './store';
import { RemoteAuthorityCoordinator } from './remote-authority-coordinator';

type NetInfo = Record<string, NetworkInterfaceInfo[] | undefined>;
type PickKind = 'certificate' | 'privateKey';
export type LanProviderOptions = {
  store: Store<ShowState>;
  settings: () => Pick<Settings, 'autoApprove' | 'rotationMode' | 'pauseIntervalSeconds'> & Partial<Pick<Settings, 'maxFutureRequestsPerSinger'>>;
  /** Must synchronously install the committed state and publish to host renderers. */
  installCommitted: (state: ShowState) => void;
  /** Shared with other transports; omitted for a standalone LAN-only provider. */
  coordinator?: RemoteAuthorityCoordinator;
  /** Main-process native picker. Never return this path to a renderer. */
  pickFile: (kind: PickKind) => Promise<string | null>;
  staticHandler: SingerStaticHandler;
  interfaces?: () => NetInfo;
  startTransport?: (options: LanTransportOptions) => Promise<LanTransport>;
  verifyHost?: (hostname: string, address: string) => Promise<void>;
  verifyTrust?: (hostname: string, address: string, port: number) => Promise<void>;
};
type RoomInput = Parameters<HostRoomProvider['open']>[0];
const safeNotify = (callback: () => void) => { try { callback(); } catch { /* notifications must not break cleanup */ } };
function privateV4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
async function readSelected(path: string): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 128 * 1024) throw new Error('Selected TLS file is not a supported size.');
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== buffer.length) { buffer.fill(0); throw new Error('Selected TLS file could not be read.'); }
    return buffer;
  } finally { await file.close(); }
}
async function verifyHost(hostname: string, address: string): Promise<void> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => record.address !== address)) throw new Error('The hostname must resolve only to the selected interface.');
}
/** Prove the presented certificate chains to Node's configured trust roots; browsers may use a different trust store. */
async function verifyTrust(hostname: string, address: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: address, port, ...(isIP(hostname) ? {} : { servername: hostname }), rejectUnauthorized: true,
      checkServerIdentity: (_host, certificate) => checkServerIdentity(hostname, certificate) });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Certificate trust check timed out.')); }, 5000);
    socket.once('secureConnect', () => { clearTimeout(timer); socket.destroy(); resolve(); });
    socket.once('error', () => { clearTimeout(timer); socket.destroy(); reject(new Error('The certificate is not trusted or does not match the hostname.')); });
  });
}

export function createLanHostProvider(options: LanProviderOptions): HostRoomProvider {
  const coordinator = options.coordinator ?? new RemoteAuthorityCoordinator(options.store, options.settings, options.installCommitted);
  if (!coordinator.usesStore(options.store)) throw new Error('Remote authority must use the host show store.');
  const handles = new WeakMap<object, { kind: PickKind; path: string }>();
  const ids = new Map<string, string>();
  let currentFailure: (() => void) | undefined;
  coordinator.onFailure(() => currentFailure?.());
  let reserved = false;
  const currentInterfaces = (): { id: string; label: string; address: string }[] => {
    const values: { id: string; label: string; address: string }[] = [];
    for (const [name, entries] of Object.entries((options.interfaces ?? networkInterfaces)())) for (const entry of entries ?? []) {
      if (entry.internal || !privateV4(entry.address)) continue;
      const key = `${name}\0${entry.address}`;
      if (!ids.has(key)) ids.set(key, randomUUID());
      const label = `${name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100)} (${entry.address})`;
      values.push({ id: ids.get(key)!, label, address: entry.address });
    }
    return values.slice(0, 100);
  };
  return {
    interfaces(): RemoteInterface[] { return currentInterfaces().map(({ id, label }) => ({ id, label })); },
    async select(kind) {
      if (kind !== 'certificate' && kind !== 'privateKey') throw new Error('Invalid TLS file type.');
      const path = await options.pickFile(kind);
      if (!path) return null;
      if (!isAbsolute(path)) throw new Error('The selected TLS file is unavailable.');
      const label = basename(path);
      if (!label || label.length > 255 || /[\\/\x00-\x1f]/.test(label)) throw new Error('Invalid selected file.');
      const handle = {}; handles.set(handle, { kind, path });
      return { label, handle };
    },
    async open(input: RoomInput): Promise<RemoteRoom> {
      if (reserved) throw new Error('A remote room is already open or needs recovery.');
      const item = currentInterfaces().find(value => value.id === input.interfaceId);
      const certItem = typeof input.certificate === 'object' && input.certificate ? handles.get(input.certificate) : undefined;
      const keyItem = typeof input.privateKey === 'object' && input.privateKey ? handles.get(input.privateKey) : undefined;
      if (!item || certItem?.kind !== 'certificate' || keyItem?.kind !== 'privateKey' ||
          !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || typeof input.hostname !== 'string' ||
          typeof input.onGuestsChanged !== 'function' || typeof input.onMissingRequest !== 'function' || typeof input.onFailure !== 'function' || !(input.signal instanceof AbortSignal)) throw new Error('Invalid room settings.');
      reserved = true;
      let certificate: Buffer | undefined, key: Buffer | undefined, transport: LanTransport | undefined;
      let queue: RemoteQueue | undefined, active = false, stopped = false, revoked = false, failure = false, opening = true;
      let stopPromise: Promise<void> | undefined;
      const release = () => { if (!opening && stopped && revoked) { input.signal.removeEventListener('abort', abort); reserved = false; currentFailure = undefined; } };
      const revoke = async () => { active = false; if (revoked) return; queue?.closeRoom(); revoked = true; release(); };
      const stop = async () => {
        active = false;
        if (stopped) return;
        if (!transport) { if (!opening) { stopped = true; release(); } return; }
        stopPromise ??= transport.close().then(() => { stopped = true; release(); }, error => { stopPromise = undefined; throw error; });
        await stopPromise;
      };
      const fail = () => {
        if (failure) return;
        failure = true; active = false;
        safeNotify(input.onFailure);
        void Promise.allSettled([revoke(), stop()]);
      };
      const abort = () => { active = false; void Promise.allSettled([revoke(), stop()]); };
      const checkAbort = () => { if (input.signal.aborted) throw new Error('Remote room opening was cancelled.'); };
      input.signal.addEventListener('abort', abort, { once: true });
      if (input.signal.aborted) abort();
      try {
        checkAbort();
        await (options.verifyHost ?? verifyHost)(input.hostname, item.address);
        checkAbort();
        certificate = await readSelected(certItem.path); checkAbort();
        key = await readSelected(keyItem.path); checkAbort();
        if (!currentInterfaces().some(value => value.id === item.id && value.address === item.address)) throw new Error('The selected interface is no longer available.');
        queue = coordinator.getAuthority();
        queue.closeRoom(); // close stale credentials from a previous host run before exposing a new room
        currentFailure = fail;
        const requireActive = () => { if (!active || failure) throw new Error('Remote room is closed.'); };
        const guarded: LanTransportOptions['authority'] = {
          admissionInfo: invitation => { requireActive(); return queue!.admissionInfo(invitation); },
          join: (invitation, joinId, resumeSecret, name, revision) => { requireActive(); const result = queue!.join(invitation, joinId, resumeSecret, name, revision); safeNotify(input.onGuestsChanged); return result; },
          resume: secret => { requireActive(); return queue!.resume(secret); },
          snapshot: token => { requireActive(); return queue!.snapshot(token); },
          catalog: (token, offset, limit, query) => { requireActive(); return queue!.catalog(token, offset, limit, query); },
          searchCatalog: async (token, offset, limit, query) => {
            requireActive();
            const result = await queue!.searchCatalog(token, offset, limit, query);
            requireActive();
            return result;
          },
          outcome: (token, id) => { requireActive(); return queue!.outcome(token, id); },
          submit: (token, command) => { requireActive(); return queue!.submit(token, command); },
          setAvailability: (token, command) => { requireActive(); return queue!.setAvailability(token, command); },
          applaud: (token, command) => { requireActive(); return queue!.applaud(token, command); },
          withdraw: (token, command) => { requireActive(); return queue!.withdraw(token, command); },
          submitMissing: (token, command) => { requireActive(); const outcome = queue!.submitMissing(token, command); if (outcome.ok) safeNotify(input.onMissingRequest); return outcome; },
        };
        transport = await (options.startTransport ?? startLanTransport)({ address: item.address, hostname: input.hostname, port: input.port,
          cert: certificate, key, authority: guarded, staticHandler: options.staticHandler, onError: fail });
        checkAbort();
        if (failure) throw new Error('Remote listener failed.');
        await (options.verifyTrust ?? verifyTrust)(input.hostname, item.address, input.port);
        checkAbort();
        if (failure) throw new Error('Remote listener failed.');
        await (options.verifyHost ?? verifyHost)(input.hostname, item.address);
        checkAbort();
        if (failure || !currentInterfaces().some(value => value.id === item.id && value.address === item.address)) throw new Error('The selected interface is no longer available.');
        opening = false;
        active = true;
        handles.delete(input.certificate as object); handles.delete(input.privateKey as object);
        const room: RemoteRoom = {
          origin: transport.origin,
          guests: () => active ? queue!.listGuests() : [],
          createInvitation: ttl => { requireActive(); return queue!.createInvitation(ttl); },
          revokeInvitations: () => { requireActive(); queue!.revokeInvitations(); },
          revokeGuest: id => { requireActive(); queue!.revokeGuest(id); safeNotify(input.onGuestsChanged); },
          revokeAll: revoke, stop,
        };
        return room;
      } catch (error) {
        opening = false;
        const cleaned = await Promise.allSettled([revoke(), stop()]);
        if (cleaned.some(result => result.status === 'rejected')) {
          const unavailable = () => { throw new Error('Remote room is unavailable.'); };
          // The lifecycle retains this inert handle and can retry both cleanup steps.
          throw new RemoteRoomOpenError({ origin: transport?.origin ?? '', guests: () => [], createInvitation: unavailable,
            revokeInvitations: unavailable, revokeGuest: unavailable, revokeAll: revoke, stop });
        }
        release();
        throw new Error('Remote room could not open. Check the TLS files, trust, hostname and selected interface.');
      } finally { certificate?.fill(0); key?.fill(0); }
    }
  };
}
