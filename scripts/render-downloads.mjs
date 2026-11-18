import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLANNING_NAMES, releaseAssetNames, releaseVersion } from './release-artifacts.mjs';

const repository = 'https://github.com/thepropervolume/proper-karaoke-booth';
const iconPath = new URL('../assets/branding/web/icon-180.png', import.meta.url);

function sizeLabel(bytes) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function byPlatform(version) {
  const prefix = `Proper-Karaoke-Booth-${version}`;
  return [
    { name: 'Windows', note: '64-bit Intel or AMD', files: [
      [`${prefix}-windows-x64-setup.exe`, 'Windows installer', 'EXE'],
      [`${prefix}-win-x64.zip`, 'Windows portable archive', 'ZIP'],
    ] },
    { name: 'macOS', note: 'Apple silicon and Intel', files: [
      [`${prefix}-mac-arm64.dmg`, 'Apple silicon disk image', 'DMG'],
      [`${prefix}-mac-arm64.zip`, 'Apple silicon archive', 'ZIP'],
      [`${prefix}-mac-x64.dmg`, 'Intel disk image', 'DMG'],
      [`${prefix}-mac-x64.zip`, 'Intel archive', 'ZIP'],
    ] },
    { name: 'Linux', note: '64-bit Intel or AMD', files: [
      [`${prefix}-linux-x86_64.AppImage`, 'Linux portable app', 'AppImage'],
      [`${prefix}-linux-amd64.deb`, 'Debian / Ubuntu package', 'DEB'],
    ] },
  ];
}

function manifestRecords(manifest, version) {
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/, 'A full source commit is required.');
  assert.equal(manifest.tag, `v${version}`, 'The release tag must match its version.');
  assert.ok(Array.isArray(manifest.artifacts), 'The release manifest must list its artifacts.');
  const allowed = new Set(releaseAssetNames(version));
  const records = new Map();
  for (const record of manifest.artifacts) {
    assert.ok(record && allowed.has(record.file) && !records.has(record.file), 'Unexpected or duplicate release file.');
    assert.match(record.sha256, /^[a-f0-9]{64}$/, 'Release checksums must be SHA-256 hex strings.');
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes > 0, 'A positive file size is required.');
    records.set(record.file, record);
  }
  return records;
}

function newestFirst(left, right) {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  const difference = a.findIndex((part, index) => part !== b[index]);
  if (difference === -1) return 0;
  return a[difference] > b[difference] ? -1 : 1;
}

function releaseHistory(earlierVersions, currentVersion) {
  const entries = earlierVersions.map(releaseVersion);
  assert.equal(new Set(entries).size, entries.length, 'Earlier versions must be unique.');
  for (const version of entries) assert.equal(newestFirst(currentVersion, version), -1, 'Earlier versions must precede the current release.');
  return entries.sort(newestFirst);
}

const styles = `
  :root { color-scheme: light dark; --page: #f7f5fa; --card: #fff; --ink: #20182e; --muted: #544a61;
    --line: #ded8e6; --accent: #871045; --accent-fill: #fae9f0; --focus: #601ce9; }
  @media (prefers-color-scheme: dark) {
    :root { --page: #161221; --card: #221b2d; --ink: #fbf7ff; --muted: #c8bdd3;
      --line: #40354d; --accent: #ff9cc2; --accent-fill: #382337; --focus: #d6b7ff; }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 1rem/1.5 system-ui, sans-serif; }
  a { color: var(--accent); text-underline-offset: .2em; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 4px; }
  .shell { width: min(100% - 2rem, 62rem); margin-inline: auto; }
  header .shell { display: flex; align-items: center; gap: .75rem; min-height: 4.5rem; }
  header { border-bottom: 1px solid var(--line); }
  header img { border-radius: .55rem; }
  main { padding-block: clamp(1.5rem, 6vw, 3.5rem); }
  .hero { margin-block-end: 2rem; }
  .version { display: inline-block; margin: 0; padding: .25rem .7rem; border-radius: 999px;
    background: var(--accent-fill); color: var(--accent); font-size: .875rem; font-weight: 650; }
  h1 { margin: .45rem 0 .25rem; font-size: clamp(2rem, 6vw, 3.5rem); line-height: 1.05; letter-spacing: -.04em; }
  h2 { margin: 0; font-size: 1.2rem; }
  p { margin: .35rem 0 0; }
  .muted { color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: .8rem; }
  .card, .verification { padding: 1.05rem; background: var(--card); border: 1px solid var(--line); border-radius: .75rem; }
  .card a { display: flex; justify-content: space-between; align-items: center; gap: .65rem; min-height: 2.75rem; }
  .card a strong { min-width: 0; }
  .metadata { color: var(--muted); font-size: .8rem; white-space: nowrap; }
  ul { list-style: none; padding: 0; margin: .6rem 0 0; }
  .files li + li { border-top: 1px solid var(--line); }
  .documents, .verification, .notice, .history { margin-block-start: .8rem; }
  .history ul { display: flex; flex-wrap: wrap; gap: .4rem 1.25rem; }
  .history a { display: inline-flex; align-items: center; min-height: 2.75rem; }
  .notice { color: var(--muted); font-size: .91rem; }
  summary { cursor: pointer; font-weight: 650; }
  .verification ul { display: grid; gap: .4rem; }
  .verification li { overflow-wrap: anywhere; }
  footer { margin-block-start: 1.4rem; display: flex; flex-wrap: wrap; column-gap: 1.25rem; row-gap: .4rem; }
  @media (max-width: 25rem) { .card a { align-items: start; flex-direction: column; gap: .12rem; padding-block: .4rem; } }
`;

