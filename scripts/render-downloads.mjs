import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLANNING_NAMES, releaseAssetNames, releaseVersion } from './release-artifacts.mjs';

const repository = 'https://github.com/thepropervolume/proper-karaoke-booth';
// Reviewed, public-facing highlights researched from release notes and Git history.
// Add an entry when a new version is published; never expose raw commit messages.
const highlights = {
  '0.10.21': ['Search or choose library sources and remember your selection.', 'Import files and folders with one control, and relink or remove library entries without deleting source files.', 'Sort library columns and use improved DJ codes for local and online tracks.'],
  '0.10.20': ['Find the running version in Help → About and open release notes from Help → What’s New.', 'Desktop singer displays show the mobile applause cue.'],
  '0.10.19': ['The mobile singer companion adds room controls and native interactions.', 'Singers can see host-confirmed applause and fulfilled requests; the desktop singer display shows an applause cue.'],
  '0.10.18': ['The mobile singer app introduces updated Rooms, Search, Queue, Account, Playlists, and Now Playing screens.', 'Sign in with a Booth account or enter as a guest; playlists remain on the device.'],
  '0.10.17': ['Filter the Song Library by source and choose which columns to display.', 'Manage karaoke services, rename singers, and play ready library tracks immediately.', 'Star songs for KJ Picks in Booth or personal playlists on a singer device.'],
};
const socialNav = `<nav class="social-nav" aria-label="The Proper Volume social accounts">
  <a href="https://instagram.com/thepropervolume" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><svg aria-hidden="true"><use href="/assets/social-icons.svg#instagram"></use></svg></a>
  <a href="https://www.linkedin.com/company/thepropervolume/" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><svg aria-hidden="true"><use href="/assets/social-icons.svg#linkedin"></use></svg></a>
  <a href="https://karaokenerds.com/Brand/TheProperVolume/Date" target="_blank" rel="noopener noreferrer" aria-label="Karaoke Nerds"><svg aria-hidden="true"><use href="/assets/social-icons.svg#karaokenerds"></use></svg></a>
  <a href="https://twitch.tv/thepropervolume" target="_blank" rel="noopener noreferrer" aria-label="Twitch"><svg aria-hidden="true"><use href="/assets/social-icons.svg#twitch"></use></svg></a>
  <a href="https://youtube.com/@thepropervolume" target="_blank" rel="noopener noreferrer" aria-label="YouTube"><svg aria-hidden="true"><use href="/assets/social-icons.svg#youtube"></use></svg></a>
  <a href="https://open.spotify.com/artist/5QMHcgrYZEPcbHx75cF2my" target="_blank" rel="noopener noreferrer" aria-label="Spotify"><svg aria-hidden="true"><use href="/assets/social-icons.svg#spotify"></use></svg></a>
  <a href="https://www.facebook.com/thepropervolume" target="_blank" rel="noopener noreferrer" aria-label="Facebook"><svg aria-hidden="true"><use href="/assets/social-icons.svg#facebook"></use></svg></a>
  <a href="https://github.com/thepropervolume" target="_blank" rel="noopener noreferrer" aria-label="GitHub"><svg aria-hidden="true"><use href="/assets/social-icons.svg#github"></use></svg></a>
</nav>`;


