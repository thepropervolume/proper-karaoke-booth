import { strict as assert } from 'node:assert';
import test from 'node:test';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { PARTY_TYME_CATALOG_URL, PartyTymeCatalogClient, parsePartyTymeCatalog } from '../../src/main/partytyme-catalog-client';

const headings = ['New', 'Date of Release', 'HD Code', 'SONG TITLE', 'ARTIST', 'GENRE', 'LANG', 'SONG KEY', 'COVER TIME'];
const row = (id: string, title = 'Popular', artist = 'Nada Surf', time = '3:37') =>
  '<tr>' + ['NEW', '11/13/2026', id, title, artist, 'Rock', 'English', 'G major', time].map(value => '<td>' + value + '</td>').join('') + '</tr>';
const catalog = (...rows: string[]) => '<html><table><tr>' + headings.map(value => '<th>' + value + '</th>').join('') + '</tr>' + rows.join('') + '</table></html>';
const html = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });

test('Party Tyme public catalog preserves exact HD identity and safe metadata without media or account fields', async () => {
  const songs = await parsePartyTymeCatalog(catalog(row('PH00382', 'Amateur &amp; Other', 'Bôa', '3.37')));
  assert.deepEqual(songs, [{ provider: 'partytyme', id: 'PH00382', title: 'Amateur & Other', artist: 'Bôa',
    language: 'English', durationSeconds: 217, webUrl: PARTY_TYME_CATALOG_URL, playbackAvailable: false }]);
  assert.equal((await parsePartyTymeCatalog(catalog(row('PH00383', 'Unknown time', 'Artist', 'unknown'))))[0].durationSeconds, null);
});

test('Party Tyme rejects malformed, changed, duplicate, active and truncated catalog data instead of reporting an empty search', async () => {
  for (const value of [
    '<html>Sign in</html>', catalog().replace('HD Code', 'ID'), catalog(row('wrong-id')), catalog(row('PH00382', '')),
    catalog(row('PH00382'), row('PH00382')), catalog(row('PH00382', '<script>secret</script>')),
    catalog(row('PH00382')).replace('</table>', ''), catalog(row('PH00382')).replace('</tr></table>', '</table>'),
    catalog(row('PH00382', 'http://example.com/private')), catalog(row('PH00382', 'bad\u0000title')),
    catalog(row('PH00382')) + '<tr>'.repeat(2048), catalog(row('PH00382', 'x'.repeat(25_000))),
  ]) await assert.rejects(parsePartyTymeCatalog(value));
});

test('Party Tyme requires the selected catalog table to close and rejects rows outside that table', async () => {
  const valid = catalog(row('PH00382'));
  const truncated = valid.replace('</table>', '');
  for (const value of [
    '<table></table>' + truncated,
    truncated + '<table></table>',
    '<table>' + valid + '</table>',
    row('PH00383') + valid,
    valid + row('PH00383'),
    valid + '</tr>',
    valid.replace('</table>', '</table broken>'),
  ]) await assert.rejects(parsePartyTymeCatalog(value));
  assert.equal((await parsePartyTymeCatalog(valid))[0].id, 'PH00382');
  const client = new PartyTymeCatalogClient({ fetch: async () => html('<table></table>' + truncated) });
  const result = await client.search('popular');
  assert.equal(result.status, 'invalid-response'); assert.deepEqual(result.songs, []);
});

test('Party Tyme shares a daily bounded snapshot across queries and returns searchable case/diacritic-insensitive metadata', async () => {
  let calls = 0, now = 1000;
  const client = new PartyTymeCatalogClient({ now: () => now, fetch: async (url, init) => {
    calls++; assert.equal(url, PARTY_TYME_CATALOG_URL); assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return html(catalog(row('PH00382'), row('PH00383', 'Duvet', 'Bôa')));
  } });
  const [first, second] = await Promise.all([client.search('nada popular'), client.search('boa')]);
  assert.equal(first.status, 'ok'); assert.equal(first.songs[0].id, 'PH00382');
  assert.equal(second.songs[0].id, 'PH00383'); assert.equal(calls, 1);
  assert.equal((await client.search('no matches')).songs.length, 0); assert.equal(calls, 1);
  now += 24 * 60 * 60 * 1000;
  assert.equal((await client.search('popular')).status, 'ok'); assert.equal(calls, 2);
});

