import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { applySettingsPatch } from '../../src/main/settings-patch';
import { SettingsUpdateQueue } from '../../src/main/settings-update-queue';

test('partial settings preserve the latest unrelated values and full snapshots remain compatible', () => {
  const current = { ...DEFAULT_SETTINGS, accentColor: 'purple' as const, layout: 'rotation' as const };
  const next = applySettingsPatch(current, { masterVolume: 0.42 });
  assert.equal(next.masterVolume, 0.42); assert.equal(next.accentColor, 'purple'); assert.equal(next.layout, 'rotation');
  assert.deepEqual(applySettingsPatch(current, current), current); assert.equal(current.masterVolume, 1);
});

test('queued patches merge only after earlier asynchronous changes finish', async () => {
  const queue = new SettingsUpdateQueue(); let current = { ...DEFAULT_SETTINGS };
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const accent = queue.run(async () => { await waiting; current = applySettingsPatch(current, { accentColor: 'pink' }); });
  const volume = queue.run(() => { current = applySettingsPatch(current, { masterVolume: 0.42 }); });
  release(); await Promise.all([accent, volume]);
  assert.equal(current.masterVolume, 0.42); assert.equal(current.accentColor, 'pink');
});

test('invalid or unknown patches fail before installing any setting, including inherited-object names', () => {
  const before = structuredClone(DEFAULT_SETTINGS);
  for (const patch of [null, [], new Date(), { masterVolume: 2 }, { autoApprove: 'yes' }, { masterVolume: 0.42, typo: true },
    { constructor: 'bad' }, JSON.parse('{"__proto__":{"polluted":true}}')]) assert.throws(() => applySettingsPatch(before, patch));
  assert.deepEqual(before, DEFAULT_SETTINGS);
  assert.deepEqual(applySettingsPatch(before, {}), before);
});
