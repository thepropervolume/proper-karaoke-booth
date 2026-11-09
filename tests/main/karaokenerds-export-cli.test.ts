import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CommunityCatalogStore } from '../../src/catalog/karaokenerds';

test('export command preserves a private migration bundle and never overwrites it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-export-cli-'));
  const database = path.join(dir, 'source.sqlite'), destination = path.join(dir, 'migration.json');
  const store = new CommunityCatalogStore(database);
  try {
    store.seed({ Items: [{ Id: 0, Artist: 'Example', Title: 'Song', Brand: 'EX', Watch: 'https://youtu.be/abcdefghij1', Created: null }] }, 0);
    store.close();
    const env = { ...process.env, TPV_KARAOKENNERDS_DATABASE: database, TPV_KARAOKENNERDS_EXPORT: destination };
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/karaokenerds-export.ts'], { encoding: 'utf8', env });
    assert.equal(JSON.parse(output).integrity.snapshotItems, 1);
    const saved = readFileSync(destination);
    const retry = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/karaokenerds-export.ts'], { encoding: 'utf8', env });
    assert.equal(retry.status, 1);
    assert.deepEqual(readFileSync(destination), saved);
  } finally { try { store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
});
