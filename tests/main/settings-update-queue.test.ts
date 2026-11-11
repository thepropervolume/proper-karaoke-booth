import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, nextAccentColor } from '../../src/domain/settings';
import { SettingsUpdateQueue } from '../../src/main/settings-update-queue';

test('a delayed settings save completes before the accent updates only its current value', async () => {
  let state = { ...DEFAULT_SETTINGS };
  let unblock!: () => void;
  const wait = new Promise<void>(resolve => { unblock = resolve; });
  const queue = new SettingsUpdateQueue();
  const save = queue.run(async () => { await wait; state = { ...state, masterVolume: .42 }; });
  const color = queue.run(() => { state = { ...state, accentColor: nextAccentColor(state.accentColor) }; });
  await Promise.resolve();
  assert.equal(state.accentColor, 'blue');
  unblock(); await Promise.all([save, color]);
  assert.equal(state.masterVolume, .42);
  assert.equal(state.accentColor, 'pink');
});

test('a failed settings update does not block later changes', async () => {
  const queue = new SettingsUpdateQueue();
  await assert.rejects(queue.run(() => { throw new Error('write failed'); }), /write failed/);
  assert.equal(await queue.run(() => 'saved'), 'saved');
});
