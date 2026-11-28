import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createInitialState, type Version } from '../../src/domain';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/domain/settings';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';
import { makeConfiguration, mergeConfiguration, parseConfiguration, readConfiguration, saveConfiguration } from '../../src/main/booth-configuration';
import { roomShareUrl } from '../../src/domain/booth-workspace-settings';
import type { InternetSessionStatus } from '../../src/remote/internet-session-control';

test('configuration retains preferences and local metadata and merges identical recordings without duplication', () => {
  const directory = mkdtempSync(join(tmpdir(), 'karabooth-config-test-'));
  try {
    const version: Version = { id: 'one', title: 'Edited title', artist: 'Artist', rating: 'unrated', djCode: 'TPV' };
    const source = { id: version.id, path: join(directory, 'song.mp4'), fingerprint: 'a'.repeat(64) };
    const bundle = makeConfiguration({ ...DEFAULT_SETTINGS, hostZoom: 120 }, DEFAULT_SHORTCUTS, [version], () => source);
    const file = join(directory, 'backup.json');
    saveConfiguration(file, bundle);
    assert.throws(() => saveConfiguration(file, bundle), /already exists|EEXIST/i);
    const imported = readConfiguration(file);
    assert.equal(imported.preferences.hostZoom, 120);
    assert.equal(imported.localRecordings[0].media.path, source.path);
    const first = mergeConfiguration(createInitialState('show', 'host'), imported, () => undefined);
    const second = mergeConfiguration(first.state, imported, () => first.media[0]);
    assert.equal(second.state.versions.length, 1);
    assert.equal(second.state.versions[0].title, 'Edited title');
    assert.deepEqual(second.media, []);
    assert.throws(() => parseConfiguration({ ...bundle, localRecordings: [
      { version, media: { ...source, path: 'relative.mp4' } },
    ] }), /invalid local/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('QRs only share a live public room and validated custom destinations', () => {
  const online: InternetSessionStatus = {
    available: true, state: 'online', suggestedSlug: 'test-show', slug: 'test-show',
    joinUrl: 'https://queue.thepropervolume.com/test-show', guests: [], message: '',
  };
  assert.equal(roomShareUrl(online, ''), online.joinUrl);
  assert.equal(roomShareUrl(online, 'https://example.com/karaoke'), 'https://example.com/karaoke');
  assert.equal(roomShareUrl({ ...online, state: 'reconnecting' }, ''), null);
  assert.throws(() => parseSettings({ roomQrUrl: 'https://user:private@example.com' }), /public HTTP/i);
  assert.throws(() => parseSettings({ hostHandle: 'api' }), /host handle/i);
});
