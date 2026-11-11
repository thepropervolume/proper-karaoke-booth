import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState, type ShowState } from '../../src/domain';
import { migrateShowSchema } from '../../src/main/schema-migrations';
import { inspectShowSnapshot } from '../../src/main/show-snapshots';

function makeState(): ShowState {
  const state = createInitialState('show', 'epoch');
  state.singers.push({ id: 's', name: 'Singer' });
  state.versions.push({ id: 'v', title: 'Song', artist: 'Artist', rating: 'clean' });
  return state;
}

test('snapshot inspection rejects orphaned or duplicate active queue entries', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    const save = (state: ShowState) => db.prepare('INSERT OR REPLACE INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    const entry = (id: string, status: 'staged' | 'playing') => ({ id, singerId: 's', versionId: 'v', status, round: 1, order: 1 });
    const orphanStage = makeState(); orphanStage.requests.push(entry('one', 'staged'));
    const duplicateStage = makeState(); duplicateStage.requests.push(entry('one', 'staged'), entry('two', 'staged')); duplicateStage.stagedRequestId = 'one';
    const orphanPlaying = makeState(); orphanPlaying.requests.push(entry('one', 'playing'));
    const duplicatePlaying = makeState(); duplicatePlaying.requests.push(entry('one', 'playing'), entry('two', 'playing'));
    duplicatePlaying.playback = { requestId: 'one', generationId: 'g', status: 'playing' }; duplicatePlaying.usedGenerationIds.push('g');
    for (const state of [orphanStage, duplicateStage, orphanPlaying, duplicatePlaying]) {
      save(state); assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/);
    }
    const valid = makeState(); valid.requests.push(entry('one', 'playing'), entry('two', 'staged'));
    valid.playback = { requestId: 'one', generationId: 'g', status: 'paused' }; valid.usedGenerationIds.push('g'); valid.stagedRequestId = 'two';
    save(valid); assert.deepEqual(inspectShowSnapshot(db), { revision: 0, singers: 1, songs: 1, requests: 2 });
  } finally { db.close(); }
});

test('snapshot accepts legacy and valid promotion state and rejects stale or disallowed pointers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    const save = (state: ShowState) => db.prepare('INSERT OR REPLACE INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
    const make = () => {
      const state = makeState();
      state.requests.push({ id: 'one', singerId: 's', versionId: 'v', status: 'accepted', round: 1, order: 1 });
      return state;
    };
    const legacy = make(); delete legacy.promotedRequestId; save(legacy); assert.equal(inspectShowSnapshot(db).requests, 1);
    const valid = make(); valid.promotedRequestId = 'one'; save(valid); assert.equal(inspectShowSnapshot(db).requests, 1);
    valid.requests[0].status = 'staged'; valid.stagedRequestId = 'one'; save(valid); assert.equal(inspectShowSnapshot(db).requests, 1);
    valid.requests[0].status = 'playing'; valid.stagedRequestId = null;
    valid.playback = { requestId: 'one', generationId: 'g', status: 'paused' }; valid.usedGenerationIds.push('g');
    save(valid); assert.equal(inspectShowSnapshot(db).requests, 1);
    for (const variant of ['missing', 'removed', 'pending', 'disallowed', 'unrated', 'invalid-type'] as const) {
      const bad = make(); bad.promotedRequestId = variant === 'missing' ? 'missing' : 'one';
      if (variant === 'removed' || variant === 'pending') bad.requests[0].status = variant;
      if (variant === 'disallowed') bad.policy.excludeVersionIds = ['v'];
      if (variant === 'unrated') { bad.policy.ageRestricted = true; bad.versions[0].rating = 'unrated'; }
      if (variant === 'invalid-type') (bad as unknown as Record<string, unknown>).promotedRequestId = 123;
      save(bad); assert.throws(() => inspectShowSnapshot(db), /incomplete or incompatible/, variant);
    }
  } finally { db.close(); }
});