export async function renderDownloads(manifest, { versionPage = false, earlierVersions = [] } = {}) {
  const version = releaseVersion(manifest.version);
  const assets = manifestRecords(manifest, version);
  assert.ok(!versionPage || earlierVersions.length === 0, 'Release history belongs on the latest downloads page.');
  const history = releaseHistory(earlierVersions, version);
  const root = versionPage ? './' : `./v${version}/`;
  const image = (await readFile(iconPath)).toString('base64');
  const platforms = byPlatform(version);
  const documents = [
    [PLANNING_NAMES[0], 'Product specification', 'Word'],
    [PLANNING_NAMES[1], 'Interface mockups', 'PDF'],
  ];
  const featured = new Set([...platforms.flatMap(platform => platform.files), ...documents].map(([file]) => file));
  const downloads = files => files.filter(([file]) => assets.has(file)).map(([file, label, format]) => `
        <li><a href="${root}${file}" download><strong>${label}</strong><span class="metadata">${format} · ${sizeLabel(assets.get(file).bytes)}</span></a></li>`).join('');
  const platformCards = platforms.map(({ name, note, files }) => {
    const links = downloads(files);
    return `<section class="card">
      <h2>${name}</h2><p class="muted">${note}</p>
      ${links ? `<ul class="files">${links}</ul>` : '<p class="muted">No verified download for this version.</p>'}
    </section>`;
  }).join('\n');
  const planning = downloads(documents);
  const receipts = [...assets.keys()].filter(file => !featured.has(file) && !['SHA256SUMS.txt', 'release-manifest.json'].includes(file)).sort();

  // URLs come from the verified version and the release allowlist. There is no
  // user-provided display text or script on the public download page.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Karaoke Booth Downloads · The Proper Volume</title>
  <link rel="icon" href="data:image/png;base64,${image}">
  <style>${styles}</style>
</head>
<body>
  <header><div class="shell">
    <img src="data:image/png;base64,${image}" width="38" height="38" alt="">
    <strong>The Proper Volume</strong>
  </div></header>
  <main class="shell">
    <div class="hero">
      <p class="version">${Number(version.split('.')[0]) === 0 ? 'Development release' : 'Version'} ${version}</p>
      <h1>Karaoke Booth downloads</h1>
      <p class="muted">Get the desktop app for your computer.</p>
    </div>
    <div class="grid">${platformCards}</div>
    <p class="notice">Back up your show before upgrading. Windows and Linux development builds are unsigned. macOS development builds use ad hoc signing and have no Apple notarization.</p>
    ${planning ? `<section class="card documents"><h2>Planning documents</h2><ul class="files">${planning}</ul></section>` : ''}
    <details class="verification">
      <summary>Checksums and build receipts</summary>
      <ul>
        <li><a href="${root}SHA256SUMS.txt" download>SHA-256 checksums</a></li>
        <li><a href="${root}release-manifest.json" download>Release manifest</a></li>
        ${receipts.map(file => `<li><a href="${root}${file}" download>${file}</a></li>`).join('\n        ')}
      </ul>
    </details>
    ${history.length ? `<section class="card history"><h2>Earlier versions</h2><ul>${history.map(earlier => `<li><a href="./v${earlier}/">Version ${earlier}</a></li>`).join('')}</ul></section>` : ''}
    <footer>
      ${versionPage ? '<a href="../">Latest release</a>' : `<a href="${root}">Permanent link to this version</a>`}
      <a href="${repository}/commit/${manifest.sourceCommit}">Source commit <code>${manifest.sourceCommit.slice(0, 7)}</code></a>
    </footer>
  </main>
</body>
</html>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, mode, history, ...extra] = process.argv.slice(2);
  const validMode = mode === '--history' ? Boolean(history) : (mode === undefined || mode === '--version-page') && history === undefined;
  assert.ok(input && output && !extra.length && validMode,
    'Usage: node scripts/render-downloads.mjs <release-manifest.json> <output-index.html> [--version-page | --history 0.8.0,0.7.1]');
  const manifest = JSON.parse(await readFile(input, 'utf8'));
  await writeFile(output, await renderDownloads(manifest, { versionPage: mode === '--version-page', earlierVersions: history?.split(',') ?? [] }), 'utf8');
}
