/** Private desktop service configuration and host-only catalog projection. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { SharedCatalogClient } from './shared-catalog-client';
import type { LocalCatalogResult } from './karaokenerds-local-browser';
import { libraryDate } from '../domain/library-result-fields';

export const PUBLIC_CATALOG_ORIGIN = 'https://apps.thepropervolume.com';

export type CatalogConnectionStatus = { status: string; source?: 'remote' | 'cache'; connectionMode?: 'public' | 'private'; lastSuccess?: number | null; lastAttempt?: number | null;
  fetchedAt?: number; stale?: boolean; recordCount?: number; searchableCount?: number; revision?: string | null; cachePersisted?: boolean };
type PrivateConfig = { baseUrl: string; token: string };
type ActiveConnection = { client: SharedCatalogClient; epoch: number; cursorScope: string };
class SupersededConnection extends Error {}
const privateFile = (info: {mode:number;uid:number;isFile():boolean}) => info.isFile() && (process.platform === 'win32' ||
  ((info.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || info.uid === process.getuid())));
export async function readSharedCatalogConfig(path: string): Promise<PrivateConfig> {
  try {
    if (!isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw new Error();
    const before = await lstat(path);
    if (!privateFile(before) || before.isSymbolicLink() || before.size < 1 || before.size > 8192) throw new Error();
    const file = await open(path, 'r'); let raw: Buffer;
    try {
      const start = await file.stat();
      if (!privateFile(start) || start.dev !== before.dev || start.ino !== before.ino || start.size !== before.size || start.mtimeMs !== before.mtimeMs) throw new Error();
      const bytes = Buffer.alloc(8193); let count = 0;
      while (count < bytes.length) { const result = await file.read(bytes, count, bytes.length - count, null); if (!result.bytesRead) break; count += result.bytesRead; }
      const end = await file.stat(), named = await lstat(path);
      if (!privateFile(end) || !privateFile(named) || count !== start.size || count > 8192 || end.size !== start.size || end.mtimeMs !== start.mtimeMs || end.ctimeMs !== start.ctimeMs ||
          named.isSymbolicLink() || named.dev !== start.dev || named.ino !== start.ino || named.size !== start.size || named.mtimeMs !== start.mtimeMs) throw new Error();
      raw = bytes.subarray(0, count);
    } finally { await file.close(); }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const config = value as Record<string, unknown>;
    if (Object.keys(config).sort().join(',') !== 'baseUrl,token' || typeof config.baseUrl !== 'string' || typeof config.token !== 'string' ||
        !/^[A-Za-z0-9._~-]{32,256}$/.test(config.token)) throw new Error();
    const url = new URL(config.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port) throw new Error();
    return {baseUrl:url.origin,token:config.token};
  } catch { throw new Error('Shared catalog configuration is unavailable or invalid. Choose the private client configuration supplied for this host.'); }
}

export class SharedCatalogConnection {
  private fingerprint = '';
  private client: SharedCatalogClient | null = null;
  private cursorScope = randomUUID();
  private activePath: string | null = null;
  private activeEpoch = 0;
  private readSequence = 0;
  private installedRead = 0;
  constructor(private readonly cacheFile: string,
    private readonly create: (config: PrivateConfig, cacheFile: string) => SharedCatalogClient = (config, cacheFile) => new SharedCatalogClient({...config,cacheFile}),
    private readonly readConfig: (path: string) => Promise<PrivateConfig> = readSharedCatalogConfig,
    private readonly createPublic: (cacheFile: string) => SharedCatalogClient = cacheFile => new SharedCatalogClient({baseUrl:PUBLIC_CATALOG_ORIGIN,public:true,cacheFile})) {}
  private connectPublic(): ActiveConnection {
    if (this.activePath !== '@public') { this.activePath = '@public'; ++this.activeEpoch; }
    if (!this.client || this.fingerprint !== '@public') {
      this.client = this.createPublic(this.cacheFile + '.public'); this.fingerprint = '@public';
      this.cursorScope = randomUUID();
    }
    this.installedRead = ++this.readSequence;
    return {client:this.client,epoch:this.activeEpoch,cursorScope:this.cursorScope};
  }
  private async connect(path: string): Promise<ActiveConnection> {
    if (path !== this.activePath) { this.activePath = path; ++this.activeEpoch; }
    const epoch = this.activeEpoch, sequence = ++this.readSequence;
    let config: PrivateConfig;
    try { config = await this.readConfig(path); }
    catch (error) { if (epoch !== this.activeEpoch) throw new SupersededConnection(); throw error; }
    if (epoch !== this.activeEpoch) throw new SupersededConnection();
    const fingerprint = createHash('sha256').update(JSON.stringify([config.baseUrl,config.token])).digest('hex');
    // Parallel reads of one configuration may share the authority. An older
    // credential read cannot replace a newer installed scope at the same path.
    if (sequence < this.installedRead && fingerprint !== this.fingerprint) throw new SupersededConnection();
    if (!this.client || fingerprint !== this.fingerprint) {
      this.client = this.create(config,this.cacheFile); this.fingerprint = fingerprint;
      this.cursorScope = randomUUID();
    }
    this.installedRead = Math.max(sequence,this.installedRead);
    return {client:this.client,epoch,cursorScope:this.cursorScope};
  }
  private current(connection: ActiveConnection): boolean {
    return connection.epoch === this.activeEpoch && connection.client === this.client;
  }
  /** Installers use this explicit token-free authority when no private config exists. */
  async publicStatus(active = true): Promise<CatalogConnectionStatus> {
    try {
      const connection = active ? this.connectPublic() : null;
      const result = await (connection?.client ?? this.createPublic(this.cacheFile + '.public.status')).status();
      if (connection && !this.current(connection)) return {status:'unavailable'};
      if (result.status !== 'ready') return {status:result.status,connectionMode:'public'};
      return {status:'ready',connectionMode:'public',source:result.source,lastSuccess:result.lastSuccess,lastAttempt:result.lastAttempt,
        fetchedAt:result.fetchedAt,stale:result.stale,recordCount:result.recordCount,searchableCount:result.searchableCount,revision:result.revision,cachePersisted:result.cachePersisted};
    } catch { return {status:'unavailable',connectionMode:'public'}; }
  }
  async publicSearch(query: unknown, cursor?: unknown, signal?: AbortSignal): Promise<LocalCatalogResult> {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/.test(query)) throw new Error('Enter at least two characters, up to 200.');
    if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') return {status:'invalid-request',tracks:[],limited:false,lastSuccess:null};
    try {
      return await this.searchPage(this.connectPublic(), query.trim(), cursor, signal);
    } catch { return {status:'unavailable',tracks:[],limited:false,lastSuccess:null}; }
  }
  private async searchPage(connection: ActiveConnection, query: string, cursor: string | null | undefined, signal?: AbortSignal): Promise<LocalCatalogResult> {
    // The provider cursor is scoped to a query and catalog revision. Add a
    // local scope as well so a new connection can't append to old results.
    const prefix = connection.cursorScope + '_';
    if (cursor != null && !cursor.startsWith(prefix)) return {status:'invalid-request',tracks:[],limited:false,lastSuccess:null};
    const result = await connection.client.search({query,cursor:cursor?.slice(prefix.length),limit:50},signal);
    if (!this.current(connection)) return {status:'unavailable',tracks:[],limited:false,lastSuccess:null};
    if (result.status !== 'ready') return {status:result.status,tracks:[],limited:false,lastSuccess:null};
    return {status:'ready',tracks:result.items.map(item => ({id:item.youtubeId,artist:item.artist,title:item.title,
      brand:item.brandSlug || item.brandCode || null,...(item.brandSlug ? {brandSlug:item.brandSlug} : {}),youtubeId:item.youtubeId,
      ...(item.uploadDate ? {dateAdded:libraryDate(item.uploadDate)} : {})})),
      limited:result.nextCursor !== null,nextCursor:result.nextCursor === null ? null : prefix + result.nextCursor,lastSuccess:result.lastSuccess,source:result.source === 'cache' ? 'offline-cache' : 'shared',
      fetchedAt:result.fetchedAt,stale:result.stale,revision:result.revision,cachePersisted:result.cachePersisted};
  }
  async status(path: string, active = true): Promise<CatalogConnectionStatus> {
    try {
      // Current credentials share the search authority's denial latch/cache;
      // unsaved drafts must not replace that authority or clear its offline data.
      const connection = active ? await this.connect(path) : null;
      if (connection && !this.current(connection)) return {status:'unavailable'};
      const client = connection?.client ?? this.create(await this.readConfig(path),this.cacheFile + '.status');
      const result = await client.status();
      if (connection && !this.current(connection)) return {status:'unavailable'};
      if (result.status !== 'ready') return {status:result.status};
      return {status:'ready',source:result.source,lastSuccess:result.lastSuccess,lastAttempt:result.lastAttempt,
        fetchedAt:result.fetchedAt,stale:result.stale,recordCount:result.recordCount,searchableCount:result.searchableCount,revision:result.revision,cachePersisted:result.cachePersisted};
    } catch (error) { return {status:error instanceof SupersededConnection ? 'unavailable' : 'configuration-error'}; }
  }
  async search(path: string, query: unknown, cursor?: unknown, signal?: AbortSignal): Promise<LocalCatalogResult> {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/.test(query)) throw new Error('Enter at least two characters, up to 200.');
    if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') return {status:'invalid-request',tracks:[],limited:false,lastSuccess:null};
    try {
      const connection = await this.connect(path);
      if (!this.current(connection)) return {status:'unavailable',tracks:[],limited:false,lastSuccess:null};
      return await this.searchPage(connection, query.trim(), cursor, signal);
    } catch (error) { return {status:error instanceof SupersededConnection ? 'unavailable' : 'configuration-error',tracks:[],limited:false,lastSuccess:null}; }
  }
}
