import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, open, realpath } from 'node:fs/promises';
import { constants, closeSync, fstatSync, linkSync, lstatSync, openSync, readSync, realpathSync, rmdirSync, unlinkSync, type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONTROL_DISCOVERY_NAME, ControlError, type ControlDiscovery } from './protocol';

export type DiscoveryAccess = {protect(path:string,directory:boolean):Promise<void>;verify(path:string):Promise<void>};
const exec=promisify(execFile);
/** Windows uses literal environment-supplied paths; no credential is sent to a shell. */
async function windowsAccess(path:string,protect:boolean,directory=false):Promise<void>{
  const script=`$ErrorActionPreference='Stop';$p=$env:TPV_CONTROL_ACL_PATH;$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$allowed=@($sid.Value,'S-1-5-18');
${protect?`$acl=if($env:TPV_CONTROL_ACL_DIRECTORY -eq '1'){[System.Security.AccessControl.DirectorySecurity]::new()}else{[System.Security.AccessControl.FileSecurity]::new()};$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($s in $allowed){$i=[System.Security.Principal.SecurityIdentifier]::new($s);$rule=if($env:TPV_CONTROL_ACL_DIRECTORY -eq '1'){[System.Security.AccessControl.FileSystemAccessRule]::new($i,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{[System.Security.AccessControl.FileSystemAccessRule]::new($i,'FullControl','Allow')};$acl.AddAccessRule($rule)};Set-Acl -LiteralPath $p -AclObject $acl;`:''}
$check=Get-Acl -LiteralPath $p;if($check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or -not $check.AreAccessRulesProtected){exit 2};foreach($rule in $check.Access){if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed){exit 3}};'OK'`;
  try{
    const native=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0');
    // A launching PowerShell7 session may export incompatible module paths.
    // Use the native Windows executable and only its matching built-in modules.
    const environment=Object.fromEntries(Object.entries(process.env).filter(([name])=>name.toLowerCase()!=='psmodulepath'));
    const result=await exec(join(native,'powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000,maxBuffer:8192,
      env:{...environment,PSModulePath:join(native,'Modules'),TPV_CONTROL_ACL_PATH:path,TPV_CONTROL_ACL_DIRECTORY:directory?'1':'0'}});
    if(result.stdout.trim()!=='OK')throw Error();
  }catch{throw new ControlError('unsafe-discovery','Owner-only control discovery permissions could not be established or verified.');}
}
export const ownerOnlyDiscoveryAccess:DiscoveryAccess={
  async protect(path,directory){if(process.platform==='win32')return windowsAccess(path,true,directory);await chmod(path,directory?0o700:0o600);},
  async verify(path){
    if(process.platform==='win32')return windowsAccess(path,false);
    const info=await lstat(path);
    if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||typeof process.getuid!=='function'||info.uid!==process.getuid())
      throw new ControlError('unsafe-discovery','Control discovery must belong to this user and have owner-only permissions.');
  },
};
export const profileIdentity=(canonicalProfile:string)=>createHash('sha256').update(canonicalProfile).digest('hex');
export function processIsRunning(pid:number):boolean{try{process.kill(pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code==='EPERM';}}
type Stamp = Pick<Stats, 'dev' | 'ino' | 'size' | 'mtimeMs' | 'ctimeMs'>;
type Profile = { path: string; identity: Stats };
const sameNode = (a: Pick<Stamp, 'dev' | 'ino'>, b: Pick<Stamp, 'dev' | 'ino'>) => a.dev === b.dev && a.ino === b.ino;
const sameContent = (a: Stamp, b: Stamp) => sameNode(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs;
const same = (a: Stamp, b: Stamp) => sameContent(a, b) && a.ctimeMs === b.ctimeMs;
const unsafe = () => new ControlError('unsafe-discovery', 'Control discovery changed or no longer belongs to its canonical profile.');
function parse(value: unknown): ControlDiscovery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'format,host,instanceId,pid,port,profileDirectory,profileId,token' || v.format !== 1 || v.host !== '127.0.0.1' || !Number.isInteger(v.port) || (v.port as number) < 1 || (v.port as number) > 65535 ||
    !Number.isInteger(v.pid) || (v.pid as number) < 1 || typeof v.instanceId !== 'string' || !/^[a-f0-9]{32}$/.test(v.instanceId) || typeof v.profileId !== 'string' || !/^[a-f0-9]{64}$/.test(v.profileId) ||
    typeof v.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v.token) || typeof v.profileDirectory !== 'string' || !isAbsolute(v.profileDirectory) || v.profileDirectory.length > 4096 || /[\x00-\x1f\x7f]/.test(v.profileDirectory)) throw Error();
  return v as ControlDiscovery;
}
function profileFence(profile: Profile): void {
  const named = lstatSync(profile.path);
  if (!named.isDirectory() || named.isSymbolicLink() || !sameNode(named, profile.identity) || realpathSync(profile.path) !== profile.path) throw unsafe();
}
function stageFence(profile: Profile, temporary: string, identity: Stats): void {
  profileFence(profile);
  const named = lstatSync(temporary), actual = realpathSync(temporary);
  if (!named.isDirectory() || named.isSymbolicLink() || !sameNode(named, identity) || actual !== temporary || dirname(actual) !== profile.path || !basename(actual).startsWith('.tpv-control-')) throw unsafe();
}
function fileFence(path: string, fd: number, expected: Stamp): Stats {
  const opened = fstatSync(fd), named = lstatSync(path);
  if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || !same(expected, opened) || !same(opened, named)) throw unsafe();
  return opened;
}
function payloadFence(fd: number, expected: Buffer): void {
  const bytes = Buffer.alloc(8193); let count = 0;
  while (count < bytes.length) { const read = readSync(fd, bytes, count, bytes.length - count, count); if (!read) break; count += read; }
  if (count !== expected.length || !bytes.subarray(0, count).equals(expected)) throw unsafe();
}
function publishedFence(profile: Profile, path: string, expected: Stamp, raw: Buffer): Stats {
  let fd: number | undefined;
  try {
    profileFence(profile);
    const named = lstatSync(path);
    if (!named.isFile() || named.isSymbolicLink() || !sameNode(named, expected) || named.size !== raw.length) throw unsafe();
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    fileFence(path, fd, named); payloadFence(fd, raw); profileFence(profile);
    return fileFence(path, fd, named);
  } finally { if (fd !== undefined) closeSync(fd); }
}
/** Small synchronous final fences avoid yielding between named checks and unlink. */
function unlinkChecked(profile: Profile, path: string, expected: Stamp, raw: Buffer): boolean {
  let fd: number | undefined;
  try {
    profileFence(profile);
    const named = lstatSync(path);
    if (!named.isFile() || named.isSymbolicLink() || !same(expected, named)) return false;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    fileFence(path, fd, expected); payloadFence(fd, raw);
    profileFence(profile); fileFence(path, fd, expected);
    unlinkSync(path); return true;
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); }
}
async function readChecked(profileDirectory: string, access: DiscoveryAccess): Promise<{value: ControlDiscovery; raw: Buffer; stamp: Stats}> {
  try {
    const profile = await realpath(profileDirectory), path = join(profile, CONTROL_DISCOVERY_NAME), before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 8192) throw Error();
    await access.verify(path);
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); let raw: Buffer, stamp: Stats;
    try {
      const start = await file.stat(); if (!same(before, start)) throw Error();
      const buffer = Buffer.alloc(8193); let count = 0;
      while (count < buffer.length) { const part = await file.read(buffer, count, buffer.length - count, null); if (!part.bytesRead) break; count += part.bytesRead; }
      const end = await file.stat(), named = await lstat(path);
      if (count !== start.size || count > 8192 || named.isSymbolicLink() || !same(start, end) || !same(start, named)) throw Error();
      await access.verify(path);
      // ACL verification is asynchronous. A replacement during it cannot be
      // authorized by the old open file's bytes or identity.
      stamp = fileFence(path, file.fd, start);
      raw = buffer.subarray(0, count);
    } finally { await file.close(); }
    const final = lstatSync(path);
    if (final.isSymbolicLink() || !same(stamp, final)) throw Error();
    const value = parse(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)));
    if (value.profileDirectory !== profile || value.profileId !== profileIdentity(profile)) throw Error();
    return {value, raw, stamp};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ControlError('not-running', 'No enabled local control API was discovered for this profile.');
    if (error instanceof ControlError) throw error;
    throw new ControlError('unsafe-discovery', 'The control discovery file is invalid, changed, or belongs to another profile.');
  }
}
export async function readControlDiscovery(profileDirectory: string, access: DiscoveryAccess = ownerOnlyDiscoveryAccess): Promise<ControlDiscovery> {
  return (await readChecked(profileDirectory, access)).value;
}

