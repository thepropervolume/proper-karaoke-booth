import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLANNING_NAMES, releaseAssetNames, releaseVersion } from './release-artifacts.mjs';

const repository = 'https://github.com/thepropervolume/proper-karaoke-booth';
// Reviewed highlights for releases whose published notes predate this renderer.
const historicalHighlights = {
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

const NOTES_NAME = 'RELEASE_NOTES.md';
const MAX_NOTES_BYTES = 64 * 1024;
const MAX_RELEASE_MANIFEST_BYTES = 256 * 1024;
const escapeHtml = text => text.replace(/[&<>"']/g, token => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[token]);

function inlineNotes(text) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).map(part => {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
    return escapeHtml(part);
  }).join('');
}

function notesSummary(markdown) {
  const blocks = [];
  let list, fence;
  for (const line of markdown.split(/\r?\n/)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (delimiter?.[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined;
      continue;
    }
    if (delimiter) { fence = delimiter[1]; list = undefined; continue; }
    const heading = /^ {0,3}#{2,6}[ \t]+(.+?)\s*$/.exec(line);
    if (heading) {
      list = undefined;
      blocks.push({ heading: heading[1].replace(/[ \t]+#+$/, '') || heading[1] });
      continue;
    }
    const bullet = /^ {0,3}(?:[-*+]|\d+[.)])[ \t]+(.+)$/.exec(line);
    if (bullet) {
      if (!list) { list = []; blocks.push({ list }); }
      list.push(bullet[1].trim());
      continue;
    }
    if (list && /^ {2,}\S/.test(line)) list[list.length - 1] += ' ' + line.trim();
    else if (line.trim()) list = undefined;
  }
  return blocks.map(block => block.heading ? `<h4>${inlineNotes(block.heading)}</h4>` :
    `<ul>${block.list.map(text => `<li>${inlineNotes(text)}</li>`).join('')}</ul>`).join('');
}

// Only read bounded, regular files. Reject links before opening, disallow
// following a swapped link where supported, then check the opened identity.
async function readReleaseFile(directory, name, maximum) {
  const path = join(directory, name);
  try {
    const original = await lstat(path);
    if (!original.isFile() || original.size < 1 || original.size > maximum) return undefined;
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== original.dev || opened.ino !== original.ino || opened.size !== original.size) return undefined;
      const bytes = Buffer.alloc(original.size + 1);
      const { bytesRead } = await handle.read(bytes);
      return bytesRead === original.size ? bytes.subarray(0, bytesRead) : undefined;
    } finally { await handle.close(); }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ELOOP') return undefined;
    throw error;
  }
}

async function verifiedNotes(directory, assets) {
  const record = assets.get(NOTES_NAME);
  if (!record || record.bytes > MAX_NOTES_BYTES) return undefined;
  const bytes = await readReleaseFile(directory, NOTES_NAME, MAX_NOTES_BYTES);
  if (!bytes || bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) return undefined;
  return bytes.toString('utf8');
}

async function loadNotes(input, manifest, { earlierVersions, publicDirectory }) {
  const version = releaseVersion(manifest.version);
  const notes = new Map([[version, await verifiedNotes(await realpath(dirname(input)), manifestRecords(manifest, version))]]);
  if (!publicDirectory) return notes;
  const root = await realpath(publicDirectory);
  for (const earlier of releaseHistory(earlierVersions, version).slice(0, 4)) {
    const directory = join(root, `v${earlier}`);
    if (!await lstat(directory).then(info => info.isDirectory(), error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }) || await realpath(directory) !== directory) continue;
    const metadata = await readReleaseFile(directory, 'release-manifest.json', MAX_RELEASE_MANIFEST_BYTES);
    if (!metadata) continue;
    const retained = JSON.parse(metadata.toString('utf8'));
    if (retained.version !== earlier) continue;
    notes.set(earlier, await verifiedNotes(directory, manifestRecords(retained, earlier)));
  }
  return notes;
}

export async function renderDownloads(manifest, { versionPage = false, earlierVersions = [], archivedVersions = [], notes = new Map() } = {}) {
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
  const changelogCard = item => {
    const published = notes.get(item);
    const summary = (published ? notesSummary(published) : '') || (historicalHighlights[item] ?
      `<ul>${historicalHighlights[item].map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : '');
    const hasNotes = published !== undefined || (!notes.has(item) && item === version && assets.has(NOTES_NAME));
    const url = versionPage ? `./${NOTES_NAME}` : `./v${item}/${hasNotes ? NOTES_NAME : ''}`;
    const link = hasNotes ? `<p><a href="${url}">Read the full release notes</a></p>` :
      (versionPage ? '' : `<p><a href="${url}">View this release</a></p>`);
    return `<article><h3>Version ${item}</h3>${summary}${link}</article>`;
  };
  const changes = versionPage
    ? (notes.get(version) ? `<section class="card version-changelog" aria-labelledby="changelog-title"><h2 id="changelog-title">What’s new</h2>${changelogCard(version)}</section>` : '')
    : `<section class="card changelog" aria-labelledby="changelog-title"><h2 id="changelog-title">What’s new in KaraBooth</h2>${[version, ...history].slice(0, 5).map(changelogCard).join('')}</section>`;

  // URLs come from verified versions and the release allowlist. Displayed
  // changelog text is escaped before it reaches the public download page.
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
    ${changes}
    ${history.length ? `<section class="card history"><h2>Earlier versions</h2><ul>${history.map(earlier => `<li><a href="./v${earlier}/">Version ${earlier}</a></li>`).join('')}</ul></section>` : ''}
    ${archived.length ? `<section class="card history"><h2>Archived release history</h2><p>Installers are retained for the five most recent versions.</p><ul>${archived.map(earlier => `<li><a href="./archive/v${earlier}/">Version ${earlier}</a></li>`).join('')}</ul></section>` : ''}
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
  let versionPage = false, earlierVersions = [], archivedVersions = [], publicDirectory;
  while (flags.length) {
    const flag = flags.shift();
    if (flag === '--version-page' && !versionPage) versionPage = true;
    else if (flag === '--history' && !earlierVersions.length && flags[0]) earlierVersions = flags.shift().split(',');
    else if (flag === '--archived' && !archivedVersions.length && flags[0]) archivedVersions = flags.shift().split(',');
    else if (flag === '--public-dir' && !publicDirectory && flags[0]) publicDirectory = flags.shift();
    else throw new Error('Invalid downloads page options.');
  }
  assert.ok(input && output, 'Usage: node scripts/render-downloads.mjs <manifest> <output> [--version-page] [--public-dir PATH] [--history VERSIONS] [--archived VERSIONS]');
  const manifest = JSON.parse(await readFile(input, 'utf8'));
  const notes = await loadNotes(input, manifest, { earlierVersions, publicDirectory });
  await writeFile(output, await renderDownloads(manifest, { versionPage, earlierVersions, archivedVersions, notes }), 'utf8');
}
