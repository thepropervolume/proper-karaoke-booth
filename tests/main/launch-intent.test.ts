import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaunchIntent } from '../../src/main/launch-intent';

test('settings and keybindings switches work in initial and Electron second-instance argv', () => {
  assert.equal(parseLaunchIntent(['--settings']), 'settings');
  assert.equal(parseLaunchIntent(['proper-karaoke-booth.exe', '--settings']), 'settings');
  assert.equal(parseLaunchIntent(['electron', '/path/to/app', '--user-data-dir=/profile', '--keybindings']), 'keybindings');
  assert.equal(parseLaunchIntent([]), null);
});

test('the more specific keyboard section wins regardless of flag order or duplicates', () => {
  assert.equal(parseLaunchIntent(['--settings', '--keybindings']), 'keybindings');
  assert.equal(parseLaunchIntent(['--keybindings', '--settings']), 'keybindings');
  assert.equal(parseLaunchIntent(['--settings', '--settings']), 'settings');
  assert.equal(parseLaunchIntent(['--keybindings', '--keybindings']), 'keybindings');
});

test('filenames, similar switches and positional arguments do not trigger settings navigation', () => {
  for (const argument of ['--settings-backup', '--keybindings.json', '--settings=true', '--keybindings=/file', '/folder/--settings', '--SETTINGS'])
    assert.equal(parseLaunchIntent([argument]), null, argument);
  assert.equal(parseLaunchIntent(['--', '--settings', '--keybindings']), null);
  assert.equal(parseLaunchIntent(['--settings', '--', '--keybindings']), 'settings');
});
