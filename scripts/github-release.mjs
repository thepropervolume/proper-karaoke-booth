import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRelease, fileRecord, PLANNING_NAMES, releaseAssetNames, releaseVersion, sha256, versionChanged } from './release-artifacts.mjs';

export class GitHubReleaseApi {
  constructor(repository, token) {
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.ok(token, 'The workflow needs its GitHub token.');
    this.repository = repository; this.token = token;
  }
  async request(method, path, value, upload) {
    const url = upload ? new URL(upload) : new URL(`https://api.github.com/repos/${this.repository}/${path}`);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, upload ? 'uploads.github.com' : 'api.github.com');
    assert.ok(!url.username && !url.password && !url.port);
    const headers = { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
    let body;
    if (upload) { headers['Content-Type'] = 'application/octet-stream'; headers['Content-Length'] = String(value.bytes); body = createReadStream(value.path); }
    else if (value !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(value); }
    try {
      const response = await fetch(url, { method, headers, body, ...(upload ? { duplex: 'half' } : {}), redirect: 'error', signal: AbortSignal.timeout(upload ? 300_000 : 30_000) });
      if (method === 'GET' && response.status === 404) return null;
      if (!response.ok) throw new Error(`GitHub ${method} failed (HTTP ${response.status}).`);
      return response.status === 204 ? null : response.json();
    } finally { if (upload) body.destroy(); }
  }
  async tagCommit(tag) {
    let ref = await this.request('GET', `git/ref/tags/${encodeURIComponent(tag)}`);
    if (!ref) return null;
    for (let depth = 0; depth < 8; ++depth) {
      assert.match(ref.object.sha, /^[a-f0-9]{40}$/);
      if (ref.object.type === 'commit') return ref.object.sha;
      assert.equal(ref.object.type, 'tag', 'Unexpected release tag object.');
      ref = await this.request('GET', `git/tags/${ref.object.sha}`);
    }
    throw new Error('Release tag nesting exceeds the supported limit.');
  }
  async assets(id) {
    const result = [];
    for (let page = 1; page <= 10; ++page) {
      const assets = await this.request('GET', `releases/${id}/assets?per_page=100&page=${page}`);
      assert.ok(Array.isArray(assets)); result.push(...assets);
      if (assets.length < 100) return result;
    }
    throw new Error('Unexpected number of release assets.');
  }
  async upload(release, record, directory) {
    const url = new URL(release.upload_url.replace(/\{.*$/, ''));
    assert.equal(url.pathname, `/repos/${this.repository}/releases/${release.id}/assets`);
    assert.equal(url.search, ''); url.searchParams.set('name', record.file);
    return this.request('POST', '', { path: join(directory, record.file), bytes: record.bytes }, url.href);
  }
}

export async function releasePlan({ previous, version, commit, manual, branch, defaultBranch }, api) {
  releaseVersion(version); assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(branch, `refs/heads/${defaultBranch}`, 'Releases can only run from the default branch.');
  if (!manual && !versionChanged(previous, version)) return { publish: false, reason: 'Version unchanged', version, commit };
  const tag = `v${version}`, existing = await api.request('GET', `releases/tags/${tag}`);
  if (existing && !existing.draft) return { publish: false, reason: 'Version already published', version, commit, url: existing.html_url };
  const tagged = await api.tagCommit(tag);
  assert.ok(!tagged || tagged === commit, 'This version tag points elsewhere. Increase the version or rerun the original release workflow.');
  if (existing) assert.equal(existing.target_commitish, commit, 'Retry the original workflow for this draft; its source commit is fixed.');
  return { publish: true, tag, version, commit };
}

export function releaseNotes(version, commit) {
  return `Desktop installers for The Proper Volume Karaoke Booth ${version}.

- Windows x64: setup installer and portable ZIP.
- Linux x64: Debian package and AppImage.
- macOS: separate Apple silicon and Intel DMG/ZIP packages.
- Generated Word specification, Night/Day mockups, build receipts and SHA256 checksums.

Source: ${commit}. All packages and planning files use this same commit.

${version.startsWith('0.') ? 'Development prerelease; 1.0.0 is the official release target. ' : ''}Windows/Linux packages are unsigned; macOS uses ad-hoc signing without Developer ID/notarization. Automated checks do not establish physical audio/display or installation compatibility. Back up your show before upgrading. External yt-dlp and FFmpeg are not bundled.

See the repository installation guide for setup and verification scope. GitHub also provides source archives below.
`;
}

/** A draft is the staging area. No release becomes visible as published until
 * every platform is present and GitHub confirms the bytes uploaded match. */
export async function publishRelease({ directory, version, commit, records }, api, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const tag = `v${releaseVersion(version)}`;
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(records.map(record => record.file).sort(), releaseAssetNames(version).sort(), 'All platform assets must be verified before publication.');
  assert.ok(records.every(record => /^[a-f0-9]{64}$/.test(record.sha256) && Number.isSafeInteger(record.bytes) && record.bytes > 0));
  let release = await api.request('GET', `releases/tags/${tag}`);
  if (release && !release.draft) return { url: release.html_url, alreadyPublished: true };
  const tagged = await api.tagCommit(tag);
  assert.ok(!tagged || tagged === commit, 'Release tag points to a different source commit.');
  if (release) assert.equal(release.target_commitish, commit, 'A draft for this version belongs to a different source commit.');
  else release = await api.request('POST', 'releases', { tag_name: tag, target_commitish: commit, name: `The Proper Volume Karaoke Booth ${version}`,
    draft: true, prerelease: version.startsWith('0.'), body: releaseNotes(version, commit), generate_release_notes: true });
  const known = new Map(records.map(record => [record.file, record]));
  assert.equal(known.size, records.length);
  let assets = await api.assets(release.id);
  assert.ok(assets.every(asset => known.has(asset.name)), 'Unexpected draft assets: review them before publishing.');
  for (const record of records) {
    const existing = assets.find(asset => asset.name === record.file);
    if (existing?.state === 'uploaded' && existing.size === record.bytes && existing.digest === `sha256:${record.sha256}`) continue;
    // Only replace a failed/mismatched asset in our same-commit unpublished draft.
    if (existing) await api.request('DELETE', `releases/assets/${existing.id}`);
    await api.upload(release, record, directory);
  }
  let verified = false;
  for (let attempt = 0; attempt < 5; ++attempt) {
    assets = await api.assets(release.id);
    verified = assets.length === records.length && new Set(assets.map(asset => asset.name)).size === records.length && assets.every(asset => {
      const expected = known.get(asset.name);
      return expected && asset.state === 'uploaded' && asset.size === expected.bytes && asset.digest === `sha256:${expected.sha256}`;
    });
    if (verified) break;
    await pause(1000);
  }
  assert.ok(verified, 'Release assets are incomplete or their GitHub checksums differ. The release remains a draft.');
  const finalTag = await api.tagCommit(tag);
  assert.ok(!finalTag || finalTag === commit, 'The release tag changed during upload.');
  release = await api.request('PATCH', `releases/${release.id}`, { draft: false, prerelease: version.startsWith('0.'), make_latest: version.startsWith('0.') ? 'false' : 'true' });
  assert.equal(release.draft, false);
  assert.equal(await api.tagCommit(tag), commit, 'Published tag must identify the built source.');
  return { url: release.html_url, alreadyPublished: false };
}

async function main() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(repo, 'package-lock.json'), 'utf8'));
  const version = releaseVersion(metadata.version), git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(lock.version, version); assert.equal(lock.packages[''].version, version, 'Update package-lock.json with the package version.');
  const commit = git('rev-parse', 'HEAD');
  if (process.env.GITHUB_SHA) assert.equal(commit, process.env.GITHUB_SHA);
  const mode = process.argv[2];
  if (mode === 'plan') {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
    assert.ok(manual || process.env.GITHUB_EVENT_NAME === 'push');
    let previous = null;
    if (!manual && event.before && !/^0{40}$/.test(event.before)) {
      assert.match(event.before, /^[a-f0-9]{40}$/);
      previous = JSON.parse(git('show', `${event.before}:package.json`)).version;
    }
    const plan = await releasePlan({ previous, version, commit, manual, branch: process.env.GITHUB_REF, defaultBranch: event.repository.default_branch }, new GitHubReleaseApi(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN));
    await appendFile(process.env.GITHUB_OUTPUT, `publish=${plan.publish}\nversion=${version}\ncommit=${commit}\n`);
    console.log(JSON.stringify(plan));
  } else if (mode === 'platform') {
    const { verifyPackagedPlatform } = await import('./release-platform.mjs');
    await verifyPackagedPlatform(repo, process.argv[3], version, commit);
  } else if (mode === 'planning') {
    const directory = join(repo, 'release/planning'), sourceSha256 = await sha256(join(repo, 'docs/product-specification.md'));
    const receipt = { version, sourceCommit: commit, sourceSha256, artifacts: [] };
    for (const name of PLANNING_NAMES.slice(0, 2)) receipt.artifacts.push(await fileRecord(directory, name));
    await writeFile(join(directory, 'planning-build.json'), JSON.stringify(receipt, null, 2) + '\n');
    const stage = join(repo, 'release/ci-assets/planning'); await mkdir(stage, { recursive: true });
    for (const name of PLANNING_NAMES) await cp(join(directory, name), join(stage, name), { force: false, errorOnExist: true });
  } else if (mode === 'publish') {
    const directory = join(repo, 'release-assets');
    const records = await collectRelease(directory, version, commit, await sha256(join(repo, 'docs/product-specification.md')));
    const result = await publishRelease({ directory, version, commit, records }, new GitHubReleaseApi(process.env.GITHUB_REPOSITORY, process.env.GH_TOKEN));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `[${version} release](${result.url}) — ${records.length} verified assets.\n`);
    console.log(JSON.stringify(result));
  } else throw new Error('Usage: node scripts/github-release.mjs plan|platform <win|linux|mac>|planning|publish');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
