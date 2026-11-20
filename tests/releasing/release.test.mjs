import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRelease, fileRecord, installerNames, mobileInstallerNames, MOBILE_PLATFORMS, PLANNING_NAMES, PLATFORMS, releaseAssetNames, releaseVersion, sha256, versionChanged } from '../../scripts/release-artifacts.mjs';
import { GitHubReleaseApi, publishRelease, releasePlan } from '../../scripts/github-release.mjs';

const version = '0.8.0', commit = 'a'.repeat(40), otherCommit = 'b'.repeat(40), sourceSha256 = 'c'.repeat(64);
const save = (dir, name, value) => writeFile(join(dir, name), JSON.stringify(value) + '\n');
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'tpv-release-test-'));
  for (const platform of PLATFORMS) {
    const prefix = `Proper-Karaoke-Booth-${version}-${platform}`, artifacts = [];
    for (const file of installerNames(version, platform)) { await writeFile(join(dir, file), `Synthetic package ${file}`); artifacts.push({ file, sha256: await sha256(join(dir, file)) }); }
    await save(dir, `${prefix}-build.json`, { version, platform, sourceCommit: commit, architectures: platform === 'mac' ? ['arm64', 'x64'] : ['x64'], sourceHasUncommittedChanges: false, sourceRevisionChangedDuringBuild: false, artifacts });
    await writeFile(join(dir, `${prefix}-SHA256SUMS.txt`), artifacts.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
    const buildReceiptSha256 = await sha256(join(dir, `${prefix}-build.json`));
    await save(dir, `${prefix}-ci-verification.json`, { version, platform, sourceCommit: commit, passed: true, buildReceiptSha256 });
    if (platform === 'mac') await save(dir, `${prefix}-verification.json`, { version, sourceCommit: commit, buildReceiptSha256,
      packages: ['arm64', 'x64'].map(architecture => ({ architecture, diskImageVerified: true, matchingDmgAndZip: true, nativeLaunch: architecture === 'arm64', cliWithoutNode: architecture === 'arm64' })) });
  }
  for (const platform of MOBILE_PLATFORMS) {
    const artifacts = [];
    for (const file of mobileInstallerNames(version, platform)) { await writeFile(join(dir, file), `Synthetic mobile package ${file}`); artifacts.push(await fileRecord(dir, file)); }
    await save(dir, `Proper-Karaoke-Booth-${version}-${platform}-build.json`, { version, platform, sourceCommit: commit,
      sourceHasUncommittedChanges: false, sourceRevisionChangedDuringBuild: false,
      kind: platform === 'android' ? 'debug-apk-and-unsigned-aab' : 'unsigned-ios-simulator', artifacts });
  }
  const artifacts = [];
  for (const file of PLANNING_NAMES.slice(0, -1)) { await writeFile(join(dir, file), `Synthetic planning ${file}`); artifacts.push(await fileRecord(dir, file)); }
  await save(dir, 'planning-build.json', { version, sourceCommit: commit, sourceSha256, artifacts });
  return dir;
}
const withFixture = async run => { const dir = await fixture(); try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); } };

