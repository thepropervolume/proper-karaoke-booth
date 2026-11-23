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

test('a manual update check contacts the feed and reports failure even with automatic checks turned off', async t => {
  const requests = t.mock.method(globalThis, 'fetch', async () => new Response('Offline', { status: 503 }));
  const phases: string[] = [];
  const updates = new BoothDesktopUpdates('0.10.14', join(tmpdir(), 'tpv-booth-updates'), 'off', true, tmpdir(),
    status => phases.push(status.phase));
  assert.equal((await updates.check()).phase, 'idle');
  assert.equal(requests.mock.callCount(), 0);
  const result = await updates.check(true);
  assert.equal(requests.mock.callCount(), 1);
  assert.deepEqual(phases, ['checking', 'error']);
  assert.equal(result.phase, 'error');
  assert.match(result.message ?? '', /could not be checked or verified/i);
});
