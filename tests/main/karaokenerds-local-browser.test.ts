import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LocalCommunityBrowser } from '../../src/main/karaokenerds-local-browser';

const item = (id: number, title = 'Popular') => ({ Id: id, Artist: 'Nada Surf', Title: title, Brand: 'internal-42', Watch: 'https://www.youtube.com/watch?v=abcdefghijk', Created: null });

test('searches the existing local snapshot without creating a database or contacting the provider', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-local-catalog-'));
  const path = join(dir, 'catalog.sqlite');
  const browser = new LocalCommunityBrowser(path);
  try {
    assert.equal(browser.search('nada').status, 'missing');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE community_catalog (id INTEGER PRIMARY KEY, snapshot TEXT, last_success INTEGER); CREATE TABLE community_brand_mappings (upstream_brand TEXT, display_name TEXT)');
    db.prepare('INSERT INTO community_catalog VALUES (1, ?, ?)').run(JSON.stringify({ Items: [item(1), { ...item(2, 'Alternate'), Brand: 'unknown', Watch: 'https://example.com/not-a-video' }] }), 123);
    db.prepare('INSERT INTO community_brand_mappings VALUES (?, ?)').run('internal-42', 'The Proper Volume');
    const result = browser.search('NADA popular');
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') throw new Error('Unexpected status');
    assert.deepEqual(result.tracks, [{ id: 1, artist: 'Nada Surf', title: 'Popular', brand: 'The Proper Volume', youtubeId: 'abcdefghijk' }]);
    const unknown = browser.search('alternate');
    assert.equal(unknown.status, 'ready');
    if (unknown.status !== 'ready') throw new Error('Unexpected status');
    assert.equal(unknown.tracks[0].brand, null);
    assert.equal(unknown.tracks[0].youtubeId, null);
    db.prepare('UPDATE community_catalog SET snapshot = ? WHERE id = 1').run(JSON.stringify({ Items: [item(3, 'New Song')] }));
    const updated = browser.search('new song');
    assert.equal(updated.status, 'ready');
    if (updated.status !== 'ready') throw new Error('Unexpected status');
    assert.equal(updated.tracks[0].id, 3);
    assert.throws(() => browser.search('x'), /at least two characters/);
    db.close();
  } finally { browser.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('limits results and reports unusable databases without exposing paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tpv-local-catalog-'));
  const path = join(dir, 'catalog.sqlite');
  const db = new DatabaseSync(path);
  const browser = new LocalCommunityBrowser(path);
  try {
    db.exec('CREATE TABLE community_catalog (id INTEGER PRIMARY KEY, snapshot TEXT, last_success INTEGER)');
    db.prepare('INSERT INTO community_catalog VALUES (1, ?, NULL)').run(JSON.stringify({ Items: Array.from({ length: 51 }, (_, i) => item(i)) }));
    const result = browser.search('nada');
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') throw new Error('Unexpected status');
    assert.equal(result.tracks.length, 50);
    assert.equal(result.limited, true);
    db.prepare('UPDATE community_catalog SET snapshot = ? WHERE id = 1').run('{not json');
    assert.equal(browser.search('nada').status, 'unavailable');
  } finally { browser.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
