import { existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseCommunityCatalog } from '../catalog/karaokenerds';
import { youtubeVideoId } from '../catalog/karaokenerds-brand-map';

export type LocalCatalogTrack = { id: number; artist: string; title: string; brand: string | null; youtubeId: string | null };
export type LocalCatalogResult =
  | { status: 'ready'; tracks: LocalCatalogTrack[]; limited: boolean; lastSuccess: number | null }
  | { status: 'missing' | 'unavailable' | 'uninitialized'; tracks: []; limited: false; lastSuccess: null };

type Entry = { track: LocalCatalogTrack; search: string };
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();

/** A local, read-only view. It never opens an absent database or refreshes the feed. */
export class LocalCommunityBrowser {
  private db: DatabaseSync | null = null;
  private identity = '';
  private dataVersion = -1;
  private entries: Entry[] = [];
  private lastSuccess: number | null = null;

  constructor(private readonly path: string) {}

  close(): void { this.db?.close(); this.db = null; this.identity = ''; this.dataVersion = -1; this.entries = []; }

  search(value: unknown): LocalCatalogResult {
    if (typeof value !== 'string' || value.length > 200 || /[\x00-\x1f\x7f]/u.test(value)) throw new Error('Invalid catalog search.');
    const query = normalize(value);
    if (query.length < 2) throw new Error('Enter at least two characters to search.');
    const empty = (status: 'missing' | 'unavailable' | 'uninitialized'): LocalCatalogResult => ({ status, tracks: [], limited: false, lastSuccess: null });
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
          const mappings = mappingsExist ? db.prepare('SELECT upstream_brand, display_name FROM community_brand_mappings').all() as { upstream_brand: string; display_name: string }[] : [];
          const brands = new Map(mappings.map(item => [item.upstream_brand, item.display_name]));
          this.entries = catalog.Items.map(item => {
            const track = { id: item.Id, artist: item.Artist, title: item.Title, brand: brands.get(item.Brand) ?? null, youtubeId: youtubeVideoId(item.Watch) };
            return { track, search: normalize(`${track.artist} ${track.title} ${track.brand ?? ''}`) };
          });
          this.lastSuccess = typeof row.last_success === 'number' && Number.isSafeInteger(row.last_success) && row.last_success >= 0 ? row.last_success : null;
          db.exec('COMMIT'); this.dataVersion = version;
        } catch (error) { try { db.exec('ROLLBACK'); } catch { /* Connection is already unusable. */ } throw error; }
      }
      const terms = query.split(/\s+/u);
      const matches: LocalCatalogTrack[] = [];
      for (const entry of this.entries) {
        if (!terms.every(term => entry.search.includes(term))) continue;
        matches.push(entry.track);
        if (matches.length > 50) break;
      }
      return { status: 'ready', tracks: matches.slice(0, 50), limited: matches.length > 50, lastSuccess: this.lastSuccess };
    } catch { this.close(); return empty('unavailable'); }
  }
}
