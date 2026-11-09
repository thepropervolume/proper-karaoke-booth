import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { CommunityCatalogStore } from '../../src/catalog/karaokenerds';
import { catalogMigrationIntegrity, validateSQLiteExport } from '../../src/catalog/karaokenerds-migration-schema';
import { CatalogExportCleanupError, exportSQLiteCatalog, writeCatalogMigrationExport } from '../../src/catalog/karaokenerds-sqlite-export';

function fixture(filename: string) {
  const store = new CommunityCatalogStore(filename);
  store.seed({ Items: [
    { Id: 0, Artist: 'Example', Title: 'One', Brand: 'EX', Watch: 'https://youtu.be/abcdefghij1', Created: null },
    { Id: 0, Artist: 'Example', Title: 'Two', Brand: 'EX', Watch: 'https://youtu.be/abcdefghij2', Created: '/Date(1)/' },
  ] }, 1000);
  store.saveBrandMapping({ slug: 'ExampleBrand', name: 'Example Brand', upstreamBrand: 'EX' }, 2000, ['abcdefghij1', 'abcdefghij2']);
  store.saveProducerTrackCode('abcdefghij1', 'EX-003', 'host-confirmed');
  store.saveVideoDates('abcdefghij1', { uploadDate: '2024-06-01', releaseDate: null, provenance: 'yt-dlp' }, 3000);
  store.retireSQLiteRefresh(true, 1000);
  store.close();
}

test('exports every catalog table and cooldown with digest, without changing the source', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-kn-export-')), database = path.join(dir, 'catalog.sqlite');
  try {
    fixture(database); const before = readFileSync(database);
    const result = exportSQLiteCatalog(database);
    assert.equal(result.lastAttempt, 1000); assert.equal(result.lastSuccess, 1000);
    assert.deepEqual(result.sqliteRetirement, { state: 'retired', retiredAt: 1000, attemptOutstanding: false });
    assert.deepEqual(result.integrity, { sha256: result.integrity.sha256, snapshotItems: 2, brands: 1, videos: 2, videoDates: 1 });
    assert.equal(result.videoMetadata[0].producerTrackCode, 'EX-003');
    assert.equal(result.videoDates[0].uploadDate, '2024-06-01');
    assert.deepEqual(validateSQLiteExport(JSON.parse(JSON.stringify(result))), result);
    assert.deepEqual(readFileSync(database), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects tampering, inconsistent references, invalid cooldown and counts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-kn-invalid-')), database = path.join(dir, 'catalog.sqlite');
  try {
    fixture(database); const original = exportSQLiteCatalog(database);
    const tampered = structuredClone(original); tampered.snapshot.Items[0].Title = 'Different';
    assert.throws(() => validateSQLiteExport(tampered), /Invalid catalog migration export/);
    const badCount = structuredClone(original); badCount.integrity.videos++;
    assert.throws(() => validateSQLiteExport(badCount), /Invalid catalog migration export/);
    const tamperedRetirement = structuredClone(original); tamperedRetirement.sqliteRetirement.retiredAt = 999;
    assert.throws(() => validateSQLiteExport(tamperedRetirement), /Invalid catalog migration export/);
    const { integrity: _bad, ...outstandingProof } = structuredClone(original);
    (outstandingProof.sqliteRetirement as { attemptOutstanding: boolean }).attemptOutstanding = true;
    assert.throws(() => validateSQLiteExport({ ...outstandingProof, integrity: catalogMigrationIntegrity(outstandingProof) }), /Invalid catalog migration export/);
    const noProof = structuredClone(original) as unknown as Record<string, unknown>; delete noProof.sqliteRetirement;
    assert.throws(() => validateSQLiteExport(noProof), /Invalid catalog migration export/);
    const { integrity: _, ...badReference } = structuredClone(original);
    badReference.videoMetadata[0].brandSlug = 'Missing';
    assert.throws(() => validateSQLiteExport({ ...badReference, integrity: catalogMigrationIntegrity(badReference) }), /Invalid catalog migration export/);
    badReference.videoMetadata[0].brandSlug = 'examplebrand';
    assert.throws(() => validateSQLiteExport({ ...badReference, integrity: catalogMigrationIntegrity(badReference) }), /Invalid catalog migration export/);
    const db = new DatabaseSync(database); db.prepare('UPDATE community_catalog SET last_success = 2000 WHERE id = 1').run(); db.close();
    assert.throws(() => exportSQLiteCatalog(database), /Invalid catalog migration export/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('requires an actual retired marker and no outstanding SQLite attempt', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-kn-retire-')), database = path.join(dir, 'catalog.sqlite');
  try {
    const store = new CommunityCatalogStore(database);
    store.seed({ Items: [{ Id: 0, Artist: 'Example', Title: 'Song', Brand: 'EX', Watch: 'https://youtu.be/abcdefghij1', Created: null }] }, 0);
    assert.throws(() => exportSQLiteCatalog(database), /retired/);
    store.retireSQLiteRefresh(true, 0); store.close();
    const db = new DatabaseSync(database); db.prepare("UPDATE community_catalog SET attempt_id = 'pending' WHERE id = 1").run(); db.close();
    assert.throws(() => exportSQLiteCatalog(database), /outstanding/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writes a verified export privately without replacing an existing destination', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-kn-write-')), database = path.join(dir, 'catalog.sqlite'), target = path.join(dir, 'export.json');
  try {
    fixture(database); const result = exportSQLiteCatalog(database);
    writeCatalogMigrationExport(result, target);
    assert.deepEqual(validateSQLiteExport(JSON.parse(readFileSync(target, 'utf8'))), result);
    if (process.platform !== 'win32') assert.equal(statSync(target).mode & 0o777, 0o600);
    writeFileSync(target, 'do not overwrite');
    assert.throws(() => writeCatalogMigrationExport(result, target));
    assert.equal(readFileSync(target, 'utf8'), 'do not overwrite');
    assert.equal(readdirSync(dir).some(name => name.startsWith('.tpv-catalog-export-')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cleanup errors report whether publication occurred without exposing the temporary path', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-kn-cleanup-')), database = path.join(dir, 'catalog.sqlite');
  try {
    fixture(database); const result = exportSQLiteCatalog(database);
    const target = path.join(dir, 'new-export.json');
    const cleanup = () => { throw new Error('sensitive cleanup detail'); };
    assert.throws(() => writeCatalogMigrationExport(result, target, { cleanupStage: cleanup }), (error: unknown) =>
      error instanceof CatalogExportCleanupError && error.published && !String(error).includes('sensitive') && !String(error).includes(dir));
    assert.deepEqual(validateSQLiteExport(JSON.parse(readFileSync(target, 'utf8'))), result);
    const occupied = path.join(dir, 'occupied.json'); writeFileSync(occupied, 'unchanged');
    assert.throws(() => writeCatalogMigrationExport(result, occupied, { cleanupStage: cleanup }), (error: unknown) =>
      error instanceof CatalogExportCleanupError && !error.published && !String(error).includes('sensitive'));
    assert.equal(readFileSync(occupied, 'utf8'), 'unchanged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
