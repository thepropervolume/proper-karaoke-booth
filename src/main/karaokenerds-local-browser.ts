import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseCommunityCatalog } from '../catalog/karaokenerds';
import { youtubeVideoId } from '../catalog/karaokenerds-brand-map';

export type LocalCatalogTrack = { id: number | string; artist: string; title: string; brand: string | null; brandSlug?: string; youtubeId: string | null };
export type LocalCatalogResult =
  | { status: 'ready'; tracks: LocalCatalogTrack[]; limited: boolean; nextCursor?: string | null; lastSuccess: number | null; source?: 'shared' | 'offline-cache'; fetchedAt?: number; stale?: boolean; revision?: string | null; cachePersisted?: boolean }
  | { status: 'missing' | 'unavailable' | 'uninitialized' | 'unauthorized' | 'forbidden' | 'configuration-error' | 'rate-limited' | 'timed-out' | 'invalid-request' | 'invalid-response'; tracks: []; limited: false; lastSuccess: null };

type Entry = { track: LocalCatalogTrack; search: string };
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
const PAGE_SIZE = 50;
const LOCAL_CURSOR = /^local_([a-f0-9]{64})_([1-9]\d{0,6})$/;

/** A local, read-only view. It never opens an absent database or refreshes the feed. */
export class LocalCommunityBrowser {
  private db: DatabaseSync | null = null;
  private identity = '';
  private dataVersion = -1;
  private entries: Entry[] = [];
  private snapshotDigest = '';
  private lastSuccess: number | null = null;

  constructor(private readonly path: string) {}

  close(): void { this.db?.close(); this.db = null; this.identity = ''; this.dataVersion = -1; this.entries = []; this.snapshotDigest = ''; }

  search(value: unknown, cursor?: unknown): LocalCatalogResult {
    if (typeof value !== 'string' || value.length > 200 || /[\x00-\x1f\x7f]/u.test(value)) throw new Error('Invalid catalog search.');
    const query = normalize(value);
    if (query.length < 2) throw new Error('Enter at least two characters to search.');
    const empty = (status: 'missing' | 'unavailable' | 'uninitialized' | 'invalid-request'): LocalCatalogResult => ({ status, tracks: [], limited: false, lastSuccess: null });
    const continuation = typeof cursor === 'string' ? LOCAL_CURSOR.exec(cursor) : null;
    if (cursor != null && !continuation) return empty('invalid-request');
    try {
      if (!existsSync(this.path)) { this.close(); return empty('missing'); }
      const stats = statSync(this.path);
      if (!stats.isFile()) { this.close(); return empty('unavailable'); }
      const identity = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
      if (!this.db || this.identity !== identity) {
        this.close(); this.db = new DatabaseSync(this.path, { readOnly: true }); this.identity = identity;
      }
      const db = this.db;
      const version = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
      if (version !== this.dataVersion) {
        db.exec('BEGIN');
        try {
          const row = db.prepare('SELECT snapshot, last_success FROM community_catalog WHERE id = 1').get() as { snapshot: string | null; last_success: number | null } | undefined;
          if (!row || row.snapshot === null) { db.exec('COMMIT'); this.entries = []; this.dataVersion = -1; return empty('uninitialized'); }
          if (typeof row.snapshot !== 'string' || Buffer.byteLength(row.snapshot, 'utf8') > 64 * 1024 * 1024) throw new Error('Invalid catalog.');
          const catalog = parseCommunityCatalog(JSON.parse(row.snapshot));
          const mappingsExist = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='community_brand_mappings'").get();
          const hasSlugs = mappingsExist && (db.prepare('PRAGMA table_info(community_brand_mappings)').all() as {name:string}[]).some(column => column.name === 'slug');
          const mappings = mappingsExist ? db.prepare(`SELECT upstream_brand, display_name${hasSlugs ? ', slug' : ''} FROM community_brand_mappings`).all() as { upstream_brand: string; display_name: string; slug?: string }[] : [];
          const brands = new Map(mappings.map(item => [item.upstream_brand, item.display_name]));
          const slugs = new Map(mappings.filter(item => item.slug && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(item.slug)).map(item => [item.upstream_brand, item.slug!]));
          this.entries = catalog.Items.map(item => {
            const track = { id: item.Id, artist: item.Artist, title: item.Title, brand: brands.get(item.Brand) ?? null, ...(slugs.has(item.Brand) ? {brandSlug: slugs.get(item.Brand)!} : {}), youtubeId: youtubeVideoId(item.Watch) };
            return { track, search: normalize(`${track.artist} ${track.title} ${track.brand ?? ''}`) };
          });
          this.snapshotDigest = createHash('sha256').update(row.snapshot).update(JSON.stringify(mappings)).digest('hex');
          this.lastSuccess = typeof row.last_success === 'number' && Number.isSafeInteger(row.last_success) && row.last_success >= 0 ? row.last_success : null;
          db.exec('COMMIT'); this.dataVersion = version;
        } catch (error) { try { db.exec('ROLLBACK'); } catch { /* Connection is already unusable. */ } throw error; }
      }
      const terms = query.split(/\s+/u);
      const pageKey = createHash('sha256').update(JSON.stringify([this.snapshotDigest, terms])).digest('hex');
      if (continuation && continuation[1] !== pageKey) return empty('invalid-request');
      const offset = continuation ? Number(continuation[2]) : 0;
      const matches: LocalCatalogTrack[] = [];
      const seenVideos = new Set<string>();
      let skipped = 0;
      for (const entry of this.entries) {
        if (!terms.every(term => entry.search.includes(term))) continue;
        const videoId = entry.track.youtubeId;
        if (videoId) {
          if (seenVideos.has(videoId)) continue;
          seenVideos.add(videoId);
        }
        if (skipped < offset) { skipped++; continue; }
        matches.push(entry.track);
        if (matches.length > PAGE_SIZE) break;
      }
      if (skipped !== offset) return empty('invalid-request');
      const limited = matches.length > PAGE_SIZE;
      return { status: 'ready', tracks: matches.slice(0, PAGE_SIZE), limited,
        nextCursor: limited ? ['local', pageKey, offset + PAGE_SIZE].join('_') : null, lastSuccess: this.lastSuccess };
    } catch { this.close(); return empty('unavailable'); }
  }
}
