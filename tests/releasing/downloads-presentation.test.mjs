import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('an unknown future version links to its release notes', async () => {
  const html = await renderDownloads({...manifest, version:'0.10.22',tag:'v0.10.22'}, {earlierVersions:['0.10.21']});
  assert.match(html, /href="\.\/v0\.10\.22\/RELEASE_NOTES\.md"/);
});
