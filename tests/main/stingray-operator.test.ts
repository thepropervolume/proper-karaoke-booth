import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runStingrayOperator } from '../../src/main/stingray-operator';

test('operator uses a restricted config file and disconnects after a status or search', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-stingray-')); const file = join(dir, 'config');
  try {
    writeFileSync(file, JSON.stringify({ apiKey: 'fixture-secret', deviceId: 'fixture-device', languageCode: 'en', countryCode: 'US' }), { mode: 0o600 });
    let disposed = 0, calls = 0;
    const create = (key: string) => {
      assert.equal(key, 'fixture-secret');
      return { connect: async (device: unknown) => { assert.deepEqual(device, { deviceId: 'fixture-device', languageCode: 'en', countryCode: 'US' }); return 'ok' as const; },
        searchSongs: async (query: string) => { calls++; assert.equal(query, 'test song'); return { status: 'ok' as const, songs: [] }; }, disconnect: () => { disposed++; } };
    };
    assert.deepEqual(await runStingrayOperator(file, null, create), { status: 'ok' });
    assert.deepEqual(await runStingrayOperator(file, 'test song', create), { status: 'ok', songs: [] });
    assert.equal(disposed, 2); assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('operator rejects missing, relative, insecure and malformed configuration without network', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-stingray-')); const file = join(dir, 'config'); let calls = 0;
  const create = () => { calls++; throw new Error('unexpected'); };
  try {
    for (const value of [undefined, 'relative', dir, join(dir, 'missing')]) assert.deepEqual(await runStingrayOperator(value, null, create), { status: 'configuration-error' });
    writeFileSync(file, JSON.stringify({ apiKey: 'fixture-secret', deviceId: 'id', languageCode: 'en', countryCode: 'US', extra: true }), { mode: 0o600 });
    assert.deepEqual(await runStingrayOperator(file, null, create), { status: 'configuration-error' });
    if (process.platform !== 'win32') {
      chmodSync(file, 0o644); assert.deepEqual(await runStingrayOperator(file, null, create), { status: 'configuration-error' });
      const link = join(dir, 'link'); symlinkSync(file, link); assert.deepEqual(await runStingrayOperator(link, null, create), { status: 'configuration-error' });
    }
    assert.equal(calls, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI help and invalid invocations stay offline and do not echo arguments', () => {
  const args = ['--import', 'tsx', 'scripts/stingray-catalog.ts'];
  const help = spawnSync(process.execPath, [...args, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /TPV_STINGRAY_CONFIG_FILE/);
  const bad = spawnSync(process.execPath, [...args, 'private-argument'], { encoding: 'utf8' });
  assert.equal(bad.status, 7); assert.doesNotMatch(bad.stdout + bad.stderr, /private-argument/);
  const missing = spawnSync(process.execPath, [...args, 'status'], { encoding: 'utf8', env: { ...process.env, TPV_STINGRAY_CONFIG_FILE: '' } });
  assert.equal(missing.status, 7); assert.deepEqual(JSON.parse(missing.stdout), { status: 'configuration-error' });
});
