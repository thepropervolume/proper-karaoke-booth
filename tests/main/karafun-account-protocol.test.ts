import { test } from 'node:test';
import assert from 'node:assert/strict';
import { karaFunElements, karaFunEnvelopeOk, karaFunSessionKey, karaFunSignedRequest, karaFunValue, parseKaraFunXml } from '../../src/main/karafun-account-protocol';

test('account XML preserves bounded plain text, UTF-8, namespaced element names and CDATA', () => {
  const parsed = parseKaraFunXml('<?xml version="1.0"?><x:response status="ok"><x:session key="fixture-only-key"/><title><![CDATA[A < B]]> &#x2665; &amp;</title></x:response>');
  assert.equal(karaFunSessionKey(parsed), 'fixture-only-key'); assert.equal(karaFunEnvelopeOk(parsed), true);
  assert.equal(karaFunValue(parsed, 'title'), 'A < B ♥ &'); assert.equal(karaFunElements(parsed, 'session').length, 1);
  assert.equal(karaFunValue(parsed, 'missing'), null);
});
test('account XML rejects DTDs, external/custom entities, malformed text, processing instructions and ambiguous fields', () => {
  for (const input of ['<!DOCTYPE r [<!ENTITY e SYSTEM "file:///private">]><r>&e;</r>', '<!DOCTYPE r [<!ENTITY e "expanded">]><r>&e;</r>', '<r><a></r>', '<r/> <r/>', '<r a="one" a="two"/>', '<r id="1" x:id="2"/>', '<r>&unknown;</r>', '<r>&#0;</r>', '<r><?execute arbitrary?></r>', 'outside<r/>']) assert.throws(() => parseKaraFunXml(input), /Invalid KaraFun response/);
  assert.throws(() => karaFunSessionKey(parseKaraFunXml('<r><session key="a"/><session key="b"/></r>')));
  assert.throws(() => karaFunValue(parseKaraFunXml('<r status="ok"><status>error</status></r>'), 'status'));
  assert.throws(() => karaFunEnvelopeOk(parseKaraFunXml('<r><status>ok</status><status>ok</status></r>')));
  assert.equal(karaFunSessionKey(parseKaraFunXml('<r><session key="invalid key"/></r>')), null);
});
test('account XML limits byte size rather than only characters and bounds depth, nodes, attributes and values', () => {
  for (const input of ['<a>'.repeat(65) + '</a>'.repeat(65), '<r>' + '<v/>'.repeat(25_000) + '</r>', '<r ' + Array.from({ length: 65 }, (_, i) => `a${i}="v"`).join(' ') + '/>', '<r a="' + 'v'.repeat(8193) + '"/>', '<r>' + '♥'.repeat(720_000) + '</r>']) assert.throws(() => parseKaraFunXml(input), /Invalid KaraFun response/);
});
test('native signing matches a fixed protocol vector and keeps application identification honest', () => {
  const request = karaFunSignedRequest('search/top', { query: "A B!'", offset: '0' }, 'fixture-only-key', 1700000000);
  assert.equal(request.url, 'https://api.karafun.com/search/top?offset=0&query=A%20B%21%27&sk=fixture-only-key');
  assert.equal(request.headers['X-Request-Timestamp'], '1700000000');
  assert.equal(request.headers['X-Request-Signature'], '862a654ddf4d5be4f8d8b4e7405a83957b9a1291a8619493082d33a0893c718d');
  assert.match(request.headers['User-Agent'], /^TheProperVolume/); assert.doesNotMatch(request.headers['User-Agent'], /Macintosh|KaraFunDesktop/);
  assert.equal(new URL(request.url).searchParams.has('key'), false);
  assert.equal(new URL(request.url).searchParams.has('client'), false);
});
test('signed serialization is stable across query order and binds changed content, timestamp and owned session', () => {
  const first = karaFunSignedRequest('search/top', { query: 'A / B? ♥', offset: '0' }, 'fixture-key', 1_700_000_000);
  const reordered = karaFunSignedRequest('search/top', { offset: '0', query: 'A / B? ♥' }, 'fixture-key', 1_700_000_000);
  assert.deepEqual(reordered, first);
  const parsed = new URL(first.url); assert.equal(parsed.searchParams.get('query'), 'A / B? ♥'); assert.equal(parsed.searchParams.get('offset'), '0');
  assert.notEqual(karaFunSignedRequest('search/top', { query: 'Changed', offset: '0' }, 'fixture-key', 1_700_000_000).headers['X-Request-Signature'], first.headers['X-Request-Signature']);
  assert.notEqual(karaFunSignedRequest('search/top', { query: 'A / B? ♥', offset: '0' }, 'fixture-key', 1_700_000_001).headers['X-Request-Signature'], first.headers['X-Request-Signature']);
  assert.notEqual(karaFunSignedRequest('search/top', { query: 'A / B? ♥', offset: '0' }, 'different-key', 1_700_000_000).headers['X-Request-Signature'], first.headers['X-Request-Signature']);
  assert.equal(new URL(karaFunSignedRequest('search/top', { sk: 'attacker-key' }, 'fixture-key', 1).url).searchParams.get('sk'), 'fixture-key');
});
test('signing only accepts the supported read/preparation endpoints and valid session/timestamp data', () => {
  for (const path of ['https://attacker.invalid', '../session/open', 'song/delete', '/search/top', 'search/top?query=x']) assert.throws(() => karaFunSignedRequest(path, {}, 'fixture-key', 0));
  for (const session of ['', 'key with spaces', 'https://private.invalid', 'x'.repeat(4097)]) assert.throws(() => karaFunSignedRequest('search/top', {}, session, 0));
  for (const timestamp of [NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => karaFunSignedRequest('search/top', {}, 'fixture-key', timestamp));
});
