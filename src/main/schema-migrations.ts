/** Transactional application schema versions. The caller owns the sole show database connection. */
import type { DatabaseSync } from 'node:sqlite';
import { seedSongHistory } from './song-history';

// Version 5 permits unassigned (null-singer) queue/history entries. Older
// clients require a singer and must refuse this database rather than crash
// during playback or silently invent a singer when restoring it.
// Version 6 adds Party Tyme source identities to saved show JSON. Older binaries
// must not reinterpret private provider media as ordinary imported files.
// Version 7 preserves queued song identities for cross-show scoring.
export const SHOW_SCHEMA_VERSION = 7;
const required: Record<string, readonly string[]> = {
  show_state: ['id', 'value'], media: ['id', 'path', 'fingerprint'], checkpoint: ['id', 'generation', 'position'],
  missing_song_requests: ['id', 'singer', 'title', 'artist', 'created_at'], missing_song_request_reviews: ['request_id', 'status', 'updated_at'], playlists: ['id', 'name', 'singer_id'],
  playlist_items: ['playlist_id', 'version_id'], performance_history: ['generation_id', 'singer_id', 'singer', 'version_id', 'title', 'artist', 'outcome', 'performed_at'],
  remote_invitations: ['token_hash', 'show_id', 'expires', 'revoked'], remote_guests: ['id', 'singer_id', 'show_id', 'resume_hash', 'resume_expires', 'join_id', 'join_name', 'join_revision', 'revoked'],
  remote_invitation_scopes: ['token_hash', 'scope_id'], remote_guest_scopes: ['guest_id', 'scope_id'], remote_sessions: ['token_hash', 'guest_id', 'run_id', 'expires', 'revoked'],
  remote_receipts: ['guest_id', 'command_id', 'fingerprint', 'outcome'], remote_missing_song_owners: ['request_id', 'guest_id', 'singer_id', 'show_id'],
  local_song_ratings: ['fingerprint', 'value', 'updated_at'], song_queue_history: ['identity'],
};
const primaryKeys: Record<string, readonly string[]> = {
  show_state: ['id'], media: ['id'], checkpoint: ['id'], missing_song_requests: ['id'], missing_song_request_reviews: ['request_id'], playlists: ['id'],
  playlist_items: ['playlist_id', 'version_id'], performance_history: ['generation_id'], remote_invitations: ['token_hash'],
  remote_guests: ['id'], remote_invitation_scopes: ['token_hash'], remote_guest_scopes: ['guest_id'], remote_sessions: ['token_hash'],
  remote_receipts: ['guest_id', 'command_id'], remote_missing_song_owners: ['request_id'],
  local_song_ratings: ['fingerprint'], song_queue_history: ['identity'],
};
const notNull: Record<string, readonly string[]> = {
  show_state: ['value'], media: ['path', 'fingerprint'], checkpoint: ['generation', 'position'],
  missing_song_requests: ['singer', 'title', 'artist', 'created_at'], missing_song_request_reviews: ['status', 'updated_at'], playlists: ['name'],
  playlist_items: ['playlist_id', 'version_id'], performance_history: ['singer_id', 'singer', 'version_id', 'title', 'artist', 'outcome', 'performed_at'],
  remote_invitations: ['show_id', 'expires', 'revoked'], remote_guests: ['singer_id', 'show_id', 'resume_hash', 'resume_expires', 'join_id', 'join_name', 'join_revision', 'revoked'],
  remote_invitation_scopes: ['scope_id'], remote_guest_scopes: ['scope_id'], remote_sessions: ['guest_id', 'run_id', 'expires', 'revoked'],
  remote_receipts: ['guest_id', 'command_id', 'fingerprint', 'outcome'], remote_missing_song_owners: ['guest_id', 'singer_id', 'show_id'],
  local_song_ratings: ['value', 'updated_at'], song_queue_history: ['identity'],
};

