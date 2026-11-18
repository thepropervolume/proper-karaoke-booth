import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const PLATFORMS = ['win', 'linux', 'mac'];
export const MOBILE_PLATFORMS = ['android', 'ios'];
export function releaseVersion(value) {
  assert.equal(typeof value, 'string', 'The package version must be a string.');
  assert.ok(value.length <= 40 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value), 'Use a numeric major.minor.patch package version.');
  return value;
}
export function versionChanged(previous, current) {
  releaseVersion(current);
  if (previous === null) return true;
  releaseVersion(previous);
  if (previous === current) return false;
  const a = previous.split('.').map(BigInt), b = current.split('.').map(BigInt);
  const difference = a.findIndex((value, index) => value !== b[index]);
  assert.ok(b[difference] > a[difference], 'A release version must increase; never reuse or downgrade a version.');
  return true;
}
export function installerNames(version, platform) {
  releaseVersion(version); assert.ok(PLATFORMS.includes(platform), 'Unknown release platform.');
  const prefix = `Proper-Karaoke-Booth-${version}`;
  if (platform === 'win') return [`${prefix}-win-x64.zip`, `${prefix}-windows-x64-setup.exe`, `${prefix}-windows-x64-setup.exe.blockmap`];
  if (platform === 'linux') return [`${prefix}-linux-amd64.deb`, `${prefix}-linux-x86_64.AppImage`];
  return ['arm64', 'x64'].flatMap(arch => ['.dmg', '.dmg.blockmap', '.zip', '.zip.blockmap'].map(ext => `${prefix}-mac-${arch}${ext}`));
}
export function platformNames(version, platform) {
  const prefix = `Proper-Karaoke-Booth-${releaseVersion(version)}-${platform}`;
  return [...installerNames(version, platform), `${prefix}-build.json`, `${prefix}-SHA256SUMS.txt`, `${prefix}-ci-verification.json`,
    ...(platform === 'mac' ? [`${prefix}-verification.json`] : [])];
}
/** Development mobile builds are deliberately labeled with their signing and
 * simulator limitations. They are staged and verified with the same release. */
export function mobileInstallerNames(version, platform) {
  const prefix = `Proper-Karaoke-Booth-${releaseVersion(version)}-${platform}`;
  assert.ok(MOBILE_PLATFORMS.includes(platform), 'Unknown mobile release platform.');
  return platform === 'android' ? [`${prefix}-debug.apk`, `${prefix}-unsigned.aab`] : [`${prefix}-simulator.zip`];
}
export function mobilePlatformNames(version, platform) {
  return [...mobileInstallerNames(version, platform), `Proper-Karaoke-Booth-${releaseVersion(version)}-${platform}-build.json`];
}
export const PLANNING_NAMES = ['TPV_Karaoke_Product_Specification_Current.docx', 'TPV_Karaoke_Mockups_Dark_and_Light_Current.pdf', 'RELEASE_NOTES.md', 'planning-build.json'];
export const releaseAssetNames = version => [...PLATFORMS.flatMap(platform => platformNames(version, platform)), ...MOBILE_PLATFORMS.flatMap(platform => mobilePlatformNames(version, platform)), ...PLANNING_NAMES, 'release-manifest.json', 'SHA256SUMS.txt'];
export const sha256 = async path => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
};
export async function fileRecord(directory, name) {
  assert.equal(basename(name), name, 'Release assets must have plain filenames.');
  assert.ok(!name.includes('\\') && !name.includes('/') && !name.startsWith('.'), 'Invalid release filename.');
  const path = join(directory, name), info = await lstat(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size < 2 * 1024 ** 3, `Invalid release asset: ${name}`);
  assert.equal(dirname(await realpath(path)), await realpath(directory), 'Release assets must stay in their output directory.');
  return { file: name, bytes: info.size, sha256: await sha256(path) };
}
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const exactNames = (actual, expected, message) => assert.deepEqual([...actual].sort(), [...expected].sort(), message);

