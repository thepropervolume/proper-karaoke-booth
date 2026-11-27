import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeLibrarySort, compareLibrarySortValues, cycleLibrarySort } from '../../src/domain/library-result-fields';

test('result headers cycle ascending, descending and off, and moving columns restarts ascending', () => {
  const ascending = cycleLibrarySort('import-oldest', 'filename');
  assert.deepEqual(activeLibrarySort(ascending), { field: 'filename', direction: 'asc' });
  const descending = cycleLibrarySort(ascending, 'filename');
  assert.deepEqual(activeLibrarySort(descending), { field: 'filename', direction: 'desc' });
  assert.equal(activeLibrarySort(cycleLibrarySort(descending, 'filename')), null);
  assert.equal(cycleLibrarySort(descending, 'source'), 'source-asc');
});

test('sorting compares real values naturally and keeps unknown fields at the end in either direction', () => {
  assert.ok(compareLibrarySortValues('Track 2.mp4', 'Track 12.mp4', 'asc') < 0);
  assert.ok(compareLibrarySortValues('2024-10-01', '2024-02-01', 'asc') > 0);
  assert.ok(compareLibrarySortValues(119, 120, 'asc') < 0);
  assert.ok(compareLibrarySortValues(119, 120, 'desc') > 0);
  for (const direction of ['asc', 'desc'] as const) {
    assert.ok(compareLibrarySortValues(undefined, 120, direction) > 0);
    assert.ok(compareLibrarySortValues(' ', 'Known filename', direction) > 0);
    assert.equal(compareLibrarySortValues(null, undefined, direction), 0);
  }
});