/** Reject unrelated or incompatible legacy tables instead of silently stamping them as upgraded. */
function validateExisting(db: DatabaseSync, complete: boolean, schemaVersion = SHOW_SCHEMA_VERSION): void {
  const rows = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  const tables = new Set(rows.map(row => row.name));
  if (tables.size && !tables.has('show_state')) throw new Error('This is not a recognizable show database.');
  for (const [name, columns] of Object.entries(required)) {
    if (!tables.has(name)) {
      const introducedIn = name === 'song_queue_history' ? 7 : name === 'local_song_ratings' ? 3 : name === 'missing_song_request_reviews' ? 2 : 1;
      if (complete && schemaVersion >= introducedIn) throw new Error(`Show database table ${name} is missing.`);
      continue;
    }
    const info = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; type: string; notnull: number; pk: number; dflt_value: unknown }[];
    const actual = new Map(info.map(column => [column.name, column]));
    const key = info.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
    const requiredNotNull = notNull[name].filter(column => !(schemaVersion >= 5 && name === 'performance_history' && column === 'singer_id'));
    if (columns.some(column => !actual.has(column)) || requiredNotNull.some(column => actual.get(column)?.notnull !== 1) ||
        schemaVersion >= 5 && name === 'performance_history' && actual.get('singer_id')?.notnull !== 0 ||
        info.some(column => !columns.includes(column.name) && column.notnull === 1 && column.dflt_value === null) ||
        key.length !== primaryKeys[name].length || key.some((column, index) => column !== primaryKeys[name][index]))
      throw new Error(`Show database table ${name} is incompatible.`);
    if (name === 'local_song_ratings' && (actual.get('fingerprint')?.type.toUpperCase() !== 'TEXT' ||
      actual.get('value')?.type.toUpperCase() !== 'INTEGER' || actual.get('updated_at')?.type.toUpperCase() !== 'TEXT'))
      throw new Error('Show database local ratings column types are incompatible.');
    const unique = db.prepare(`PRAGMA index_list("${name}")`).all() as { name: string; unique: number; partial: number }[];
    const allowed = [primaryKeys[name], ...(name === 'remote_guests' ? [['resume_hash'], ['join_id']] : [])];
    const seen = new Set<string>();
    for (const index of unique.filter(item => item.unique === 1)) {
      const fields = (db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(index.name) as { name: string | null }[]).map(item => item.name);
      if (index.partial || !allowed.some(expected => expected.length === fields.length && expected.every((field, position) => field === fields[position])))
        throw new Error(`Show database table ${name} has an incompatible unique constraint.`);
      seen.add(fields.join('\0'));
    }
    if (name === 'remote_guests' && (!seen.has('resume_hash') || !seen.has('join_id'))) throw new Error('Show database guest credentials lack required uniqueness.');
  }
  if (tables.has('missing_song_request_reviews')) {
    if (db.prepare("SELECT 1 FROM missing_song_request_reviews WHERE status NOT IN ('pending', 'reviewing', 'fulfilled', 'declined') LIMIT 1").get())
      throw new Error('Show database has an invalid missing-song review status.');
    if (!tables.has('missing_song_requests')) {
      if (db.prepare('SELECT 1 FROM missing_song_request_reviews LIMIT 1').get()) throw new Error('Show database has orphaned missing-song reviews.');
    } else if (db.prepare('SELECT 1 FROM missing_song_request_reviews review LEFT JOIN missing_song_requests request ON request.id = review.request_id WHERE request.id IS NULL LIMIT 1').get())
      throw new Error('Show database has orphaned missing-song reviews.');
  }
  if (tables.has('local_song_ratings') && db.prepare(`SELECT 1 FROM local_song_ratings
    WHERE typeof(fingerprint) <> 'text' OR length(fingerprint) <> 64 OR fingerprint GLOB '*[^0-9a-f]*'
    OR typeof(value) <> 'integer' OR value < 1 OR value > 10 OR typeof(updated_at) <> 'text' LIMIT 1`).get())
    throw new Error('Show database has an invalid local song rating.');
  if (tables.has('show_state')) {
    const row = db.prepare('SELECT value FROM show_state WHERE id = 1').get() as { value: unknown } | undefined;
    if (row) {
      if (typeof row.value !== 'string') throw new Error('Show database state is invalid.');
      try { JSON.parse(row.value); } catch { throw new Error('Show database state is invalid.'); }
    } else {
      // Never silently create a fresh show over orphaned library or history data.
      if (db.prepare('SELECT 1 FROM show_state LIMIT 1').get()) throw new Error('Show database state is missing.');
      for (const name of Object.keys(required)) {
        if (name === 'show_state' || !tables.has(name)) continue;
        const where = name === 'playlists' ? " WHERE id <> 'kj-picks'" : '';
        if (db.prepare(`SELECT 1 FROM "${name}"${where} LIMIT 1`).get()) throw new Error('Show database state is missing while other show data exists.');
      }
    }
  }
}

