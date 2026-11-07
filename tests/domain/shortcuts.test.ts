import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHORTCUTS, matchesShortcut, parseShortcuts } from '../../src/domain/shortcuts';

test('shortcuts provide defaults and normalize configurable bindings', () => {
  assert.deepEqual(parseShortcuts({}), DEFAULT_SHORTCUTS);
  const bindings = parseShortcuts({ playPause: ['Shift+Control+KeyP'] });
  assert.deepEqual(bindings.playPause, ['Control+Shift+KeyP']);
  assert.equal(matchesShortcut(bindings, 'playPause', { code: 'KeyP', control: true, shift: true, alt: false, meta: false }), true);
  assert.equal(matchesShortcut(bindings, 'playPause', { code: 'KeyP', control: true, shift: false, alt: false, meta: false }), false);
});

test('shortcuts reject collisions, unsupported actions and malformed keys', () => {
  assert.throws(() => parseShortcuts({ playPause: ['Control+KeyF'] }), /Conflicting/);
  assert.throws(() => parseShortcuts({ playPause: ['Ctrl+P'] }), /Invalid/);
  assert.throws(() => parseShortcuts({ unknown: ['Space'] }), /Unknown/);
  assert.throws(() => parseShortcuts({ playPause: [] }));
});
