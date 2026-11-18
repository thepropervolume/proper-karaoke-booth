import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileShow, newMobileShow, restoreMobileShow, type MobileSong } from '../../src/mobile/show';
import { youtubeLink } from '../../src/mobile/catalog';
const songs: MobileSong[] = [{ id: 'youtube_Video123456', title: 'Wonderwall', artist: 'Oasis', provider: 'karaokenerds', videoId: 'Video123456' },
  { id: 'local_video_file', title: 'A Local Song', artist: '', provider: 'local', fileName: 'my-video.mp4' }];
test('a restored mobile show retains its active turn but has no persisted play or authentication instruction', () => {
  const show = new MobileShow(); show.add(songs); show.request(songs[0].id); show.start();
  const saved = show.state(), restored = new MobileShow(restoreMobileShow(saved));
  assert.equal(restored.current()?.songId, songs[0].id);
  assert.deepEqual(Object.keys(saved).sort(), ['applauseEnabled','autoAdvance','currentId','favorites','format','gapSeconds','history','missingRequests','name','points','pointsEnabled','queue','singers','songs','volume'].sort());
  const changed = show.state(); changed.songs[0].title = 'Other'; assert.equal(show.state().songs[0].title, 'Wonderwall');
  assert.throws(() => restoreMobileShow({ ...saved, volume: NaN }));
  assert.throws(() => restoreMobileShow({ ...saved, currentId: 'missing' }));
  assert.throws(() => restoreMobileShow({ ...saved, songs: [...songs, songs[0]] }));
});
test('queue edits preserve the playing turn and guests can withdraw only their own waiting requests', () => {
  const show = new MobileShow(); show.add(songs);
  const playing = show.request(songs[0].id), a = show.request(songs[1].id, 'Alice', 'singer_alice'), b = show.request(songs[0].id, 'Ben', 'singer_ben');
  show.start(); show.move(b, -1); assert.equal(show.current()?.id, playing); assert.equal(show.next()?.id, b);
  assert.throws(() => show.remove(playing)); assert.throws(() => show.remove(a, 'singer_ben'));
  show.remove(a, 'singer_alice'); show.finish(); assert.equal(show.state().history.length, 1); assert.equal(show.start()?.id, b);
  show.finish(true); assert.equal(show.state().history.length, 1);
});
test('unavailable singers keep one upcoming request and become eligible at their exact return time', () => {
  let now = 10_000; const show = new MobileShow(newMobileShow(), () => now); show.add(songs);
  show.setAvailability('singer_alice', 1); const a = show.request(songs[0].id, 'Alice', 'singer_alice');
  assert.throws(() => show.request(songs[0].id, 'Alice', 'singer_alice'), /limit/); assert.equal(show.start(), null);
  now += 60_000; assert.equal(show.start()?.id, a);
  assert.throws(() => show.setAvailability('singer_alice', 61));
});
test('video links accept only exact YouTube watch identities, never arbitrary hosts or credentials', () => {
  assert.equal(youtubeLink('https://www.youtube.com/watch?v=Video123456')?.videoId, 'Video123456');
  assert.equal(youtubeLink('https://youtu.be/Video123456')?.videoId, 'Video123456');
  for (const input of ['http://youtube.com/watch?v=Video123456', 'https://youtube.com.attacker.test/watch?v=Video123456', 'https://u:p@youtube.com/watch?v=Video123456', 'https://youtube.com/embed/Video123456']) assert.equal(youtubeLink(input), null);
});
test('an older settings snapshot cannot erase concurrent requests or missing-song submissions', () => {
  const show = new MobileShow(); show.add(songs); const old = show.state();
  show.request(songs[0].id, 'Alice'); show.addMissingRequest('Alice', 'New Song', 'New Artist');
  show.settings({ ...old, volume: 0.4 });
  assert.equal(show.state().queue.length, 1); assert.equal(show.state().missingRequests.length, 1); assert.equal(show.state().volume, 0.4);
  assert.equal(restoreMobileShow(show.state()).missingRequests[0].title, 'New Song');
});
