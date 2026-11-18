import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

test('photo points require an authenticated singer and a valid image hash and are awarded once', () => {
  const settings = { ...DEFAULT_SETTINGS, pointsEnabled: true };
  let state = createInitialState('show', 'epoch');
  state = applyCommand(state, { showId: 'show', hostEpoch: 'epoch', expectedRevision: state.revision,
    commandId: 'add', actor: { role: 'host', id: 'host' },
    command: { type: 'addSinger', singer: { id: 'singer', name: 'Singer' } } }, settings, 1000).state;
  const envelope = { showId: 'show', hostEpoch: 'epoch', expectedRevision: state.revision,
    commandId: 'photo-1', actor: { role: 'singer' as const, id: 'singer' },
    command: { type: 'photo' as const, photoHash: 'a'.repeat(64) } };
  const first = applyCommand(state, envelope, settings, 1000);
  assert.equal(first.outcome.ok, true);
  assert.equal(first.state.points?.accounts.find(row => row.singerId === 'singer')?.points, 24);
  const replay = applyCommand(first.state, envelope, settings, 1000);
  assert.equal(replay.outcome.ok, true);
  assert.equal(replay.state.points?.accounts.find(row => row.singerId === 'singer')?.points, 24);
  const changed = applyCommand(first.state, { ...envelope, command: { type: 'photo', photoHash: 'b'.repeat(64) } }, settings, 1000);
  assert.equal(changed.outcome.ok, false);
  const invalid = applyCommand(first.state, { ...envelope, commandId: 'photo-2', expectedRevision: first.state.revision,
    command: { type: 'photo', photoHash: 'not-a-hash' } }, settings, 1000);
  assert.equal(invalid.outcome.ok, false);
  const host = applyCommand(first.state, { ...envelope, commandId: 'photo-3', expectedRevision: first.state.revision,
    actor: { role: 'host', id: 'host' } }, settings, 1000);
  assert.equal(host.outcome.ok, false);
});
