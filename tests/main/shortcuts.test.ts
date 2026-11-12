import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SHORTCUTS, parseShortcuts } from '../../src/domain/shortcuts';
import { readShortcuts, writeShortcuts } from '../../src/main/shortcuts';

test('shortcuts persist multiple bindings and disabled actions; invalid edits leave the old file intact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-shortcuts-'));
  try {
    const path = join(directory, 'profile', 'keybindings.json');
    assert.deepEqual(readShortcuts(path), DEFAULT_SHORTCUTS);
    const initial = readFileSync(path, 'utf8');
    assert.throws(() => writeShortcuts(path, { ...DEFAULT_SHORTCUTS, playPause: ['Control+KeyF'] }), /Conflicting/);
    assert.equal(readFileSync(path, 'utf8'), initial);
    const changed = parseShortcuts({ ...DEFAULT_SHORTCUTS, keybindings: [], previous: ['Control+KeyR', 'Meta+KeyR'] });
    writeShortcuts(path, changed);
    assert.deepEqual(readShortcuts(path), changed);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(json.previous, ['Control+KeyR', 'Meta+KeyR']);
    assert.deepEqual(json.keybindings, []);
    assert.equal(Object.keys(json).length, Object.keys(DEFAULT_SHORTCUTS).length);
    writeShortcuts(path, DEFAULT_SHORTCUTS);
    assert.deepEqual(readShortcuts(path), DEFAULT_SHORTCUTS);
    assert.deepEqual(readdirSync(join(directory, 'profile')), ['keybindings.json']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('an old file upgrades in memory without rewriting user edits; malformed JSON remains recoverable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-shortcuts-upgrade-'));
  try {
    const path = join(directory, 'keybindings.json'), original = JSON.stringify({ search: ['KeyF'], playPause: ['F1'] }, null, 4);
    writeFileSync(path, original);
    const upgraded = readShortcuts(path);
    assert.deepEqual(upgraded.playPause, ['F1']);
    assert.equal(upgraded.keybindings.includes('F1'), false);
    assert.equal(readFileSync(path, 'utf8'), original);
    writeFileSync(path, '{ broken');
    assert.throws(() => readShortcuts(path), /Could not read keyboard shortcuts/);
    assert.equal(readFileSync(path, 'utf8'), '{ broken');
    writeShortcuts(path, DEFAULT_SHORTCUTS);
    assert.deepEqual(readShortcuts(path), DEFAULT_SHORTCUTS);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a failed atomic publication cleans its staged file without touching the destination directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-shortcuts-publish-'));
  try {
    const destination = join(directory, 'keep'); mkdirSync(destination); writeFileSync(join(destination, 'sentinel'), 'preserve');
    assert.throws(() => writeShortcuts(destination, DEFAULT_SHORTCUTS));
    assert.deepEqual(readdirSync(directory), ['keep']);
    assert.equal(readFileSync(join(destination, 'sentinel'), 'utf8'), 'preserve');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
