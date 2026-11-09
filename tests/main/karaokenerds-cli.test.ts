import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CommunityCatalogStore } from '../../src/catalog/karaokenerds';
import { cachedVideoPath } from '../../src/main/karaokenerds-cache-plan';

test('operator CLI lists known metadata and preserves an existing download without network access', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'tpv-kn-cli-')), db = path.join(root, 'catalog.sqlite');
  const store = new CommunityCatalogStore(db);
  const video = { id: 'abcDEF_123-', provider: 'karaokenerds', brandSlug: 'ExampleBrand', artist: 'Example Artist', title: 'Example Song', extension: 'mp4' };
  try {
    store.seed({ Items: [{ Id: 0, Artist: video.artist, Title: video.title, Brand: 'EX', Watch: `https://youtu.be/${video.id}`, Created: null }] }, 0);
    store.saveBrandMapping({ slug: video.brandSlug, name: 'Example Brand', upstreamBrand: 'EX' }, 1, [video.id]);
    store.saveProducerTrackCode(video.id, 'EX-003', 'host-confirmed');
    store.saveVideoDates(video.id, { uploadDate: '2025-03-04', releaseDate: null, provenance: 'yt-dlp' }, 1);
    store.close();
    const target = cachedVideoPath(root, video);
    mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, 'already present');
    const env = { ...process.env, TPV_KARAOKENNERDS_DATABASE: db, TPV_KARAOKENNERDS_BRAND_SLUG: video.brandSlug,
      TPV_KARAOKENNERDS_VIDEO_ID: video.id, TPV_YTDLP_EXECUTABLE: process.execPath, TPV_CACHED_VIDEOS_DIR: root,
      TPV_KARAOKENNERDS_BATCH_ARTISTS: video.artist };
    const run = (action: string) => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/karaokenerds-catalog.ts', action], { encoding: 'utf8', env }));
    const listing = run('tracks');
    assert.equal(listing.tracks[0].producerTrackCode, 'EX-003');
    assert.equal(listing.tracks[0].youtubeId, video.id);
    const preview = run('preview-batch');
    assert.equal(preview.plan.ready[0].candidate.ytDlpMetadata.uploadDate, '2025-03-04');
    assert.equal(preview.plan.ready[0].artistDecision.dateSource, 'yt-dlp-upload');
    assert.equal(run('download').status, 'exists');
    assert.equal(readFileSync(target, 'utf8'), 'already present');
  } finally { try { store.close(); } catch {} rmSync(root, { recursive: true, force: true }); }
});
