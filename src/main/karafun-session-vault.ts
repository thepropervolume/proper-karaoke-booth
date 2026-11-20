import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { mkdir, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

export type KaraFunRememberedSession = { sessionKey: string; clientId?: string; accountScope: string };
export type KaraFunSessionStore = {
  load(signal?: AbortSignal): Promise<KaraFunRememberedSession | null>;
  save(value: KaraFunRememberedSession, signal?: AbortSignal): Promise<boolean>;
  clear(expectedScope?: string): Promise<void>;
};
export type KaraFunVaultCipher = {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt?: boolean; isTemporarilyUnavailable?: boolean }>;
};
export class KaraFunSessionVaultError extends Error {
  constructor(readonly code: 'unavailable' | 'invalid-data' | 'changed' | 'cancelled') {
    super(code === 'cancelled' ? 'Remembered KaraFun sign-in was cancelled.' : code === 'unavailable'
      ? 'Secure KaraFun sign-in storage is unavailable on this device.' : 'The saved KaraFun sign-in could not be opened. Sign in again.');
    this.name = 'KaraFunSessionVaultError';
  }
}
const magic = Buffer.from('TPVKF01\0', 'ascii'), maximum = 64 * 1024;
const invalid = () => new KaraFunSessionVaultError('invalid-data');
export const secureKaraFunVaultBackend = (platform: string, backend?: string): boolean => platform !== 'linux' ||
  ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend ?? 'unknown');
const same = (a: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }, b: typeof a) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw new KaraFunSessionVaultError('cancelled'); }
function parse(value: unknown): KaraFunRememberedSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['version', 'sessionKey', 'clientId', 'accountScope'].includes(key)) ||
      record.version !== 1 || typeof record.sessionKey !== 'string' || !/^[A-Za-z0-9._~-]{1,4096}$/.test(record.sessionKey) ||
      typeof record.accountScope !== 'string' || !/^[a-f0-9]{64}$/.test(record.accountScope) ||
      record.clientId !== undefined && (typeof record.clientId !== 'string' || !/^\d{1,5}$/.test(record.clientId))) throw invalid();
  return { sessionKey: record.sessionKey, accountScope: record.accountScope, ...(record.clientId === undefined ? {} : { clientId: record.clientId }) };
}

async function systemCipher(): Promise<KaraFunVaultCipher> {
  const { safeStorage } = await import('electron');
  return {
    available: async () => {
      if (!await safeStorage.isAsyncEncryptionAvailable()) return false;
      // Electron's Linux fallback may encrypt with a hardcoded password. Never
      // remember a session unless a real desktop secret backend is selected.
      if (!secureKaraFunVaultBackend(process.platform, process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined)) return false;
      return true;
    },
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: value => safeStorage.decryptStringAsync(value),
  };
}

/** Only accepted session material is stored, using OS-provided encryption.
 * Passwords, browser cookies, account labels and provider media URLs are absent. */
