import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings, writeSettings } from '../../src/main/settings';
import { nextAccentColor } from '../../src/domain/settings';
import { DEFAULT_LIBRARY_RESULT_FIELDS } from '../../src/domain/library-result-fields';

test('custom library columns persist while older settings get defaults', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-library-columns-'));
  const path = join(directory, 'settings.json');
  try {
    writeFileSync(path, '{}');
    const defaults = readSettings(path);
    assert.deepEqual(defaults.libraryResultFields, DEFAULT_LIBRARY_RESULT_FIELDS);
    const saved = writeSettings(path, { ...defaults, libraryResultFields: ['filename', 'title', 'source'] });
    assert.deepEqual(readSettings(path).libraryResultFields, ['title', 'source', 'filename']);
    assert.throws(() => writeSettings(path, { ...saved, libraryResultFields: ['artist'] }), /title field/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('volume persists, upgrades older preferences, and rejects invalid edits without overwriting', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-settings-test-'));
  const path = join(directory, 'settings.json');
  try {
    writeFileSync(path, JSON.stringify({ appearance: 'day', autoApprove: false }));
    const upgraded = readSettings(path);
    assert.equal(upgraded.masterVolume, 1);
    const saved = writeSettings(path, { ...upgraded, masterVolume: 0.35 });
    assert.equal(saved.masterVolume, 0.35);
    assert.equal(readSettings(path).masterVolume, 0.35);
    const before = readFileSync(path, 'utf8');
    assert.throws(() => writeSettings(path, { ...saved, masterVolume: 2 }));
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('accent color defaults for older settings, cycles and persists, and rejects invalid values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-accent-test-'));
  const path = join(directory, 'settings.json');
  try {
    writeFileSync(path, JSON.stringify({ appearance: 'day' }));
    let current = readSettings(path);
    assert.equal(current.accentColor, 'blue');
    for (const color of ['pink', 'purple', 'blue'] as const) {
      current = writeSettings(path, { ...current, accentColor: nextAccentColor(current.accentColor) });
      assert.equal(current.accentColor, color);
      assert.equal(readSettings(path).accentColor, color);
      assert.equal(current.appearance, 'day');
    }
    const before = readFileSync(path, 'utf8');
    assert.throws(() => writeSettings(path, { ...current, accentColor: 'orange' }), /accent color/i);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('font preference preserves the default for older settings, persists each choice and rejects arbitrary CSS', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-appearance-font-'));
  const path = join(directory, 'settings.json');
  try {
    writeFileSync(path, JSON.stringify({ settingsVersion: 2 }));
    assert.equal(readSettings(path).fontFamily, 'default');
    for (const fontFamily of ['system-sans', 'serif', 'monospace', 'default'] as const) {
      writeSettings(path, { ...readSettings(path), fontFamily });
      assert.equal(readSettings(path).fontFamily, fontFamily);
    }
    const before = readFileSync(path, 'utf8');
    assert.throws(() => writeSettings(path, { ...readSettings(path), fontFamily: 'url(https://example.test/font)' }), /invalid font/i);
    assert.equal(readFileSync(path, 'utf8'), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('automatic bumper migrates old defaults and a subsequent deliberate opt-out persists', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-bumper-settings-'));
  try {
    const path = join(directory, 'settings.json');
    writeFileSync(path, JSON.stringify({ appearance: 'day' }));
    const old = readSettings(path);
    assert.equal(old.autoBumper, true); assert.equal(old.autoBumperTrackId, 'builtin-zen');
    writeSettings(path, { ...old, autoBumper: true, autoBumperTrackId: 'custom-track-id' });
    assert.equal(readSettings(path).autoBumper, true); assert.equal(readSettings(path).autoBumperTrackId, 'custom-track-id');
    writeSettings(path, { ...readSettings(path), autoBumper: false, bumperOnLaunch: false });
    assert.equal(readSettings(path).autoBumper, false); assert.equal(readSettings(path).bumperOnLaunch, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the Zen default migrates only the old enabled built-in default', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-zen-settings-'));
  const path = join(directory, 'settings.json');
  try {
    for (const [input, expected] of [
      [{ settingsVersion: 2, autoBumperTrackId: 'builtin-ambient' }, 'builtin-zen'],
      [{ settingsVersion: 2, includeBuiltInBumpers: false, autoBumperTrackId: 'builtin-ambient' }, 'builtin-ambient'],
      [{ settingsVersion: 2, autoBumperTrackId: 'custom-track-id' }, 'custom-track-id'],
      [{ settingsVersion: 2, autoBumperTrackId: 'builtin-sunset' }, 'builtin-sunset'],
      [{ settingsVersion: 3, autoBumperTrackId: 'builtin-ambient' }, 'builtin-ambient'],
    ] as const) {
      writeFileSync(path, JSON.stringify(input));
      const read = readSettings(path);
      assert.equal(read.autoBumperTrackId, expected);
      assert.equal(read.settingsVersion, 3);
      assert.equal(read.includeBuiltInBumpers, 'includeBuiltInBumpers' in input ? input.includeBuiltInBumpers : true);
      writeSettings(path, read);
      assert.equal(readSettings(path).autoBumperTrackId, expected);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
