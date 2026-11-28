// Verify actual DMG/ZIP payloads and launch only the native build in disposable,
// muted profiles. Requires macOS tools; never installs into /Applications.
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../electron-builder.config.mjs';

if (process.platform !== 'darwin') throw new Error('macOS package verification requires a Mac.');
if (process.argv.length !== 2) throw new Error('Usage: node scripts/verify-mac-package.mjs');
const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const release = await realpath(join(repo, 'release'));
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const prefix = `Proper-Karaoke-Booth-${metadata.version}-mac`;
const receiptPath = join(release, `${prefix}-build.json`);
const buildReceipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const command = (file, args, options = {}) => execFileSync(file, args, {
  encoding: 'utf8', cwd: repo, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options,
}).trim();
const hash = async path => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
};
const plist = path => JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path]));
assert.equal(buildReceipt.version, metadata.version);
assert.equal(buildReceipt.platform, 'mac');
assert.deepEqual([...buildReceipt.architectures].sort(), ['arm64', 'x64']);
assert.equal(buildReceipt.sourceHasUncommittedChanges, false, 'Verify packages built from a clean checkout.');
assert.equal(buildReceipt.sourceRevisionChangedDuringBuild, false);
assert.equal(buildReceipt.sourceCommit, command('git', ['rev-parse', 'HEAD']));
assert.equal(buildReceipt.signed, false, 'These development builds must not claim publisher signing.');
assert.equal(buildReceipt.codeSigning, 'ad-hoc');
assert.equal(buildReceipt.notarized, false);
const artifacts = new Map();
for (const artifact of buildReceipt.artifacts) {
  assert.equal(basename(artifact.file), artifact.file, 'Receipt artifact must be a plain filename.');
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  const path = await realpath(join(release, artifact.file));
  assert.equal(dirname(path), release);
  assert.equal(await hash(path), artifact.sha256, `Artifact checksum: ${artifact.file}`);
  artifacts.set(artifact.file, artifact.sha256);
}
const temporaryRoot = await realpath(tmpdir());
const temporary = await mkdtemp(join(temporaryRoot, 'tpv-mac-verification-'));
let mounted = null;
const packages = [];
const signature = app => {
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  // codesign intentionally writes display output to stderr even on success.
  const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', app], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const detail = result.stdout + result.stderr;
  assert.match(detail, /^Signature=adhoc$/m);
  assert.doesNotMatch(detail, /^Authority=/m);
  return 'ad-hoc; deep strict verification passed; no publisher authority';
};
const onlyApp = async directory => {
  const apps = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.endsWith('.app'));
  assert.equal(apps.length, 1, 'Expected exactly one application bundle.');
  const app = await realpath(join(directory, apps[0].name));
  assert.equal(dirname(app), directory);
  return app;
};
const inspect = async (app, architecture) => {
  const contents = join(app, 'Contents');
  const information = plist(join(contents, 'Info.plist'));
  assert.equal(information.CFBundleIdentifier, config.appId);
  assert.equal(information.CFBundleShortVersionString, metadata.version);
  assert.equal(information.CFBundleExecutable, config.executableName);
  assert.equal(information.LSMinimumSystemVersion, config.mac.minimumSystemVersion);
  assert.ok(information.CFBundleIconFile && basename(information.CFBundleIconFile) === information.CFBundleIconFile);
  const iconName = information.CFBundleIconFile.endsWith('.icns') ? information.CFBundleIconFile : information.CFBundleIconFile + '.icns';
  const executable = join(contents, 'MacOS', information.CFBundleExecutable);
  const resources = join(contents, 'Resources');
  const expectedMachArch = architecture === 'x64' ? 'x86_64' : 'arm64';
  for (const binary of [executable, join(contents, 'Frameworks', 'Electron Framework.framework', 'Electron Framework')]) {
    assert.equal(command('/usr/bin/lipo', ['-archs', binary]), expectedMachArch, `Architecture: ${binary}`);
    assert.ok((await stat(binary)).mode & 0o111, 'Mach-O executable permission missing.');
  }
  const payload = {};
  const matchSource = async (target, source, label) => {
    payload[label] = await hash(target);
    assert.equal(payload[label], await hash(source), `Bundled source mismatch: ${label}`);
  };
  await matchSource(join(resources, iconName), join(repo, config.mac.icon), 'icon.icns');
  payload['app.asar'] = await hash(join(resources, 'app.asar'));
  payload.executable = await hash(executable);
  payload['control/cli.cjs'] = await hash(join(resources, 'control', 'cli.cjs'));
  assert.ok((await stat(join(resources, 'control', 'cli.cjs'))).size > 0);
  for (const resource of config.extraResources.filter(value => ['branding', 'backdrops', 'bumpers'].includes(value.to))) {
    for (const filename of resource.filter) {
      await matchSource(join(resources, resource.to, filename), join(repo, resource.from, filename), `${resource.to}/${filename}`);
    }
  }
  const wrapper = join(resources, 'control', 'karabooth-cli');
  const wrapperText = await readFile(wrapper, 'utf8');
  assert.equal(wrapperText, (await readFile(join(repo, 'assets/cli/tpv-karaoke'), 'utf8')).replace(/\r\n/g, '\n'));
  assert.ok(!wrapperText.includes('\r'));
  assert.ok((await stat(wrapper)).mode & 0o111, 'CLI wrapper must be executable.');
  payload.wrapper = await hash(wrapper);
  assert.equal(await hash(join(resources, 'control', 'tpv-karaoke')), payload.wrapper, 'Legacy in-bundle launcher no longer matches.');
  assert.equal(await hash(join(resources, 'control', 'tpv-karaoke-booth')), payload.wrapper, 'Compatibility launcher no longer matches.');
  return { executable, wrapper, payload, signature: signature(app) };
};

