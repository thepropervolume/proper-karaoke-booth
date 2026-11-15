import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings, writeSettings } from '../../src/main/settings';
import { nextAccentColor } from '../../src/domain/settings';

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

test('automatic bumper migrates old defaults and a subsequent deliberate opt-out persists', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-bumper-settings-'));
  try {
    const path = join(directory, 'settings.json');
    writeFileSync(path, JSON.stringify({ appearance: 'day' }));
    const old = readSettings(path);
    assert.equal(old.autoBumper, true); assert.equal(old.autoBumperTrackId, 'builtin-ambient');
    writeSettings(path, { ...old, autoBumper: true, autoBumperTrackId: 'custom-track-id' });
    assert.equal(readSettings(path).autoBumper, true); assert.equal(readSettings(path).autoBumperTrackId, 'custom-track-id');
    writeSettings(path, { ...readSettings(path), autoBumper: false, bumperOnLaunch: false });
    assert.equal(readSettings(path).autoBumper, false); assert.equal(readSettings(path).bumperOnLaunch, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
