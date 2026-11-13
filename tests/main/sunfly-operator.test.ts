import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runSunflyStatus, SUNFLY_STATUS_EXIT_CODES } from '../../src/main/sunfly-operator';

test('reads a private key for an injected status inspector without returning it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-sunfly-test-'));
  const file = join(dir, 'key');
  try {
    writeFileSync(file, 'sfk_example_only\r\n', { mode: 0o600 });
    const result = await runSunflyStatus(file, async key => {
      assert.equal(key, 'sfk_example_only');
      return { status: 'active' };
    });
    assert.deepEqual(result, { status: 'active' });
    assert.equal(JSON.stringify(result).includes('sfk_example_only'), false);
    assert.equal(SUNFLY_STATUS_EXIT_CODES[result.status], 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('does not call the inspector when configuration is unsafe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-sunfly-test-'));
  const file = join(dir, 'key');
  let calls = 0;
  const inspect = async () => { calls++; return { status: 'active' } as const; };
  try {
    writeFileSync(file, 'sfk_example_only', { mode: 0o600 });
    for (const invalid of [undefined, 'relative-key', dir, join(dir, 'missing')]) {
      assert.deepEqual(await runSunflyStatus(invalid, inspect), { status: 'configuration-error' });
    }
    if (process.platform !== 'win32') {
      chmodSync(file, 0o644);
      assert.deepEqual(await runSunflyStatus(file, inspect), { status: 'configuration-error' });
      chmodSync(file, 0o600);
      const link = join(dir, 'link');
      symlinkSync(file, link);
      assert.deepEqual(await runSunflyStatus(link, inspect), { status: 'configuration-error' });
    }
    writeFileSync(file, Buffer.alloc(1027, 65));
    assert.deepEqual(await runSunflyStatus(file, inspect), { status: 'configuration-error' });
    assert.equal(calls, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI help and invalid invocations do not contact the provider or echo arguments', () => {
  const command = ['--import', 'tsx', 'scripts/sunfly-status.ts'];
  const help = spawnSync(process.execPath, [...command, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /TPV_SUNFLY_ACCESS_KEY_FILE/);
  const bad = spawnSync(process.execPath, [...command, 'sfk_do_not_log'], { encoding: 'utf8' });
  assert.equal(bad.status, 7);
  assert.deepEqual(JSON.parse(bad.stdout), { status: 'configuration-error' });
  assert.equal((bad.stdout + bad.stderr).includes('sfk_do_not_log'), false);
  const missing = spawnSync(process.execPath, [...command, 'status'], {
    encoding: 'utf8', env: { ...process.env, TPV_SUNFLY_ACCESS_KEY_FILE: '' },
  });
  assert.equal(missing.status, 7);
  assert.deepEqual(JSON.parse(missing.stdout), { status: 'configuration-error' });
});
