import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ConnectorStagingCleanupError, stageVerifiedConnector, withStagedConnector } from '../../src/main/connector-staging';

const bytes = Buffer.from('synthetic test bytes; never execute');
const release = { version: '2026.10.7', sha256: createHash('sha256').update(bytes).digest('hex') };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-stage-test-'));
  const root = join(directory, 'private folder'); mkdirSync(root);
  if (process.platform === 'win32') {
    const script = `$ErrorActionPreference='Stop'
$item=Get-Item -LiteralPath ([Environment]::GetEnvironmentVariable('TPV_TEST_ROOT'))
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User
$system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$inherit=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($user)
foreach ($sid in @($user,$system)) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)) }
$item.SetAccessControl($acl)`;
    const powershell = join(process.env.SystemRoot || process.env.WINDIR!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, env: { ...process.env, TPV_TEST_ROOT: root }, stdio: 'pipe' });
  } else chmodSync(root, 0o700);
  const source = join(directory, 'cloudflared.exe'); writeFileSync(source, bytes);
  return { directory, root, source };
}

test('staged copy matches trusted bytes, is independent of the source and detects later tampering', async () => {
  const f = fixture();
  try {
    const stage = await stageVerifiedConnector(f.source, f.root, release);
    assert.equal(stage.version, release.version);
    const path = await stage.verifyForLaunch();
    assert.deepEqual(readFileSync(path), bytes);
    writeFileSync(f.source, 'source changed');
    assert.equal(await stage.verifyForLaunch(), path);
    writeFileSync(path, 'tampered');
    await assert.rejects(stage.verifyForLaunch(), /does not match/);
    await stage.cleanup(); await stage.cleanup();
    assert.deepEqual(readdirSync(f.root), []);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('wrapper removes only its staged directory after success or failure', async () => {
  const f = fixture();
  try {
    assert.equal(await withStagedConnector(f.source, f.root, async path => { assert.deepEqual(readFileSync(path), bytes); return 'exited'; }, release), 'exited');
    assert.deepEqual(readdirSync(f.root), []);
    await assert.rejects(withStagedConnector(f.source, f.root, async () => { throw new Error('child failed'); }, release), /child failed/);
    assert.deepEqual(readdirSync(f.root), []);
    assert.deepEqual(readFileSync(f.source), bytes);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('Windows staged file inherits no access for other accounts', async t => {
  if (process.platform !== 'win32') { t.skip('Windows ACLs are not available on this platform.'); return; }
  const f = fixture();
  try {
    const stage = await stageVerifiedConnector(f.source, f.root, release), path = await stage.verifyForLaunch();
    const script = `$ErrorActionPreference='Stop'
$path=[Environment]::GetEnvironmentVariable('TPV_TEST_STAGE_FILE')
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rules=@((Get-Item -LiteralPath $path).GetAccessControl().GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if ($rules.Count -eq 0) { throw 'Missing ACL' }
foreach ($rule in $rules) { if ($rule.IdentityReference.Value -ne $user -and $rule.IdentityReference.Value -ne 'S-1-5-18') { throw 'Unexpected account' } }
`;
    const powershell = join(process.env.SystemRoot || process.env.WINDIR!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, env: { ...process.env, TPV_TEST_STAGE_FILE: path }, stdio: 'pipe' });
    await stage.cleanup();
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('a wrong pinned digest creates no staged directory', async () => {
  const f = fixture();
  try { await assert.rejects(stageVerifiedConnector(f.source, f.root, { ...release, sha256: '0'.repeat(64) }), /does not match/); assert.deepEqual(readdirSync(f.root), []); }
  finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('cleanup refuses a substituted staging directory', async t => {
  const f = fixture();
  try {
    const stage = await stageVerifiedConnector(f.source, f.root, release), path = await stage.verifyForLaunch();
    const stagedDirectory = dirname(path), moved = `${stagedDirectory}-moved`, unrelated = join(f.directory, 'unrelated');
    mkdirSync(unrelated); writeFileSync(join(unrelated, 'keep.txt'), 'keep');
    renameSync(stagedDirectory, moved);
    try { symlinkSync(unrelated, stagedDirectory, 'junction'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Junctions are unavailable.'); return; } throw error; }
    await assert.rejects(stage.cleanup(), /changed/);
    assert.equal(readFileSync(join(unrelated, 'keep.txt'), 'utf8'), 'keep');
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('a substituted directory produces a retryable cleanup handle', async t => {
  const f = fixture(); let stagedDirectory = '', moved = '';
  try {
    const unrelated = join(f.directory, 'unrelated'); mkdirSync(unrelated);
    let recovery: ConnectorStagingCleanupError | undefined;
    try {
      await withStagedConnector(f.source, f.root, async path => {
        stagedDirectory = dirname(path); moved = `${stagedDirectory}-moved`; renameSync(stagedDirectory, moved);
        try { symlinkSync(unrelated, stagedDirectory, 'junction'); }
        catch (error) { renameSync(moved, stagedDirectory); throw error; }
      }, release);
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Junctions are unavailable.'); return; }
      assert.ok(error instanceof ConnectorStagingCleanupError); recovery = error;
    }
    assert.ok(recovery); unlinkSync(stagedDirectory); renameSync(moved, stagedDirectory);
    await recovery.retryCleanup(); assert.deepEqual(readdirSync(f.root), []);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('replacing the staging root blocks launch and cleanup until the original is restored', async () => {
  const f = fixture();
  try {
    const stage = await stageVerifiedConnector(f.source, f.root, release);
    const oldRoot = `${f.root}-moved`;
    renameSync(f.root, oldRoot); mkdirSync(f.root);
    await assert.rejects(stage.verifyForLaunch(), /root changed/);
    await assert.rejects(stage.cleanup(), /root changed/);
    rmSync(f.root, { recursive: true, force: true }); renameSync(oldRoot, f.root);
    await stage.cleanup(); assert.deepEqual(readdirSync(f.root), []);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('permissive and linked roots are rejected before staging', async t => {
  const f = fixture();
  try {
    if (process.platform === 'win32') {
      execFileSync('icacls.exe', [f.root, '/grant', '*S-1-1-0:(OI)(CI)F'], { windowsHide: true, stdio: 'pipe' });
    } else chmodSync(f.root, 0o777);
    await assert.rejects(stageVerifiedConnector(f.source, f.root, release), /access controls|not private/);
    assert.deepEqual(readdirSync(f.root), []);
    const linked = join(f.directory, 'root-link');
    try { symlinkSync(f.root, linked, 'junction'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.skip('Junctions are unavailable.'); return; } throw error; }
    await assert.rejects(stageVerifiedConnector(f.source, linked, release), /root is unavailable/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