try {
  for (const architecture of ['x64', 'arm64']) {
    const zipName = `${prefix}-${architecture}.zip`;
    const dmgName = `${prefix}-${architecture}.dmg`;
    const pkgName = `${prefix}-${architecture}.pkg`;
    assert.ok(artifacts.has(zipName), `Missing ZIP: ${zipName}`);
    assert.ok(artifacts.has(dmgName), `Missing DMG: ${dmgName}`);
    const zip = join(release, zipName), dmg = join(release, dmgName);
    const zipEntries = command('/usr/bin/zipinfo', ['-1', zip]).split('\n');
    assert.ok(zipEntries.every(entry => !entry.startsWith('/') && !entry.split('/').includes('..')), 'Unsafe ZIP entry.');
    const extracted = join(temporary, architecture); await mkdir(extracted);
    command('/usr/bin/ditto', ['-x', '-k', '--rsrc', zip, extracted]);
    const app = await onlyApp(extracted);
    const zipInspection = await inspect(app, architecture);
    command('/usr/bin/hdiutil', ['verify', dmg], { timeout: 180_000 });
    const mountpoint = join(temporary, `mounted-${architecture}`); await mkdir(mountpoint);
    // Record the mountpoint before attaching so even a partial attach is detached.
    mounted = mountpoint;
    command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, dmg], { timeout: 180_000 });
    const diskApp = await onlyApp(mountpoint);
    const diskInspection = await inspect(diskApp, architecture);
    assert.deepEqual(diskInspection.payload, zipInspection.payload, 'DMG and ZIP app payloads must match.');
    command('/usr/bin/hdiutil', ['detach', mountpoint], { timeout: 60_000 }); mounted = null;
    const result = { architecture, zip: zipName, dmg: dmgName, signature: zipInspection.signature,
      payloadSha256: zipInspection.payload, diskImageVerified: true, matchingDmgAndZip: true,
      nativeLaunch: false, cliWithoutNode: false };
    if (artifacts.has(pkgName)) {
      const expanded = join(temporary, `pkg-${architecture}`);
      command('/usr/sbin/pkgutil', ['--expand-full', join(release, pkgName), expanded], { timeout: 180_000 });
      const payload = join(expanded, 'Payload');
      const installedApp = await onlyApp(join(payload, 'Applications'));
      const pkgInspection = await inspect(installedApp, architecture);
      assert.deepEqual(pkgInspection.payload, zipInspection.payload, 'PKG and ZIP app payloads must match.');
      const launcher = join(payload, 'usr/local/bin/karabooth-cli');
      const mode = await lstat(launcher);
      assert.ok(mode.isFile() && (mode.mode & 0o111), 'PKG must own an executable CLI on system PATH.');
      const systemLauncher = (await readFile(join(repo, 'assets/cli/mac-system-cli'), 'utf8')).replace(/\r\n/g, '\n');
      assert.equal(await readFile(launcher, 'utf8'), systemLauncher);
      assert.equal(await readFile(join(payload, 'usr/local/bin/tpv-karaoke-booth'), 'utf8'), systemLauncher);
      const preinstall = join(expanded, 'Scripts/preinstall');
      const isoVolume = join(temporary, `installation volume ${architecture}`);
      const isoLauncher = join(isoVolume, 'usr/local/bin/karabooth-cli');
      await mkdir(dirname(isoLauncher), { recursive: true });
      const checkInstall = () => spawnSync('/bin/sh', [preinstall, '', '/', isoVolume], { encoding: 'utf8', timeout: 5000 });
      assert.equal(checkInstall().status, 0, 'A new installation must pass the package preflight.');
      await writeFile(isoLauncher, 'A different CLI\n');
      assert.equal(checkInstall().status, 1, 'The package must preserve an unrelated CLI.');
      await writeFile(isoLauncher, systemLauncher);
      assert.equal(checkInstall().status, 0, 'A previous Booth PKG launcher must remain upgradeable.');
      result.pkgPayloadVerified = true;
    }
    if (architecture === process.arch) {
      const toolDirectory = join(temporary, 'cli-tools'); await mkdir(toolDirectory);
      await symlink('/usr/bin/dirname', join(toolDirectory, 'dirname'));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
      env.PATH = toolDirectory; // No Node executable; wrapper uses Electron's runtime.
      const help = command(zipInspection.wrapper, ['--help'], { cwd: temporary, env });
      assert.match(help, /Usage: karabooth-cli\b/);
      assert.match(help, /--help/); result.cliWithoutNode = true;
      for (const script of ['packaged-app-smoke.mjs', 'packaged-branding-smoke.mjs']) {
        const output = command(process.execPath, [join(repo, 'scripts', script), zipInspection.executable], { timeout: 240_000 });
        console.log(output);
      }
      result.nativeLaunch = true;
    }
    packages.push(result);
    console.log(`Verified ${architecture} DMG/ZIP${result.pkgPayloadVerified ? '/PKG' : ''}${result.nativeLaunch ? ', native UI/restart/branding and CLI' : ' (static validation only; architecture differs from runner)'}.`);
  }
  assert.ok(packages.some(result => result.nativeLaunch && result.cliWithoutNode), 'A native architecture must pass actual launch and CLI checks.');
  const verification = { version: metadata.version, platform: 'mac', createdAt: new Date().toISOString(),
    sourceCommit: buildReceipt.sourceCommit, buildReceiptSha256: await hash(receiptPath),
    operatingSystem: command('/usr/bin/sw_vers', []), kernel: command('/usr/bin/uname', ['-r']),
    runnerArchitecture: process.arch, codeSigning: 'ad-hoc', signedByPublisher: false, notarized: false,
    packages, limitations: ['No Apple Developer ID signing or notarization.',
      'Only the runner architecture was launched; other architectures received static checks.',
      'No physical display, audio device, media codec, Finder installation or Gatekeeper approval test.',
      'External yt-dlp and FFmpeg are not bundled.'] };
  await writeFile(join(release, `${prefix}-verification.json`), JSON.stringify(verification, null, 2) + '\n');
  console.log(`PASS: macOS ${metadata.version} verification receipt written.`);
} finally {
  // Never recursively remove a mountpoint or a path outside our own temp root.
  if (mounted) {
    const result = spawnSync('/usr/bin/hdiutil', ['detach', mounted], { encoding: 'utf8', timeout: 60_000 });
    // A failed attach may never have mounted anything. Preserve its original
    // error when the disk inventory confirms the mountpoint is unused.
    if (result.status !== 0 && command('/usr/bin/hdiutil', ['info']).includes(mounted))
      throw new Error(`Could not detach verification disk; retained temporary folder: ${temporary}`);
    mounted = null;
  }
  const actual = await realpath(temporary);
  if (dirname(actual) !== temporaryRoot || !actual.startsWith(temporaryRoot + sep) || !basename(actual).startsWith('tpv-mac-verification-'))
    throw new Error('Unsafe macOS verification cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
