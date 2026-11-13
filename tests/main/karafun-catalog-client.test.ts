import test from 'node:test';
import assert from 'node:assert/strict';
import { KaraFunCatalogClient, parseKaraFunCatalog } from '../../src/main/karafun-catalog-client';

const page = '<a href="/cl/123/0123456789abcdef0123456789abcdef/">Available in CSV format</a>';
const csv = 'Id;Title;Artist;Year;Duo;Explicit;"Date Added";Styles;Languages\r\n1;"A; Title";"Café Artist";2020;0;0;2020-01-01;Rock;English\r\n2;"A ""Quoted"" Title";Second Artist;2021;0;1;2021-01-01;Pop;French\r\n';
function reply(body: string, type = 'text/csv') { return new Response(body, { headers: { 'content-type': type } }); }
test('KaraFun preserves exact provider identity, quoted metadata and advisory flags', async () => {
  const songs = await parseKaraFunCatalog('\ufeff' + csv);
  assert.equal(songs.length, 2); assert.equal(songs[0].id, '1'); assert.equal(songs[0].title, 'A; Title');
  assert.equal(songs[1].title, 'A "Quoted" Title'); assert.equal(songs[1].explicit, true);
  assert.ok(songs.every(s => s.provider === 'karafun' && s.playbackAvailable === false && s.webUrl === null));
  for (const bad of [csv.replace('Id;Title', 'Title;Id'), csv + '1;Duplicate;Artist;2020;0;0;x;x;English\n', csv + '3;"Unfinished', csv.replace(';0;0;', ';0;maybe;')]) await assert.rejects(parseKaraFunCatalog(bad));
});
test('KaraFun catalog loads once for concurrent queries and refreshes after a day', async () => {
  let calls = 0, now = 0;
  const client = new KaraFunCatalogClient({ now: () => now, fetch: async (_url, init) => {
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'manual'); assert.equal(init?.headers, undefined);
    return ++calls % 2 ? reply(page, 'text/html') : reply(csv);
  } });
  const [a, b] = await Promise.all([client.search('cafe'), client.search('quoted')]);
  assert.equal(calls, 2); assert.equal(a.status, 'ok'); assert.equal(a.songs[0].artist, 'Café Artist'); assert.equal(b.songs[0].id, '2');
  a.songs[0].title = 'Changed'; assert.equal((await client.search('cafe')).songs[0].title, 'A; Title');
  now = 86_400_001; await client.search('artist'); assert.equal(calls, 4);
});
test('invalid queries never read a catalog or turn combining marks into all matches', async () => {
  const client = new KaraFunCatalogClient({ fetch: async () => { throw Error('Network must not be used'); } });
  for (const query of ['', 'a', '\u0301\u0301', 'x'.repeat(201), 'bad\nquery']) assert.equal((await client.search(query)).status, 'invalid-input');
});
test('off-site catalog links and unexpected media formats fail without a second request', async () => {
  for (const body of [page.replace('/cl/', 'https://evil.example/cl/'), '<a href="/foo">CSV</a>']) {
    let calls = 0; const client = new KaraFunCatalogClient({ fetch: async () => { calls++; return reply(body, 'text/html'); } });
    assert.equal((await client.search('artist')).status, 'invalid-response'); assert.equal(calls, 1);
  }
  const client = new KaraFunCatalogClient({ fetch: async () => reply(page, 'application/octet-stream') });
  assert.equal((await client.search('artist')).status, 'invalid-response');
});
test('whole catalog deadline bounds an uncooperative fetch and a stalled body', async () => {
  const never = new KaraFunCatalogClient({ timeoutMs: 10, fetch: () => new Promise(() => {}) });
  assert.equal((await never.search('artist')).status, 'timed-out');
  const stalled = new KaraFunCatalogClient({ timeoutMs: 10, fetch: async () => new Response(new ReadableStream(), { headers: { 'content-type': 'text/html' } }) });
  assert.equal((await stalled.search('artist')).status, 'timed-out');
});
test('failed refresh retains only a complete labeled snapshot and backs off repeated typing', async () => {
  let now = 0, calls = 0;
  const client = new KaraFunCatalogClient({ now: () => now, fetch: async () => {
    calls++; return calls === 1 ? reply(page, 'text/html') : calls === 2 ? reply(csv) : new Response('', { status: 429 });
  } });
  assert.equal((await client.search('artist')).status, 'ok');
  now = 86_400_001; const stale = await client.search('artist'); assert.equal(stale.songs.length, 2); assert.match(stale.message, /Saved catalog/);
  await client.search('quoted'); assert.equal(calls, 3);
});
