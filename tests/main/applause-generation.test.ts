import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applauseGenerationUnchanged, captureApplauseGeneration } from '../../src/main/applause-generation';
import type { Playback } from '../../src/domain';

const playing = (generationId: string): Playback => ({ requestId: 'song', generationId, status: 'playing' });

test('a delayed clap acknowledgement cannot award a later or paused performance', () => {
  const captured = captureApplauseGeneration(playing('first'));
  assert.equal(applauseGenerationUnchanged(captured, playing('first')), true);
  assert.equal(applauseGenerationUnchanged(captured, playing('next')), false);
  assert.equal(applauseGenerationUnchanged(captured, { ...playing('first'), status: 'paused' }), false);
  assert.equal(applauseGenerationUnchanged(captured, null), false);
});

test('an interlude clap cannot be attributed to a song that starts before acknowledgement', () => {
  const captured = captureApplauseGeneration(null);
  assert.equal(applauseGenerationUnchanged(captured, null), true);
  assert.equal(applauseGenerationUnchanged(captured, { ...playing('paused'), status: 'paused' }), true);
  assert.equal(applauseGenerationUnchanged(captured, playing('next')), false);
});
