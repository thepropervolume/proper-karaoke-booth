import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLOUDFLARED_WINDOWS_AMD64, inspectCloudflaredWindows } from '../../src/main/cloudflared-integrity';

test('offline inspection compares a selected regular file to trusted release bytes without executing it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-connector-check-'));
  try {
    const bytes = Buffer.from('synthetic executable contents; never executed');
    const trusted = { version: '2026.10.7', sha256: createHash('sha256').update(bytes).digest('hex') };
    const installed = join(directory, 'cloudflared.exe'); writeFileSync(installed, bytes);
    assert.deepEqual(await inspectCloudflaredWindows(installed, trusted), { ...trusted, size: bytes.length });
    const downloaded = join(directory, 'cloudflared-windows-amd64.exe'); writeFileSync(downloaded, bytes);
    assert.equal((await inspectCloudflaredWindows(downloaded, trusted)).version, trusted.version);
    await assert.rejects(inspectCloudflaredWindows(downloaded), /does not match/);
    assert.equal(CLOUDFLARED_WINDOWS_AMD64.sha256.length, 64);
    writeFileSync(installed, 'changed');
    await assert.rejects(inspectCloudflaredWindows(installed, trusted), /does not match/);
    await assert.rejects(inspectCloudflaredWindows(join(directory, 'other.exe'), trusted), /Invalid connector/);
    await assert.rejects(inspectCloudflaredWindows('cloudflared.exe', trusted), /Invalid connector/);
    await assert.rejects(inspectCloudflaredWindows(installed, { ...trusted, sha256: 'bad' }), /Invalid connector/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('offline inspection rejects a symbolic-link executable when the platform permits creating one', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-connector-link-'));
  try {
    const target = join(directory, 'actual.exe'), link = join(directory, 'cloudflared.exe');
    writeFileSync(target, 'target');
    try { symlinkSync(target, link, 'file'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Symlink creation is unavailable.'); return; } throw error; }
    const trusted = { version: '2026.10.7', sha256: createHash('sha256').update('target').digest('hex') };
    await assert.rejects(inspectCloudflaredWindows(link, trusted), /regular file/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
