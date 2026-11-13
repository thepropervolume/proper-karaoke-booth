import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { applicationUserData } from '../../src/main/user-data-path';

test('packaged product names retain the established show profile', () => {
  const appData = resolve(tmpdir(), 'appdata'), appName = 'The Proper Volume Karaoke Booth';
  assert.equal(applicationUserData({ appData, appName, current: join(appData, appName), packaged: true }), join(appData, 'proper-karaoke-booth'));
});
test('explicit and custom test profiles are honored before the single-instance lock', () => {
  const appData = resolve(tmpdir(), 'appdata'), custom = resolve(tmpdir(), 'isolated-profile');
  assert.equal(applicationUserData({ appData, appName: 'Product', current: custom, packaged: true }), custom);
  assert.equal(applicationUserData({ appData, appName: 'Product', current: join(appData, 'Product'), packaged: true, explicit: custom }), custom);
  assert.equal(applicationUserData({ appData, appName: 'Product', current: custom, packaged: false }), custom);
});
