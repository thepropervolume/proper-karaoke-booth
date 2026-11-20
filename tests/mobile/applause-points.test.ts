import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MobileShow, newMobileShow, restoreMobileShow, type MobileShowState } from '../../src/mobile/show';
import { MobileRoomAuthority, mobileSecret } from '../../src/mobile/room-authority';
import { MobilePhotoReview, type GuestPhotoPreview } from '../../src/mobile/photo-review';
import { validMobilePhoto } from '../../src/mobile/photo-validation';

const jpegHeader = (width: number, height: number) => 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 0xff, 0xd9]).toString('base64');
test('mobile photo dimensions are checked before browser decoding', () => {
  assert.equal(validMobilePhoto(jpegHeader(1280, 720)), true);
  assert.equal(validMobilePhoto(jpegHeader(65535, 720)), false);
  assert.equal(validMobilePhoto(jpegHeader(0, 720)), false);
  assert.equal(validMobilePhoto('data:image/jpeg;base64,/9j/2Q=='), false);
});

const song = { id: 'youtube_Video123456', title: 'Wonderwall', artist: 'Oasis', provider: 'youtube' as const, videoId: 'Video123456' };
const options = (show: MobileShow, id: string) => show.state().points?.accounts.find(account => account.singerId === id);

test('older mobile shows migrate without losing songs, queue, history, or preferences', () => {
  const prior = new MobileShow(); prior.add([song]); prior.request(song.id, 'Singer'); prior.start(); prior.finish();
  const legacy = structuredClone(prior.state()) as Partial<MobileShowState>;
  delete legacy.applauseEnabled; delete legacy.pointsEnabled; delete legacy.points; delete legacy.singers;
  const restored = restoreMobileShow(legacy);
  assert.equal(restored.applauseEnabled, true);
  assert.equal(restored.pointsEnabled, true);
  assert.equal(restored.queue.length, 1);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.songs[0].title, 'Wonderwall');
  assert.equal(restored.singers[0].name, 'Singer');
});

test('mobile host preserves singer credits, awards duet and all-listener bonuses, and honors three-voice failures', async () => {
  const show = new MobileShow(); show.add([{ ...song, isDuet: true }]);
  show.request(song.id, 'Lead', 'singer_lead', 'request_song_001', 'Partner');
  const partner = show.state().singers.find(singer => singer.name === 'Partner')!;
  show.registerSinger('singer_jon1', 'Jon');
  show.registerSinger('singer_jane', 'Jane');
  show.registerSinger('singer_mark', 'Mark');
  assert.equal(options(show, 'singer_lead')?.points, 32);
  assert.equal(options(show, partner.id)?.points, 14);
  show.start(); show.setPlaybackActive(true);
  for (const [id, actor] of [['a1', 'singer_jon1'], ['a2', 'singer_jane'], ['a3', 'singer_mark']] as const)
    await show.applaud({ role: 'singer', singerId: actor }, id, async () => {});
  await show.applaud({ role: 'host' }, 'host01', async () => {});
  assert.equal(options(show, 'singer_lead')?.points, 152);
  assert.equal(options(show, partner.id)?.points, 134);
  assert.equal(options(show, 'singer_jon1')?.credits, 2);
  await assert.rejects(show.applaud({ role: 'singer', singerId: 'singer_jon1' }, 'failure', async () => { throw new Error('Three applause tracks are already playing.'); }), /Three applause/);
  assert.equal(options(show, 'singer_jon1')?.credits, 2);
  show.finish();
  assert.equal(options(show, 'singer_lead')?.points, 152);
  assert.equal(options(show, partner.id)?.points, 134);
  assert.equal(options(show, 'singer_lead')?.credits, 4);
  assert.equal(restoreMobileShow(show.state()).points?.accounts.find(a => a.singerId === partner.id)?.points, 134);
});

test('late audio acknowledgements cannot transfer points to another song', async () => {
  const show = new MobileShow(newMobileShow()); show.add([song]);
  show.request(song.id, 'Lead', 'singer_lead', 'request_song_001');
  show.registerSinger('singer_fan1', 'Fan');
  show.start(); show.setPlaybackActive(true);
  let complete!: () => void;
  const pending = show.applaud({ role: 'singer', singerId: 'singer_fan1' }, 'one', () => new Promise<void>(resolve => { complete = resolve; }));
  await new Promise(resolve => setTimeout(resolve, 0));
  show.finish(); complete();
  await assert.rejects(pending, /changed/);
  assert.equal(options(show, 'singer_fan1')?.credits, 3);
  assert.equal(options(show, 'singer_lead')?.points, 18);
});

test('mobile room binds applause and moderated photo delivery to its authenticated guest and retries once', async () => {
  const show = new MobileShow(); show.add([song]); let played = 0, shown = 0;
  const previews: GuestPhotoPreview[] = [];
  const review = new MobilePhotoReview(preview => { if (preview) previews.push(preview); }, async () => { shown++; }, () => {}, () => true);
  const authority = new MobileRoomAuthority(show, () => {}, async () => { played++; }, review);
  const call = (operation: string, payload: unknown, session?: string) => ({ requestId: crypto.randomUUID(), operation, payload, ...(session ? { session } : {}) });
  const join = authority.dispatch(call('join', { joinId: mobileSecret(), resumeSecret: mobileSecret(), name: 'Guest', expectedRevision: show.revision }));
  const { session, singerId } = join.body as { session: string; singerId: string };
  const admission = authority.dispatch(call('admission', {})).body as { showId: string; hostEpoch: string };
  const info = { showId: admission.showId, hostEpoch: admission.hostEpoch };
  const applause = { commandId: mobileSecret(), ...info, expectedRevision: show.revision };
  show.registerSinger('singer_late1', 'Later guest'); // Unrelated activity must not invalidate applause.
  const first = await authority.dispatchApplause(call('applause', { command: applause }, session));
  const second = await authority.dispatchApplause(call('applause', { command: applause }, session));
  assert.deepEqual(first.body, second.body); assert.equal(played, 1); assert.equal(options(show, singerId)?.credits, 2);
  const photo = { commandId: mobileSecret(), ...info, expectedRevision: 0, dataUrl: jpegHeader(100, 100) };
  const photoFirst = await authority.dispatchPhoto(call('photo', { command: photo }, session));
  const photoAgain = await authority.dispatchPhoto(call('photo', { command: photo }, session));
  assert.deepEqual(photoFirst.body, photoAgain.body); assert.equal(previews.length, 1); assert.equal(shown, 0); assert.equal(options(show, singerId)?.points, 0);
  const conflict = await authority.dispatchPhoto(call('photo', { command: { ...photo, dataUrl: jpegHeader(50, 50) } }, session));
  assert.equal(conflict.status, 400);
  await review.approve(previews[0].id); await review.approve(previews[0].id);
  assert.equal(shown, 1); assert.equal(options(show, singerId)?.points, 24);
  const recovered = authority.dispatch(call('outcome', { commandId: photo.commandId }, session));
  assert.deepEqual(recovered.body, photoFirst.body);
  await authority.dispatchPhoto(call('photo', { command: { ...photo, commandId: mobileSecret() } }, session));
  authority.reset();
  await review.approve(previews[1].id);
  assert.equal(shown, 1); assert.equal(options(show, singerId)?.points, 24);
  assert.equal(JSON.stringify(show.state()).includes(photo.dataUrl), false);
});
