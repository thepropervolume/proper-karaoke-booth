import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDownloads } from '../../scripts/render-downloads.mjs';

const manifest = {version:'0.10.21', tag:'v0.10.21', sourceCommit:'a'.repeat(40), artifacts:[]};
const booth = 'https://github.com/thepropervolume/proper-karaoke-booth';
const studio = 'https://github.com/thepropervolume/proper-karaoke-studio';
const names = ['Instagram','LinkedIn','Karaoke Nerds','Twitch','YouTube','Spotify','Facebook','GitHub'];

test('hub and generated Booth page share accessible brand links and source links', async () => {
  const hub = await readFile(new URL('../../deploy/booth-downloads/release-index.html', import.meta.url), 'utf8');
  const page = await renderDownloads(manifest, {earlierVersions:['0.10.20','0.10.19','0.10.18','0.10.17']});
  const sprite = await readFile(new URL('../../deploy/booth-downloads/assets/social-icons.svg', import.meta.url), 'utf8');
  for (const html of [hub, page]) {
    assert.match(html, /The Proper Volume Karaoke Booth/);
    assert.match(html, /KaraBooth/);
    assert.ok(html.includes(booth) && html.includes(studio));
    for (const name of names) assert.ok(html.includes(`aria-label="${name}"`), `missing ${name}`);
    for (const id of ['instagram','linkedin','karaokenerds','twitch','youtube','spotify','facebook','github']) {
      assert.ok(html.includes(`/assets/social-icons.svg#${id}`));
      assert.ok(sprite.includes(`id="${id}"`));
    }
  }
});

test('latest page displays five researched releases and retains history', async () => {
  const html = await renderDownloads(manifest, {earlierVersions:['0.10.20','0.10.19','0.10.18','0.10.17'],archivedVersions:['0.10.16']});
  const changelog = html.match(/<section class="card changelog"[\s\S]*?<\/section>/)[0];
  assert.deepEqual([...changelog.matchAll(/<h3>Version ([\d.]+)<\/h3>/g)].map(m=>m[1]), ['0.10.21','0.10.20','0.10.19','0.10.18','0.10.17']);
  assert.match(changelog, /applause/);
  assert.doesNotMatch(changelog, /Version 0\.10\.16/);
  assert.match(html, /Archived release history/);
  assert.doesNotMatch(await renderDownloads(manifest, {versionPage:true}), /class="card changelog"/);
});

test('an unknown future version links to release notes in its manifest', async () => {
  const artifacts = [{file:'RELEASE_NOTES.md',bytes:4,sha256:'c'.repeat(64)}];
  const html = await renderDownloads({...manifest, version:'0.10.22',tag:'v0.10.22',artifacts}, {earlierVersions:['0.10.21']});
  assert.match(html, /href="\.\/v0\.10\.22\/RELEASE_NOTES\.md"/);
});

test('the page CLI uses verified current and retained notes, escapes raw HTML, and skips unsupported sources', async t => {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'tpv-download-notes-'));
  t.after(async () => {
    const checked = await realpath(directory);
    assert.equal(dirname(checked), parent);
    await rm(checked, { recursive: true, force: true });
  });
  const published = join(directory, 'public'), candidate = join(directory, 'incoming');
  await mkdir(published); await mkdir(candidate);
  const writeRelease = async (root, version, notes) => {
    await mkdir(root, { recursive: true });
    const file = join(root, 'release-manifest.json');
    await writeFile(file, JSON.stringify({ ...manifest, version, tag:`v${version}`, artifacts: [
      { file:'RELEASE_NOTES.md', bytes:Buffer.byteLength(notes), sha256:createHash('sha256').update(notes).digest('hex') },
    ] }));
    await writeFile(join(root, 'RELEASE_NOTES.md'), notes);
    return file;
  };
  const input = await writeRelease(candidate, '0.10.22', [
    '# KaraBooth 0.10.22', '## Playback <script>', '- Use **Room mode** and `karabooth-cli`.',
    '- <img src=x onerror=alert(1)> & safe copy', '  on a second line.',
    '', '```html', '- invisible fenced content', '```',
  ].join('\n'));
  await writeRelease(join(published,'v0.10.21'), '0.10.21', '## Library C#\n1. Retained entry from the published file');
  await writeRelease(join(published,'v0.10.20'), '0.10.20', '- Published checksum target');
  await writeFile(join(published,'v0.10.20','RELEASE_NOTES.md'), '- Tampered note should not render');
  await writeRelease(join(directory,'external'), '0.10.19', '- External directory should never be read');
  try { await symlink(join(directory,'external'), join(published,'v0.10.19'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch(error) {
    if (error.code !== 'EPERM') throw error;
    t.diagnostic('Directory symlinks are unavailable on this Windows host');
  }
  const output = join(directory, 'index.html'), script = fileURLToPath(new URL('../../scripts/render-downloads.mjs', import.meta.url));
  execFileSync(process.execPath, [script, input, output, '--public-dir', published, '--history', '0.10.21,0.10.20,0.10.19']);
  const html = await readFile(output, 'utf8');
  assert.match(html, /<h4>Playback &lt;script&gt;<\/h4>/);
  assert.match(html, /<li>Use <strong>Room mode<\/strong> and <code>karabooth-cli<\/code>\.<\/li>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; safe copy on a second line/);
  assert.match(html, /<h4>Library C#<\/h4>.*Retained entry from the published file/);
  assert.match(html, /href="\.\/v0\.10\.21\/RELEASE_NOTES\.md">Read the full release notes/);
  assert.match(html, /Find the running version in Help/);
  assert.doesNotMatch(html, /<script>|<img src=x|invisible fenced content|Tampered note|External directory/);
  const invalid = spawnSync(process.execPath, [script, input, output, '--public-dir', published, '--history', '../external']);
  assert.notEqual(invalid.status, 0, 'retained version arguments cannot escape the public root');
  execFileSync(process.execPath, [script, input, output, '--version-page']);
  const versionHtml = await readFile(output, 'utf8');
  assert.match(versionHtml, /class="card version-changelog"/);
  assert.match(versionHtml, /href="\.\/RELEASE_NOTES\.md">Read the full release notes/);
});
