import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createInitialState, orderedFuture, type Command } from '../../src/domain/index';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/domain/settings';

test('settings have validated defaults and reject malformed or misspelled values', () => {
  assert.deepEqual(parseSettings({}), DEFAULT_SETTINGS);
  assert.equal(parseSettings({ autoApprove: false }).autoApprove, false);
  assert.equal(parseSettings({ layout: 'rotation' }).layout, 'rotation');
  assert.equal(parseSettings({ layout: 'library' }).layout, 'library');
  assert.equal(parseSettings({ masterVolume: 0 }).masterVolume, 0);
  assert.equal(parseSettings({ masterVolume: 0.42 }).masterVolume, 0.42);
  assert.deepEqual(parseSettings({ metadataTemplates: ['${Artist} - ${Title}'] }).metadataTemplates, ['${Artist} - ${Title}']);
  assert.throws(() => parseSettings({ metadataTemplates: ['${Artist}${Title}'] }));
  assert.equal(parseSettings({ showNextSingers: true }).showNextSingers, true);
  assert.throws(() => parseSettings({ showDisplayLogo: 'yes' }));
  for (const masterVolume of [-1, 1.1, '0.5', null]) assert.throws(() => parseSettings({ masterVolume }));
  assert.throws(() => parseSettings({ layout: 'unknown' }));
  assert.throws(() => parseSettings({ autoApprove: 'false' }));
  assert.throws(() => parseSettings({ autoAprove: false }));
  for (const key of ['constructor', '__proto__', 'toString']) assert.throws(() => parseSettings(JSON.parse(`{"${key}": true}`)), /Unknown settings/);
  assert.equal(parseSettings({}).audioOutputId, '');
  assert.equal(parseSettings({}).autoBumper, true);
  assert.equal(parseSettings({}).autoBumperTrackId, 'builtin-ambient');
  assert.equal(parseSettings({ autoBumper: true, autoBumperTrackId: 'chosen-track' }).autoBumperTrackId, 'chosen-track');
  for (const invalid of [{ autoBumper: 'yes' }, { autoBumperTrackId: '' }, { autoBumperTrackId: 'x'.repeat(129) }]) assert.throws(() => parseSettings(invalid));
  assert.equal(parseSettings({}).maxFutureRequestsPerSinger, 3);
  assert.equal(parseSettings({ maxFutureRequestsPerSinger: 0 }).maxFutureRequestsPerSinger, 0);
  assert.equal(parseSettings({ maxFutureRequestsPerSinger: 50 }).maxFutureRequestsPerSinger, 50);
  for (const value of [-1, 51, 1.5, null, '3']) assert.throws(() => parseSettings({ maxFutureRequestsPerSinger: value }));
  assert.equal(parseSettings({}).singerDisplayFullscreen, false);
  assert.equal(parseSettings({ singerDisplayFullscreen: true }).singerDisplayFullscreen, true);
  assert.throws(() => parseSettings({ singerDisplayFullscreen: 'yes' }));
  assert.equal(parseSettings({ audioOutputId: 'speaker-123' }).audioOutputId, 'speaker-123');
  assert.throws(() => parseSettings({ audioOutputId: 42 }));
  assert.throws(() => parseSettings({ audioOutputId: 'x'.repeat(1025) }));
});

test('provider search settings migrate old files and keep secrets outside settings', () => {
  const settings = parseSettings({});
  assert.equal(settings.providerCatalogEnabled, true);
  assert.deepEqual(settings.providerCatalogProfiles, { karafun: '', partytyme: '', sunfly: '', stingray: '' });
  const profiles = { ...settings.providerCatalogProfiles, stingray: '/private/stingray.json' };
  const saved = parseSettings({ providerCatalogEnabled: false, providerCatalogProfiles: profiles });
  profiles.stingray = '/later'; assert.equal(saved.providerCatalogProfiles.stingray, '/private/stingray.json');
  assert.equal(saved.providerCatalogEnabled, false);
  for (const value of [false, {}, { ...profiles, surprise: 'secret' }, { ...profiles, sunfly: 'relative/file' }, { ...profiles, sunfly: 'bad\npath' }]) assert.throws(() => parseSettings({ providerCatalogProfiles: value }));
  assert.throws(() => parseSettings({ providerCatalogEnabled: 'yes' }));
});

test('auto approval and queue modes determine staging while preserving the locked song', () => {
  let state = createInitialState('show', 'epoch');
  let n = 0;
  const send = (command: Command, rotationMode: 'singer' | 'fifo' = 'singer', autoApprove = true) => {
    const result = applyCommand(state, { commandId: `${++n}`, showId: 'show', hostEpoch: 'epoch', expectedRevision: state.revision, actor: { role: 'host', id: 'host' }, command }, { autoApprove, rotationMode });
    assert.equal(result.outcome.ok, true, JSON.stringify(result.outcome)); state = result.state;
  };
  send({ type: 'addVersion', version: { id: 'v', title: 'Song', artist: 'Artist', rating: 'clean' } });
  for (const id of ['a', 'b']) send({ type: 'addSinger', singer: { id, name: id } });
  for (const [id, singerId] of [['a1', 'a'], ['a2', 'a'], ['b1', 'b']]) send({ type: 'request', requestId: id, singerId, versionId: 'v' });
  assert.deepEqual(orderedFuture(state, 'singer').map(r => r.id), ['a1', 'b1', 'a2']);
  assert.deepEqual(orderedFuture(state, 'fifo').map(r => r.id), ['a1', 'a2', 'b1']);
  send({ type: 'stage' }, 'singer');
  assert.equal(orderedFuture(state, 'fifo')[0].id, 'a1');
  send({ type: 'release' });
  send({ type: 'stage' }, 'fifo');
  assert.equal(state.stagedRequestId, 'a1');
  send({ type: 'start', generationId: 'g' });
  send({ type: 'stage' }, 'fifo');
  assert.equal(state.stagedRequestId, 'a2');
  send({ type: 'request', requestId: 'b2', singerId: 'b', versionId: 'v' }, 'fifo', false);
  assert.equal(state.requests.find(r => r.id === 'b2')?.status, 'pending');
});

test('FIFO follows request time when older pending requests are approved later', () => {
  let state = createInitialState('show', 'epoch');
  let n = 0;
  const send = (command: Command) => {
    const result = applyCommand(state, { commandId: `${++n}`, showId: 'show', hostEpoch: 'epoch', expectedRevision: state.revision, actor: { role: 'host', id: 'host' }, command }, { autoApprove: false, rotationMode: 'fifo' });
    assert.equal(result.outcome.ok, true); state = result.state;
  };
  send({ type: 'addVersion', version: { id: 'v', title: 'Song', artist: '', rating: 'clean' } });
  send({ type: 'addSinger', singer: { id: 'a', name: 'A' } });
  send({ type: 'request', requestId: 'first', singerId: 'a', versionId: 'v' });
  send({ type: 'request', requestId: 'second', singerId: 'a', versionId: 'v' });
  send({ type: 'accept', requestId: 'second' });
  send({ type: 'accept', requestId: 'first' });
  // Serialized old shows already contain their requests in arrival order.
  state = JSON.parse(JSON.stringify(state));
  assert.deepEqual(orderedFuture(state, 'fifo').map(r => r.id), ['first', 'second']);
  send({ type: 'stage' });
  assert.equal(state.stagedRequestId, 'first');
});
