import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('raw read-only seed requires explicit disabled-refresh acknowledgement and redacts private configuration', () => {
  const marker = 'synthetic-upstream-secret-never-print';
  const env = { ...process.env, TPV_KN_REFRESH_DISABLED: '', TPV_KN_RAW_SNAPSHOT_FILE: `/${marker}/snapshot.json`,
    TPV_KN_MYSQL_PASSWORD_FILE: `/${marker}/password`, TPV_KN_UPSTREAM_URL_FILE: `/${marker}/upstream` };
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/karaokenerds-mysql.ts', 'seed-readonly'], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr.includes(marker), false);
  assert.match(result.stderr, /Catalog operation failed/);
});

test('raw read-only seed rejects missing, relative, public and malformed snapshot files before connecting', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-readonly-seed-'));
  const marker = 'synthetic-private-content-never-print';
  try {
    const password = path.join(dir, 'password'); writeFileSync(password, marker, { mode: 0o600 });
    const publicSnapshot = path.join(dir, 'public.json'); writeFileSync(publicSnapshot, '{}', { mode: 0o644 });
    const malformed = path.join(dir, 'malformed.json'); writeFileSync(malformed, marker, { mode: 0o600 });
    for (const snapshot of [path.join(dir, 'missing.json'), 'relative.json', ...(process.platform === 'win32' ? [] : [publicSnapshot]), malformed]) {
      const env = { ...process.env, TPV_KN_REFRESH_DISABLED: 'yes', TPV_KN_RAW_SNAPSHOT_FILE: snapshot,
        TPV_KN_MYSQL_SOCKET: path.join(dir, 'missing.sock'), TPV_KN_MYSQL_DATABASE: 'synthetic', TPV_KN_MYSQL_USER: 'synthetic', TPV_KN_MYSQL_PASSWORD_FILE: password };
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/karaokenerds-mysql.ts', 'seed-readonly'], { env, encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr.includes(marker), false);
      assert.equal(result.stderr.includes(dir), false); assert.match(result.stderr, /Catalog operation failed/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
