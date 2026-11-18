import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFile, lstat, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANNING_NAMES, platformNames, releaseVersion, sha256, versionChanged } from './release-artifacts.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sshHost = '45.79.137.117';
const sshUser = `tpv-booth-release@${sshHost}`;
const publicBase = 'https://release.thepropervolume.com';
const windows = process.platform === 'win32';
const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
const git = (...args) => execFileSync('git', args, { ...quiet, cwd: repo }).trim();

async function isHosted(version) {
  const url = new URL(`${publicBase}/v${version}/release-manifest.json`);
  // The manifest body and download files can require sign-in. The server
  // verifies completeness and commit identity before exposing this HEAD route.
  const response = await fetch(url, { method: 'HEAD', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return false;
  assert.equal(response.status, 200, `Could not check the hosted release (HTTP ${response.status}).`);
  return true;
}

async function writePlan({ version, commit }) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert.equal(process.env.GITHUB_REF, `refs/heads/${event.repository.default_branch}`);
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  assert.ok(manual || process.env.GITHUB_EVENT_NAME === 'push');
  let previous = null;
  if (!manual && event.before && !/^0{40}$/.test(event.before)) {
    assert.match(event.before, /^[a-f0-9]{40}$/);
    previous = JSON.parse(git('show', `${event.before}:package.json`)).version;
  }
  const unchanged = !manual && !versionChanged(previous, version);
  const published = !unchanged && await isHosted(version);
  const publish = !unchanged && !published;
  await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\nversion=${version}\ncommit=${commit}\n`);
  console.log(publish ? `Prepare release ${version} from ${commit}.` : unchanged ? 'Version unchanged.' : `Version ${version} is already hosted.`);
}

function processExit(child, name) {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', (code, signal) => {
      if (code === 0) resolveExit();
      else rejectExit(new Error(`${name} failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

async function sendSsh(command, key, archive) {
  assert.ok(key?.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n') && key.endsWith('\n-----END OPENSSH PRIVATE KEY-----'), 'Set the BOOTH_RELEASE_SSH_KEY secret to the dedicated release key.');
  const knownHost = process.env.BOOTH_RELEASE_KNOWN_HOST?.trim();
  assert.ok(knownHost && /^45\.79\.137\.117 ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(knownHost), 'Set BOOTH_RELEASE_KNOWN_HOST to the pinned Linode host key.');

  const privateDir = await mkdtemp(join(tmpdir(), 'booth-release-'));
  const identity = join(privateDir, 'identity'), knownHosts = join(privateDir, 'known_hosts'), config = join(privateDir, 'config');
  try {
    // Windows OpenSSH checks the identity ACL. Set it before writing any secret.
    if (windows) {
      const sid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], quiet).trim();
      assert.match(sid, /^S-1-(?:\d+-)+\d+$/);
      execFileSync('icacls.exe', [privateDir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], quiet);
    }
    await writeFile(identity, `${key}\n`, { mode: 0o600, flag: 'wx' });
    await writeFile(knownHosts, `${knownHost}\n`, { mode: 0o600, flag: 'wx' });
    await writeFile(config, '', { mode: 0o600, flag: 'wx' });
    const ssh = windows ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : 'ssh';
    const pinnedHosts = windows ? knownHosts.replaceAll('\\', '/') : knownHosts;
    const remote = spawn(ssh, ['-F', config, '-i', identity, '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
      '-o', 'StrictHostKeyChecking=yes', '-o', 'GlobalKnownHostsFile=none', '-o', `UserKnownHostsFile="${pinnedHosts}"`, '-o', 'HostKeyAlgorithms=ssh-ed25519',
      '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', sshUser, command.join(' ')],
    { stdio: [archive ? 'pipe' : 'ignore', 'inherit', 'inherit'], windowsHide: true });
    const jobs = [processExit(remote, 'Release SSH command')];
    let tar;
    if (archive) {
      tar = spawn('tar', ['--format=ustar', '-cf', '-', '-C', archive.directory, ...archive.names], {
        stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true, env: { ...process.env, COPYFILE_DISABLE: '1' }
      });
      jobs.push(processExit(tar, 'Release archive creation'));
      remote.stdin.on('error', error => {
        if (error.code !== 'EPIPE') remote.kill();
        tar.kill();
      });
      tar.stdout.pipe(remote.stdin);
    }
    try {
      await Promise.all(jobs);
    } catch (error) {
      remote.kill();
      tar?.kill();
      await Promise.allSettled(jobs);
      throw error;
    }
  } finally {
    await Promise.all([identity, knownHosts, config].map(path => rm(path, { force: true })));
    await rmdir(privateDir);
  }
}

async function main() {
  const mode = process.argv[2];
  const key = process.env.BOOTH_RELEASE_SSH_KEY?.replace(/\r\n/g, '\n').trim();
  delete process.env.BOOTH_RELEASE_SSH_KEY;
  const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(repo, 'package-lock.json'), 'utf8'));
  const version = releaseVersion(metadata.version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  const commit = git('rev-parse', 'HEAD');
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(commit, process.env.GITHUB_SHA);
  if (mode === 'plan') return writePlan({ version, commit });

  const runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT;
  assert.match(runId ?? '', /^[1-9]\d{0,19}$/);
  assert.match(attempt ?? '', /^[1-9]\d{0,9}$/);
  if (mode === 'upload') {
    const platform = process.argv[3];
    const names = platform === 'planning' ? PLANNING_NAMES : platformNames(version, platform);
    const directory = join(repo, 'release', 'ci-assets', platform);
    assert.deepEqual((await readdir(directory)).sort(), [...names].sort(), 'Only verified release outputs can be uploaded.');
    for (const name of names) {
      const status = await lstat(join(directory, name));
      assert.ok(status.isFile() && status.size > 0 && status.size < 2 * 1024 ** 3, `Invalid release file ${name}.`);
    }
    await sendSsh(['upload', version, commit, runId, attempt, platform], key, { directory, names });
    await appendFile(process.env.GITHUB_OUTPUT, `attempt=${attempt}\n`);
    return;
  }

  assert.equal(mode, 'publish', 'Use plan, upload <platform>, or publish.');
  for (const name of ['WIN_STAGE_ATTEMPT', 'LINUX_STAGE_ATTEMPT', 'MAC_STAGE_ATTEMPT', 'PLANNING_STAGE_ATTEMPT']) {
    assert.equal(process.env[name], attempt, 'All four upload jobs must use this run attempt. Select Re-run all jobs.');
  }
  const sourceSha256 = await sha256(join(repo, 'docs', 'product-specification.md'));
  await sendSsh(['publish', version, commit, runId, attempt, sourceSha256], key);
  assert.ok(await isHosted(version), 'The published release manifest is unavailable over HTTPS.');
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `[Karaoke Booth ${version} downloads](${publicBase}/)\n`);
  console.log(`Verified release ${version} at ${publicBase}/`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