/** Read-only compatibility check for a standalone versioned backup. */
export function inspectShowSchema(db: DatabaseSync): void {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current < 1 || current > SHOW_SCHEMA_VERSION) throw new Error('Backup schema is unsupported.');
  validateExisting(db, true, current);
}

/** Baseline the existing unversioned schema in one transaction, preserving all rows. */
export function migrateShowSchema(db: DatabaseSync): void {
  // Acquire the writer lock before inspecting the version. Schema edits, copied
  // rows and the version marker must either all commit or all roll back.
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (!Number.isSafeInteger(current) || current < 0 || current > SHOW_SCHEMA_VERSION) throw new Error('This show database was created by a newer or unsupported version.');
    validateExisting(db, current > 0, current);
    if (current === SHOW_SCHEMA_VERSION) { db.exec('COMMIT'); return; }
    db.exec(`CREATE TABLE IF NOT EXISTS show_state (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, path TEXT NOT NULL, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), generation TEXT NOT NULL, position REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS missing_song_requests (id TEXT PRIMARY KEY, singer TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS missing_song_request_reviews (request_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('pending', 'reviewing', 'fulfilled', 'declined')), updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, singer_id TEXT);
      CREATE TABLE IF NOT EXISTS playlist_items (playlist_id TEXT NOT NULL, version_id TEXT NOT NULL, PRIMARY KEY (playlist_id, version_id));
      CREATE TABLE IF NOT EXISTS performance_history (generation_id TEXT PRIMARY KEY, singer_id TEXT, singer TEXT NOT NULL, version_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, outcome TEXT NOT NULL, performed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_invitations (token_hash TEXT PRIMARY KEY, show_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_guests (id TEXT PRIMARY KEY, singer_id TEXT NOT NULL, show_id TEXT NOT NULL, resume_hash TEXT NOT NULL UNIQUE, resume_expires INTEGER NOT NULL, join_id TEXT NOT NULL UNIQUE, join_name TEXT NOT NULL, join_revision INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_invitation_scopes (token_hash TEXT PRIMARY KEY, scope_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_guest_scopes (guest_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_sessions (token_hash TEXT PRIMARY KEY, guest_id TEXT NOT NULL, run_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remote_receipts (guest_id TEXT NOT NULL, command_id TEXT NOT NULL, fingerprint TEXT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY (guest_id, command_id));
      CREATE TABLE IF NOT EXISTS remote_missing_song_owners (request_id TEXT PRIMARY KEY, guest_id TEXT NOT NULL, singer_id TEXT NOT NULL, show_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_song_ratings (fingerprint TEXT PRIMARY KEY CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
        value INTEGER NOT NULL CHECK (typeof(value) = 'integer' AND value BETWEEN 1 AND 10), updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS song_queue_history (identity TEXT PRIMARY KEY NOT NULL);
      INSERT OR IGNORE INTO playlists (id, name, singer_id) VALUES ('kj-picks', 'KJ Picks', NULL);`);
    const history = db.prepare('PRAGMA table_info(performance_history)').all() as { name: string; notnull: number }[];
    if (history.find(column => column.name === 'singer_id')?.notnull === 1) {
      // SQLite has no ALTER COLUMN DROP NOT NULL. Preserve every row and any
      // existing explicit indexes/triggers while changing this one constraint.
      const attached = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name = 'performance_history' AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name").all() as { sql: string }[];
      db.exec(`CREATE TABLE performance_history_v5 (generation_id TEXT PRIMARY KEY, singer_id TEXT, singer TEXT NOT NULL,
        version_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, outcome TEXT NOT NULL, performed_at TEXT NOT NULL);`);
      db.exec(`INSERT INTO performance_history_v5 (generation_id, singer_id, singer, version_id, title, artist, outcome, performed_at)
        SELECT generation_id, singer_id, singer, version_id, title, artist, outcome, performed_at FROM performance_history;`);
      db.exec('DROP TABLE performance_history;');
      db.exec('ALTER TABLE performance_history_v5 RENAME TO performance_history;');
      for (const entry of attached) db.exec(entry.sql);
    }
    if (current < 7) seedSongHistory(db);
    // IF NOT EXISTS also tolerates a same-named view; verify the complete
    // resulting table layout before declaring this migration successful.
    validateExisting(db, true);
    db.exec(`PRAGMA user_version = ${SHOW_SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
