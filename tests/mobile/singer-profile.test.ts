import assert from 'node:assert/strict';
import test from 'node:test';
import { accessSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import {
  parseSingerProfile, singerRecordingIdentity, starredPlaylist, updateSingerProfile,
  type SingerPlaylistRecording, type SingerProfile, type SingerProfileAction,
} from '../../src/mobile/singer-profile';

const oasis = { title: 'Wonderwall', artist: 'Oasis', source: 'karaokenerds', recordingKey: 'youtube:Video123456' } as const;
const local = { title: 'Wonderwall', artist: 'Oasis', source: 'local', roomId: 'my-room', id: 'local_song' } as const;

test('singer identity and playlists are independent of room admission', () => {
  const original = parseSingerProfile(undefined);
  const profile = updateSingerProfile(original, { type: 'identity', displayName: '  Singer  ', email: 'person@example.com' });
  const first = updateSingerProfile(profile, { type: 'create-playlist', playlistId: 'first', name: ' Try next ', recording: oasis });
  const second = updateSingerProfile(first, { type: 'create-playlist', playlistId: 'second', name: 'Duets', recording: local });
  const renamed = updateSingerProfile(second, { type: 'rename-playlist', playlistId: 'first', name: 'Weekends' });
  assert.equal(original.displayName, '');
  assert.equal(first.playlists[0].name, 'Try next');
  assert.equal(renamed.displayName, 'Singer');
  assert.equal(renamed.email, 'person@example.com');
  assert.deepEqual(renamed.playlists.map(playlist => playlist.name), ['Weekends', 'Duets']);
  assert.throws(() => updateSingerProfile(profile, { type: 'identity', displayName: 'bad\nname', email: '' }), /valid optional email/);
  assert.throws(() => updateSingerProfile(profile, { type: 'identity', displayName: '', email: 'not an email' }), /valid optional email/);
  assert.deepEqual(updateSingerProfile(renamed, { type: 'remove-playlist', playlistId: 'second' }).playlists.map(playlist => playlist.id), ['first']);
});

test('playlist entries match exact recording versions and keep room-only IDs scoped', () => {
  let profile = updateSingerProfile(parseSingerProfile(undefined), { type: 'create-playlist', playlistId: 'first', name: 'Songs', recording: oasis });
  const add = (recording: SingerPlaylistRecording) => { profile = updateSingerProfile(profile, { type: 'add-recording', playlistId: 'first', recording }); };
  add({ ...oasis, source: 'youtube' });
  add({ title: oasis.title, artist: oasis.artist, source: 'karafun', recordingKey: 'karafun:catalog:123' });
  add(local);
  add({ ...local, roomId: 'other-room' });
  const before = profile.playlists[0].recordings.map(singerRecordingIdentity);
  assert.deepEqual(before, ['youtube:Video123456', 'karafun:catalog:123', 'room:my-room:local_song', 'room:other-room:local_song']);
  profile = updateSingerProfile(profile, { type: 'remove-recording', playlistId: 'first', key: 'room:my-room:local_song' });
  assert.deepEqual(profile.playlists[0].recordings.map(singerRecordingIdentity), ['youtube:Video123456', 'karafun:catalog:123', 'room:other-room:local_song']);
  assert.throws(() => add({ title: 'Wonderwall', artist: 'Oasis', id: 'unscoped' }), /no playlist identity/);
});

test('singer stars create, deduplicate, rename and remove recordings in one per-profile playlist', () => {
  const initial = parseSingerProfile(undefined);
  const star = (recording: SingerPlaylistRecording, selected = true, newPlaylistId = 'stars'): Extract<SingerProfileAction, { type: 'set-starred' }> =>
    ({ type: 'set-starred', recording, selected, newPlaylistId, displayName: 'Greg The Egg' });
  const first = updateSingerProfile(initial, star(oasis));
  assert.equal(starredPlaylist(first)?.name, "Greg The Egg's Starred Songs");
  assert.equal(starredPlaylist(first)?.kind, 'starred');
  assert.deepEqual(updateSingerProfile(first, star({ ...oasis, source: 'youtube' }, true, 'another-id')), first);
  assert.deepEqual(parseSingerProfile(first), first);
  const renamed = updateSingerProfile(first, { type: 'identity', displayName: 'Gregory', email: '' });
  assert.equal(starredPlaylist(renamed)?.name, "Gregory's Starred Songs");
  assert.deepEqual(starredPlaylist(renamed)?.recordings, [oasis]);
  assert.deepEqual(starredPlaylist(updateSingerProfile(renamed, star(oasis, false)))?.recordings, []);
  assert.deepEqual(initial.playlists, []);
  const manual = updateSingerProfile(initial, { type: 'create-playlist', playlistId: 'current', name: 'Starred Songs', recording: local });
  const adopted = updateSingerProfile(manual, { ...star(oasis), displayName: undefined });
  assert.equal(adopted.playlists.length, 1);
  assert.equal(starredPlaylist(adopted)?.id, 'current');
  assert.deepEqual(starredPlaylist(adopted)?.recordings, [local, oasis]);
});

test('saved profile parsing preserves valid fields and excludes foreign session details', () => {
  const incoming = { ...oasis, invitation: 'private', playbackUrl: 'https://host.example', roomId: 'remove', id: 'remove' };
  const profile = updateSingerProfile(parseSingerProfile(undefined), { type: 'create-playlist', playlistId: 'first', name: 'Songs', recording: incoming });
  assert.deepEqual(profile.playlists[0].recordings, [oasis]);
  assert.deepEqual(parseSingerProfile({ ...profile, session: 'private' }), profile);
  assert.throws(() => parseSingerProfile({ ...profile, format: 2 }), /has been preserved/);
  assert.throws(() => parseSingerProfile({ ...profile, playlists: [profile.playlists[0], profile.playlists[0]] }), /has been preserved/);
  assert.throws(() => parseSingerProfile({ ...profile, playlists: [{ ...profile.playlists[0], recordings: [oasis, oasis] }] }), /has been preserved/);
});

const chromiumPaths = process.platform === 'win32' ? [join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')] : process.platform === 'darwin' ?
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const executablePath = chromiumPaths.find(path => { try { accessSync(path); return true; } catch { return false; } });

test('singer writes serialize across browser tabs and survive reload', { skip: executablePath || process.env.TPV_REQUIRE_CHROMIUM === '1' ? false : 'Chromium is required for IndexedDB coverage.', timeout: 60_000 }, async () => {
  assert.ok(executablePath, 'Chromium is required for the mobile release tests.');
  const browser = await chromium.launch({ executablePath, headless: true,
    args: process.platform !== 'win32' && process.getuid?.() === 0 ? ['--no-sandbox'] : [] });
  const server = createServer();
  try {
    const repo = resolve(import.meta.dirname, '../..');
    const bundle = await build({ stdin: { contents: "import * as profile from './src/mobile/singer-profile'; window.singerStorage = profile;", resolveDir: repo }, bundle: true, platform: 'browser', write: false });
    server.on('request', (request, response) => {
      if (request.url === '/profile.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); }
      else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="en"><title>Singer storage test</title><script src="/profile.js"></script></html>'); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const context = await browser.newContext();
    const first = await context.newPage(), second = await context.newPage();
    const url = `http://127.0.0.1:${address.port}`;
    await Promise.all([first.goto(url), second.goto(url)]);
    type SingerWindow = Window & { singerStorage: typeof import('../../src/mobile/singer-profile') };
    const commit = (action: SingerProfileAction) => (window as unknown as SingerWindow).singerStorage.saveSingerProfile(action);
    await Promise.all([
      first.evaluate<SingerProfile, SingerProfileAction>(commit, { type: 'create-playlist', playlistId: 'first', name: 'Songs', recording: oasis }),
      second.evaluate<SingerProfile, SingerProfileAction>(commit, { type: 'identity', displayName: 'Singer', email: 'person@example.com' }),
    ]);
    await first.reload();
    const stored = await first.evaluate(() => (window as unknown as SingerWindow).singerStorage.loadSingerProfile());
    assert.deepEqual(stored, { format: 1, displayName: 'Singer', email: 'person@example.com', playlists: [{ id: 'first', name: 'Songs', recordings: [oasis] }] });
    const guestStar = { type: 'set-starred', selected: true, newPlaylistId: 'starred', recording: oasis, displayName: 'Greg The Egg' } as const;
    await first.evaluate(action => (window as unknown as SingerWindow).singerStorage.saveSingerProfile(action, 'Greg The Egg'), guestStar);
    await second.reload();
    const guestProfile = await second.evaluate(() => (window as unknown as SingerWindow).singerStorage.loadSingerProfile('Greg The Egg'));
    assert.deepEqual(starredPlaylist(guestProfile)?.recordings, [oasis]);
    const otherGuest = await second.evaluate(() => (window as unknown as SingerWindow).singerStorage.loadSingerProfile('Other Singer'));
    assert.deepEqual(otherGuest.playlists, []);
    assert.deepEqual(await second.evaluate(() => (window as unknown as SingerWindow).singerStorage.loadSingerProfile()), stored);
    await context.close();
  } finally {
    await browser.close();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
