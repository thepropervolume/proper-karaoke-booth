import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metadataFromFilename } from '../../src/domain/metadata';
import { applyCommand, createInitialState, type Command } from '../../src/domain/index';

test('filename formats and incomplete names are interpreted predictably', () => {
  assert.deepEqual(metadataFromFilename('Artist - Song - Mix', 'artist-title'), { artist: 'Artist', title: 'Song - Mix' });
  assert.deepEqual(metadataFromFilename('Song - Artist', 'title-artist'), { artist: 'Artist', title: 'Song' });
  assert.deepEqual(metadataFromFilename('Artist - Song', 'filename'), { artist: '', title: 'Artist - Song' });
  assert.deepEqual(metadataFromFilename('Song', 'artist-title'), { artist: '', title: 'Song' });
  assert.deepEqual(metadataFromFilename('Artist - ', 'artist-title'), { artist: '', title: 'Artist -' });
});

test('host metadata edits persist in state, validate input and are not allowed to singers', () => {
  let state = createInitialState('show', 'epoch'); let n = 0;
  const send = (command: Command, role: 'host' | 'singer' = 'host') => {
    const result = applyCommand(state, { commandId: `${++n}`, showId: 'show', hostEpoch: 'epoch', expectedRevision: state.revision, actor: { role, id: 'a' }, command });
    state = result.state; return result.outcome;
  };
  send({ type: 'addVersion', version: { id: 'v', title: 'Old', artist: '', rating: 'unrated' } });
  assert.equal(send({ type: 'editVersion', id: 'v', title: '  New  ', artist: ' Artist ' }).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(state)).versions[0], { id: 'v', title: 'New', artist: 'Artist', rating: 'unrated' });
  assert.equal(send({ type: 'editVersion', id: 'v', title: ' ', artist: 'Artist' }).ok, false);
  assert.equal(send({ type: 'editVersion', id: 'v', title: 'Bad', artist: 'Artist' }, 'singer').ok, false);
});
