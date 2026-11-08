/** Offline main-process staging; it does not download, install or execute a connector. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { CLOUDFLARED_WINDOWS_AMD64, inspectCloudflaredWindows, type TrustedCloudflaredRelease } from './cloudflared-integrity';

const execFileAsync = promisify(execFile);
const MAX_BYTES = 256 * 1024 * 1024;
async function runAclCheck(script: string, directory: string): Promise<void> {
  const root = process.env.SystemRoot || process.env.WINDIR;
  if (!root || !isAbsolute(root)) throw new Error('Windows access controls are unavailable.');
  const exe = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try { await execFileAsync(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 15000, maxBuffer: 16384, env: { ...process.env, TPV_CONNECTOR_STAGE_DIRECTORY: directory }
  }); } catch { throw new Error('Could not verify connector access controls.'); }
}

/** Creates a new ACL with only the current Windows user and Local System. Never interpolate a path into code. */
async function restrictDirectory(directory: string): Promise<void> {
  if (process.platform !== 'win32') { await chmod(directory, 0o700); return; }
  const script = `$ErrorActionPreference = 'Stop'
$path = [Environment]::GetEnvironmentVariable('TPV_CONNECTOR_STAGE_DIRECTORY')
$item = Get-Item -LiteralPath $path -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid directory' }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($user)
foreach ($sid in @($user, $system)) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
}
$item.SetAccessControl($acl)
$check = $item.GetAccessControl()
$rules = @($check.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
$expected = @($user.Value, $system.Value) | Select-Object -Unique
if (-not $check.AreAccessRulesProtected -or $rules.Count -ne $expected.Count -or $check.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value) { throw 'Unexpected ACL' }
foreach ($rule in $rules) {
  if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or ($rule.IdentityReference.Value -ne $user.Value -and $rule.IdentityReference.Value -ne $system.Value) -or ($rule.InheritanceFlags -band $inherit) -ne $inherit -or ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Unexpected ACL' }
}`;
  await runAclCheck(script, directory);
}

async function verifyFileAccess(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    if ((await lstat(path)).mode & 0o077) throw new Error('Connector file permissions are not private.');
    return;
  }
  await runAclCheck(`$ErrorActionPreference='Stop'
$item=Get-Item -LiteralPath ([Environment]::GetEnvironmentVariable('TPV_CONNECTOR_STAGE_DIRECTORY')) -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid file' }
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl=$item.GetAccessControl()
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if ($rules.Count -eq 0 -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user) { throw 'Invalid ACL owner' }
foreach ($rule in $rules) { if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or ($rule.IdentityReference.Value -ne $user -and $rule.IdentityReference.Value -ne 'S-1-5-18')) { throw 'Unexpected account' } }`, path);
}

/** The existing parent must already exclude other principals before a child is created. */
async function verifyStagingRoot(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    const info = await lstat(path);
    if ((info.mode & 0o077) || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Connector staging root is not private.');
    return;
  }
  await runAclCheck(`$ErrorActionPreference='Stop'
$item=Get-Item -LiteralPath ([Environment]::GetEnvironmentVariable('TPV_CONNECTOR_STAGE_DIRECTORY')) -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid directory' }
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl=$item.GetAccessControl()
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if (-not $acl.AreAccessRulesProtected -or $rules.Count -eq 0 -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user) { throw 'Unprotected root' }
foreach ($rule in $rules) { if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or ($rule.IdentityReference.Value -ne $user -and $rule.IdentityReference.Value -ne 'S-1-5-18')) { throw 'Unexpected account' } }`, path);
}

export type StagedConnector = {
  version: string;
  /** Trusted main process only. Verify immediately before spawning; this still cannot prevent a same-user race. */
  verifyForLaunch(): Promise<string>;
  cleanup(): Promise<void>;
};
/** Main-process-only recovery for a staged directory that could not be removed. */
export class ConnectorStagingCleanupError extends Error {
  constructor(readonly retryCleanup: () => Promise<void>) { super('Connector staging cleanup is incomplete.'); }
}

