import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { extractBrandDirectory, extractBrandVideoIds } from '../../src/catalog/karaokenerds-web';

const brands = (body: string) => `<html><body><table><thead><tr><th>Brand</th><th>Tracks</th><th>Views</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
const brandRow = (name: string, url: string) => `<tr><td>${name}</td><td><a href="${url}">3 Tracks</a></td><td>42</td></tr>`;
const tracks = (body: string) => `<table id="list"><thead><tr><th>Artist</th><th>Title</th><th>Date</th><th></th></tr></thead><tbody>${body}</tbody></table>`;
const trackRow = (link: string) => `<tr><td>Example Artist</td><td>Example Song</td><td>October 3rd, 2023</td><td>${link}</td></tr>`;

test('extracts the actual canonical slugs and display names from community rows', () => {
  const html = brands(brandRow('The Proper Volume', '/Brand/TheProperVolume/') + brandRow('April&#39;s Music', '/Brand/April%27sMusic/') + brandRow('Karaok&#233;', '/Brand/Karaok%C3%A9/'));
  assert.deepEqual(extractBrandDirectory(html), [
    { name: 'The Proper Volume', slug: 'TheProperVolume' },
    { name: "April's Music", slug: "April'sMusic" },
    { name: 'Karaoké', slug: 'Karaoké' },
  ]);
});

test('rejects ambiguous, malicious, empty and oversized community pages', () => {
  const row = brandRow('Example', '/Brand/Example/');
  for (const html of [
    '', '<h1>Sign in</h1>', brands(''), brands(row + row), brands(brandRow('Example', 'https://evil.example/Brand/Example/')),
    brands(brandRow('Example', '/Brand/%2e%2e/')), brands(brandRow('Example', '/Brand/a%2Fb/')),
    brands(brandRow('Example', '/Brand/a%3Fb/')), brands(brandRow('Example', '/Brand/a%23b/')), brands(brandRow('Example', '/Brand/a%25b/')),
    brands(brandRow('Example', '/Brand/Example/?wrong=1')), brands(row) + brands(row), 'a'.repeat(8 * 1024 * 1024 + 1),
  ]) assert.throws(() => extractBrandDirectory(html));
});

test('extracts deduplicated video IDs only from the brand track table', () => {
  const one = '<a href="https://www.youtube.com/watch?v=abcDEF_123-&amp;list=example">Watch Online</a>';
  const two = '<a href="https://youtu.be/98765432100">Watch Online</a>';
  const unrelated = '<table><tbody><tr><td><a href="https://youtu.be/AAAAAAAAAAA">Watch Online</a></td></tr></tbody></table>';
  assert.deepEqual(extractBrandVideoIds(unrelated + tracks(trackRow(one) + trackRow(two) + trackRow(one) + trackRow('Offline'))), ['abcDEF_123-', '98765432100']);
});

test('refuses malformed or external watch links and ambiguous track tables', () => {
  const valid = trackRow('<a href="https://www.youtube.com/watch?v=abcDEF_123-">Watch Online</a>');
  for (const html of [
    '<p>Not a track page</p>', tracks('<tr><td>Only one cell</td></tr>'), tracks(valid) + tracks(valid),
    tracks(trackRow('<a href="https://evil.example/watch?v=abcDEF_123-">Watch Online</a>')),
    tracks(trackRow('<a href="https://www.youtube.com/watch?v=abcDEF_123-&amp;v=98765432100">Watch Online</a>')),
    tracks(trackRow('<a href="https://youtube.com.evil.example/watch?v=abcDEF_123-">Watch Online</a>')),
  ]) assert.throws(() => extractBrandVideoIds(html));
});
