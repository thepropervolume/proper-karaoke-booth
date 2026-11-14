import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings } from '../../src/domain/settings';

test('KHost selection migrates old settings to an empty opt-in path and validates private paths', () => {
  assert.equal(parseSettings({}).khostBridgeConfigFile, '');
  for (const path of ['/private/connection.json', 'C:\\private\\connection.json', '\\\\computer\\share\\connection.json'])
    assert.equal(parseSettings({ khostBridgeConfigFile: path }).khostBridgeConfigFile, path);
  for (const path of ['relative/connection.json', 'C:connection.json', '/private\nconnection.json', 'x'.repeat(4097), null, false, {}])
    assert.throws(() => parseSettings({ khostBridgeConfigFile: path }), /KHost bridge profile/);
});
