import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createInitialState, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { Store } from '../../src/main/store';

test('shutdown gate prevents opening a guest authority without preventing local host writes', () => {
  const store = new Store<ShowState>(':memory:');
  try {
    const state = createInitialState('show-123456', 'epoch-123456'); store.save(state);
    store.disableRemoteQueue();
    assert.throws(() => store.openRemoteQueue(() => DEFAULT_SETTINGS, () => {}), /shutting down/);
    state.revision++; store.save(state); assert.equal(store.load()?.revision, 1);
  } finally { store.close(); }
});

test('shutdown gate blocks existing guest actions while host close can revoke credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-remote-quit-'));
  const file = join(dir, 'show.sqlite'); let store = new Store<ShowState>(file);
  try {
    let state = createInitialState('show-123456', 'epoch-123456'); store.save(state);
    const guest = store.openRemoteQueue(() => DEFAULT_SETTINGS, value => { state = value; });
    const invitation = guest.createInvitation(60000), resume = 'a'.repeat(43);
    const joined = guest.join(invitation, 'join-123456', resume, 'Singer', 0);
    store.disableRemoteQueue();
    assert.throws(() => guest.admissionInfo(invitation), /shutting down/);
    assert.throws(() => guest.snapshot(joined.session), /shutting down/);
    assert.throws(() => guest.resume(resume), /shutting down/);
    assert.throws(() => guest.submitMissing(joined.session, { commandId: 'command-123', title: 'Song', artist: '' }), /shutting down/);
    guest.closeRoom();
    state.revision++; store.save(state); assert.equal(store.load()?.revision, 2);
    store.close(); store = new Store<ShowState>(file);
    const reopened = store.openRemoteQueue(() => DEFAULT_SETTINGS, () => {});
    assert.throws(() => reopened.resume(resume), /access denied/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
