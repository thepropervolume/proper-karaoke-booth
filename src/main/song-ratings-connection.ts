import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { readSharedCatalogConfig, PUBLIC_CATALOG_ORIGIN } from './shared-catalog-connection';
import { SongRatingsClient, type RatingsFailure, type SongRatingVote, type SongRatingsLookup } from './song-ratings-client';
import { isRecordingKey, parseRecordingKeys, validHeartVote } from '../domain/song-rating';

export type SongRatingsConfig = {baseUrl:string;token:string};
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
class SupersededRatingsConnection extends Error {}

/** Missing default config enables public aggregates. Invalid supplied config never does. */
export async function readSongRatingsConfig(path: string): Promise<SongRatingsConfig | null> {
  try {
    if (!isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path)) throw new Error();
    try { await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    return await readSharedCatalogConfig(path);
  } catch { throw new Error('Song rating credentials are invalid or unavailable. Use the owner-only rating configuration supplied for this host.'); }
}

/** Credentials stay in main; a voter represents a host installation, not a singer account. */
export class SongRatingsConnection {
  private sequence = 0;
  private installedSequence = 0;
  private epoch = 0;
  private fingerprint = '';
  private client: SongRatingsClient | null = null;
  constructor(private readonly configFile: string, private readonly options: {fetch?:FetchFn;timeoutMs?:number;requireConfig?:boolean;readConfig?:(path:string)=>Promise<SongRatingsConfig | null>} = {}) {
    if (!isAbsolute(configFile) || /[\x00-\x1f\x7f]/.test(configFile)) throw new Error('Use an absolute private rating configuration path.');
  }
  private async connect(): Promise<{client:SongRatingsClient;epoch:number}> {
    const sequence = ++this.sequence;
    let config: SongRatingsConfig | null;
    try {
      config = await (this.options.readConfig ?? readSongRatingsConfig)(this.configFile);
      if (!config && this.options.requireConfig) throw new Error('The explicitly chosen host rating profile is missing.');
    }
    catch (error) {
      // A newer failed read still invalidates previously authorized in-flight replies.
      if (sequence >= this.installedSequence) { this.installedSequence = sequence; ++this.epoch; this.client = null; this.fingerprint = ''; }
      throw error;
    }
    const identity = createHash('sha256').update(JSON.stringify(config ? [config.baseUrl,config.token] : ['public',PUBLIC_CATALOG_ORIGIN])).digest('hex');
    if (sequence < this.installedSequence && identity !== this.fingerprint) throw new SupersededRatingsConnection();
    if (!this.client || identity !== this.fingerprint) {
      this.client = new SongRatingsClient({baseUrl:config?.baseUrl ?? PUBLIC_CATALOG_ORIGIN,...(config ? {token:config.token} : {}),fetch:this.options.fetch,timeoutMs:this.options.timeoutMs});
      this.fingerprint = identity; ++this.epoch;
    }
    this.installedSequence = Math.max(sequence,this.installedSequence);
    return {client:this.client,epoch:this.epoch};
  }
  private failure(error: unknown): RatingsFailure { return {status:error instanceof SupersededRatingsConnection ? 'unavailable' : 'configuration-error'}; }
  async lookup(recordingKeys: unknown): Promise<SongRatingsLookup> {
    try { parseRecordingKeys(recordingKeys); } catch { return {status:'invalid-request'}; }
    try {
      const connection = await this.connect(), result = await connection.client.lookup(recordingKeys);
      return connection.epoch === this.epoch && connection.client === this.client ? result : {status:'unavailable'};
    } catch (error) { return this.failure(error); }
  }
  async vote(recordingKey: unknown, value: unknown): Promise<SongRatingVote> {
    if (!isRecordingKey(recordingKey) || !validHeartVote(value)) return {status:'invalid-request'};
    try {
      const connection = await this.connect(), result = await connection.client.vote(recordingKey,value);
      return connection.epoch === this.epoch && connection.client === this.client ? result : {status:'unavailable'};
    } catch (error) { return this.failure(error); }
  }
}
