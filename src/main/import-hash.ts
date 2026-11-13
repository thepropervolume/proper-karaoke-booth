import { Worker } from 'node:worker_threads';

export class ImportCancelled extends Error { constructor() { super('Import cancelled.'); this.name = 'ImportCancelled'; } }
export type ImportFileFailure = 'missing' | 'permission' | 'unavailable' | 'empty' | 'not-file' | 'changed' | 'unknown';
export class ImportFileError extends Error {
  constructor(readonly reason: ImportFileFailure) { super(`Import failed: ${reason === 'changed' ? 'source changed during import' : reason}`); this.name = 'ImportFileError'; }
}

// This fixed, app-owned worker program never incorporates paths or metadata as
// code. The selected path is sent separately through workerData.
const workerProgram = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { lstat, open } = require('node:fs/promises');
const same = (a,b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
(async () => {
  let file;
  try {
    const path = workerData.path;
    const startPath = await lstat(path);
    if (!startPath.isFile() || startPath.isSymbolicLink()) throw Object.assign(new Error('Not a regular file'), { reason: 'not-file' });
    if (!Number.isSafeInteger(startPath.size) || startPath.size < 1) throw Object.assign(new Error('Empty file'), { reason: 'empty' });
    file = await open(path, 'r');
    const before = await file.stat();
    if (!before.isFile() || !same(startPath,before)) throw Object.assign(new Error('Source changed'), { reason: 'changed' });
    const hash = createHash('sha256');
    let read = 0, lastBytes = 0, lastTime = 0;
    parentPort.postMessage({type:'progress', read:0, total:before.size});
    const stream = file.createReadStream({autoClose:false, highWaterMark:1024 * 1024});
    for await (const chunk of stream) {
      hash.update(chunk); read += chunk.length;
      const now = Date.now();
      if (read - lastBytes >= 8 * 1024 * 1024 || now - lastTime >= 150) {
        parentPort.postMessage({type:'progress', read, total:before.size}); lastBytes = read; lastTime = now;
      }
    }
    const after = await file.stat(), endPath = await lstat(path);
    if (read !== before.size || !same(before,after) || !endPath.isFile() || endPath.isSymbolicLink() || !same(before,endPath)) throw Object.assign(new Error('Source changed'), { reason: 'changed' });
    parentPort.postMessage({type:'done', hash:hash.digest('hex'), read, total:before.size});
  } catch (error) {
    const code = error && error.code;
    const reason = error && error.reason || (code === 'ENOENT' ? 'missing' : ['EACCES','EPERM'].includes(code) ? 'permission' : ['EIO','EBUSY','ENODEV','ETIMEDOUT','ENETUNREACH'].includes(code) ? 'unavailable' : 'unknown');
    parentPort.postMessage({type:'error', reason});
  }
  finally { if (file) await file.close().catch(() => {}); }
})().catch(() => {});
`;

/** Compute the complete file fingerprint away from the host authority thread. */
export function hashImportFile(path: string, signal: AbortSignal, progress: (bytesRead: number, bytesTotal: number) => void = () => {}): Promise<string> {
  if (signal.aborted) return Promise.reject(new ImportCancelled());
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerProgram, { eval: true, workerData: { path } });
    let settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      // Await termination so cancellation has released the file and worker.
      void worker.terminate().then(() => error ? reject(error) : resolve(value!), reason => reject(reason instanceof Error ? reason : new Error('Hash worker failed.')));
    };
    const abort = () => finish(new ImportCancelled());
    worker.on('message', (message: unknown) => {
      if (settled || !message || typeof message !== 'object') return;
      const data = message as Record<string, unknown>;
      if (data.type === 'progress' && typeof data.read === 'number' && typeof data.total === 'number') {
        try { progress(data.read, data.total); } catch { /* Progress cannot affect the import. */ }
      } else if (data.type === 'done' && typeof data.hash === 'string' && /^[a-f0-9]{64}$/.test(data.hash)) finish(undefined, data.hash);
      else if (data.type === 'error') {
        const reasons: ImportFileFailure[] = ['missing', 'permission', 'unavailable', 'empty', 'not-file', 'changed', 'unknown'];
        finish(new ImportFileError(reasons.includes(data.reason as ImportFileFailure) ? data.reason as ImportFileFailure : 'unknown'));
      }
    });
    worker.once('error', () => finish(new Error('The file could not be read.')));
    worker.once('exit', () => { if (!settled) finish(new Error('The hash worker stopped unexpectedly.')); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
