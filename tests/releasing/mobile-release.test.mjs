import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { verifyMobilePlatform } from '../../scripts/release-artifacts.mjs';
import { releaseNotesForCommit } from '../../scripts/github-release.mjs';

const appId = 'com.thepropervolume.karaoke';
const widgetId = appId + '.liveactivity';

async function fixture({ androidId = appId, androidVersion = '0.10.1', iosBuilds = [14, 14], iosWidgetId = widgetId,
  includeWidgetProduct = iosWidgetId !== null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tpv-mobile-release-'));
  await mkdir(join(dir, 'scripts')); await mkdir(join(dir, 'mobile')); await mkdir(join(dir, 'src'));
  await cp(resolve('scripts/mobile-release.mjs'), join(dir, 'scripts/mobile-release.mjs'));
  await cp(resolve('scripts/ios-release-targets.mjs'), join(dir, 'scripts/ios-release-targets.mjs'));
  await cp(resolve('scripts/release-artifacts.mjs'), join(dir, 'scripts/release-artifacts.mjs'));
  await writeFile(join(dir, '.gitignore'), 'release/\nmobile/android/app/build/\n');
  await writeFile(join(dir, 'package.json'), '{"version":"0.10.1"}\n');
  await writeFile(join(dir, 'package-lock.json'), '{"version":"0.10.1","packages":{"":{"version":"0.10.1"}}}\n');
  await writeFile(join(dir, 'mobile/package.json'), '{"version":"0.10.1"}\n');
  await writeFile(join(dir, 'mobile/package-lock.json'), '{"version":"0.10.1","packages":{"":{"version":"0.10.1"}}}\n');
  await writeFile(join(dir, 'mobile/capacitor.config.ts'), "const config = { appId: '" + appId + "' };\n");
  await mkdir(join(dir, 'mobile/android/app'), { recursive: true });
  await writeFile(join(dir, 'mobile/android/app/build.gradle'), 'applicationId "' + androidId + '"\nversionCode 1001\nversionName "' + androidVersion + '"\n');
  await mkdir(join(dir, 'mobile/ios/App/App.xcodeproj'), { recursive: true });
  const iosConfig = iosBuilds.map(build => 'MARKETING_VERSION = 0.10.1;\nPRODUCT_BUNDLE_IDENTIFIER = ' + appId + ';\nCURRENT_PROJECT_VERSION = ' + build + ';\n');
  if (iosWidgetId) iosConfig.push(...Array(2).fill('PRODUCT_BUNDLE_IDENTIFIER = ' + iosWidgetId + ';\n'));
  if (includeWidgetProduct) iosConfig.push('path = RoomLiveActivity.appex;\n');
  await writeFile(join(dir, 'mobile/ios/App/App.xcodeproj/project.pbxproj'), iosConfig.join(''));
  await writeFile(join(dir, 'src/example.txt'), 'reviewed code');
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fixture']);
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const run = (...args) => spawnSync(process.execPath, [join(dir, 'scripts/mobile-release.mjs'), ...args], { cwd: dir, env: { ...process.env, GITHUB_SHA: commit }, encoding: 'utf8' });
  return { dir, commit, run };
}

test('store preflight checks one version and commit with separate platform build counters', async () => {
  const { dir, commit, run } = await fixture();
  try {
    const result = run('check-store-pair');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('Mobile store candidate 0.10.1 from commit ' + commit));
    assert.match(result.stdout, /iOS build 14 and Android version code 1001/);
    await assert.rejects(readFile(join(dir, 'release', 'mobile-build-source.json')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('store preflight also accepts the source layout without a WidgetKit extension', async () => {
  const { dir, run } = await fixture({ iosWidgetId: null });
  try {
    const result = run('check-store-pair');
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('store preflight rejects platform version, package identity, and iOS build-setting drift', async () => {
  const cases = [
    [{ androidVersion: '0.10.2' }, /Android package version does not match/],
    [{ androidId: 'com.example.wrong' }, /Android application ID does not match/],
    [{ iosBuilds: [14, 15] }, /Both iOS configurations need the same positive build number/],
    [{ iosWidgetId: 'com.example.wrong' }, /Live Activity extension bundle IDs/],
    [{ iosWidgetId: null, includeWidgetProduct: true }, /Live Activity extension bundle IDs/],
    [{ includeWidgetProduct: false }, /Live Activity extension bundle IDs/],
  ];
  for (const [options, message] of cases) {
    const { dir, run } = await fixture(options);
    try {
      const result = run('check-store-pair');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, message);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});

test('mobile release staging copies just the expected builds and binds hashes to the source commit', async () => {
  const { dir, commit, run } = await fixture();
  try {
    assert.equal(run('check-source').status, 0);
    const apk = join(dir, 'mobile/android/app/build/outputs/apk/debug'), aab = join(dir, 'mobile/android/app/build/outputs/bundle/release');
    await mkdir(apk, { recursive: true }); await mkdir(aab, { recursive: true });
    await writeFile(join(apk, 'app-debug.apk'), 'test apk'); await writeFile(join(aab, 'app-release.aab'), 'test aab');
    assert.equal(run('stage', 'android').status, 0);
    await verifyMobilePlatform(join(dir, 'release/ci-assets/android'), '0.10.1', 'android', commit);
    const receipt = JSON.parse(await readFile(join(dir, 'release/ci-assets/android/Proper-Karaoke-Booth-0.10.1-android-build.json'), 'utf8'));
    assert.equal(receipt.kind, 'debug-apk-and-unsigned-aab');
    assert.notEqual(run('stage', 'android').status, 0, 'A retry must not overwrite an existing staged build.');
    await writeFile(join(dir, 'release/TPV-Karaoke-Mobile-iOS-Simulator.zip'), 'simulator zip');
    assert.equal(run('stage', 'ios').status, 0);
    await verifyMobilePlatform(join(dir, 'release/ci-assets/ios'), '0.10.1', 'ios', commit);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mobile release refuses changed source and a mismatched source identity', async () => {
  const { dir, run } = await fixture();
  try {
    const wrong = spawnSync(process.execPath, [join(dir, 'scripts/mobile-release.mjs'), 'check-source'], { cwd: dir, env: { ...process.env, GITHUB_SHA: 'f'.repeat(40) }, encoding: 'utf8' });
    assert.notEqual(wrong.status, 0); assert.match(wrong.stderr, /match this workflow/);
    assert.equal(run('check-source').status, 0);
    await writeFile(join(dir, 'src/example.txt'), 'changed after build started');
    const result = run('stage', 'android');
    assert.notEqual(result.status, 0); assert.match(result.stderr, /source changed/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('release notes come from the reviewed commit, with a clear fallback when absent', async () => {
  const { dir, commit } = await fixture();
  try {
    const path = join(dir, 'docs/release-notes/v0.10.1.md');
    await mkdir(join(dir, 'docs/release-notes'), { recursive: true });
    await writeFile(path, 'Untracked private draft');
    assert.match(releaseNotesForCommit(dir, '0.10.1', commit), /No release notes were provided/);
    execFileSync('git', ['-C', dir, 'add', 'docs/release-notes/v0.10.1.md']);
    execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Add reviewed notes']);
    const published = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await writeFile(path, 'Unreviewed working tree change');
    assert.equal(releaseNotesForCommit(dir, '0.10.1', published), 'Untracked private draft\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
