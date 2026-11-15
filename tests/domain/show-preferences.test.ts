import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/domain/settings';

test('show defaults migrate once and preserve a deliberate versioned bumper opt-out', () => {
  assert.equal(parseSettings({ autoBumper: false }).autoBumper, true);
  assert.equal(parseSettings({ settingsVersion: 1, autoBumper: false }).autoBumper, true);
  const saved = parseSettings({ ...DEFAULT_SETTINGS, autoBumper: false, bumperOnLaunch: false, autoAdvance: false });
  assert.equal(saved.autoBumper, false); assert.equal(saved.bumperOnLaunch, false); assert.equal(saved.autoAdvance, false);
  assert.deepEqual(parseSettings(JSON.parse(JSON.stringify(saved))), saved);
  assert.throws(() => parseSettings({ settingsVersion: 999 }), /version/i);
});
test('branding and automation reject malformed values without rejecting a valid expiry or punctuation', () => {
  const branding = { boothName: "Ben’s Booth!", displayLogoSize: 85, bannerText: '<script>plain text</script>', bannerEnabled: true, bannerPosition: 'top', bannerExpiresAt: '2026-11-30T20:30:00-05:00', bumperFadeMs: 1700 };
  const settings = parseSettings(branding);
  for (const [key, value] of Object.entries(branding)) assert.equal(settings[key as keyof typeof settings], value);
  for (const patch of [{ boothName: '' }, { boothName: 'x\ny' }, { displayLogoSize: 9 }, { displayLogoSize: 86 }, { displayLogoSize: 30.5 }, { bannerPosition: 'middle' }, { bannerText: 'x'.repeat(1001) }, { bannerExpiresAt: 'tomorrow' }, { bannerExpiresAt: '2026-11-30T20:30' }, { bumperFadeMs: 499 }, { bumperFadeMs: 1701 }, { autoAdvance: 'true' }]) assert.throws(() => parseSettings(patch));
});
