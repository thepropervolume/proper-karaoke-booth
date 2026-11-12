/** Persistent global ratings in a dedicated MySQL 8 schema; no public credential enrollment. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { isRatingValue, isRecordingKey, isVoterId, parseRecordingKeys, RatingsError, type RecordingRating } from './schema';

const TABLES = ['schema_version', 'voters', 'votes'] as const;
const unavailable = () => new RatingsError(503, 'RATINGS_UNAVAILABLE');
const unsupported = () => new RatingsError(503, 'UNSUPPORTED_SCHEMA');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const COLUMNS: Record<typeof TABLES[number], readonly [string, string, number?][]> = {
  schema_version: [['id', 'tinyint'], ['version', 'int']],
  voters: [['voter_id', 'char', 36], ['token_hash', 'binary', 32], ['disabled', 'tinyint']],
  votes: [['recording_key', 'varchar', 80], ['voter_id', 'char', 36], ['value', 'tinyint'], ['updated_at', 'datetime']],
};
async function tables(connection: PoolConnection) {
  const [rows] = await connection.query<(RowDataPacket & { name: string; kind: string; engine: string })[]>(
    'SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,ENGINE AS engine FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  return rows;
}
async function verify(connection: PoolConnection): Promise<void> {
  const [identity] = await connection.query<(RowDataPacket & { version: string; charset: string })[]>(
    'SELECT VERSION() AS version,DEFAULT_CHARACTER_SET_NAME AS charset FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=DATABASE()');
  if (identity.length !== 1 || !/^8\./.test(identity[0].version) || identity[0].charset !== 'utf8mb4') throw unsupported();
  const objects = await tables(connection);
  if (objects.length !== TABLES.length || objects.some(item => !(TABLES as readonly string[]).includes(item.name) || item.kind !== 'BASE TABLE' || item.engine !== 'InnoDB')) throw unsupported();
  const [extras] = await connection.query<(RowDataPacket & { total: number | string })[]>(`SELECT
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE())+
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE())+
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA=DATABASE()) AS total`);
  if (Number(extras[0]?.total) !== 0) throw unsupported();
  for (const table of TABLES) {
    const [columns] = await connection.execute<(RowDataPacket & { name: string; type: string; nullable: string; length: number | string | null; collation: string | null; precision_ms: number | null; generation_sql: string })[]>(
      `SELECT COLUMN_NAME AS name,DATA_TYPE AS type,IS_NULLABLE AS nullable,CHARACTER_MAXIMUM_LENGTH AS length,
       COLLATION_NAME AS collation,DATETIME_PRECISION AS precision_ms,GENERATION_EXPRESSION AS generation_sql
       FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [table]);
    if (columns.length !== COLUMNS[table].length || columns.some((column, index) => {
      const [name, type, length] = COLUMNS[table][index];
      return column.name !== name || column.type !== type || column.nullable !== 'NO' || column.generation_sql !== '' ||
        (length !== undefined && Number(column.length) !== length) ||
        ((type === 'char' || type === 'varchar') && column.collation !== 'ascii_bin') || (type === 'datetime' && Number(column.precision_ms) !== 6);
    })) throw unsupported();
    const [indexes] = await connection.execute<(RowDataPacket & { name: string; non_unique: number; column_name: string })[]>(
      `SELECT INDEX_NAME AS name,NON_UNIQUE AS non_unique,COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX`, [table]);
    const unique = new Map<string, string[]>();
    for (const row of indexes) if (Number(row.non_unique) === 0) { const list = unique.get(row.name) ?? []; list.push(row.column_name); unique.set(row.name, list); }
    const expected = table === 'schema_version' ? ['id'] : table === 'voters' ? ['token_hash', 'voter_id'] : ['recording_key,voter_id'];
    if (JSON.stringify([...unique.values()].map(value => value.join(',')).sort()) !== JSON.stringify(expected.sort())) throw unsupported();
    if (table === 'votes' && !indexes.some(index => index.column_name === 'voter_id' && index.non_unique === 1)) throw unsupported();
  }
  const [versions] = await connection.query<(RowDataPacket & { id: number; version: number })[]>('SELECT id,version FROM schema_version');
  if (versions.length !== 1 || versions[0].id !== 1 || versions[0].version !== 1) throw unsupported();
  const [foreign] = await connection.query<(RowDataPacket & { column_name: string; target: string; target_column: string })[]>(
    `SELECT COLUMN_NAME AS column_name,REFERENCED_TABLE_NAME AS target,REFERENCED_COLUMN_NAME AS target_column
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='votes' AND REFERENCED_TABLE_SCHEMA=DATABASE()`);
  if (foreign.length !== 1 || foreign[0].column_name !== 'voter_id' || foreign[0].target !== 'voters' || foreign[0].target_column !== 'voter_id') throw unsupported();
  const [checks] = await connection.query<(RowDataPacket & { table_name: string; check_sql: string; enforced: string })[]>(
    `SELECT t.TABLE_NAME AS table_name,c.CHECK_CLAUSE AS check_sql,t.ENFORCED AS enforced FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
     JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME
     WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.CONSTRAINT_TYPE='CHECK'`);
  const requiredChecks: Record<string, string> = { schema_version: 'id=1', voters: 'disabledin0,1', votes: 'valuebetween1and10' };
  if (checks.length !== 3 || checks.some(check => check.enforced !== 'YES' ||
      check.check_sql.toLowerCase().replace(/[\s`()]/g, '') !== requiredChecks[check.table_name])) throw unsupported();
}

/** Read-only startup check; the runtime never runs DDL or changes existing votes. */
export async function checkMySqlRatingsStore(pool: Pool): Promise<void> {
  let connection: PoolConnection | undefined;
  try { connection = await pool.getConnection(); await verify(connection); }
  catch (error) { throw error instanceof RatingsError ? error : unavailable(); }
  finally { connection?.release(); }
}

