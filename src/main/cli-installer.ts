import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const START = '# >>> The Proper Volume Karaoke CLI >>>';
const END = '# <<< The Proper Volume Karaoke CLI <<<';
const BLOCK = `${START}\ncase ":$PATH:" in\n  *":$HOME/.local/bin:"*) ;;\n  *) PATH="$HOME/.local/bin\${PATH:+:$PATH}"; export PATH ;;\nesac\n${END}\n`;
const MARKER = '# Managed by The Proper Volume Karaoke Booth CLI installer';
const MAX_PROFILE = 2 * 1024 * 1024;

export type CliInstallResult = { ok: boolean; command?: string; message: string; files?: string[] };
export type CliInstallOptions = { platform: NodeJS.Platform; packaged: boolean; executable: string; resources: string;
  home: string; shell: string; appImage?: string; environment?: NodeJS.ProcessEnv };
type Verified = { target: string; appDirectory: string };

function validPath(value: string): boolean { return isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value); }
function shellQuote(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }

/** Test the bundled Electron+CLI pair before changing any user files or PATH. */
async function verify(options: CliInstallOptions): Promise<Verified> {
  if (!options.packaged) throw new Error('Install a packaged version of Karaoke Booth before installing its CLI.');
  if (![options.executable, options.resources, options.home].every(validPath)) throw new Error('The app installation path is invalid.');
  if (options.platform !== 'win32' && options.platform !== 'darwin' && options.platform !== 'linux') throw new Error('CLI installation is not supported on this platform.');
  if (options.platform === 'linux' && (options.appImage || /(?:^|\/)\.mount_[^/]+\//.test(options.executable)))
    throw new Error('Automatic CLI installation is not available for AppImage yet. Use the CLI included with a Debian installation.');
  const appDirectory = dirname(options.executable);
  const entry = join(options.resources, 'control', 'cli.cjs');
  const target = options.platform === 'darwin' ? join(options.resources, 'control', 'tpv-karaoke') : join(appDirectory, options.platform === 'win32' ? 'tpv-karaoke.cmd' : 'tpv-karaoke');
  for (const path of [options.executable, entry, target]) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('The bundled CLI is missing or is not a regular file.');
  }
  const { stdout } = await runFile(options.executable, [entry, '--help'], { timeout: 15000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ...options.environment, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
  if (!/local control CLI/i.test(stdout)) throw new Error('The bundled CLI did not pass its verification check.');
  return { target, appDirectory };
}

async function checkedDirectory(path: string, create: boolean): Promise<void> {
  try { if (create) await mkdir(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o022) !== 0)))
    throw new Error(`Refusing unsafe or shared directory: ${path}`);
  await access(path, fsConstants.W_OK);
}

type ExistingFile = { bytes: Buffer; mode: number; ino: number; mtimeMs: number } | null;
async function inspectFile(path: string): Promise<ExistingFile> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o022) !== 0)) || info.size > MAX_PROFILE)
      throw new Error(`Refusing unsafe file: ${path}`);
    return { bytes: await readFile(path), mode: info.mode & 0o7777, ino: info.ino, mtimeMs: info.mtimeMs };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function atomicWrite(path: string, bytes: Buffer, previous: ExistingFile, mode: number): Promise<void> {
  const temporary = join(dirname(path), `.tpv-cli-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', mode);
  try {
    await file.writeFile(bytes); await file.chmod(mode); await file.sync(); await file.close();
    const current = await inspectFile(path);
    if (previous ? !current || current.ino !== previous.ino || current.mtimeMs !== previous.mtimeMs || !current.bytes.equals(previous.bytes) : !!current)
      throw new Error(`The file changed during installation: ${path}`);
    await rename(temporary, path);
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}

/** Add a clearly delimited profile block and a launcher under the current user. */
export async function installPosixCli(home: string, shell: string, target: string, pathValue: string, zDotDir = ''): Promise<CliInstallResult> {
  if (process.platform !== 'win32' && home.includes(':')) throw new Error('Your home directory cannot be safely added to PATH because it contains a colon.');
  const local = join(home, '.local'), bin = join(local, 'bin');
  await checkedDirectory(home, false); await checkedDirectory(local, true); await checkedDirectory(bin, true);
  const launcher = join(bin, 'tpv-karaoke'), oldLauncher = await inspectFile(launcher);
  if (oldLauncher && !oldLauncher.bytes.toString('utf8').startsWith(`#!/bin/sh\n${MARKER}\n`))
    throw new Error(`A different command already exists at ${launcher}. Rename it before installing.`);
  const program = Buffer.from(`#!/bin/sh\n${MARKER}\nexec ${shellQuote(target)} "$@"\n`);
  const selectedShell = basename(shell), supported = selectedShell === 'bash' || selectedShell === 'zsh' && (!zDotDir || zDotDir === home);
  const profiles: string[] = [];
  if (supported && selectedShell === 'bash') {
    profiles.push(join(home, '.bashrc'));
    let login = join(home, '.profile');
    // Bash uses the first of these login files, not all three.
    for (const name of ['.bash_profile', '.bash_login', '.profile']) {
      const path = join(home, name);
      if (await inspectFile(path)) { login = path; break; }
    }
    profiles.push(login);
  } else if (supported) profiles.push(join(home, '.zshrc'), join(home, '.zprofile'));
  const edits: { path: string; previous: ExistingFile; content: Buffer; mode: number }[] = [];
  for (const profile of profiles) {
    const oldProfile = await inspectFile(profile);
    const original = oldProfile?.bytes.toString('utf8') ?? '';
    if (Buffer.from(original).compare(oldProfile?.bytes ?? Buffer.alloc(0)) !== 0 || original.includes('\0')) throw new Error(`The shell profile is not valid text: ${profile}`);
    const start = original.indexOf(START), end = original.indexOf(END);
    if ((start < 0) !== (end < 0) || (start >= 0 && (end < start || original.indexOf(START, start + 1) >= 0 || original.indexOf(END, end + 1) >= 0)))
      throw new Error(`The existing managed CLI block is malformed: ${profile}`);
    if (start >= 0 && !original.slice(start).startsWith(BLOCK)) throw new Error(`The existing CLI block was changed. Review ${profile} before installing.`);
    if (start < 0) edits.push({ path: profile, previous: oldProfile, mode: oldProfile?.mode ?? 0o600,
      content: Buffer.from(original + (original && !original.endsWith('\n') ? '\n' : '') + BLOCK) });
  }
  const written: { path: string; previous: ExistingFile; content: Buffer }[] = [];
  try {
    if (!oldLauncher?.bytes.equals(program) || (oldLauncher.mode & 0o100) === 0) {
      await atomicWrite(launcher, program, oldLauncher, oldLauncher ? oldLauncher.mode | 0o100 : 0o700);
      written.push({ path: launcher, previous: oldLauncher, content: program });
    }
    for (const edit of edits) { await atomicWrite(edit.path, edit.content, edit.previous, edit.mode); written.push(edit); }
  } catch (error) {
    for (const item of written.reverse()) {
      const current = await inspectFile(item.path);
      if (current?.bytes.equals(item.content)) {
        if (item.previous) await atomicWrite(item.path, item.previous.bytes, current, item.previous.mode);
        else await unlink(item.path);
      }
    }
    throw error;
  }
  const files = [launcher, ...edits.map(edit => edit.path)];
  if (!supported && !pathValue.split(':').includes(bin)) return { ok: true, command: launcher, files,
    message: `CLI installed. Add ${bin} to your shell PATH, then open a new terminal. Remove ${launcher} to uninstall it.` };
  return { ok: true, command: 'tpv-karaoke', files,
    message: `CLI installed. Open a new terminal and run tpv-karaoke --help. To uninstall, remove ${launcher}${profiles.length ? ` and the managed TPV blocks in ${profiles.join(' and ')}` : ''}.` };
}

// Windows values are passed through the environment; neither the installation
// path nor the user's existing PATH is interpolated into a shell command.
const WINDOWS_PATH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:TPV_CLI_INSTALL_DIRECTORY
if (!$target -or $target -match '[;\x00-\x1f\x7f%"\r\n]') { throw 'Invalid installation directory.' }
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if (!$key) { throw 'User environment is unavailable.' }
try {
  $value = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
  if (($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) -or $value -isnot [string]) { throw 'Unsupported user PATH format.' }
  $found = $false
  foreach ($item in $value.Split(';')) {
    $expanded = [Environment]::ExpandEnvironmentVariables($item.Trim().Trim('"')).TrimEnd('\')
    if ([String]::Equals($expanded, $target.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { $found = $true }
  }
  if (!$found) {
    $updated = if ($value) { $value.TrimEnd(';') + ';' + $target } else { $target }
    if ($updated.Length -gt 32000) { throw 'The user PATH is too long.' }
    $key.SetValue('Path', $updated, $kind)
    # Let Explorer and other applications refresh their user environment. A
    # notification failure does not undo an already-persisted registry update.
    try {
      Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TpvEnvironmentBroadcast { [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint flags, uint timeout, out UIntPtr result); }'
      $ignored = [UIntPtr]::Zero
      [void][TpvEnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$ignored)
    } catch { }
  }
  Write-Output $(if ($found) { 'already-present' } else { 'added' })
} finally { $key.Close() }
`;

type PathExecutor = (file: string, args: string[], options: { timeout: number; maxBuffer: number; windowsHide: boolean; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string }>;
export async function installWindowsCliPath(appDirectory: string, environment: NodeJS.ProcessEnv, execute: PathExecutor = runFile): Promise<CliInstallResult> {
    if (!validPath(appDirectory) || /[;\x00-\x1f\x7f%"]/.test(appDirectory)) throw new Error('The application directory cannot safely be added to PATH.');
    const systemRoot = environment.SystemRoot;
    if (!systemRoot || !validPath(systemRoot)) throw new Error('Windows system directory is unavailable.');
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_PATH_SCRIPT, 'utf16le').toString('base64')], {
      timeout: 15000, maxBuffer: 65536, windowsHide: true,
      env: { ...process.env, ...environment, TPV_CLI_INSTALL_DIRECTORY: appDirectory },
    });
    if (!/^(added|already-present)\s*$/.test(stdout)) throw new Error('The user PATH could not be verified.');
    const change = stdout.trim() === 'added' ? `To undo, remove ${appDirectory} from your user PATH in Windows Environment Variables.` : 'Your user PATH already contained the application directory, so no PATH change was needed.';
    return { ok: true, command: 'tpv-karaoke', files: [], message: `CLI installed. Open a new terminal (or sign out and back in if needed) and run tpv-karaoke --help. ${change}` };
}

export async function installControlCli(options: CliInstallOptions): Promise<CliInstallResult> {
  const { target, appDirectory } = await verify(options);
  if (options.platform === 'win32') return installWindowsCliPath(appDirectory, options.environment ?? process.env);
  return installPosixCli(options.home, options.shell, target, (options.environment ?? process.env).PATH ?? '', (options.environment ?? process.env).ZDOTDIR ?? '');
}
