import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, lstat, open, mkdtemp, link, unlink, rmdir } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { parseKaraFunKit, type KaraFunKit } from '../domain/karafun-kit';
import type { KaraFunSource } from '../domain/streaming-source';

/** Private provider URLs never enter show state, a renderer, or a sidecar. */
export type KaraFunMediaDescriptor = { url: string; expectedBytes: number | null; md5: string | null };
export type KaraFunPreparedMedia = { path: string; fingerprint: string; accountScope: string; source: KaraFunSource; kit: KaraFunKit; md5: string; bytes: number };
export type KaraFunMediaProgress = { phase: 'authorizing' | 'downloading' | 'checking' | 'ready'; received: number; total: number | null };
export class KaraFunMediaError extends Error {
  constructor(readonly code: 'cancelled' | 'unavailable' | 'invalid-media' | 'cache-unavailable' | 'cache-miss' | 'cleanup-required', message: string) {
    super(message); this.name = 'KaraFunMediaError';
  }
}
const invalid = () => new KaraFunMediaError('invalid-media', 'The KaraFun song was incomplete or could not be verified. Retry preparation.');
const allowedCdn = (host: string) => ['karafun.com', 'recis.io', 'amazonaws.com'].some(domain => host === domain || host.endsWith('.' + domain));
const maximumBytes = 128 * 1024 * 1024;

function privateUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (value.length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !allowedCdn(url.hostname)) throw invalid();
    return url;
  } catch { throw invalid(); }
}
function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason?.name === 'TimeoutError'
    ? new KaraFunMediaError('unavailable', 'KaraFun preparation timed out. Check the connection and retry.')
    : new KaraFunMediaError('cancelled', 'KaraFun preparation was cancelled.');
}

/** Account-scoped acquisition, exact-byte verification and exclusive publication.
 * Nothing in this cache authorizes playback; the caller obtains a fresh private
 * descriptor through the current account authority before each preparation. */
export class KaraFunMediaCache {
  private pending = new Map<string, Promise<KaraFunPreparedMedia>>();
  constructor(private readonly directory: string, private readonly dependencies: {
    fetch?: typeof fetch; parse?: (data: Uint8Array) => KaraFunKit; timeoutMs?: number;
  } = {}) {}