/** Explicit operator-only schema initialization. Partial/unrelated schemas are rejected intact. */
export async function initializeMySqlRatingsStore(pool: Pool): Promise<void> {
  let connection: PoolConnection | undefined, lock: string | undefined, destroy = false;
  try {
    connection = await pool.getConnection();
    const [identity] = await connection.query<(RowDataPacket & { name: string; version: string; charset: string })[]>(
      'SELECT DATABASE() AS name,VERSION() AS version,DEFAULT_CHARACTER_SET_NAME AS charset FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=DATABASE()');
    if (identity.length !== 1 || !identity[0].name || !/^8\./.test(identity[0].version) || identity[0].charset !== 'utf8mb4') throw unsupported();
    const name = 'tpv-rating-init-' + createHash('sha256').update(identity[0].name).digest('hex').slice(0, 32);
    const [held] = await connection.execute<(RowDataPacket & { acquired: number | string | null })[]>('SELECT GET_LOCK(?,5) AS acquired', [name]);
    if (Number(held[0]?.acquired) !== 1) throw unavailable();
    lock = name;
    const existing = await tables(connection);
    if (existing.length) { await verify(connection); return; }
    const [extras] = await connection.query<(RowDataPacket & { total: number | string })[]>(`SELECT
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE())+
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA=DATABASE()) AS total`);
    if (Number(extras[0]?.total) !== 0) throw unsupported();
    // MySQL DDL commits implicitly. The version marker is inserted only after
    // all tables exist; partial initialization requires operator recovery.
    await connection.query('CREATE TABLE schema_version(id TINYINT UNSIGNED NOT NULL PRIMARY KEY,version INT NOT NULL,CHECK(id=1)) ENGINE=InnoDB');
    await connection.query(`CREATE TABLE voters(
      voter_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      token_hash BINARY(32) NOT NULL,disabled TINYINT UNSIGNED NOT NULL DEFAULT 0,
      UNIQUE KEY voter_token_hash(token_hash),CHECK(disabled IN(0,1))
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE votes(
      recording_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      voter_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,value TINYINT UNSIGNED NOT NULL,
      updated_at DATETIME(6) NOT NULL,PRIMARY KEY(recording_key,voter_id),KEY votes_voter(voter_id),
      CONSTRAINT votes_voter_fk FOREIGN KEY(voter_id) REFERENCES voters(voter_id),CHECK(value BETWEEN 1 AND 10)
    ) ENGINE=InnoDB`);
    await connection.query('INSERT INTO schema_version(id,version) VALUES(1,1)');
    await verify(connection);
  } catch (error) { throw error instanceof RatingsError ? error : unavailable(); }
  finally {
    if (connection && lock) try {
      const [released] = await connection.execute<(RowDataPacket & { released: number | string | null })[]>('SELECT RELEASE_LOCK(?) AS released', [lock]);
      if (Number(released[0]?.released) !== 1) destroy = true;
    } catch { destroy = true; }
    if (connection) { if (destroy) connection.destroy(); else connection.release(); }
  }
}

