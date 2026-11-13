import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialState, remainingPauseSeconds, type ShowState } from '../../src/domain/index';
import { Store } from '../../src/main/store';

test('an active interval survives a database close and elapsed offline time counts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tpv-interval-'));
  const path = join(directory, 'show.sqlite');
  try {
    const state = createInitialState('show', 'epoch');
    state.nextStartAtMs = 16_000;
    const first = new Store<ShowState>(path); first.save(state); first.close();
    const reopened = new Store<ShowState>(path);
    const restored = reopened.load()!;
    assert.equal(remainingPauseSeconds(restored, 11_500), 5);
    assert.equal(remainingPauseSeconds(restored, 16_000), 0);
    assert.equal(restored.playback, null);
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
