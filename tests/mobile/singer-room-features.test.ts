import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GuestSnapshot, Song } from '../../src/remote/client';
import { invitationMessage, singerInvite } from '../../src/mobile/singer-invite';
import { mergePerformances } from '../../src/mobile/singer-performance-history';
import { projectGuestStage } from '../../src/domain/guest-stage';

test('a room invitation contains only a validated public join link and the message', () => {
  assert.equal(singerInvite('https://outside.test/', 'Invalid'), null);
  assert.equal(singerInvite('room?secret=yes', 'Invalid'), null);
  const invite = singerInvite('friday-night', 'Friday Night')!;
  assert.equal(new URL(invite.url).searchParams.get('room'), 'friday-night');
  assert.match(invitationMessage(invite), /^Join me for karaoke in Friday Night!\nhttps:/);
});

test('performance history keeps host-confirmed completions once per show and skips unknown songs', () => {
  const song = { id: 'song', title: 'A Song', artist: 'The Artist' };
  const songs = new Map<string, Song>([[song.id, song]]);
  const snapshot: GuestSnapshot = {
    showId: 'show1', hostEpoch: 'epoch', revision: 1, singerId: 'singer', singerName: 'Ben', catalog: [], catalogNextOffset: null,
    requests: [{ id: 'one', status: 'completed', versionId: 'song' },
      { id: 'two', status: 'skipped', versionId: 'song' },
      { id: 'three', status: 'completed', versionId: 'missing' }],
  };
  const history = mergePerformances([], snapshot, songs, 1_000);
  assert.deepEqual(history, [{ key: 'show1:one', title: 'A Song', artist: 'The Artist', observedAt: 1_000 }]);
  assert.equal(mergePerformances(history, snapshot, songs, 2_000), history);
  assert.equal(mergePerformances(history, { ...snapshot, showId: 'show2' }, songs, 3_000).length, 2);
});

test('guest-stage projection drops private clap metadata and tolerates older hosts', () => {
  const baseline = { nowPlaying: null, queue: [], queueTruncated: false };
  assert.deepEqual(projectGuestStage(baseline), baseline);
  const applause = { id: 'e55a912c-6c2c-48f4-95ac-aca49bd4d143', atMs: 10_000 };
  const stage = projectGuestStage({ ...baseline, applause: { ...applause, sourceSinger: 'private', generation: 'private' } });
  assert.deepEqual(stage?.applause, applause);
  assert.equal(projectGuestStage({ ...baseline, applause: { id: 'user@private.test', atMs: 1 } })?.applause, undefined);
});