export class KaraFunSessionVault implements KaraFunSessionStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly dependencies: { cipher?: () => Promise<KaraFunVaultCipher> } = {}) {}
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation, operation); this.tail = task.catch(() => {}); return task;
  }
  private async cipher(): Promise<KaraFunVaultCipher> {
    try { const cipher = await (this.dependencies.cipher ?? systemCipher)(); if (!await cipher.available()) throw new KaraFunSessionVaultError('unavailable'); return cipher; }
    catch { throw new KaraFunSessionVaultError('unavailable'); }
  }
  private async read(): Promise<{ bytes: Buffer; identity: Stats } | null> {
    if (!isAbsolute(this.file)) throw invalid();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const before = await lstat(this.file);
      if (!before.isFile() || before.isSymbolicLink() || before.size <= magic.length || before.size > maximum) throw invalid();
      handle = await open(this.file, 'r'); const opened = await handle.stat(); if (!same(before, opened)) throw invalid();
      const bounded = Buffer.alloc(maximum + 1); let size = 0;
      while (size < bounded.length) { const part = await handle.read(bounded, size, bounded.length - size, size); if (!part.bytesRead) break; size += part.bytesRead; }
      const bytes = bounded.subarray(0, size), after = await handle.stat(), leaf = await lstat(this.file);
      if (!same(opened, after) || !same(after, leaf) || bytes.length !== opened.size || !bytes.subarray(0, magic.length).equals(magic)) throw invalid();
      return { bytes, identity: leaf };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error instanceof KaraFunSessionVaultError ? error : invalid();
    } finally { await handle?.close().catch(() => {}); }
  }
  private async decoded(bytes: Buffer, cipher: KaraFunVaultCipher): Promise<KaraFunRememberedSession> {
    try {
      const plain = await cipher.decrypt(bytes.subarray(magic.length));
      if (plain.isTemporarilyUnavailable) throw new KaraFunSessionVaultError('unavailable');
      if (typeof plain.result !== 'string' || Buffer.byteLength(plain.result) > 8192) throw invalid();
      return parse(JSON.parse(plain.result));
    } catch (error) { throw error instanceof KaraFunSessionVaultError ? error : invalid(); }
  }
  load(signal?: AbortSignal): Promise<KaraFunRememberedSession | null> {
    return this.enqueue(async () => {
      checkSignal(signal); const saved = await this.read(); if (!saved) return null;
      const cipher = await this.cipher(), record = await this.decoded(saved.bytes, cipher); checkSignal(signal);
      return record;
    });
  }
  save(value: KaraFunRememberedSession, signal?: AbortSignal): Promise<boolean> {
    return this.enqueue(async () => {
      checkSignal(signal); const record = parse({ ...value, version: 1 });
      let cipher: KaraFunVaultCipher;
      try { cipher = await this.cipher(); } catch { return false; }
      const encrypted = await cipher.encrypt(JSON.stringify({ version: 1, ...record })).catch(() => { throw new KaraFunSessionVaultError('unavailable'); });
      checkSignal(signal);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length + magic.length > maximum || !isAbsolute(this.file)) throw invalid();
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const parent = await realpath(dirname(this.file)), parentIdentity = await lstat(parent), target = join(parent, basename(this.file));
      if (!parentIdentity.isDirectory() || parentIdentity.isSymbolicLink()) throw invalid();
      const previous = await this.read();
      const temporary = join(parent, `.${basename(this.file)}.${randomUUID()}.tmp`);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let temporaryIdentity: Stats | undefined, published = false;
      try {
        handle = await open(temporary, 'wx', 0o600); temporaryIdentity = await handle.stat();
        await handle.writeFile(Buffer.concat([magic, encrypted])); await handle.sync();
        const identity = await handle.stat(); await handle.close(); handle = undefined;
        const currentParent = await lstat(parent), current = await this.read(); checkSignal(signal);
        if (parentIdentity.dev !== currentParent.dev || parentIdentity.ino !== currentParent.ino || await realpath(dirname(this.file)) !== parent ||
            !!previous !== !!current || previous && current && !same(previous.identity, current.identity) ||
            !same(identity, await lstat(temporary))) throw new KaraFunSessionVaultError('changed');
        await rename(temporary, target); published = true; return true;
      } catch (error) { throw error instanceof KaraFunSessionVaultError ? error : new KaraFunSessionVaultError('unavailable'); }
      finally {
        await handle?.close().catch(() => {});
        if (temporaryIdentity && !published) {
          const leaf = await lstat(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new KaraFunSessionVaultError('changed'); });
          if (leaf) {
            if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.dev !== temporaryIdentity.dev || leaf.ino !== temporaryIdentity.ino) throw new KaraFunSessionVaultError('changed');
            await unlink(temporary);
          }
        }
      }
    });
  }
  clear(expectedScope?: string): Promise<void> {
    return this.enqueue(async () => {
      const saved = await this.read(); if (!saved) return;
      if (expectedScope !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(expectedScope)) throw invalid();
        const record = await this.decoded(saved.bytes, await this.cipher()); if (record.accountScope !== expectedScope) return;
      }
      const current = await lstat(this.file); if (!same(saved.identity, current) || current.isSymbolicLink()) throw new KaraFunSessionVaultError('changed');
      await unlink(this.file);
    });
  }
}
