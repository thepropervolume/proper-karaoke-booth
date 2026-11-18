import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Version } from '../../src/domain';
import type { YouTubeDownloadStatus } from '../../src/renderer/YouTubeDownloadsPanel';
import { queuePreparation } from '../../src/renderer/use-queue-preparation';

const base = { id: 'song', title: 'Title', artist: 'Artist', rating: 'unrated' } as const;
const youtube: Version = { ...base, source: { provider: 'youtube', videoId: 'abcdefghijk' } };
const karafun: Version = { ...base, source: { provider: 'karafun', catalog: 'catalog', songId: '1' } };
const party: Version = { ...base, source: { provider: 'partytyme', catalog: 'consumer', videoId: '1' } };
const providers = { karafun: [], partytyme: [] };
const status: YouTubeDownloadStatus = { job: null, preparing: false, cachedVersionIds: [], readyVersionIds: [],
  queue: { pendingVersionIds: ['song'], activeVersionId: null, failures: [], blocked: false } };

test('queue describes waiting, downloading, failing and cached YouTube songs', () => {
  assert.match(queuePreparation(youtube, status, providers)!.label, /Waiting/);
  assert.match(queuePreparation(youtube, { ...status, queue: { ...status.queue!, activeVersionId: 'song' } }, providers)!.label, /Downloading/);
  assert.equal(queuePreparation(youtube, { ...status, queue: { ...status.queue!, failures: [{ versionId: 'song', message: 'failed' }] } }, providers)!.failed, true);
  assert.equal(queuePreparation(youtube, { ...status, readyVersionIds: ['song'] }, providers), null);
});

test('authoritative readiness wins over a stale native ready status after a cached file disappears', () => {
  const native = { ...providers, karafun: [{ versionId: 'song', phase: 'ready' as const, received: 0, total: null }] };
  assert.equal(queuePreparation(karafun, { ...status, readyVersionIds: ['song'] }, native), null);
  assert.equal(queuePreparation(karafun, status, native)!.pending, true);
  assert.equal(queuePreparation(party, { ...status, readyVersionIds: ['song'] }, providers), null);
  assert.equal(queuePreparation(base, status, providers), null);
});
