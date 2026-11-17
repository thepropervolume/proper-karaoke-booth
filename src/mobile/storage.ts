import { newMobileShow, restoreMobileShow, type MobileShowState } from './show';
/** IndexedDB holds show metadata and user-selected files only, never authentication. */
async function database(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open('tpv-mobile', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('show'); request.result.createObjectStore('media'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Mobile storage is unavailable.'));
  });
}
async function operation<T>(store: 'show' | 'media', mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try { return await new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode), request = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(new Error('Could not save mobile data. Check available device storage.'));
  }); } finally { db.close(); }
}
export async function loadMobileShow(): Promise<MobileShowState> { const value = await operation('show', 'readonly', store => store.get('active')); return value === undefined ? newMobileShow() : restoreMobileShow(value); }
export const saveMobileShow = (state: MobileShowState) => operation('show', 'readwrite', store => store.put(state, 'active'));
export const saveLocalMedia = (id: string, file: Blob) => operation('media', 'readwrite', store => store.put(file, id));
export const loadLocalMedia = (id: string) => operation<Blob | undefined>('media', 'readonly', store => store.get(id));
export const deleteLocalMedia = (id: string) => operation('media', 'readwrite', store => store.delete(id));
/** Replacing a blob keeps every request, favorite and history reference on its existing song ID. */
export const relinkLocalMedia = saveLocalMedia;

const RECOVERY_KEY = /^recovery:([0-9]{13,16}):[a-f0-9-]{36}$/;
export type MobileRecoveryRecord = { key: string; createdAt: number; value: unknown };

/**
 * Copy the raw value without parsing an unknown future/corrupt show format.
 * The backup and its read belong to one transaction; only a committed backup
 * permits the caller to continue with a fresh saved show. Active stays intact.
 */
export async function preserveMobileRecovery(): Promise<string> {
  const db = await database();
  try {
    const createdAt = Date.now(), key = `recovery:${String(createdAt).padStart(13, '0')}:${crypto.randomUUID()}`;
    return await new Promise<string>((resolve, reject) => {
      const tx = db.transaction('show', 'readwrite'), store = tx.objectStore('show');
      let missing = false;
      tx.oncomplete = () => resolve(key);
      tx.onabort = tx.onerror = () => reject(new Error(missing ? 'No saved mobile show is available to preserve.' : 'The saved show could not be preserved. It has not been replaced.'));
      const active = store.get('active');
      active.onsuccess = () => {
        if (active.result === undefined) { missing = true; tx.abort(); return; }
        try { store.add({ createdAt, value: active.result }, key); }
        catch { tx.abort(); }
      };
    });
  } finally { db.close(); }
}

/** List metadata only; opening this list never loads or rewrites a saved show. */
export async function listMobileRecoveries(): Promise<{ key: string; createdAt: number }[]> {
  const keys = await operation<IDBValidKey[]>('show', 'readonly', store => store.getAllKeys());
  return keys.filter((key): key is string => typeof key === 'string' && RECOVERY_KEY.test(key)).sort().reverse().slice(0, 100)
    .map(key => ({ key, createdAt: Number(RECOVERY_KEY.exec(key)![1]) }));
}
export async function readMobileRecovery(key: string): Promise<MobileRecoveryRecord | null> {
  if (!RECOVERY_KEY.test(key)) throw new Error('Invalid mobile recovery reference.');
  const record = await operation<{ createdAt: number; value: unknown } | undefined>('show', 'readonly', store => store.get(key));
  if (!record) return null;
  return { key, createdAt: record.createdAt, value: record.value };
}

export class MobileHostLockUnsupported extends Error {
  constructor() { super('This browser does not support exclusive host protection.'); this.name = 'MobileHostLockUnsupported'; }
}

/**
 * A single origin-wide host writer prevents separate tabs from replacing one
 * another's complete IndexedDB snapshot. Keep the callback alive until release;
 * merely awaiting request() would release the lock before hosting began.
 */
export async function acquireMobileHostLock(manager?: Pick<LockManager, 'request'> | null): Promise<(() => void) | null> {
  const locks = manager === undefined ? typeof navigator === 'undefined' ? undefined : navigator.locks : manager;
  if (!locks?.request) throw new MobileHostLockUnsupported();
  return await new Promise<(() => void) | null>((resolve, reject) => {
    try {
      void locks.request('tpv-mobile-host-writer', { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { resolve(null); return; }
        await new Promise<void>(release => {
          let released = false;
          resolve(() => { if (!released) { released = true; release(); } });
        });
      }).catch(() => reject(new Error('Exclusive host protection could not be started. Your saved show has not been changed.')));
    } catch { reject(new Error('Exclusive host protection could not be started. Your saved show has not been changed.')); }
  });
}
