import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkInterfaceInfoIPv4, networkInterfaces } from 'node:os';
import { discoverSingerScreenAddresses, isPrivateSingerScreenIPv4 } from '../../src/main/singer-screen-network';

const ipv4 = (address: string, internal = false): NetworkInterfaceInfoIPv4 => ({
  address, family: 'IPv4', internal, netmask: '255.255.255.0', cidr: `${address}/24`, mac: '00:00:00:00:00:00',
});
const interfaces = (): ReturnType<typeof networkInterfaces> => ({
  loopback: [ipv4('127.0.0.1', true)], private: [ipv4('192.168.1.20')],
  publicProfile: [ipv4('10.2.3.4')], internet: [ipv4('8.8.8.8')],
  ipv6: [{ address: 'fd01::1', family: 'IPv6', internal: false, netmask: 'ffff:ffff:ffff:ffff::', cidr: 'fd01::1/64', mac: '00:00:00:00:00:00', scopeid: 0 }],
});

test('portable discovery includes assigned LAN IPv4 addresses without wildcard, public or IPv6 listeners', async () => {
  assert.deepEqual(await discoverSingerScreenAddresses({ platform: 'linux', interfaces }), ['10.2.3.4', '192.168.1.20']);
  for (const address of ['10.2.3.4', '172.16.0.1', '192.168.1.1', '169.254.1.1', '100.64.1.1']) assert.equal(isPrivateSingerScreenIPv4(address), true);
  for (const address of ['0.0.0.0', '127.0.0.1', '8.8.8.8', '172.32.0.1', '::', '::1', 'fd01::1']) assert.equal(isPrivateSingerScreenIPv4(address), false);
});

test('Windows requires actual Private-profile approval as well as an assigned LAN address', async () => {
  assert.deepEqual(await discoverSingerScreenAddresses({ platform: 'win32', interfaces,
    readWindowsAddresses: async () => ['192.168.1.20', '192.168.1.200', '8.8.8.8'] }), ['192.168.1.20']);
  assert.deepEqual(await discoverSingerScreenAddresses({ platform: 'win32', interfaces,
    readWindowsAddresses: async () => [] }), []);
});

test('an unavailable Windows profile query never falls back to all private-looking addresses', async () => {
  assert.deepEqual(await discoverSingerScreenAddresses({ platform: 'win32', interfaces,
    readWindowsAddresses: async () => { throw new Error('Profile service unavailable'); } }), []);
});