function sizeLabel(bytes) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function byPlatform(version, records) {
  const prefix = `Proper-Karaoke-Booth-${version}`;
  return [
    { name: 'Windows', note: '64-bit Intel or AMD', files: [
      [`${prefix}-windows-x64-setup.exe`, 'Windows installer', 'EXE'],
      [`${prefix}-win-x64.zip`, 'Windows portable archive', 'ZIP'],
    ] },
    { name: 'macOS', note: 'Apple silicon and Intel', files: [
      [`${prefix}-mac-arm64.pkg`, 'Apple silicon installer', 'PKG'],
      [`${prefix}-mac-arm64.dmg`, 'Apple silicon disk image', 'DMG'],
      [`${prefix}-mac-arm64.zip`, 'Apple silicon archive', 'ZIP'],
      [`${prefix}-mac-x64.pkg`, 'Intel installer', 'PKG'],
      [`${prefix}-mac-x64.dmg`, 'Intel disk image', 'DMG'],
      [`${prefix}-mac-x64.zip`, 'Intel archive', 'ZIP'],
    ].filter(([file]) => !file.endsWith('.pkg') || records.has(file)) },
    { name: 'Linux', note: '64-bit Intel or AMD', files: [
      [`${prefix}-linux-x86_64.AppImage`, 'Linux portable app', 'AppImage'],
      [`${prefix}-linux-amd64.deb`, 'Debian / Ubuntu package', 'DEB'],
    ] },
    { name: 'Android development', note: 'Debug APK and unsigned release bundle', files: [
      [`${prefix}-android-debug.apk`, 'Android debug app', 'APK'],
      [`${prefix}-android-unsigned.aab`, 'Unsigned Android bundle', 'AAB'],
    ] },
    { name: 'iOS development', note: 'Unsigned simulator build; not an iPhone installer', files: [
      [`${prefix}-ios-simulator.zip`, 'iOS simulator app', 'ZIP'],
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

export async function renderDownloads(manifest, { versionPage = false, earlierVersions = [], archivedVersions = [] } = {}) {
  const version = releaseVersion(manifest.version);
  const assets = manifestRecords(manifest, version);
  assert.ok(!versionPage || (earlierVersions.length === 0 && archivedVersions.length === 0), 'Release history belongs on the latest downloads page.');
  const history = releaseHistory(earlierVersions, version);
  const archived = releaseHistory(archivedVersions, version);
  assert.ok(!archived.some(item => history.includes(item)), 'An archived version cannot also be retained.');
  const root = versionPage ? './' : `./v${version}/`;
  const assetUrl = file => versionPage ? `./${file}` : `./latest/${file.replace(`-${version}-`, '-')}`;
  const platforms = byPlatform(version, assets);
  const documents = [
    [PLANNING_NAMES[0], 'Product specification', 'Word'],
    [PLANNING_NAMES[1], 'Interface mockups', 'PDF'],
    ['RELEASE_NOTES.md', 'Release notes', 'Markdown'],
  ];
  const featured = new Set([...platforms.flatMap(platform => platform.files), ...documents].map(([file]) => file));
  const downloads = files => files.filter(([file]) => assets.has(file)).map(([file, label, format]) => `
        <li><a href="${assetUrl(file)}" download><strong>${label}</strong><span class="metadata">${format} · ${sizeLabel(assets.get(file).bytes)}</span></a></li>`).join('');
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
  <title>Karaoke Booth ${version} downloads · The Proper Volume</title>
  <link rel="icon" href="/assets/karaoke-booth.png">
  <link rel="stylesheet" href="/assets/releases.css">
</head>
<body>
  <a class="skip-link" href="#downloads">Skip to downloads</a>
  <header class="site-header"><div class="shell topbar">
    <a class="brand" href="https://thepropervolume.com/">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="/assets/tpv-wordmark-night.svg">
        <img src="/assets/tpv-wordmark-day.svg" width="144" height="48" alt="The Proper Volume">
      </picture>
    </a>
    <a href="/">All downloads</a>
  </div></header>
  <main class="shell" id="downloads">
    <section class="hero release-hero">
      <div class="hero-copy">
        <p class="eyebrow">${Number(version.split('.')[0]) === 0 ? 'Development release' : 'Release'} ${version}</p>
        <h1>The Proper Volume Karaoke Booth <span class="short-name">(KaraBooth)</span> downloads</h1>
        <p class="lede">Desktop installers and mobile development builds.</p>
      </div>
      <img class="product-icon" src="/assets/karaoke-booth.png" width="96" height="96" alt="">
    </section>
    <div class="grid">${platformCards}</div>
    <p class="notice">Back up your show before upgrading. Windows and Linux development builds are unsigned. macOS development builds use ad hoc signing and have no Apple notarization.</p>
    ${planning ? `<section class="card documents"><h2>Planning documents</h2><ul class="files">${planning}</ul></section>` : ''}
    <details class="verification">
      <summary>Checksums and build receipts</summary>
      <ul>
        <li><a href="${assetUrl('SHA256SUMS.txt')}" download>SHA-256 checksums</a></li>
        <li><a href="${assetUrl('release-manifest.json')}" download>Release manifest</a></li>
        ${receipts.map(file => `<li><a href="${assetUrl(file)}" download>${file}</a></li>`).join('\n        ')}
      </ul>
    </details>
    ${history.length ? `<section class="card history"><h2>Earlier versions</h2><ul>${history.map(earlier => `<li><a href="./v${earlier}/">Version ${earlier}</a></li>`).join('')}</ul></section>` : ''}
    ${archived.length ? `<section class="card history"><h2>Archived release history</h2><p>Installers are retained for the five most recent versions.</p><ul>${archived.map(earlier => `<li><a href="./archive/v${earlier}/">Version ${earlier}</a></li>`).join('')}</ul></section>` : ''}
    ${!versionPage ? `<section class="card changelog" aria-labelledby="changelog-title"><h2 id="changelog-title">What’s new in KaraBooth</h2>${[version, ...history, ...archived].slice(0, 5).map(item => `<article><h3>Version ${item}</h3>${highlights[item] ? `<ul>${highlights[item].map(text => `<li>${text}</li>`).join('')}</ul>` : `<p><a href="${archived.includes(item) ? `./archive/v${item}/` : `./v${item}/RELEASE_NOTES.md`}">Read the release notes</a></p>`}</article>`).join('')}</section>` : ''}
    <footer class="release-footer">
      ${versionPage ? '<a href="../">Latest release</a>' : `<a href="${root}">Permanent link to this version</a>`}
      <a href="${repository}" target="_blank" rel="noopener noreferrer">KaraBooth on GitHub</a>
      <a href="https://github.com/thepropervolume/proper-karaoke-studio" target="_blank" rel="noopener noreferrer">Karaoke Studio on GitHub</a>
      <a href="${repository}/commit/${manifest.sourceCommit}">Source commit <code>${manifest.sourceCommit.slice(0, 7)}</code></a>
    </footer>
  </main>
  <footer class="shell site-footer">${socialNav}</footer>
</body>
</html>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, ...flags] = process.argv.slice(2);
  let versionPage = false, earlierVersions = [], archivedVersions = [];
  while (flags.length) {
    const flag = flags.shift();
    if (flag === '--version-page' && !versionPage) versionPage = true;
    else if (flag === '--history' && !earlierVersions.length && flags[0]) earlierVersions = flags.shift().split(',');
    else if (flag === '--archived' && !archivedVersions.length && flags[0]) archivedVersions = flags.shift().split(',');
    else throw new Error('Invalid downloads page options.');
  }
  assert.ok(input && output, 'Usage: node scripts/render-downloads.mjs <manifest> <output> [--version-page] [--history VERSIONS] [--archived VERSIONS]');
  const manifest = JSON.parse(await readFile(input, 'utf8'));
  await writeFile(output, await renderDownloads(manifest, { versionPage, earlierVersions, archivedVersions }), 'utf8');
}