/** release is trusted app-owned data or a test fixture, never renderer-supplied input. */
export async function stageVerifiedConnector(selected: string, stagingRoot: string,
  release: TrustedCloudflaredRelease = CLOUDFLARED_WINDOWS_AMD64): Promise<StagedConnector> {
  if (!isAbsolute(stagingRoot)) throw new Error('Connector staging root must be an absolute directory.');
  // The same digest is checked both during selection and on the copied bytes.
  await inspectCloudflaredWindows(selected, release);
  const originalRoot = await lstat(stagingRoot);
  if (!originalRoot.isDirectory() || originalRoot.isSymbolicLink()) throw new Error('Connector staging root is unavailable.');
  const root = await realpath(stagingRoot), rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || originalRoot.dev !== rootInfo.dev || originalRoot.ino !== rootInfo.ino) throw new Error('Connector staging root is unavailable.');
  const verifyRootIdentity = async () => {
    const current = await lstat(stagingRoot), resolved = await realpath(stagingRoot), canonical = await lstat(root);
    if (!current.isDirectory() || current.isSymbolicLink() || !canonical.isDirectory() || canonical.isSymbolicLink() || resolved !== root ||
        current.dev !== rootInfo.dev || current.ino !== rootInfo.ino || canonical.dev !== rootInfo.dev || canonical.ino !== rootInfo.ino)
      throw new Error('Connector staging root changed.');
  };
  await verifyStagingRoot(root);
  await verifyRootIdentity();
  const directory = await mkdtemp(join(root, 'tpv-connector-'));
  let identity: Awaited<ReturnType<typeof lstat>> | undefined;
  const same = (a: Awaited<ReturnType<typeof lstat>>, b: Awaited<ReturnType<typeof lstat>>) => a.dev === b.dev && a.ino === b.ino;
  const verifyDirectory = async () => {
    await verifyRootIdentity();
    const current = await lstat(directory), actual = await realpath(directory);
    if (!identity || !current.isDirectory() || current.isSymbolicLink() || !same(identity, current) || dirname(actual) !== root)
      throw new Error('Connector staging directory changed.');
  };
  const cleanup = async () => {
    await verifyRootIdentity();
    try { await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await verifyDirectory();
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  try {
    identity = await lstat(directory);
    await verifyDirectory();
    await restrictDirectory(directory);
    await verifyDirectory();
    const target = join(directory, 'cloudflared.exe');
    const input = await open(selected, 'r');
    try {
      const opened = await input.stat();
      if (!opened.isFile() || opened.size < 1 || opened.size > MAX_BYTES) throw new Error('Connector source is unavailable.');
      const output = await open(target, 'wx', 0o600);
      try {
        const hash = createHash('sha256'); let total = 0;
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        for (;;) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          total += bytesRead;
          if (total > MAX_BYTES) throw new Error('Connector source is too large.');
          hash.update(buffer.subarray(0, bytesRead));
          let offset = 0;
          while (offset < bytesRead) { const result = await output.write(buffer, offset, bytesRead - offset); if (!result.bytesWritten) throw new Error('Connector copy failed.'); offset += result.bytesWritten; }
        }
        if (!total || !timingSafeEqual(hash.digest(), Buffer.from(release.sha256, 'hex'))) throw new Error('Connector does not match the trusted release.');
        await output.sync();
      } finally { await output.close(); }
    } finally { await input.close(); }
    await verifyDirectory();
    await verifyFileAccess(target);
    await inspectCloudflaredWindows(target, release);
    return { version: release.version,
      async verifyForLaunch() { await verifyRootIdentity(); await verifyStagingRoot(root); await verifyDirectory(); await restrictDirectory(directory); await verifyFileAccess(target); await inspectCloudflaredWindows(target, release); await verifyDirectory(); return target; },
      cleanup };
  } catch (error) {
    try { await cleanup(); } catch { throw new ConnectorStagingCleanupError(cleanup); }
    throw error;
  }
}

/** The callback must settle only after the child has exited. No process is started by this helper. */
export async function withStagedConnector<T>(selected: string, stagingRoot: string, runUntilExit: (path: string) => Promise<T>,
  release: TrustedCloudflaredRelease = CLOUDFLARED_WINDOWS_AMD64): Promise<T> {
  const staged = await stageVerifiedConnector(selected, stagingRoot, release);
  try { return await runUntilExit(await staged.verifyForLaunch()); }
  finally { try { await staged.cleanup(); } catch { throw new ConnectorStagingCleanupError(staged.cleanup); } }
}
