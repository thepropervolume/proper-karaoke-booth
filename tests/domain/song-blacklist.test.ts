import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSongBlacklist, MAX_BLACKLIST_ARTISTS, MAX_BLACKLIST_SONGS, normalizeBlacklistIdentity, parseArtistBlacklist, parseSongBlacklist } from '../../src/domain/song-blacklist';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/domain/settings';
import { applySettingsPatch } from '../../src/main/settings-patch';

test('older settings migrate to empty host-wide song and artist blacklists', () => {
  const first = parseSettings({}), second = parseSettings({});
  assert.deepEqual(first.songBlacklist, []);
  assert.deepEqual(first.artistBlacklist, []);
  assert.notEqual(first.songBlacklist, second.songBlacklist);
  assert.notEqual(first.artistBlacklist, DEFAULT_SETTINGS.artistBlacklist);
  assert.equal(compileSongBlacklist(first).isBlocked({ artist: 'Artist', title: 'Song' }), false);
});

test('blacklist metadata folds Unicode, typography, case and spacing while retaining distinct identities', () => {
  assert.equal(normalizeBlacklistIdentity('  Ｂｅｙｏｎｃｅ\u0301\u00a0  –  Don’t Stop '), "beyoncé - don't stop");
  const matcher = compileSongBlacklist({ artistBlacklist: ['Beyoncé'], songBlacklist: [{ artist: 'Artist', title: 'Don’t Stop' }] });
  assert.equal(matcher.match({ artist: 'BEYONCE\u0301', title: 'Anything' }), 'artist');
  assert.equal(matcher.match({ artist: 'artist', title: "  don't  stop " }), 'song');
  assert.equal(matcher.match({ artist: 'Beyonce', title: 'Anything' }), null, 'Accents are not discarded.');
  assert.equal(matcher.match({ artist: 'Artist', title: 'Dont Stop' }), null, 'Meaningful punctuation is retained.');
});

test('song identity blocks every recording version without blocking another artist or similarly named song', () => {
  const matcher = compileSongBlacklist({ songBlacklist: [{ artist: 'Nada Surf', title: 'Amateur' }], artistBlacklist: [] });
  for (const recording of [{ id: 'local-1', source: 'local' }, { id: 'local-2', source: 'local' }, { id: 'catalog-1', source: 'karaokenerds' }, { id: 'provider-1', source: 'karafun' }]) {
    assert.equal(matcher.isBlocked({ ...recording, artist: 'NADA  SURF', title: 'amateur' }), true);
  }
  assert.equal(matcher.isBlocked({ artist: 'Other Artist', title: 'Amateur' }), false);
  assert.equal(matcher.isBlocked({ artist: 'Nada Surf', title: 'Amateur Hour' }), false);
  assert.equal(matcher.isBlocked({ artist: 'Nada Surf Tribute', title: 'Amateur' }), false);
});

test('artist blacklist applies to every song and explicit performer metadata without guessing partial names', () => {
  const matcher = compileSongBlacklist({ songBlacklist: [], artistBlacklist: ['The The', 'AC/DC'] });
  for (const title of ['Song One', 'Song Two']) assert.equal(matcher.match({ artist: 'the the', title }), 'artist');
  assert.equal(matcher.isBlocked({ artist: 'The', title: 'Song One' }), false);
  assert.equal(matcher.isBlocked({ artist: 'AC DC', title: 'Song One' }), false);
  assert.equal(matcher.isBlocked({ artist: 'Artist A & AC/DC', artists: ['Artist A', 'AC/DC'], title: 'Duet' }), true);
  assert.equal(matcher.isBlocked({ artist: null, title: 'Song One' }), false);
});

test('unknown artist is an exact song identity rather than a wildcard artist', () => {
  const matcher = compileSongBlacklist({ songBlacklist: [{ artist: '', title: 'Song' }], artistBlacklist: [] });
  assert.equal(matcher.match({ artist: null, title: 'Song' }), 'song');
  assert.equal(matcher.match({ artist: '', title: 'Song' }), 'song');
  assert.equal(matcher.match({ artist: 'Known Artist', title: 'Song' }), null);
  assert.equal(matcher.match({}), null);
});

test('saving, removing and resetting blacklist rules creates a new policy without mutating prior settings', () => {
  const input = { songBlacklist: [{ artist: ' Artist ', title: ' Song ' }], artistBlacklist: [' Other Artist '] };
  const settings = applySettingsPatch(parseSettings({}), input), installed = compileSongBlacklist(settings);
  input.songBlacklist[0].title = 'Changed'; input.artistBlacklist[0] = 'Changed';
  assert.deepEqual(settings.songBlacklist, [{ artist: 'Artist', title: 'Song' }]);
  const removed = applySettingsPatch(settings, { songBlacklist: [], artistBlacklist: [] });
  assert.equal(compileSongBlacklist(removed).isBlocked({ artist: 'Artist', title: 'Song' }), false);
  assert.equal(installed.isBlocked({ artist: 'Artist', title: 'Song' }), true);
  settings.songBlacklist[0].title = 'Mutated after compile'; settings.artistBlacklist.length = 0;
  assert.equal(installed.isBlocked({ artist: 'Artist', title: 'Song' }), true);
  assert.equal(installed.isBlocked({ artist: 'Other Artist', title: 'Anything' }), true);
});

test('malformed, oversized and duplicate rules are rejected before changing any host settings', () => {
  for (const value of [null, {}, '', [null], ['Song'], [{ title: 'Song' }], [{ artist: 'Artist', title: '' }], [{ artist: 4, title: 'Song' }],
    [{ artist: 'Artist', title: 'Song', versionId: 'version' }], [{ artist: 'Artist', title: 'bad\nname' }], [{ artist: 'x'.repeat(501), title: 'Song' }]])
    assert.throws(() => parseSongBlacklist(value), /song|blacklist/i);
  for (const value of [null, {}, '', [''], [5], ['bad\nname'], ['x'.repeat(501)]])
    assert.throws(() => parseArtistBlacklist(value), /artist|blacklist/i);
  assert.throws(() => parseSongBlacklist(Array(MAX_BLACKLIST_SONGS + 1).fill({ artist: 'A', title: 'T' })), /at most/);
  assert.throws(() => parseArtistBlacklist(Array(MAX_BLACKLIST_ARTISTS + 1).fill('A')), /at most/);
  assert.throws(() => parseSettings({ songBlacklist: [{ artist: 'Artist', title: 'Don’t Stop' }, { artist: 'artist', title: "Don't Stop" }] }), /Duplicate song/);
  assert.throws(() => parseSettings({ artistBlacklist: ['Beyoncé', 'BEYONCE\u0301'] }), /Duplicate artist/);
  const inherited = Object.create({ artist: 'Artist' }); inherited.title = 'Song';
  assert.throws(() => parseSongBlacklist([inherited]), /only artist and title/);
});