/** Atomic exclusive publication. Existing live-PID discovery is never replaced. */
export async function publishControlDiscovery(value: ControlDiscovery, access: DiscoveryAccess = ownerOnlyDiscoveryAccess): Promise<() => Promise<void>> {
  parse(value);
  const canonical = await realpath(value.profileDirectory), profile: Profile = {path:canonical, identity:await lstat(canonical)};
  const target = join(canonical, CONTROL_DISCOVERY_NAME), raw = Buffer.from(JSON.stringify(value) + '\n');
  if (canonical !== value.profileDirectory || profileIdentity(canonical) !== value.profileId || raw.length > 8192) throw unsafe();
  profileFence(profile);
  try {
    const existing = await readChecked(canonical, access);
    if (processIsRunning(existing.value.pid)) throw new ControlError('already-running', 'A live process already owns control discovery for this profile.');
    if (!unlinkChecked(profile, target, existing.stamp, existing.raw)) throw unsafe();
  } catch (error) { if (!(error instanceof ControlError && error.code === 'not-running')) throw error; }
  const temporary = await mkdtemp(join(canonical, '.tpv-control-')), identity = await lstat(temporary);
  const staged = join(temporary, CONTROL_DISCOVERY_NAME);
  let file: Awaited<ReturnType<typeof open>> | undefined, owned: Stamp | undefined, published: Stats | undefined, linked = false, failure: unknown;
  try {
    stageFence(profile, temporary, identity);
    await access.protect(temporary, true);
    stageFence(profile, temporary, identity);
    file = await open(staged, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    owned = fstatSync(file.fd);
    stageFence(profile, temporary, identity); fileFence(staged, file.fd, owned);
    await access.protect(staged, false);
    stageFence(profile, temporary, identity);
    const protectedFile = fstatSync(file.fd);
    if (!sameNode(protectedFile, owned) || protectedFile.size !== 0) throw unsafe();
    fileFence(staged, file.fd, protectedFile);
    await file.writeFile(raw); await file.sync();
    const written = fstatSync(file.fd);
    stageFence(profile, temporary, identity); fileFence(staged, file.fd, written);
    await access.verify(staged);
    stageFence(profile, temporary, identity); fileFence(staged, file.fd, written); payloadFence(file.fd, raw);
    // No asynchronous ACL/metadata gap between the final named fence and link.
    linkSync(staged, target); linked = true;
    const afterLink = fstatSync(file.fd);
    if (!sameContent(written, afterLink)) throw unsafe();
    fileFence(target, file.fd, afterLink);
  } catch (error) { failure = error; }
  finally {
    // Remove only our named staged inode, then an empty directory. Unexpected
    // entries and replaced directories/junctions are preserved, never recursed.
    try {
      stageFence(profile, temporary, identity);
      const named = lstatSync(staged);
      if (owned && named.isFile() && !named.isSymbolicLink() && sameNode(named, owned)) unlinkSync(staged);
      rmdirSync(temporary);
    } catch { /* Preserve uncertain staging for review. */ }
    if (!failure && linked && file) {
      try {
        profileFence(profile);
        const opened = fstatSync(file.fd);
        if (!owned || !sameNode(opened, owned) || opened.size !== raw.length) throw unsafe();
        fileFence(target, file.fd, opened); payloadFence(file.fd, raw);
        published = fileFence(target, file.fd, opened);
      } catch (error) { failure = error; }
    }
    if (file) try { await file.close(); } catch (error) { failure ??= error; }
  }
  if (!failure && published) {
    // Windows may commit LastWrite metadata when our writable handle closes.
    // Revalidate the exact bounded payload and inode, rather than accepting a
    // metadata-only mismatch or weakening identity checks after that await.
    try { published = publishedFence(profile, target, published, raw); }
    catch (error) { failure = error; }
  }
  if (failure || !published) {
    if (linked && owned) try { const named = lstatSync(target); if (sameNode(named, owned)) unlinkChecked(profile, target, named, raw); } catch { /* Preserve any replacement. */ }
    if ((failure as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') throw new ControlError('already-running', 'Another process published control discovery for this profile.');
    throw failure instanceof ControlError ? failure : unsafe();
  }
  const stamp = published;
  return async () => {
    try {
      profileFence(profile);
      const current = lstatSync(target); if (current.isSymbolicLink() || !sameNode(current, stamp)) return;
      const named = await readChecked(canonical, access);
      if (!same(named.stamp, stamp) || named.value.instanceId !== value.instanceId || named.value.pid !== value.pid || named.value.token !== value.token) return;
      unlinkChecked(profile, target, named.stamp, named.raw);
    } catch { /* An absent/replaced discovery file is never someone else's cleanup target. */ }
  };
}
