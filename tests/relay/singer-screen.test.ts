import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { InternetSingerScreens, SCREEN_FRAME_BYTES } from '../../src/relay/singer-screen';

test('screen frames are bounded, generation scoped, short lived and cannot restart after stop', () => {
  let now = 1000;
  const screens = new InternetSingerScreens(() => now), id = randomUUID(), other = randomUUID();
  const lease = { roomId: randomUUID(), generation: randomUUID(), slug: 'stage-one', expiresAt: 1_000_000 };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const secret = 'a'.repeat(43), digest = createHash('sha256').update(secret).digest('hex');
  screens.start(lease, id, digest);
  assert.equal(screens.frame(lease.slug, lease, 'viewer', secret), null);
  screens.publish(lease, id, 1, jpeg);
  assert.deepEqual(screens.frame(lease.slug, lease, 'viewer', secret), jpeg);
  assert.equal(screens.frame(lease.slug, { ...lease, generation: randomUUID() }, 'viewer', secret), null);
  assert.throws(() => screens.publish(lease, id, 1, jpeg));
  assert.throws(() => screens.publish(lease, id, 2, Buffer.alloc(SCREEN_FRAME_BYTES + 1)));
  assert.throws(() => screens.start(lease, other, digest));
  screens.clear(lease, id);
  assert.equal(screens.frame(lease.slug, lease, 'viewer', secret), null);
  assert.throws(() => screens.start(lease, id, digest));
  assert.throws(() => screens.publish(lease, id, 2, jpeg));
  screens.start(lease, other, digest); screens.publish(lease, other, 1, jpeg);
  now += 4001;
  assert.equal(screens.frame(lease.slug, lease, 'viewer', secret), null);
});

test('screen viewer count is bounded and stale viewers expire', () => {
  let now = 1000;
  const screens = new InternetSingerScreens(() => now), id = randomUUID();
  const lease = { roomId: randomUUID(), generation: randomUUID(), slug: 'stage-one', expiresAt: 1_000_000 };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const secret = 'a'.repeat(43), digest = createHash('sha256').update(secret).digest('hex');
  screens.start(lease, id, digest); screens.publish(lease, id, 1, jpeg);
  for (let i = 0; i < 32; i++) assert.ok(screens.frame(lease.slug, lease, String(i), secret));
  assert.throws(() => screens.frame(lease.slug, lease, 'extra', secret));
  now += 3000; screens.publish(lease, id, 2, jpeg);
  now += 3000; screens.publish(lease, id, 3, jpeg);
  now += 3000; screens.publish(lease, id, 4, jpeg);
  now += 1001; screens.publish(lease, id, 5, jpeg);
  assert.ok(screens.frame(lease.slug, lease, 'extra', secret));
});
