import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CommunityCatalogStore } from '../../src/catalog/karaokenerds';
import { previewCatalogBatch } from '../../src/main/karaokenerds-batch-catalog';

const first = { Id: 0, Artist: 'Example Artist', Title: 'Example Song', Brand: 'A', Watch: 'https://youtu.be/abcdefghij1', Created: '/Date(9999999999999)/' };
const second = { ...first, Brand: 'B', Watch: 'https://youtu.be/abcdefghij2', Created: '/Date(0)/' };

test('saved yt-dlp dates reach the artist preview while feed Created is ignored', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-batch-catalog-')); const store = new CommunityCatalogStore(path.join(dir, 'db.sqlite'));
  try {
    store.seed({ Items: [first, second] }, 0);
    store.saveBrandMapping({ slug: 'BrandA', name: 'Brand A', upstreamBrand: 'A' }, 1, ['abcdefghij1']);
    store.saveBrandMapping({ slug: 'BrandB', name: 'Brand B', upstreamBrand: 'B' }, 1, ['abcdefghij2']);
    store.saveVideoDates('abcdefghij1', { uploadDate: '2024-01-01', releaseDate: null, provenance: 'yt-dlp' }, 1);
    const lackingDate = previewCatalogBatch(store, dir, { brandSlugs: [], artists: ['Example Artist'] });
    assert.equal(lackingDate.plan.ready.length, 0);
    assert.equal(lackingDate.plan.unresolvedArtists[0].reason, 'missing-publication-date');
    store.saveVideoDates('abcdefghij2', { uploadDate: '2025-02-02', releaseDate: null, provenance: 'yt-dlp' }, 1);
    const preview = previewCatalogBatch(store, dir, { brandSlugs: [], artists: ['Example Artist'] });
    assert.deepEqual(preview.incompleteArtists, []);
    assert.equal(preview.plan.ready.length, 1);
    assert.equal(preview.plan.ready[0].candidate.video.id, 'abcdefghij2');
    assert.equal(preview.plan.ready[0].artistDecision?.dateSource, 'yt-dlp-upload');
    assert.equal(preview.plan.ready[0].artistDecision?.approximate, true);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('mismatched saved brand identity is not accepted as complete coverage', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-batch-stale-')); const store = new CommunityCatalogStore(path.join(dir, 'db.sqlite'));
  try {
    store.seed({ Items: [{ ...first, Brand: 'B' }] }, 0);
    store.saveBrandMapping({ slug: 'BrandA', name: 'Brand A', upstreamBrand: 'A' }, 1, ['abcdefghij1']);
    store.saveBrandMapping({ slug: 'BrandB', name: 'Brand B', upstreamBrand: 'B' }, 1);
    const preview = previewCatalogBatch(store, dir, { brandSlugs: ['BrandB'], artists: ['Example Artist'] });
    assert.deepEqual(preview.incompleteArtists, ['Example Artist']);
    assert.deepEqual(preview.incompleteBrands, ['BrandB']);
    assert.equal(preview.plan.ready.length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unmapped entries and duplicate IDs prevent false completeness for artists or brands', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-batch-incomplete-')); const store = new CommunityCatalogStore(path.join(dir, 'db.sqlite'));
  try {
    store.seed({ Items: [first, second, { ...first, Artist: 'Another Artist' }] }, 0);
    store.saveBrandMapping({ slug: 'BrandA', name: 'Brand A', upstreamBrand: 'A' }, 1, ['abcdefghij1']);
    const preview = previewCatalogBatch(store, dir, { brandSlugs: ['BrandA'], artists: ['Example Artist'] });
    assert.deepEqual(preview.incompleteArtists, ['Example Artist']);
    assert.deepEqual(preview.incompleteBrands, ['BrandA']);
    assert.equal(preview.plan.ready.length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
