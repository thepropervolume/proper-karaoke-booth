import assert from 'node:assert/strict';
import test from 'node:test';
import { preferenceSearchTerms, preferenceTopicMatches } from '../../src/renderer/preference-search';

test('preference search matches phrases across terms in the same group of controls', () => {
  assert.deepEqual(preferenceSearchTerms('  PAUSE — interval (seconds) '), ['pause', 'interval', 'seconds']);
  assert.deepEqual(preferenceSearchTerms('Play music on lÁunch'), ['play', 'music', 'launch']);
  assert.equal(preferenceTopicMatches(['pause', 'interval'], 'Audio & Display', 'Audio Controls', 'pause interval'), true);
  assert.equal(preferenceTopicMatches(['pause', 'interval'], 'Audio & Display', 'Bumper Music', 'launch'), false);
  assert.equal(preferenceTopicMatches(['audio', 'display'], 'Audio & Display', 'Bumper Music', 'launch'), true);
});
