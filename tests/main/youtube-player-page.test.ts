import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { allowedYouTubeLink, youtubeEmbedUrl, youtubePlayerPage, YOUTUBE_REFERER } from '../../src/main/youtube-player-page';

test('builds only an exact YouTube embed URL with native controls and no autoplay', () => {
  const url = new URL(youtubeEmbedUrl('S4y482Pz-_U'));
  assert.equal(url.origin, 'https://www.youtube.com');
  assert.equal(url.pathname, '/embed/S4y482Pz-_U');
  assert.equal(url.searchParams.get('controls'), '1');
  assert.equal(url.searchParams.has('autoplay'), false);
  assert.equal(new URL(YOUTUBE_REFERER).protocol, 'https:');
  for (const invalid of ['', 'abc', 'S4y482Pz-_U"', '../evil.abc', 'S4y482Pz-_U?autoplay=1', null, {}])
    assert.throws(() => youtubeEmbedUrl(invalid), /Invalid/);
});

test('preview page includes the untouched native iframe without scripts or overlays', () => {
  const html = youtubePlayerPage('S4y482Pz-_U');
  assert.match(html, /<iframe title="YouTube video player"/);
  assert.match(html, /plays separately from the show queue/i);
  assert.match(html, /src="https:\/\/www\.youtube\.com\/embed\/S4y482Pz-_U\?controls=1&playsinline=1"/);
  assert.doesNotMatch(html, /<script|autoplay|position:\s*(?:absolute|fixed)/i);
});

test('external links are constrained to YouTube HTTPS hosts', () => {
  assert.equal(allowedYouTubeLink('https://www.youtube.com/watch?v=S4y482Pz-_U'), true);
  assert.equal(allowedYouTubeLink('https://youtu.be/S4y482Pz-_U'), true);
  for (const invalid of ['http://www.youtube.com/', 'https://www.youtube.com.attacker.invalid/', 'https://www.youtube.com:444/', 'https://user@www.youtube.com/', 'file:///etc/passwd', 'not a URL'])
    assert.equal(allowedYouTubeLink(invalid), false);
});
