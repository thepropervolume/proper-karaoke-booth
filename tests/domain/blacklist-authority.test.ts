import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createInitialState, isVersionAllowed, visibleVersions, type Actor, type Command } from '../../src/domain';
import { parseSettings } from '../../src/domain/settings';

function fixture() {
  let state = createInitialState('show', 'epoch'), number = 0;
  const settings = parseSettings({});
  state.versions.push({ id: 'first-version', artist: 'Nada Surf', title: 'Amateur', rating: 'clean', source: { provider: 'youtube', videoId: 'abcdefghijk' } },
    { id: 'second-version', artist: 'NADA SURF', title: 'AMATEUR', rating: 'clean', source: { provider: 'youtube', videoId: 'lmnopqrstuv' } },
    { id: 'other-version', artist: 'Other Artist', title: 'Amateur', rating: 'clean' });
  state.singers.push({ id: 'singer', name: 'Singer' });
  const command = (command: Command, actor: Actor = { role: 'host', id: 'host' }) => {
    const result = applyCommand(state, { commandId: `command-${++number}`, showId: 'show', hostEpoch: 'epoch', expectedRevision: state.revision, actor, command }, settings);
    state = result.state; return result.outcome;
  };
  return { settings, command, state: () => state };
}

test('authority requests and projections honor host-wide identities across recording versions without sticky show policy', () => {
  const f = fixture(), policy = structuredClone(f.state().policy);
  f.settings.songBlacklist = [{ artist: 'Nada Surf', title: 'Amateur' }];
  for (const id of ['first-version', 'second-version']) {
    const outcome = f.command({ type: 'request', requestId: 'request-' + id, singerId: 'singer', versionId: id });
    assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(outcome.code, 'NOT_AVAILABLE');
    assert.equal(isVersionAllowed(f.state(), id, f.settings), false);
  }
  assert.deepEqual(visibleVersions(f.state(), f.settings).map(version => version.id), ['other-version']);
  assert.equal(f.command({ type: 'request', requestId: 'other-request', singerId: 'singer', versionId: 'other-version' }).ok, true);
  assert.deepEqual(f.state().policy, policy);
  f.settings.songBlacklist = [];
  assert.equal(visibleVersions(f.state(), f.settings).length, 3);
  assert.equal(f.command({ type: 'request', requestId: 'unhidden-request', singerId: 'singer', versionId: 'first-version' }).ok, true);
  assert.deepEqual(f.state().policy, policy);
});

test('artist rules gate accept, promote and request edits while staging skips retained ineligible requests', () => {
  const f = fixture();
  f.command({ type: 'request', requestId: 'first-request', singerId: 'singer', versionId: 'first-version' });
  f.command({ type: 'request', requestId: 'other-request', singerId: 'singer', versionId: 'other-version' });
  f.settings.autoApprove = false;
  f.command({ type: 'request', requestId: 'pending-request', singerId: 'singer', versionId: 'second-version' });
  f.settings.artistBlacklist = ['Nada Surf'];
  for (const command of [{ type: 'accept', requestId: 'pending-request' }, { type: 'promoteRequest', requestId: 'first-request' },
    { type: 'editRequest', requestId: 'other-request', singerId: 'singer', versionId: 'second-version' }] as Command[]) {
    const outcome = f.command(command); assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(outcome.code, 'NOT_AVAILABLE');
  }
  assert.equal(f.state().requests.find(request => request.id === 'other-request')?.versionId, 'other-version');
  assert.equal(f.command({ type: 'stage' }).ok, true); assert.equal(f.state().stagedRequestId, 'other-request');
  assert.equal(f.state().requests.find(request => request.id === 'first-request')?.status, 'accepted');
  assert.deepEqual(f.state().policy.excludeVersionIds, []);
});

test('a newly blocked staged song remains locked and cannot start until the host releases it or removes the rule', () => {
  const f = fixture();
  f.command({ type: 'request', requestId: 'request', singerId: 'singer', versionId: 'first-version' }); f.command({ type: 'stage' });
  f.settings.artistBlacklist = ['Nada Surf'];
  const start = f.command({ type: 'start', generationId: 'generation' });
  assert.equal(start.ok, false); if (!start.ok) assert.equal(start.code, 'NOT_AVAILABLE');
  assert.equal(f.state().stagedRequestId, 'request'); assert.equal(f.state().playback, null);
  const stage = f.command({ type: 'stage' }); assert.equal(stage.ok, false); if (!stage.ok) assert.equal(stage.code, 'LOCKED');
  assert.equal(f.command({ type: 'release' }).ok, true); assert.equal(f.command({ type: 'stage' }).ok, false);
  f.settings.artistBlacklist = []; assert.equal(f.command({ type: 'stage' }).ok, true);
  assert.equal(f.command({ type: 'start', generationId: 'generation' }).ok, true);
});

test('paused blocked playback cannot resume but host stop and engine completion remain available', () => {
  const f = fixture();
  f.command({ type: 'request', requestId: 'request', singerId: 'singer', versionId: 'first-version' }); f.command({ type: 'stage' });
  f.command({ type: 'start', generationId: 'generation' }); f.command({ type: 'pause' }); f.settings.artistBlacklist = ['Nada Surf'];
  const resumed = f.command({ type: 'resume' }); assert.equal(resumed.ok, false); if (!resumed.ok) assert.equal(resumed.code, 'NOT_AVAILABLE');
  assert.equal(f.state().playback?.status, 'paused'); assert.equal(f.command({ type: 'stop' }).ok, true);
  assert.equal(f.state().requests[0].status, 'accepted'); assert.equal(f.state().playback, null);
  f.settings.artistBlacklist = []; f.command({ type: 'stage' }); f.command({ type: 'start', generationId: 'second-generation' });
  f.settings.artistBlacklist = ['Nada Surf'];
  assert.equal(f.command({ type: 'complete', generationId: 'second-generation' }, { role: 'engine', id: 'engine' }).ok, true);
  assert.equal(f.state().requests[0].status, 'completed'); assert.deepEqual(f.state().policy.excludeVersionIds, []);
});

test('removing a global rule does not remove a separate show exclusion or a show allowlist', () => {
  const f = fixture();
  f.command({ type: 'setPolicy', policy: { ageRestricted: false, includeVersionIds: null, excludeVersionIds: ['second-version'] } });
  f.settings.artistBlacklist = ['Nada Surf']; assert.equal(visibleVersions(f.state(), f.settings).length, 1);
  f.settings.artistBlacklist = []; assert.deepEqual(visibleVersions(f.state(), f.settings).map(version => version.id), ['first-version', 'other-version']);
  assert.deepEqual(f.state().policy.excludeVersionIds, ['second-version']);
});
