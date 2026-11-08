import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mediaFailure, playFailure } from '../../src/display/media-error';

test('media failures use bounded codes without propagating decoder messages', () => {
  assert.equal(mediaFailure(1), 'MEDIA_ERR_ABORTED');
  assert.equal(mediaFailure(2), 'MEDIA_ERR_NETWORK');
  assert.equal(mediaFailure(3), 'MEDIA_ERR_DECODE');
  assert.equal(mediaFailure(4), 'MEDIA_ERR_SRC_NOT_SUPPORTED');
  assert.equal(mediaFailure(undefined), 'PLAY_FAILED');
  assert.equal(playFailure({ name: 'NotAllowedError', message: 'private path' }), 'PLAY_BLOCKED');
  assert.equal(playFailure({ name: 'NotSupportedError' }), 'MEDIA_ERR_SRC_NOT_SUPPORTED');
  assert.equal(playFailure(new Error('private path')), 'PLAY_FAILED');
});
