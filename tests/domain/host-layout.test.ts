import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOST_PANEL_SIZES, fittedHostPanels } from '../../src/domain/host-layout';
import { parseSettings } from '../../src/domain/settings';

test('old settings get a silent host preview and disabled LAN listener without sharing mutable panel defaults', () => {
  const first = parseSettings({}), second = parseSettings({});
  assert.equal(first.hostPreviewPosition, 'above');
  assert.equal(first.singerScreenEnabled, false); assert.equal(first.singerScreenPort, 4051);
  first.hostPanelSizes.queue = 600;
  assert.equal(second.hostPanelSizes.queue, 350); assert.equal(DEFAULT_HOST_PANEL_SIZES.queue, 350);
});
test('invalid panel or LAN options fail explicitly rather than resetting to defaults', () => {
  for (const patch of [{ hostPreviewPosition: null }, { hostPreviewPosition: 'left' }, { hostPanelSizes: null }, { hostPanelSizes: { queue: 10000 } }, { hostPanelSizes: { unused: 12 } }, { hostPanelSizes: { preview: 10.5 } }, { singerScreenPort: 80 }, { singerScreenPort: '4051' }, { singerScreenPort: null }, { singerScreenEnabled: 'true' }]) assert.throws(() => parseSettings(patch));
});
test('viewport fitting preserves stored dimensions while retaining usable queue and preview bounds', () => {
  const saved = { sidebar: 300, queue: 900, preview: 580, libraryQueue: 700 };
  const fit = fittedHostPanels(saved, 1040, 700);
  assert.ok(fit.sidebar <= 250 && fit.queue <= 480 && fit.preview <= 280 && fit.libraryQueue <= 315);
  assert.deepEqual(saved, { sidebar: 300, queue: 900, preview: 580, libraryQueue: 700 });
  assert.deepEqual(parseSettings({ hostPanelSizes: saved }).hostPanelSizes, saved);
});
