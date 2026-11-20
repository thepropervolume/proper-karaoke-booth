import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { applyCommand, createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';
import { runControlCli } from '../../src/control/cli';
import { projectControlQueue } from '../../src/control/queue';
import { fixtureAccess, httpControl, serverFixture } from './fixtures';

test('queue control is opt-in and retries return the original policy-checked result', async () => {
  const state = createInitialState('show-1', 'epoch-1');
  state.versions.push({ id: 'song-1', title: 'Synthetic Song', artist: 'Sample Artist', rating: 'clean' });
  let current = state, enabled = false, writes = 0;
  await serverFixture(async (_server, discovery) => {
    const body = { commandId: randomUUID(), showId: state.showId, hostEpoch: state.hostEpoch, expectedRevision: 0,
      command: { type: 'request', requestId: 'request-1', versionId: 'song-1', singerId: null } };
    const post = (value: unknown, anonymous = false) => httpControl(discovery, '/v1/queue/commands', {
      method: 'POST', anonymous, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    assert.equal((await post(body, true)).status, 401);
    assert.equal((await post(body)).status, 501);
    assert.equal(writes, 0);
    enabled = true;
    assert.equal((await post({ ...body, actor: { role: 'host' } })).status, 400);
    assert.equal((await post({ ...body, command: { type: 'start', requestId: 'request-1' } })).status, 400);
    assert.equal((await post({ ...body, command: { ...body.command, path: '/ignored' } })).status, 400);

    const out: string[] = [], errors: string[] = [];
    const cli = (...args: string[]) => runControlCli(['--profile-dir', discovery.profileDirectory, ...args], {
      access: fixtureAccess, out: line => out.push(line), err: line => errors.push(line), input: Readable.from([JSON.stringify(body)]),
    });
    assert.equal(await cli('queue', 'command', JSON.stringify(body)), 0);
    assert.equal(await cli('queue', 'command', '-'), 0);
    assert.deepEqual(JSON.parse(out[1]).result, { ok: true, revision: 1 });
    assert.equal(writes, 1);
    assert.equal(await cli('queue'), 0);
    assert.deepEqual(JSON.parse(out[2]).result.requests, [{ id: 'request-1', versionId: 'song-1', singerId: null,
      status: 'pending', title: 'Synthetic Song', artist: 'Sample Artist', singer: '' }]);

    const accept = { ...body, commandId: randomUUID(), command: { type: 'accept', requestId: 'request-1' } };
    assert.equal(await cli('queue', 'command', JSON.stringify(accept)), 5);
    assert.equal(JSON.parse(errors.at(-1)!).result.code, 'REVISION_CONFLICT');
    assert.equal(await cli('queue', 'command', JSON.stringify({ ...accept, commandId: randomUUID(), expectedRevision: 1 })), 0);
    assert.equal(current.requests[0].status, 'accepted');
    assert.equal(current.playback, null);
    assert.equal((await post({ ...body, hostEpoch: 'expired-epoch' })).status, 200);
    enabled = false;
    assert.equal(await cli('queue', 'command', JSON.stringify(body)), 6);
    assert.equal(current.requests.length, 1);
  }, { adapter: {
    getState: () => current, getSettings: () => DEFAULT_SETTINGS, getShortcuts: () => DEFAULT_SHORTCUTS,
    getQueue: () => projectControlQueue(current, 'singer', 0), isQueueControlEnabled: () => enabled,
    applyQueueCommand: envelope => {
      const result = applyCommand(current, { ...envelope, actor: { role: 'host', id: 'local-cli' } }, { ...DEFAULT_SETTINGS, autoApprove: false });
      if (result.state !== current) writes++;
      current = result.state;
      return result.outcome;
    },
  } });
});
