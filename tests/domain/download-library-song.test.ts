import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadLibrarySong } from '../../src/renderer/download-library-song';
import type { LibrarySearchVersion } from '../../src/domain/unified-library';

const online: LibrarySearchVersion = { id: 'catalog:AbCdEfGhI_j', title: 'Chosen Track', artist: 'Chosen Artist', rating: 'unrated',
  source: { provider: 'youtube', videoId: 'AbCdEfGhI_j' },
  catalogTrack: { youtubeId: 'AbCdEfGhI_j', title: 'Chosen Track', artist: 'Chosen Artist', brandSlug: 'TheProperVolume' } };

test('explicit download of a catalog match saves the exact recording and uses the durable ID, without queueing', async () => {
  const calls: unknown[] = [];
  const result = await downloadLibrarySong(online, {
    addYouTube: async input => { calls.push(input); return { ok: true, versionId: 'durable-version' }; },
    youtubeDownloads: { start: async id => { calls.push(id); } },
  });
  assert.deepEqual(result, { ok: true, versionId: 'durable-version' });
  assert.deepEqual(calls, [{ url: 'https://www.youtube.com/watch?v=AbCdEfGhI_j', title: 'Chosen Track', artist: 'Chosen Artist', brandSlug: 'TheProperVolume' }, 'durable-version']);
});

test('existing host metadata is not rewritten and failed catalog persistence cannot dispatch a download', async () => {
  const { catalogTrack, ...existing } = online;
  let dispatched = '';
  await downloadLibrarySong({ ...existing, id: 'host-corrected' }, {
    addYouTube: async () => { throw new Error('Must not rewrite existing metadata'); },
    youtubeDownloads: { start: async id => { dispatched = id; } },
  });
  assert.equal(dispatched, 'host-corrected');
  dispatched = '';
  assert.deepEqual(await downloadLibrarySong(online, {
    addYouTube: async () => ({ ok: false, error: 'Blocked by show policy.' }),
    youtubeDownloads: { start: async id => { dispatched = id; } },
  }), { ok: false, error: 'Blocked by show policy.' });
  assert.equal(dispatched, '');
});
