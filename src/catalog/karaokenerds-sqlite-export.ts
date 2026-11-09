/** Read-only prototype export. Stop all old refreshers before cutover. */
import { closeSync, fsyncSync, linkSync, mkdtempSync, openSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseCommunityCatalog } from './karaokenerds';
import { catalogMigrationIntegrity, validateSQLiteExport, type CatalogMigrationPayload, type CatalogMigrationExport } from './karaokenerds-migration-schema';

/** Read a consistent SQLite snapshot without contacting any network service. */
export function exportSQLiteCatalog(filename: string): CatalogMigrationExport {
  if (!path.isAbsolute(filename)) throw new Error('Catalog database path must be absolute.');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; BEGIN');
    try {
      const rows = db.prepare('SELECT id, snapshot, last_attempt AS lastAttempt, last_success AS lastSuccess, attempt_id AS attemptId FROM community_catalog').all() as
        { id: number; snapshot: string | null; lastAttempt: number | null; lastSuccess: number | null; attemptId: string | null }[];
      if (rows.length !== 1 || rows[0].id !== 1 || typeof rows[0].snapshot !== 'string' || rows[0].lastAttempt === null)
        throw new Error('Catalog state is uninitialized or invalid.');
      if (rows[0].attemptId !== null) throw new Error('SQLite refresh has an outstanding attempt.');
      const controlExists = db.prepare("SELECT 1 AS found FROM sqlite_schema WHERE type = 'table' AND name = 'community_refresh_control'").get();
      if (!controlExists) throw new Error('SQLite refresh must be retired before export.');
      const controls = db.prepare('SELECT id, state, retired_at AS retiredAt FROM community_refresh_control').all() as { id: number; state: string; retiredAt: number }[];
      if (controls.length !== 1 || controls[0].id !== 1 || controls[0].state !== 'retired') throw new Error('SQLite refresh must be retired before export.');
      let parsed: unknown;
      try { parsed = JSON.parse(rows[0].snapshot); } catch { throw new Error('Catalog snapshot is not valid JSON.'); }
      const snapshot = parseCommunityCatalog(parsed);
      const brandMappings = db.prepare('SELECT slug, display_name AS name, upstream_brand AS upstreamBrand, observed_at AS observedAt FROM community_brand_mappings ORDER BY slug').all() as CatalogMigrationPayload['brandMappings'];
      const videoMetadata = db.prepare('SELECT youtube_id AS youtubeId, brand_slug AS brandSlug, producer_track_code AS producerTrackCode, code_source AS codeSource FROM community_video_metadata ORDER BY youtube_id').all() as CatalogMigrationPayload['videoMetadata'];
      const videoDates = db.prepare('SELECT youtube_id AS youtubeId, upload_date AS uploadDate, release_date AS releaseDate, source, observed_at AS observedAt FROM community_video_dates ORDER BY youtube_id').all() as CatalogMigrationPayload['videoDates'];
      const payload: CatalogMigrationPayload = { snapshot, lastAttempt: rows[0].lastAttempt, lastSuccess: rows[0].lastSuccess,
        sqliteRetirement: { state: 'retired', retiredAt: controls[0].retiredAt, attemptOutstanding: false },
        brandMappings: brandMappings.map(row => ({ ...row })), videoMetadata: videoMetadata.map(row => ({ ...row })), videoDates: videoDates.map(row => ({ ...row })) };
      const result = validateSQLiteExport({ ...payload, integrity: catalogMigrationIntegrity(payload) });
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}

export class CatalogExportCleanupError extends Error {
  constructor(readonly published: boolean) {
    super('Catalog export cleanup needs attention.');
    this.name = 'CatalogExportCleanupError';
  }
}

function cleanupStage(stage: string, directory: string): void {
  try { unlinkSync(stage); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  rmdirSync(directory);
}

/** Write privately and atomically; never replace an existing destination.
 * The optional cleanup hook is for controlled fault testing only.
 */
export function writeCatalogMigrationExport(value: CatalogMigrationExport, target: string,
  options: { cleanupStage?: (stage: string, directory: string) => void } = {}): void {
  if (!path.isAbsolute(target)) throw new Error('Output path must be absolute.');
  const validated = validateSQLiteExport(value);
  const directory = mkdtempSync(path.join(path.dirname(target), '.tpv-catalog-export-'));
  const stage = path.join(directory, 'catalog.json');
  let fd: number | undefined, published = false, operationFailed = false, operationFailure: unknown;
  try {
    fd = openSync(stage, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(validated), 'utf8');
    fsyncSync(fd); closeSync(fd); fd = undefined;
    linkSync(stage, target);
    published = true;
  } catch (error) { operationFailed = true; operationFailure = error; }
  let cleanupFailed = false;
  if (fd !== undefined) { try { closeSync(fd); } catch { cleanupFailed = true; } }
  try { (options.cleanupStage ?? cleanupStage)(stage, directory); } catch { cleanupFailed = true; }
  if (cleanupFailed) throw new CatalogExportCleanupError(published);
  if (operationFailed) throw operationFailure;
}
