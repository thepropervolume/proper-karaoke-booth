import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validInvitation, validateOpenLan } from '../../src/remote/host-control';

const interfaces = [{ id: 'private-iface', label: 'Venue network' }];
const config = { interfaceId: 'private-iface', hostname: 'karaoke.example.test', port: 8443, certificateToken: 'cert-token', privateKeyToken: 'key-token' };

test('host configuration requires an offered interface, bounded port and separately selected certificate and key', () => {
  assert.equal(validateOpenLan(config, interfaces), null);
  assert.equal(validateOpenLan({ ...config, hostname: '::1' }, interfaces), null);
  assert.match(validateOpenLan({ ...config, interfaceId: 'other' }, interfaces)!, /interface/);
  assert.match(validateOpenLan({ ...config, hostname: 'evil.example/path' }, interfaces)!, /hostname/);
  assert.match(validateOpenLan({ ...config, hostname: 'Example.test' }, interfaces)!, /hostname/);
  assert.match(validateOpenLan({ ...config, port: 0 }, interfaces)!, /port/);
  assert.match(validateOpenLan({ ...config, privateKeyToken: '' }, interfaces)!, /private key/);
});

test('displayed invitations must use the active HTTPS origin and a single fragment credential', () => {
  const token = 'A'.repeat(43), origin = 'https://karaoke.example.test:8443';
  assert.equal(validInvitation(`${origin}/singer/#invite=${token}`, origin), true);
  for (const link of [
    `http://karaoke.example.test:8443/singer/#invite=${token}`, `https://other.example.test:8443/singer/#invite=${token}`,
    `${origin}/singer/?invite=${token}`, `${origin}/singer/#invite=${token}&invite=${token}`, `${origin}/singer/#invite=${token}&x=1`,
    `${origin}/path#invite=${token}`, `https://user@karaoke.example.test:8443/singer/#invite=${token}`, `${origin}/singer/#invite=short`
  ]) assert.equal(validInvitation(link, origin), false, link);
  assert.equal(validInvitation(`${origin}/singer/#invite=${token}`, null), false);
});
