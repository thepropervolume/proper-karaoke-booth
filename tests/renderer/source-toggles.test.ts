import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceToggles } from '../../src/renderer/SourceToggles';
import type { SourceVisibility } from '../../src/domain/settings';

test('source controls show all seven independently checked states without claiming an account connection', () => {
  const value: SourceVisibility = { local: false, karaokenerds: true, youtube: false,
    karafun: true, partytyme: false, sunfly: true, stingray: false };
  const html = renderToStaticMarkup(React.createElement(SourceToggles, { value, onSave: async () => {} }));
  for (const label of ['Imported / Local', 'Karaoke Nerds', 'YouTube', 'KaraFun', 'Party Tyme', 'Sunfly', 'Stingray'])
    assert.ok(html.includes(`aria-label="Show ${label} in search"`), label);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 7);
  assert.equal((html.match(/checked=""/g) ?? []).length, 3);
  assert.match(html, /Show in Search/);
  assert.doesNotMatch(html, /account connected/i);
});