test('Party Tyme never exceeds 50 results and prioritizes an exact recording code', async () => {
  const body = catalog(...Array.from({ length: 70 }, (_, index) => row('PH' + String(index).padStart(5, '0'), 'Song ' + index, 'Artist')));
  const client = new PartyTymeCatalogClient({ fetch: async () => html(body) });
  const result = await client.search('song'); assert.equal(result.songs.length, 50);
  assert.equal((await client.search('PH00069')).songs[0].id, 'PH00069');
  result.songs[0].title = 'Client changed';
  assert.notEqual((await client.search('song')).songs[0].title, 'Client changed');
});

test('Party Tyme retains a clearly labeled older snapshot after failed refresh and backs off without retry storms', async () => {
  let calls = 0, now = 1000;
  const client = new PartyTymeCatalogClient({ now: () => now, fetch: async () => {
    calls++; return calls === 1 ? html(catalog(row('PH00382'))) : new Response('private-provider-body', { status: 503 });
  } });
  await client.search('popular'); now += 24 * 60 * 60 * 1000;
  const result = await client.search('popular');
  assert.equal(result.status, 'ok'); assert.match(result.message, /older cached/); assert.equal(result.songs.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-body/);
  await client.search('nada'); assert.equal(calls, 2);
  now += 15 * 60 * 1000; await client.search('nada'); assert.equal(calls, 3);
});

test('Party Tyme errors, oversized responses, redirects and timeouts are bounded and never echo provider bodies', async () => {
  for (const [response, expected] of [
    [new Response('secret', { status: 401 }), 'unauthorized'], [new Response('secret', { status: 403 }), 'unauthorized'],
    [new Response('secret', { status: 429 }), 'rate-limited'], [new Response('secret', { status: 503 }), 'unavailable'],
    [new Response('{}', { headers: { 'Content-Type': 'application/json' } }), 'invalid-response'],
    [new Response('secret', { headers: { 'Content-Type': 'text/html', 'Content-Length': String(25 * 1024 * 1024) } }), 'invalid-response'],
    [html('<html>Sign in to your account</html>'), 'invalid-response'],
  ] as const) {
    const result = await new PartyTymeCatalogClient({ fetch: async () => response }).search('popular');
    assert.equal(result.status, expected); assert.deepEqual(result.songs, []); assert.doesNotMatch(JSON.stringify(result), /secret|Sign in/);
  }
  assert.equal((await new PartyTymeCatalogClient({ fetch: async () => { throw Error('credential-value'); } }).search('popular')).status, 'unavailable');
  let finish!: (response: Response) => void;
  const client = new PartyTymeCatalogClient({ fetch: async () => new Promise(resolve => { finish = resolve; }), timeoutMs: 5 });
  assert.equal((await client.search('popular')).status, 'timed-out');
  finish(html(catalog(row('PH00382')))); await yieldTurn();
  assert.equal((await client.search('popular')).status, 'timed-out');
});

test('Party Tyme validates query input before fetching the public catalog', async () => {
  let calls = 0;
  const client = new PartyTymeCatalogClient({ fetch: async () => { calls++; return html(catalog(row('PH00382'))); } });
  for (const query of ['', 'a', 'x'.repeat(161), 'bad\nquery', '\u0301\u0301']) assert.equal((await client.search(query)).status, 'invalid-input');
  assert.equal(calls, 0);
  assert.throws(() => new PartyTymeCatalogClient({ timeoutMs: NaN }));
});
