import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettings, writeSettings } from '../../src/main/settings';

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