async function transaction<T>(pool: Pool, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  let connection: PoolConnection | undefined, begun = false, attempted = false, commitAttempted = false, destroy = false;
  try {
    connection = await pool.getConnection(); await connection.query('SET SESSION innodb_lock_wait_timeout=5');
    attempted = true; await connection.beginTransaction(); begun = true;
    const result = await work(connection);
    commitAttempted = true; await connection.commit(); begun = false; return result;
  } catch (error) {
    if (begun && connection) try { await connection.rollback(); } catch { destroy = true; }
    if (commitAttempted || attempted && !begun) destroy = true;
    throw error instanceof RatingsError ? error : unavailable();
  } finally { if (connection) { if (destroy) connection.destroy(); else connection.release(); } }
}

/** Controlled provisioning only. Supply a SHA-256 digest, never persist the bearer itself. */
export async function provisionRatingsVoter(pool: Pool, input: { voterId: string; tokenHashHex: string; disabled?: boolean }): Promise<void> {
  if (!input || !isVoterId(input.voterId) || !hash(input.tokenHashHex) || input.disabled !== undefined && typeof input.disabled !== 'boolean') throw new RatingsError(400, 'INVALID_VOTER');
  await checkMySqlRatingsStore(pool);
  await transaction(pool, async connection => {
    const digest = Buffer.from(input.tokenHashHex, 'hex');
    const [existing] = await connection.execute<(RowDataPacket & { voter_id: string })[]>('SELECT voter_id FROM voters WHERE voter_id=? OR token_hash=? FOR UPDATE', [input.voterId, digest]);
    if (existing.some(row => row.voter_id !== input.voterId)) throw new RatingsError(400, 'VOTER_CONFLICT');
    if (existing.length) await connection.execute('UPDATE voters SET token_hash=?,disabled=? WHERE voter_id=?', [digest, input.disabled ? 1 : 0, input.voterId]);
    else await connection.execute('INSERT INTO voters(voter_id,token_hash,disabled) VALUES(?,?,?)', [input.voterId, digest, input.disabled ? 1 : 0]);
  });
}

function safeInteger(value: unknown): number {
  if (!(typeof value === 'number' || typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value))) throw unavailable();
  const converted = Number(value); if (!Number.isSafeInteger(converted) || converted < 0) throw unavailable(); return converted;
}
async function lookupOn(connection: Pick<PoolConnection, 'execute'>, keys: readonly string[], voterId: string | null): Promise<RecordingRating[]> {
  if (!keys.length) return [];
  const [rows] = await connection.execute<(RowDataPacket & { recording_key: string; vote_count: string | number; total_value: string | number; own_vote: number | string | null })[]>(
    `SELECT recording_key,COUNT(*) AS vote_count,SUM(value) AS total_value,
     MAX(CASE WHEN voter_id=? THEN value ELSE NULL END) AS own_vote FROM votes
     WHERE recording_key IN(${keys.map(() => '?').join(',')}) GROUP BY recording_key`, [voterId, ...keys]);
  const ratings = new Map<string, RecordingRating>();
  for (const row of rows) {
    if (!isRecordingKey(row.recording_key) || !keys.includes(row.recording_key) || ratings.has(row.recording_key)) throw unavailable();
    const count = safeInteger(row.vote_count), total = safeInteger(row.total_value), ownVote = row.own_vote === null ? null : safeInteger(row.own_vote);
    if (count < 1 || total < count || total > count * 10 || ownVote !== null && (ownVote < 1 || ownVote > 10) || voterId === null && ownVote !== null) throw unavailable();
    ratings.set(row.recording_key, { recordingKey: row.recording_key, average: total / count, count, ownVote });
  }
  return keys.map(recordingKey => ratings.get(recordingKey) ?? { recordingKey, average: null, count: 0, ownVote: null });
}

