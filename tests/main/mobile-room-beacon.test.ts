import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { encode, decode, type Packet, type StringAnswer } from 'dns-packet';
import { MobileRoomBeacon, mobileBeaconLabel, type MobileBeaconSocket } from '../../src/main/mobile-room-beacon';
import type { InternetSessionStatus } from '../../src/remote/internet-session-control';

const status: InternetSessionStatus = { available: true, state: 'online', suggestedSlug: 'test-karaoke', slug: 'test-karaoke',
  joinUrl: 'https://queue.thepropervolume.com/test-karaoke', guests: [], message: 'Online' };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
class FakeSocket extends EventEmitter {
  readonly packets: Packet[] = [];
  destroyed = 0;
  sendError: Error | null = null;
  respond(packet: Parameters<MobileBeaconSocket['respond']>[0], callback: (error: Error | null) => void): void {
    this.packets.push(Array.isArray(packet) ? { answers: packet } : packet); callback(this.sendError);
  }
  destroy(callback: () => void): void { this.destroyed++; callback(); }
}
function fixture() {
  let addresses = ['192.168.20.5'];
  let denied = false;
  let now = 0;
  const sockets: { address: string; socket: FakeSocket }[] = [];
  const timers = new Map<number, () => void>();
  const beacon = new MobileRoomBeacon({ now: () => now, addresses: async () => { if (denied) throw new Error('Profile unavailable'); return addresses; },
    socket: address => { const socket = new FakeSocket(); sockets.push({ address, socket }); return socket as unknown as MobileBeaconSocket; },
    every: (callback, delay) => { timers.set(delay, callback); return () => { if (timers.get(delay) === callback) timers.delete(delay); }; } });
  return { beacon, sockets, timers, advance: (ms: number) => { now += ms; }, addresses: (value: string[]) => { addresses = value; }, deny: () => { denied = true; } };
}

test('discovery requires an enabled, online, exact public room and a verified private interface', async () => {
  const f = fixture();
  for (const value of [{ ...status, state: 'stopped' as const }, { ...status, state: 'reconnecting' as const }, { ...status, joinUrl: 'https://attacker.test/test-karaoke' }]) {
    f.beacon.update(value, 'My Booth', true); await flush(); assert.equal(f.sockets.length, 0);
  }
  f.beacon.update(status, 'My Booth', false); await flush(); assert.equal(f.sockets.length, 0);
  f.addresses(['8.8.8.8', '127.0.0.1', '0.0.0.0', '192.168.20.5']);
  f.beacon.update(status, 'My Booth', true); await flush();
  assert.deepEqual(f.sockets.map(item => item.address), ['192.168.20.5']);
  assert.deepEqual([...f.timers.keys()].sort((a, b) => a - b), [5000, 30000]);
  f.beacon.close(); assert.equal(f.timers.size, 0); assert.equal(f.sockets[0].socket.destroyed, 1);
});

test('beacons publish only their approved interface and public URL, then answer matching discovery queries', async () => {
  const f = fixture(); f.beacon.update(status, 'My Booth', true); await flush();
  const socket = f.sockets[0].socket; assert.equal(socket.packets.length, 0);
  socket.emit('ready'); assert.equal(socket.packets.length, 1);
  const packet = decode(encode(socket.packets[0]));
  assert.deepEqual(packet.answers?.filter((record): record is StringAnswer => record.type === 'A').map(record => record.data), ['192.168.20.5']);
  const txt = packet.answers?.find(record => record.type === 'TXT');
  assert.equal(txt?.type, 'TXT');
  const txtParts = txt?.type === 'TXT' ? Array.isArray(txt.data) ? txt.data : [txt.data] : [];
  assert.equal(Buffer.concat(txtParts.map(item => typeof item === 'string' ? Buffer.from(item) : item)).toString(), 'url=' + status.joinUrl);
  assert.ok(packet.answers?.every(record => 'ttl' in record && record.ttl === 30));
  socket.emit('query', { questions: [{ name: '_other._tcp.local', type: 'PTR' }] }); assert.equal(socket.packets.length, 1);
  f.advance(250);
  socket.emit('query', { questions: [{ name: '_TPV-KARAOKE._TCP.LOCAL', type: 'PTR' }] }); assert.equal(socket.packets.length, 2);
  for (let i = 0; i < 100; i++) socket.emit('query', { questions: [{ name: '_tpv-karaoke._tcp.local', type: 'PTR' }] });
  assert.equal(socket.packets.length, 2, 'Repeated simultaneous queries share one response.');
  f.advance(5000); f.timers.get(5000)?.(); assert.equal(socket.packets.length, 3);
  f.beacon.close(); socket.emit('query', { questions: [{ name: '_tpv-karaoke._tcp.local', type: 'PTR' }] }); assert.equal(socket.packets.length, 3);
});

