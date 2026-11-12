import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindingFromKeyInput, canonicalShortcut, DEFAULT_SHORTCUTS, formatShortcut, matchesShortcut, parseShortcuts } from '../../src/domain/shortcuts';

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
  assert.deepEqual(parseShortcuts({ playPause: [] }).playPause, []);
});

test('the requested punctuation, help and player-fullscreen defaults match exact physical combinations', () => {
  const keys = parseShortcuts({});
  const input = (code: string, changes = {}) => ({ code, control: false, alt: false, shift: false, meta: false, ...changes });
  for (const modifier of ['control', 'meta', 'alt']) assert.equal(matchesShortcut(keys, 'preferences', input('Comma', { [modifier]: true })), true);
  for (const modifier of ['control', 'meta']) assert.equal(matchesShortcut(keys, 'keybindings', input('Slash', { [modifier]: true })), true);
  assert.equal(matchesShortcut(keys, 'keybindings', input('F1')), true);
  assert.equal(matchesShortcut(keys, 'toggleFullscreen', input('KeyF')), true);
  assert.equal(matchesShortcut(keys, 'toggleFullscreen', input('KeyF', { shift: true })), true);
  assert.equal(matchesShortcut(keys, 'toggleFullscreen', input('KeyF', { control: true })), false);
  assert.equal(matchesShortcut(keys, 'preferences', input('Comma', { control: true, shift: true })), false);
  assert.equal(formatShortcut('Control+Comma'), 'Ctrl+,');
  assert.equal(formatShortcut('Meta+Slash'), 'Cmd+/');
  assert.equal(formatShortcut('Shift+KeyF'), 'Shift+F');
});

test('old custom bindings survive new help/fullscreen defaults without stealing another existing action', () => {
  const migrated = parseShortcuts({ search: ['KeyF'], playPause: ['F1', 'Space'] });
  assert.deepEqual(migrated.search, ['KeyF']);
  assert.deepEqual(migrated.playPause, ['F1', 'Space']);
  assert.deepEqual(migrated.toggleFullscreen, ['Shift+KeyF']);
  assert.deepEqual(migrated.keybindings, ['Control+Slash', 'Meta+Slash']);
  assert.throws(() => parseShortcuts({ search: ['Space'], playPause: ['Space'] }), /Conflicting/);
  assert.throws(() => parseShortcuts({ ...DEFAULT_SHORTCUTS, playPause: ['F1'] }), /Conflicting/);
  migrated.preferences.length = 0;
  assert.equal(DEFAULT_SHORTCUTS.preferences.length, 3, 'Parsed defaults must not share mutable arrays.');
});

test('recording ignores modifier-only input and handles punctuation, arrows and explicit removal', () => {
  const input = { code: 'ControlLeft', control: true, alt: false, shift: false, meta: false };
  assert.equal(bindingFromKeyInput(input), null);
  assert.equal(bindingFromKeyInput({ ...input, code: 'Slash' }), 'Control+Slash');
  assert.equal(bindingFromKeyInput({ ...input, code: 'Comma', control: false, meta: true }), 'Meta+Comma');
  assert.equal(canonicalShortcut('Meta+Shift+Control+ArrowLeft'), 'Control+Shift+Meta+ArrowLeft');
  assert.equal(matchesShortcut(parseShortcuts({ keybindings: [] }), 'keybindings', { ...input, code: 'F1', control: false }), false);
  for (const invalid of [null, ['Space'], { search: null }, { search: 'Space' }, { search: ['Control+Control+KeyF'] }, { search: [''] }])
    assert.throws(() => parseShortcuts(invalid));
  assert.throws(() => parseShortcuts({ search: Array.from({ length: 17 }, (_, index) => `F${index + 1}`) }), /between 0 and 16/);
  assert.throws(() => parseShortcuts({ search: ['Meta+Control+Comma', 'Control+Meta+Comma'] }), /Conflicting/);
});

test('queue Delete is configurable and cannot silently collide with an application action', () => {
  const input = { code: 'Delete', control: false, alt: false, shift: false, meta: false };
  assert.equal(matchesShortcut(parseShortcuts({}), 'removeRequest', input), true);
  assert.throws(() => parseShortcuts({ ...DEFAULT_SHORTCUTS, previous: ['Delete'] }), /Conflicting.*Restart Current Song.*Remove Selected Queue Request/);
  const reassigned = parseShortcuts({ ...DEFAULT_SHORTCUTS, removeRequest: [], previous: ['Delete'] });
  assert.equal(matchesShortcut(reassigned, 'removeRequest', input), false);
  assert.equal(matchesShortcut(reassigned, 'previous', input), true);
  const legacy = parseShortcuts({ search: ['Delete'], playPause: ['Space'] });
  assert.deepEqual(legacy.removeRequest, []);
  assert.deepEqual(legacy.search, ['Delete']);
});