export class MySqlRatingsStore {
  constructor(private readonly pool: Pool) {}
  async authenticate(tokenHashHex: string): Promise<string | null> {
    if (!hash(tokenHashHex)) throw new RatingsError(400, 'INVALID_CREDENTIAL');
    try {
      const [rows] = await this.pool.execute<(RowDataPacket & { voter_id: string; disabled: number })[]>('SELECT voter_id,disabled FROM voters WHERE token_hash=?', [Buffer.from(tokenHashHex, 'hex')]);
      if (!rows.length) return null;
      if (rows.length !== 1 || !isVoterId(rows[0].voter_id) || ![0, 1].includes(rows[0].disabled)) throw unavailable();
      return rows[0].disabled ? null : rows[0].voter_id;
    } catch (error) { throw error instanceof RatingsError ? error : unavailable(); }
  }
  async lookup(recordingKeys: readonly string[], voterId: string | null, expectedTokenHashHex?: string): Promise<RecordingRating[]> {
    const keys = parseRecordingKeys(recordingKeys);
    if (!keys || voterId !== null && !isVoterId(voterId) || expectedTokenHashHex !== undefined && (!hash(expectedTokenHashHex) || voterId === null)) throw new RatingsError(400, 'INVALID_LOOKUP');
    try {
      if (voterId === null) return await lookupOn(this.pool, keys, null);
      return await transaction(this.pool, async connection => {
        const [voters] = await connection.execute<(RowDataPacket & { voter_id: string; disabled: number; token_hash: Buffer })[]>(
          'SELECT voter_id,disabled,token_hash FROM voters WHERE voter_id=? FOR SHARE', [voterId]);
        if (voters.length !== 1 || voters[0].disabled !== 0) throw new RatingsError(401, 'UNAUTHORIZED');
        if (voters[0].voter_id !== voterId || !Buffer.isBuffer(voters[0].token_hash) || voters[0].token_hash.length !== 32) throw unavailable();
        if (expectedTokenHashHex !== undefined && !timingSafeEqual(voters[0].token_hash, Buffer.from(expectedTokenHashHex, 'hex')))
          throw new RatingsError(401, 'UNAUTHORIZED');
        return lookupOn(connection, keys, voterId);
      });
    }
    catch (error) { throw error instanceof RatingsError ? error : unavailable(); }
  }
  async vote(recordingKey: string, value: number | null, voterId: string, expectedTokenHashHex?: string): Promise<RecordingRating> {
    if (!isRecordingKey(recordingKey) || !isRatingValue(value) || !isVoterId(voterId) ||
        expectedTokenHashHex !== undefined && !hash(expectedTokenHashHex)) throw new RatingsError(400, 'INVALID_VOTE');
    return transaction(this.pool, async connection => {
      const [voters] = await connection.execute<(RowDataPacket & { voter_id: string; disabled: number; token_hash: Buffer })[]>('SELECT voter_id,disabled,token_hash FROM voters WHERE voter_id=? FOR UPDATE', [voterId]);
      if (voters.length !== 1 || voters[0].disabled !== 0) throw new RatingsError(401, 'UNAUTHORIZED');
      if (voters[0].voter_id !== voterId) throw unavailable();
      if (!Buffer.isBuffer(voters[0].token_hash) || voters[0].token_hash.length !== 32) throw unavailable();
      if (expectedTokenHashHex !== undefined && !timingSafeEqual(voters[0].token_hash, Buffer.from(expectedTokenHashHex, 'hex')))
        throw new RatingsError(401, 'UNAUTHORIZED');
      if (value === null) await connection.execute('DELETE FROM votes WHERE recording_key=? AND voter_id=?', [recordingKey, voterId]);
      else await connection.execute(`INSERT INTO votes(recording_key,voter_id,value,updated_at) VALUES(?,?,?,UTC_TIMESTAMP(6))
        ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=UTC_TIMESTAMP(6)`, [recordingKey, voterId, value]);
      return (await lookupOn(connection, [recordingKey], voterId))[0];
    });
  }
}
