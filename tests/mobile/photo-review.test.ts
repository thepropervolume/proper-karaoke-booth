import assert from 'node:assert/strict';
import test from 'node:test';
import { MobilePhotoReview, type GuestPhotoPreview } from '../../src/mobile/photo-review';

test('photo review accepts one preview, then expires or discards without display', async () => {
  const previews: (GuestPhotoPreview | null)[] = [];
  let now = 1_000;
  const forbidden = () => assert.fail('A photo was shown without a current approval.');
  const review = new MobilePhotoReview(preview => previews.push(preview), async () => forbidden(), () => {}, () => true, 45_000, () => now);
  review.submit('Singer', 'photo a', forbidden);
  assert.throws(() => review.submit('Another singer', 'photo b', forbidden), /already reviewing/);
  now += 45_000;
  await review.approve(previews[0]!.id);
  assert.equal(previews.at(-1), null);
  review.submit('Another singer', 'photo b', forbidden);
  review.discard(previews.at(-1)!.id);
  assert.equal(previews.at(-1), null);
});

test('the review deadline clears an untouched image without waiting for a host action', { timeout: 1000 }, async () => {
  let expire!: () => void;
  const expired = new Promise<void>(resolve => { expire = resolve; });
  const forbidden = () => assert.fail('An unreviewed photo reached the display.');
  const review = new MobilePhotoReview(preview => { if (!preview) expire(); }, async () => forbidden(), () => {}, () => true, 5);
  review.submit('Singer', 'photo', forbidden);
  await expired;
});

test('closing review withdraws an in-flight presentation and fences late display confirmation', async () => {
  const previews: (GuestPhotoPreview | null)[] = [];
  let complete!: () => void, cleared = 0, awarded = 0;
  const review = new MobilePhotoReview(preview => previews.push(preview), () => new Promise<void>(resolve => { complete = resolve; }),
    () => { cleared++; }, () => true);
  review.submit('Singer', 'photo', () => { awarded++; });
  const approval = review.approve(previews[0]!.id);
  assert.equal(awarded, 0);
  review.clear();
  complete();
  await approval;
  assert.equal(awarded, 0);
  assert.equal(cleared, 1);
});

test('hidden screens reject pictures and decode failures never confirm delivery', async () => {
  const previews: GuestPhotoPreview[] = [];
  let visible = false, awarded = 0;
  const review = new MobilePhotoReview(preview => { if (preview) previews.push(preview); }, async () => { throw new Error('Could not load'); },
    () => {}, () => visible);
  const award = () => { awarded++; };
  assert.throws(() => review.submit('Singer', 'photo', award), /not available/);
  visible = true;
  review.submit('Singer', 'photo', award);
  await assert.rejects(review.approve(previews[0].id), /Could not load/);
  assert.equal(awarded, 0);
  review.submit('Singer', 'photo', award);
  visible = false;
  await review.approve(previews[1].id);
  assert.equal(awarded, 0);
});