export async function verifyPlatform(directory, version, platform, commit) {
  const prefix = `Proper-Karaoke-Booth-${releaseVersion(version)}-${platform}`;
  const receipt = await json(join(directory, `${prefix}-build.json`));
  assert.equal(receipt.version, version); assert.equal(receipt.platform, platform); assert.equal(receipt.sourceCommit, commit);
  assert.equal(receipt.sourceHasUncommittedChanges, false, 'Build from a clean checkout.');
  assert.equal(receipt.sourceRevisionChangedDuringBuild, false, 'Source changed while packaging.');
  exactNames(receipt.architectures, platform === 'mac' ? ['arm64', 'x64'] : ['x64'], 'Incomplete platform architectures.');
  exactNames(receipt.artifacts.map(item => item.file), installerNames(version, platform), 'Missing, duplicate or unexpected installers.');
  for (const item of receipt.artifacts) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await fileRecord(directory, item.file)).sha256, item.sha256, `Installer checksum mismatch: ${item.file}`);
  }
  const sums = (await readFile(join(directory, `${prefix}-SHA256SUMS.txt`), 'utf8')).trim().split(/\r?\n/);
  exactNames(sums, receipt.artifacts.map(item => `${item.sha256}  ${item.file}`), 'Package checksum manifest differs from the build receipt.');
  const ci = await json(join(directory, `${prefix}-ci-verification.json`));
  assert.equal(ci.version, version); assert.equal(ci.sourceCommit, commit); assert.equal(ci.platform, platform); assert.equal(ci.passed, true);
  assert.equal(ci.buildReceiptSha256, await sha256(join(directory, `${prefix}-build.json`)));
  if (platform === 'mac') {
    const native = await json(join(directory, `${prefix}-verification.json`));
    assert.equal(native.sourceCommit, commit); assert.equal(native.version, version);
    assert.equal(native.buildReceiptSha256, ci.buildReceiptSha256);
    exactNames(native.packages.map(item => item.architecture), ['arm64', 'x64']);
    assert.ok(native.packages.every(item => item.diskImageVerified && item.matchingDmgAndZip));
    assert.ok(native.packages.some(item => item.architecture === 'arm64' && item.nativeLaunch && item.cliWithoutNode));
  }
  return receipt;
}

export async function verifyPlanning(directory, version, commit, sourceSha256) {
  const receipt = await json(join(directory, 'planning-build.json'));
  assert.equal(receipt.version, version); assert.equal(receipt.sourceCommit, commit); assert.equal(receipt.sourceSha256, sourceSha256);
  exactNames(receipt.artifacts.map(item => item.file), PLANNING_NAMES.slice(0, -1), 'Missing planning editions or release notes.');
  for (const item of receipt.artifacts) assert.equal((await fileRecord(directory, item.file)).sha256, item.sha256);
}

export async function verifyMobilePlatform(directory, version, platform, commit) {
  const prefix = `Proper-Karaoke-Booth-${releaseVersion(version)}-${platform}`;
  const receipt = await json(join(directory, `${prefix}-build.json`));
  assert.equal(receipt.version, version); assert.equal(receipt.platform, platform); assert.equal(receipt.sourceCommit, commit);
  assert.equal(receipt.sourceHasUncommittedChanges, false, 'Build from a clean checkout.');
  assert.equal(receipt.sourceRevisionChangedDuringBuild, false, 'Source changed while packaging.');
  assert.equal(receipt.kind, platform === 'android' ? 'debug-apk-and-unsigned-aab' : 'unsigned-ios-simulator');
  assert.ok(Array.isArray(receipt.artifacts));
  exactNames(receipt.artifacts.map(item => item.file), mobileInstallerNames(version, platform), 'Missing, duplicate or unexpected mobile packages.');
  for (const item of receipt.artifacts) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    const record = await fileRecord(directory, item.file);
    assert.equal(record.sha256, item.sha256, `Mobile package checksum mismatch: ${item.file}`);
    assert.equal(record.bytes, item.bytes, `Mobile package size mismatch: ${item.file}`);
  }
}

/** The allowlist is also the publication boundary: no show profiles, caches,
 * test credentials or arbitrary files from a runner can become release assets. */
export async function collectRelease(directory, version, commit, sourceSha256) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  const expected = [...PLATFORMS.flatMap(platform => platformNames(version, platform)), ...MOBILE_PLATFORMS.flatMap(platform => mobilePlatformNames(version, platform)), ...PLANNING_NAMES];
  exactNames(await readdir(directory), expected, 'The release must contain every platform and no extra files.');
  for (const platform of PLATFORMS) await verifyPlatform(directory, version, platform, commit);
  for (const platform of MOBILE_PLATFORMS) await verifyMobilePlatform(directory, version, platform, commit);
  await verifyPlanning(directory, version, commit, sourceSha256);
  const files = [];
  for (const name of expected.sort()) files.push(await fileRecord(directory, name));
  const manifest = { version, sourceCommit: commit, tag: `v${version}`, artifacts: files };
  await writeFile(join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(directory, 'SHA256SUMS.txt'), [...files, await fileRecord(directory, 'release-manifest.json')]
    .map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
  return [...files, await fileRecord(directory, 'release-manifest.json'), await fileRecord(directory, 'SHA256SUMS.txt')];
}
export async function stagePlatform(repo, platform, version) {
  const destination = resolve(repo, 'release', 'ci-assets', platform);
  await mkdir(destination, { recursive: true });
  for (const name of platformNames(version, platform)) await cp(join(repo, 'release', name), join(destination, name), { force: false, errorOnExist: true });
}
