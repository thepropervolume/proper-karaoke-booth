/** Validate mobile releases and stage reviewed development builds for publication. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileRecord, mobileInstallerNames, releaseVersion } from './release-artifacts.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const [operation, platform] = process.argv.slice(2);
const commit = git('rev-parse', 'HEAD');
assert.match(commit, /^[a-f0-9]{40}$/);
assert.equal(commit, process.env.GITHUB_SHA, 'The checked-out source must match this workflow run.');
const root = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(repo, 'package-lock.json'), 'utf8'));
const mobile = JSON.parse(await readFile(join(repo, 'mobile/package.json'), 'utf8'));
const mobileLock = JSON.parse(await readFile(join(repo, 'mobile/package-lock.json'), 'utf8'));
const version = releaseVersion(root.version);
assert.equal(lock.version, version); assert.equal(lock.packages[''].version, version); assert.equal(mobile.version, version);
assert.equal(mobileLock.version, version); assert.equal(mobileLock.packages[''].version, version);
const androidConfig = await readFile(join(repo, 'mobile/android/app/build.gradle'), 'utf8');
const iosConfig = await readFile(join(repo, 'mobile/ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
assert.deepEqual([...androidConfig.matchAll(/\bversionName\s+"([^"]+)"/g)].map(match => match[1]), [version], 'Android package version does not match.');
assert.deepEqual([...iosConfig.matchAll(/\bMARKETING_VERSION\s*=\s*([^;]+);/g)].map(match => match[1].trim()), [version, version], 'iOS package version does not match.');

const checkpoint = join(repo, 'release', 'mobile-build-source.json');
if (operation === 'check-source' || operation === 'check-store-pair') {
  assert.equal(platform, undefined);
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Build from a clean checkout.');
  if (operation === 'check-store-pair') {
    const appId = 'com.thepropervolume.karaoke';
    const capacitorConfig = await readFile(join(repo, 'mobile/capacitor.config.ts'), 'utf8');
    const capacitorIds = [...capacitorConfig.matchAll(/\bappId\s*:\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    const androidIds = [...androidConfig.matchAll(/\bapplicationId\s+"([^"]+)"/g)].map(match => match[1]);
    const iosIds = [...iosConfig.matchAll(/\bPRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g)].map(match => match[1].trim());
    assert.deepEqual(capacitorIds, [appId], 'Capacitor app ID does not match the store identity.');
    assert.deepEqual(androidIds, [appId], 'Android application ID does not match the store identity.');
      const extensionId = appId + '.liveactivity';
      assert.deepEqual(iosIds.sort(), [appId, appId, extensionId, extensionId],
        'The iOS app and Live Activity extension bundle IDs do not match their store identities.');
    const androidCodes = [...androidConfig.matchAll(/\bversionCode\s+(\d+)\s*$/gm)].map(match => match[1]);
    const iosBuilds = [...iosConfig.matchAll(/\bCURRENT_PROJECT_VERSION\s*=\s*([^;]+);/g)].map(match => match[1].trim());
    assert.ok(androidCodes.length === 1 && /^[1-9]\d*$/.test(androidCodes[0]), 'Android needs a positive version code.');
    assert.ok(iosBuilds.length === 2 && /^[1-9]\d*$/.test(iosBuilds[0]) && iosBuilds[0] === iosBuilds[1], 'Both iOS configurations need the same positive build number.');
    console.log('Mobile store candidate ' + version + ' from commit ' + commit + '.');
    console.log('Store identity ' + appId + ' with iOS build ' + iosBuilds[0] + ' and Android version code ' + androidCodes[0] + '.');
  } else {
    await mkdir(dirname(checkpoint), { recursive: true });
    await writeFile(checkpoint, JSON.stringify({ version, commit }) + '\n', { flag: 'wx' });
  }
} else {
  assert.equal(operation, 'stage');
  assert.ok(platform === 'android' || platform === 'ios');
  const recorded = JSON.parse(await readFile(checkpoint, 'utf8'));
  assert.deepEqual(recorded, { version, commit }, 'Source revision changed during the mobile build.');
  // Capacitor sync may regenerate these checked-in Android scaffolding files.
  // Every other tracked source file must still match the clean checkout.
  const pathspec = ['--', '.', ':(exclude)mobile/android/app/capacitor.build.gradle', ':(exclude)mobile/android/capacitor.settings.gradle'];
  assert.equal(git('diff', '--name-only', ...pathspec), '', 'Application source changed during the mobile build.');
  assert.equal(git('diff', '--cached', '--name-only'), '', 'Staged source changed during the mobile build.');
  const names = mobileInstallerNames(version, platform);
  const inputs = platform === 'android'
    ? ['mobile/android/app/build/outputs/apk/debug/app-debug.apk', 'mobile/android/app/build/outputs/bundle/release/app-release.aab']
    : ['release/TPV-Karaoke-Mobile-iOS-Simulator.zip'];
  const directory = join(repo, 'release', 'ci-assets', platform);
  await mkdir(directory, { recursive: true });
  for (let i = 0; i < names.length; i++) await copyFile(join(repo, inputs[i]), join(directory, names[i]), constants.COPYFILE_EXCL);
  const artifacts = [];
  for (const name of names) artifacts.push(await fileRecord(directory, name));
  const receipt = { version, platform, sourceCommit: commit, sourceHasUncommittedChanges: false,
    sourceRevisionChangedDuringBuild: false, kind: platform === 'android' ? 'debug-apk-and-unsigned-aab' : 'unsigned-ios-simulator', artifacts };
  await writeFile(join(directory, `Proper-Karaoke-Booth-${version}-${platform}-build.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(`Prepared ${platform} development packages for Booth ${version}.`);
}
