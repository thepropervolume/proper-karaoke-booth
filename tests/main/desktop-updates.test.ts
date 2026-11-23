import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BoothDesktopUpdates, boothUpdateKind } from '../../src/main/desktop-updates';
import { parseSettings } from '../../src/domain/settings';

test('desktop update options default to a startup notice and persist only supported modes', () => {
  assert.equal(parseSettings({}).desktopUpdateMode, 'notify');
  for (const desktopUpdateMode of ['notify', 'install', 'download', 'off']) {
    assert.equal(parseSettings({ desktopUpdateMode }).desktopUpdateMode, desktopUpdateMode);
  }
  assert.throws(() => parseSettings({ desktopUpdateMode: 'auto' }), /available updates mechanism/);
});

test('selects the right artifact and never applies a development build', async () => {
  assert.equal(boothUpdateKind('win32', undefined, true), 'nsis');
  assert.equal(boothUpdateKind('win32'), 'zip');
  assert.equal(boothUpdateKind('darwin'), 'pkg');
  assert.equal(boothUpdateKind('linux', '/opt/Booth.AppImage'), 'appimage');
  assert.equal(boothUpdateKind('linux'), 'deb');
  const updates = new BoothDesktopUpdates('0.10.14', join(tmpdir(), 'tpv-booth-updates'), 'install', false, tmpdir(), () => {});
  assert.equal((await updates.check(true)).phase, 'unavailable');
  assert.equal(updates.canApplyOnQuit(), false);
  await updates.applyOnQuit(async () => assert.fail('Development build must not open an installer.'));
});