test('asynchronous bind, warning and send failures retire a socket without uncaught events or repeated sends', async () => {
  const f = fixture(); f.beacon.update(status, 'My Booth', true); await flush();
  const first = f.sockets[0].socket;
  assert.equal(first.listenerCount('error'), 1); assert.equal(first.listenerCount('warning'), 1);
  assert.doesNotThrow(() => first.emit('error', Object.assign(new Error('Bind failed'), { code: 'EADDRINUSE' })));
  assert.equal(first.destroyed, 1); first.emit('ready'); f.timers.get(5000)?.(); assert.equal(first.packets.length, 0);
  assert.doesNotThrow(() => first.emit('error', new Error('Late error'))); assert.equal(first.destroyed, 1);
  f.timers.get(30000)?.(); await flush(); assert.equal(f.sockets.length, 2);
  const second = f.sockets[1].socket; second.sendError = new Error('Send failed'); second.emit('ready');
  assert.equal(second.packets.length, 1); assert.equal(second.destroyed, 1);
  f.timers.get(30000)?.(); await flush(); const third = f.sockets[2].socket;
  assert.doesNotThrow(() => third.emit('warning', new Error('Membership lost'))); assert.equal(third.destroyed, 1);
  f.beacon.close();
});

test('lost network trust removes advertisements and a pending old profile check cannot resurrect them', async () => {
  const f = fixture(); f.beacon.update(status, 'My Booth', true); await flush(); f.sockets[0].socket.emit('ready');
  f.deny(); f.timers.get(30000)?.(); await flush(); assert.equal(f.sockets[0].socket.destroyed, 1);
  f.timers.get(5000)?.(); assert.equal(f.sockets[0].socket.packets.length, 1); f.beacon.close();
  let release!: (value: string[]) => void; let created = 0;
  const pending = new MobileRoomBeacon({ addresses: () => new Promise(resolve => { release = resolve; }), socket: () => { created++; return new FakeSocket() as unknown as MobileBeaconSocket; }, every: () => () => {} });
  pending.update(status, 'My Booth', true); pending.close(); release(['192.168.20.5']); await flush(); assert.equal(created, 0);
});

test('Unicode booth names become complete DNS labels within 63 UTF-8 bytes', async () => {
  for (const input of ['🎤'.repeat(60), 'é'.repeat(60), 'A.B\nC', '  ']) {
    const label = mobileBeaconLabel(input); assert.ok(Buffer.byteLength(label, 'utf8') <= 63); assert.ok(label.length > 0);
    assert.equal(label.includes('\ufffd'), false); assert.equal(label.includes('.'), false);
  }
  const f = fixture(); f.beacon.update(status, '🎤'.repeat(60), true); await flush(); f.sockets[0].socket.emit('ready');
  const packet = decode(encode(f.sockets[0].socket.packets[0]));
  const ptr = packet.answers?.find(record => record.type === 'PTR'); assert.ok(ptr);
  assert.ok(ptr?.type === 'PTR' && ptr.data.startsWith('🎤'.repeat(13)));
  assert.ok(ptr?.type === 'PTR' && Buffer.byteLength(ptr.data.split('.')[0], 'utf8') <= 63); f.beacon.close();
});

test('different rooms with the same booth name have distinct DNS-SD instances', async () => {
  const a = fixture(), b = fixture();
  a.beacon.update(status, 'Same Booth', true);
  b.beacon.update({ ...status, slug: 'another-room', joinUrl: 'https://queue.thepropervolume.com/another-room' }, 'Same Booth', true);
  await flush(); a.sockets[0].socket.emit('ready'); b.sockets[0].socket.emit('ready');
  const first = a.sockets[0].socket.packets[0].answers?.find(record => record.type === 'PTR');
  const second = b.sockets[0].socket.packets[0].answers?.find(record => record.type === 'PTR');
  assert.equal(first?.type, 'PTR'); assert.equal(second?.type, 'PTR');
  assert.notDeepEqual(first, second); a.beacon.close(); b.beacon.close();
});
