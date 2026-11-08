import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addPreviewRequest, initialPreview, searchPreview, withdrawPreviewRequest } from '../src/preview';

test('the offline preview searches synthetic songs and never mutates the previous state', () => {
  const original = initialPreview();
  assert.deepEqual(searchPreview(original, 'sample tonight').map(item => item.id), ['demo-3']);
  const requested = addPreviewRequest(original, 'demo-1');
  assert.equal(original.requests.length, 0);
  assert.equal(requested.requests[0].status, 'accepted');
  assert.equal(addPreviewRequest(requested, 'unknown'), requested);
  const withdrawn = withdrawPreviewRequest(requested, requested.requests[0].id);
  assert.equal(withdrawn.requests[0].status, 'withdrawn');
  assert.equal(requested.requests[0].status, 'accepted');
});