  prepare(source: KaraFunSource, accountScope: string,
    authorize: (signal: AbortSignal) => Promise<KaraFunMediaDescriptor>, options: {
      signal: AbortSignal; previousPath?: string; existingOnly?: boolean; progress?: (value: KaraFunMediaProgress) => void;
    }): Promise<KaraFunPreparedMedia> {
    if (!/^[a-f0-9]{64}$/.test(accountScope) || !/^[1-9]\d{0,11}$/.test(source.songId) || !['catalog', 'community'].includes(source.catalog))
      return Promise.reject(invalid());
    const key = `${accountScope}:${source.catalog}:${source.songId}:${!!options.existingOnly}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.acquire(source, accountScope, authorize, options).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
    this.pending.set(key, task); return task;
  }

  private async acquire(source: KaraFunSource, scope: string, authorize: (signal: AbortSignal) => Promise<KaraFunMediaDescriptor>,
    options: { signal: AbortSignal; previousPath?: string; existingOnly?: boolean; progress?: (value: KaraFunMediaProgress) => void }): Promise<KaraFunPreparedMedia> {
    const timeout = AbortSignal.timeout(this.dependencies.timeoutMs ?? 300_000);
    const signal = AbortSignal.any([options.signal, timeout]);
    const report = (phase: KaraFunMediaProgress['phase'], received = 0, total: number | null = null) => { try { options.progress?.({ phase, received, total }); } catch {} };
    aborted(signal); report('authorizing');
    const descriptor = await authorize(signal); aborted(signal);
    let url = privateUrl(descriptor.url);
    if (descriptor.expectedBytes !== null && (!Number.isSafeInteger(descriptor.expectedBytes) || descriptor.expectedBytes <= 0 || descriptor.expectedBytes > maximumBytes) ||
        descriptor.md5 !== null && !/^[a-f0-9]{32}$/i.test(descriptor.md5)) throw invalid();
    if (!isAbsolute(this.directory)) throw new KaraFunMediaError('cache-unavailable', 'The KaraFun cache directory is unavailable.');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(this.directory)).isDirectory() || (await lstat(this.directory)).isSymbolicLink()) throw invalid();
    const root = await realpath(this.directory), requested = join(root, scope);
    await mkdir(requested, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const info = await lstat(requested), folder = await realpath(requested);
    if (!info.isDirectory() || info.isSymbolicLink() || dirname(folder) !== root) throw invalid();
    const tag = descriptor.md5?.toLowerCase() ?? 'current';
    const canonical = join(folder, `${source.catalog}-${source.songId}-${tag}.kit`);
    const inspect = async (path: string): Promise<KaraFunPreparedMedia | null> => {
      if (dirname(path) !== folder) return null;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const before = await lstat(path);
        if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maximumBytes ||
            descriptor.expectedBytes !== null && before.size !== descriptor.expectedBytes) return null;
        file = await open(path, 'r'); const identity = await file.stat();
        if (!identity.isFile() || before.dev !== identity.dev || before.ino !== identity.ino || before.size !== identity.size) return null;
        const data = await file.readFile(); aborted(signal);
        const after = await file.stat();
        if (data.length !== identity.size || after.size !== identity.size || after.mtimeMs !== identity.mtimeMs || after.ctimeMs !== identity.ctimeMs) return null;
        const md5 = createHash('md5').update(data).digest('hex');
        if (descriptor.md5 && md5 !== descriptor.md5.toLowerCase()) return null;
        const fingerprint = createHash('sha256').update(data).digest('hex');
        const kit = (this.dependencies.parse ?? parseKaraFunKit)(data);
        return { path, fingerprint, kit, accountScope: scope, source: { ...source }, md5, bytes: data.length };
      } catch (error) { aborted(signal); if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return null; }
      finally { await file?.close().catch(() => {}); }
    };
    for (const path of new Set([...(options.previousPath ? [options.previousPath] : []), canonical])) {
      const retained = await inspect(path); if (retained) { report('ready', retained.bytes, retained.bytes); return retained; }
    }
    if (options.existingOnly) throw new KaraFunMediaError('cache-miss', 'The KaraFun recording needs preparation before playback.');
    aborted(signal);
    const stage = await mkdtemp(join(folder, '.prepare-')), stageIdentity = await lstat(stage), temporary = join(stage, 'song.kit');
    let output: Awaited<ReturnType<typeof open>> | undefined, published: KaraFunPreparedMedia | null = null;
    try {
      output = await open(temporary, 'wx+', 0o600);
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 2; redirects++) {
        response = await (this.dependencies.fetch ?? fetch)(url, { redirect: 'manual', signal, credentials: 'omit',
          headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location'); await response.body?.cancel();
          if (!location || redirects === 2) throw invalid();
          url = privateUrl(new URL(location, url).href); continue;
        }
        break;
      }
      if (!response?.ok || !response.body || ![200].includes(response.status)) { await response?.body?.cancel(); throw new KaraFunMediaError('unavailable', 'KaraFun did not provide the song. Check the account and retry preparation.'); }
      const encoding = response.headers.get('content-encoding'); if (encoding && encoding !== 'identity') { await response.body.cancel(); throw invalid(); }
      const length = response.headers.get('content-length');
      const stated = length === null ? null : /^\d+$/.test(length) ? Number(length) : NaN;
      if (stated !== null && (!Number.isSafeInteger(stated) || stated <= 0 || stated > maximumBytes ||
          descriptor.expectedBytes !== null && stated !== descriptor.expectedBytes)) { await response.body.cancel(); throw invalid(); }
      const md5 = createHash('md5'), sha256 = createHash('sha256'); let received = 0;
      report('downloading', 0, descriptor.expectedBytes ?? stated);
      const reader = response.body.getReader();
      const cancelReader = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancelReader, { once: true });
      try {
        while (true) {
          aborted(signal); const chunk = await reader.read(); if (chunk.done) break;
          received += chunk.value.length;
          if (received > maximumBytes || descriptor.expectedBytes !== null && received > descriptor.expectedBytes || stated !== null && received > stated) throw invalid();
          md5.update(chunk.value); sha256.update(chunk.value);
          let offset = 0; while (offset < chunk.value.length) { const written = await output.write(chunk.value, offset); if (!written.bytesWritten) throw invalid(); offset += written.bytesWritten; }
          report('downloading', received, descriptor.expectedBytes ?? stated);
        }
      } finally { signal.removeEventListener('abort', cancelReader); await reader.cancel().catch(() => {}); }
      aborted(signal); report('checking', received, descriptor.expectedBytes ?? stated);
      const digest = md5.digest('hex');
      if (!received || descriptor.expectedBytes !== null && received !== descriptor.expectedBytes || stated !== null && received !== stated ||
          descriptor.md5 && digest !== descriptor.md5.toLowerCase()) throw invalid();
      await output.sync();
      const identity = await output.stat(), data = Buffer.alloc(received);
      let readAt = 0;
      while (readAt < received) {
        const chunk = await output.read(data, readAt, received - readAt, readAt);
        if (!chunk.bytesRead) throw invalid(); readAt += chunk.bytesRead;
      }
      const afterRead = await output.stat(), leaf = await lstat(temporary), directory = await lstat(stage);
      if (identity.size !== received || afterRead.size !== received || afterRead.mtimeMs !== identity.mtimeMs || afterRead.ctimeMs !== identity.ctimeMs ||
          !leaf.isFile() || leaf.isSymbolicLink() || leaf.dev !== identity.dev || leaf.ino !== identity.ino ||
          !directory.isDirectory() || directory.isSymbolicLink() || directory.dev !== stageIdentity.dev || directory.ino !== stageIdentity.ino ||
          createHash('md5').update(data).digest('hex') !== digest) throw invalid();
      const fingerprint = sha256.digest('hex');
      if (createHash('sha256').update(data).digest('hex') !== fingerprint) throw invalid();
      const kit = (this.dependencies.parse ?? parseKaraFunKit)(data);
      await output.close(); output = undefined;
      aborted(signal);
      let destination = canonical;
      try { await link(temporary, destination); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const retained = await inspect(canonical);
        if (retained) { published = retained; report('ready', retained.bytes, retained.bytes); return retained; }
        destination = join(folder, `${source.catalog}-${source.songId}-${tag}-${randomUUID()}.kit`);
        await link(temporary, destination);
      }
      const committed = await lstat(destination);
      if (!committed.isFile() || committed.isSymbolicLink() || committed.dev !== identity.dev || committed.ino !== identity.ino) throw invalid();
      published = { path: destination, fingerprint, kit, accountScope: scope, source: { ...source }, md5: digest, bytes: received };
      report('ready', received, received); return published;
    } catch (error) {
      if (error instanceof KaraFunMediaError) throw error;
      aborted(signal);
      throw new KaraFunMediaError('invalid-media', 'The KaraFun song could not be prepared. Check the connection and retry.');
    } finally {
      await output?.close().catch(() => {});
      const after = await lstat(stage).catch(() => null);
      if (!after || !after.isDirectory() || after.isSymbolicLink() || after.dev !== stageIdentity.dev || after.ino !== stageIdentity.ino || await realpath(stage) !== stage)
        throw new KaraFunMediaError('cleanup-required', 'KaraFun temporary files changed; preparation needs review before retrying.');
      try { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); await rmdir(stage); }
      catch { throw new KaraFunMediaError('cleanup-required', published ? 'The KaraFun song was saved, but its temporary files need review.' : 'KaraFun temporary files need review before retrying.'); }
    }
  }
}