test('versions increase numerically, unchanged versions skip, and malformed or downgraded versions fail', () => {
  assert.equal(versionChanged('0.8.0', '0.9.0'), true); assert.equal(versionChanged('0.9.9', '0.10.0'), true);
  assert.equal(versionChanged('0.8.0', version), false); assert.equal(versionChanged(null, version), true);
  for (const value of ['v0.8.0', '0.08.0', '0.8', '0.8.0\ninjected=true', '../0.8.0', '0.8.0-beta', null]) assert.throws(() => releaseVersion(value));
  assert.throws(() => versionChanged('0.9.0', version), /increase/);
});
test('the package contract includes every current installer architecture and sidecar', () => {
  assert.deepEqual(installerNames(version, 'win'), ['Proper-Karaoke-Booth-0.8.0-win-x64.zip', 'Proper-Karaoke-Booth-0.8.0-windows-x64-setup.exe', 'Proper-Karaoke-Booth-0.8.0-windows-x64-setup.exe.blockmap']);
  assert.deepEqual(installerNames(version, 'linux'), ['Proper-Karaoke-Booth-0.8.0-linux-amd64.deb', 'Proper-Karaoke-Booth-0.8.0-linux-x86_64.AppImage']);
  assert.equal(installerNames(version, 'mac').length, 8);
  assert.ok(installerNames(version, 'mac').includes('Proper-Karaoke-Booth-0.8.0-mac-arm64.dmg'));
  assert.ok(installerNames(version, 'mac').includes('Proper-Karaoke-Booth-0.8.0-mac-x64.zip'));
  assert.ok(!installerNames('0.10.8', 'mac').some(name => name.endsWith('.pkg')));
  assert.deepEqual(installerNames('0.10.9', 'mac').filter(name => name.endsWith('.pkg')),
    ['Proper-Karaoke-Booth-0.10.9-mac-arm64.pkg', 'Proper-Karaoke-Booth-0.10.9-mac-x64.pkg']);
  assert.equal(releaseAssetNames('0.10.9').length, 36);
  assert.deepEqual(mobileInstallerNames(version, 'android'), ['Proper-Karaoke-Booth-0.8.0-android-debug.apk', 'Proper-Karaoke-Booth-0.8.0-android-unsigned.aab']);
  assert.deepEqual(mobileInstallerNames(version, 'ios'), ['Proper-Karaoke-Booth-0.8.0-ios-simulator.zip']);
  assert.equal(releaseAssetNames(version).length, 34);
});
test('a complete same-commit release produces an allowlisted manifest and checksums', () => withFixture(async dir => {
  const files = await collectRelease(dir, version, commit, sourceSha256);
  assert.equal(files.length, 34);
  const manifest = JSON.parse(await readFile(join(dir, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, commit); assert.equal(manifest.artifacts.length, 32);
  const sums = await readFile(join(dir, 'SHA256SUMS.txt'), 'utf8');
  assert.ok(sums.includes(`${await sha256(join(dir, 'release-manifest.json'))}  release-manifest.json`));
}));
for (const mutation of ['missing-linux', 'missing-mobile', 'missing-notes', 'tampered-notes', 'tampered-mobile', 'mobile-other-commit', 'extra-private-file', 'tampered-installer', 'different-version', 'different-commit', 'dirty-source', 'incomplete-architecture', 'bad-mac-rehearsal', 'changed-planning']) {
  test(`publication rejects ${mutation}`, () => withFixture(async dir => {
    if (mutation === 'missing-linux') await unlink(join(dir, 'Proper-Karaoke-Booth-0.8.0-linux-amd64.deb'));
    else if (mutation === 'missing-mobile') await unlink(join(dir, 'Proper-Karaoke-Booth-0.8.0-ios-simulator.zip'));
    else if (mutation === 'missing-notes') await unlink(join(dir, 'RELEASE_NOTES.md'));
    else if (mutation === 'tampered-notes') await writeFile(join(dir, 'RELEASE_NOTES.md'), 'modified notes');
    else if (mutation === 'tampered-mobile') await writeFile(join(dir, 'Proper-Karaoke-Booth-0.8.0-android-debug.apk'), 'replaced');
    else if (mutation === 'mobile-other-commit') { const name = 'Proper-Karaoke-Booth-0.8.0-android-build.json'; const receipt = JSON.parse(await readFile(join(dir, name), 'utf8')); receipt.sourceCommit = otherCommit; await save(dir, name, receipt); }
    else if (mutation === 'extra-private-file') await writeFile(join(dir, 'private-credentials.json'), 'Never publish');
    else if (mutation === 'tampered-installer') await writeFile(join(dir, 'Proper-Karaoke-Booth-0.8.0-win-x64.zip'), 'replaced');
    else if (mutation === 'changed-planning') await writeFile(join(dir, PLANNING_NAMES[0]), 'changed');
    else {
      const name = mutation === 'bad-mac-rehearsal' ? 'Proper-Karaoke-Booth-0.8.0-mac-verification.json' : 'Proper-Karaoke-Booth-0.8.0-win-build.json';
      const value = JSON.parse(await readFile(join(dir, name), 'utf8'));
      if (mutation === 'different-version') value.version = '0.8.1';
      if (mutation === 'different-commit') value.sourceCommit = otherCommit;
      if (mutation === 'dirty-source') value.sourceHasUncommittedChanges = true;
      if (mutation === 'incomplete-architecture') value.architectures = ['arm64'];
      if (mutation === 'bad-mac-rehearsal') value.packages[0].nativeLaunch = false;
      await save(dir, name, value);
    }
    await assert.rejects(collectRelease(dir, version, commit, sourceSha256));
  }));
}

class FakeGitHub {
  release = null; tag = null; uploaded = []; patches = []; deleted = []; requests = []; nextId = 100; failAt = null; mismatch = false;
  async request(method, path, value) {
    this.requests.push({ method, path, value });
    if (method === 'GET') return this.release;
    if (method === 'POST') return this.release = { id: 42, ...value, upload_url: 'https://uploads.github.com/repos/owner/repo/releases/42/assets{?name,label}', html_url: 'https://github.com/owner/repo/releases/tag/v0.8.0' };
    if (method === 'DELETE') { this.deleted.push(path); this.uploaded = this.uploaded.filter(asset => `releases/assets/${asset.id}` !== path); return null; }
    assert.equal(method, 'PATCH'); this.patches.push(value); this.release = { ...this.release, ...value }; this.tag = this.release.target_commitish; return this.release;
  }
  async tagCommit() { return this.tag; }
  async assets() { return this.uploaded; }
  async upload(_release, record) {
    if (this.uploaded.length === this.failAt) throw new Error('Simulated upload failure');
    this.uploaded.push({ id: this.nextId++, name: record.file, state: 'uploaded', size: record.bytes, digest: `sha256:${this.mismatch ? '0'.repeat(64) : record.sha256}` });
  }
}
const records = () => releaseAssetNames(version).map(file => ({ file, bytes: 12, sha256: 'e'.repeat(64) }));
const plan = (extra = {}) => ({ previous: '0.7.1', version, commit, manual: false, branch: 'refs/heads/main', defaultBranch: 'main', ...extra });
const publish = (api, files = records()) => publishRelease({ directory: '/synthetic', version, commit, records: files }, api, async () => {});

test('ordinary package changes without a version bump make no release API calls', async () => {
  const api = new FakeGitHub(); assert.equal((await releasePlan(plan({ previous: version }), api)).publish, false); assert.equal(api.requests.length, 0);
});
test('manual first release works, branches are enforced, and conflicting tags cannot be moved', async () => {
  const api = new FakeGitHub(); assert.equal((await releasePlan(plan({ previous: version, manual: true }), api)).publish, true);
  await assert.rejects(releasePlan(plan({ branch: 'refs/heads/feature' }), api), /default branch/);
  api.tag = otherCommit; await assert.rejects(releasePlan(plan(), api), /points elsewhere/);
});
test('publication stages every file before publishing an immutable development prerelease', async () => {
  const api = new FakeGitHub(); const result = await publish(api);
  assert.equal(result.alreadyPublished, false); assert.equal(api.uploaded.length, 34);
  assert.equal(api.requests.find(item => item.method === 'POST').value.draft, true);
  assert.deepEqual(api.patches, [{ draft: false, prerelease: true, make_latest: 'false' }]);
  const count = api.requests.length;
  assert.equal((await publish(api)).alreadyPublished, true); assert.equal(api.requests.length, count + 1); assert.equal(api.deleted.length, 0);
});
test('partial uploads remain a draft and a retry retains correct assets', async () => {
  const api = new FakeGitHub(); api.failAt = 2;
  await assert.rejects(publish(api), /upload failure/); assert.equal(api.release.draft, true); assert.equal(api.patches.length, 0);
  const retained = api.uploaded.map(asset => asset.id); api.failAt = null;
  await publish(api); assert.deepEqual(api.uploaded.slice(0, 2).map(asset => asset.id), retained); assert.equal(api.uploaded.length, 34);
});
test('checksum mismatch never publishes; unknown assets or another commit cannot hitchhike on a draft', async () => {
  const api = new FakeGitHub(); api.mismatch = true;
  await assert.rejects(publish(api), /checksums differ/); assert.equal(api.release.draft, true); assert.equal(api.patches.length, 0);
  api.mismatch = false; api.uploaded.push({ id: 999, name: 'private.json' });
  await assert.rejects(publish(api), /Unexpected draft assets/);
  api.uploaded.pop(); api.release.target_commitish = otherCommit;
  await assert.rejects(publish(api), /different source commit/);
});
test('an incomplete asset set fails before even creating a draft', async () => {
  const api = new FakeGitHub(); await assert.rejects(publish(api, records().slice(1)), /All platform/); assert.equal(api.requests.length, 0);
});
test('published versions skip without replacing assets even after later same-version commits', async () => {
  const api = new FakeGitHub(); api.release = { draft: false, html_url: 'https://github.com/owner/repo/releases/tag/v0.8.0' };
  assert.equal((await releasePlan(plan({ manual: true, commit: otherCommit }), api)).publish, false);
});
test('API client refuses malformed repository identities before credentials can be used', () => {
  for (const repo of ['https://evil.example/repo', '../owner/repo', 'owner/repo/extra', 'owner/repo\n']) assert.throws(() => new GitHubReleaseApi(repo, 'synthetic'));
});
