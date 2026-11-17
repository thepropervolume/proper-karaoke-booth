import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MobileHostAccess, NearbyRooms } from '../../src/relay/mobile-access';
import { RelayStore } from '../../src/relay/store';
import { searchMobileCatalog } from '../../src/relay/mobile-catalog';
test('mobile host capabilities are opaque, bounded, expire, and use a separately limited owner namespace', () => {
  let now = 1000; const access = new MobileHostAccess(() => now), issued = access.issue();
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/); assert.match(access.authenticate(issued.token)!, /^f17e0001-/);
  assert.equal(access.authenticate('wrong'), undefined); now = issued.expiresAt; assert.equal(access.authenticate(issued.token), undefined);
});
test('mobile reservation exhaustion leaves trusted desktop capacity available', () => {
  const db = new DatabaseSync(':memory:'), store = new RelayStore(db), access = new MobileHostAccess();
  try {
    for (let i = 0; i < 50; i++) { const token = access.issue().token, owner = access.authenticate(token)!; store.open(owner, { slug: `mobile-room-${i}`, openId: crypto.randomUUID() }); }
    assert.throws(() => store.open(access.authenticate(access.issue().token)!, { slug: 'mobile-overflow', openId: crypto.randomUUID() }), /mobile-reservation-capacity/);
    assert.ok(store.open(crypto.randomUUID(), { slug: 'trusted-desktop', openId: crypto.randomUUID() }).roomId);
  } finally { db.close(); }
});
test('discovery uses no raw IP output, honors opt-out and recovers after an outage and another room refresh', async () => {
  let now = 1000; const nearby = new NearbyRooms(() => now);
  const room = { roomId: crypto.randomUUID(), generation: crypto.randomUUID(), slug: 'proper-volume', publicUrl: 'https://queue.thepropervolume.com/proper-volume', expiresAt: now + 100000, pollAfterMs: 0 as const };
  const other = { ...room, roomId: crypto.randomUUID(), slug: 'other-room' };
  const lookup = async (slug: string) => ({ ...(slug === room.slug ? room : other), online: true });
  nearby.record(room, '192.0.2.1', true);
  assert.equal((await nearby.discover('192.0.2.2', lookup)).length, 0);
  assert.equal((await nearby.discover('192.0.2.1', lookup)).length, 1);
  now += 46000; nearby.record(other, '192.0.2.1', true); nearby.refresh(room, '192.0.2.1', true);
  const visible = await nearby.discover('::ffff:192.0.2.1', lookup); assert.equal(visible.length, 2); assert.ok(!JSON.stringify(visible).includes('192.0.2'));
  nearby.refresh(room, '192.0.2.1', false); assert.equal((await nearby.discover('192.0.2.1', lookup)).length, 1);
});
test('mobile catalog uses only bounded loopback snapshot reads without any provider secret', async () => {
  let called = '';
  const value = await searchMobileCatalog('Oasis', undefined, async (url, init) => { called = String(url); assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return new Response(JSON.stringify({ items: [{ youtubeId: 'Video123456', artist: 'Oasis', title: 'Wonderwall', brandSlug: '', privatePath: 'SECRET' }] }), { headers: { 'Content-Type': 'application/json' } }); });
  assert.equal(new URL(called).origin, 'http://127.0.0.1:8765'); assert.equal(new URL(called).searchParams.get('q'), 'Oasis');
  assert.equal(value.items[0].title, 'Wonderwall'); assert.ok(!JSON.stringify(value).includes('SECRET'));
});
