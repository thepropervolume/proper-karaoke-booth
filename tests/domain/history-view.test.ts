import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HistoryEntry } from '../../src/domain/collections';
import { historyView } from '../../src/domain/history-view';

const records: HistoryEntry[] = [
  { generationId: 'one', singerId: 'singer-one', singer: 'José', versionId: 'v1', title: 'Déjà Vu', artist: 'Beyoncé', outcome: 'completed', at: '2026-11-11T00:00:00Z' },
  { generationId: 'two', singerId: 'singer-two', singer: 'Casey', versionId: 'v2', title: 'Popular', artist: 'Nada Surf', outcome: 'skipped', at: '2026-11-10T00:00:00Z' },
  { generationId: 'three', singerId: 'singer-one', singer: 'José', versionId: 'v3', title: 'Popular', artist: 'Nada Surf', outcome: 'completed', at: '2026-11-09T00:00:00Z' },
];

test('searches saved singer, artist and title together without changing history order', () => {
  assert.deepEqual(historyView(records, '  JOSE  deja  ', '').map(row => row.generationId), ['one']);
  assert.deepEqual(historyView(records, '  NADA popular ', '').map(row => row.generationId), ['two', 'three']);
  assert.deepEqual(historyView(records, '', '').map(row => row.generationId), ['one', 'two', 'three']);
  assert.deepEqual(records.map(row => row.generationId), ['one', 'two', 'three']);
});

test('combines the singer filter and text search using historical singer names', () => {
  assert.deepEqual(historyView(records, 'popular', 'singer-one').map(row => row.generationId), ['three']);
  assert.deepEqual(historyView(records, 'casey', 'singer-one'), []);
  assert.deepEqual(historyView(records, 'jose', '').map(row => row.generationId), ['one', 'three']);
  assert.deepEqual(historyView(records, 'missing', ''), []);
});
