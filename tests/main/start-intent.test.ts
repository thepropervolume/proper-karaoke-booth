import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyCommand, createInitialState, type Command, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { StartIntentFence } from '../../src/main/start-intent';

function fixture() {
  let state: ShowState = createInitialState('show', 'epoch'), sequence = 0;
  const fence = new StartIntentFence();
  const send = (command: Command, role: 'host' | 'singer' = 'host') => {
    const result = applyCommand(state, { commandId: String(++sequence), showId: state.showId, hostEpoch: state.hostEpoch,
      expectedRevision: state.revision, actor: { role, id: role === 'singer' ? 'singer' : 'host' }, command });
    assert.equal(result.outcome.ok, true); state = result.state; fence.observe(state, DEFAULT_SETTINGS, 0);
  };
  send({ type: 'addSinger', singer: { id: 'singer', name: 'Singer' } });
  send({ type: 'addVersion', version: { id: 'song', title: 'Song', artist: 'Artist', rating: 'clean' } });
  send({ type: 'request', requestId: 'request', versionId: 'song', singerId: 'singer' });
  send({ type: 'stage' });
  return { state: () => state, send, fence, capture: () => fence.capture(state, DEFAULT_SETTINGS, 0), current: (intent: ReturnType<StartIntentFence['capture']>) => fence.current(state, DEFAULT_SETTINGS, 0, intent) };
}

test('a delayed start cannot survive a singer hold and return to the same request', async () => {
  const f = fixture(), intent = f.capture(); assert.ok(f.current(intent));
  let release!: () => void, started = false;
  const pending = (async () => { await new Promise<void>(resolve => { release = resolve; });
    if (f.current(intent)) started = true; })();
  f.send({ type: 'setSingerAvailability', singerId: 'singer', minutes: 1 }, 'singer');
  f.send({ type: 'setSingerAvailability', singerId: 'singer', minutes: 0 }, 'singer');
  f.send({ type: 'stage' }); assert.equal(f.state().stagedRequestId, intent?.requestId);
  release(); await pending; assert.equal(started, false);
  assert.ok(f.current(f.capture()), 'a fresh deliberate attempt can select the returned singer');
});

test('unrelated committed changes preserve a start, while performer, recording and show changes invalidate it', () => {
  const f = fixture(), state = f.state(), intent = f.capture(); assert.ok(intent);
  f.send({ type: 'addSinger', singer: { id: 'other', name: 'Other' } });
  assert.equal(f.current(intent), true, 'an unrelated singer must not delay the show');
  for (const changed of [
    { ...state, hostEpoch: 'new-epoch' },
    { ...state, requests: state.requests.map(request => ({ ...request, singerId: 'other' })) },
    { ...state, requests: state.requests.map(request => ({ ...request, coSingerId: 'other' })) },
    { ...state, requests: state.requests.map(request => ({ ...request, versionId: 'other' })) },
  ]) { const fence = new StartIntentFence(), captured = fence.capture(state, DEFAULT_SETTINGS, 0); assert.equal(fence.current(changed, DEFAULT_SETTINGS, 0, captured), false); }
  const policyFence = new StartIntentFence(), policyIntent = policyFence.capture(state, DEFAULT_SETTINGS, 0);
  policyFence.observe(state, { ...DEFAULT_SETTINGS, artistBlacklist: ['Artist'] }, 0);
  assert.equal(policyFence.current(state, DEFAULT_SETTINGS, 0, policyIntent), false, 'a temporary policy block invalidates the old intent');
  f.send({ type: 'withdrawRequest', requestId: 'request' }, 'singer');
  assert.equal(f.current(intent), false);
});
