import { strict as assert } from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { executeKaraokeNerdsBatch, planKaraokeNerdsBatch, type BatchCandidate } from '../../src/main/karaokenerds-batch';

const base = path.resolve('synthetic-cache');
function candidate(id: string, brand: string, artist: string, title: string, date?: string): BatchCandidate {
  return { video: { id, provider: 'karaokenerds', brandSlug: brand, artist, title, extension: 'mp4' },
    watchUrl: `https://youtu.be/${id}`, verifiedPublicationDate: date };
}
const one = candidate('11111111111', 'Alpha', 'Artist One', 'Song One', '2023-01-01');
const two = candidate('22222222222', 'Beta', 'Artist One', 'Song One', '2024-01-01');
const three = candidate('33333333333', 'Alpha', 'Artist Two', 'Song Two');
const four = candidate('44444444444', 'Beta', 'Artist Two', 'Song Two');
const five = candidate('55555555555', 'Beta', 'Artist Three', 'Song Three');

test('selected brands include all songs and artists add only the newest confirmed version', () => {
  const result = planKaraokeNerdsBatch(base, [one, two, three, five], { brandSlugs: ['alpha'], artists: ['ARTIST ONE', 'Artist Three'], completeArtists: ['Artist One', 'Artist Three'] });
  assert.deepEqual(result.ready.map(item => item.candidate.video.id).sort(), [one.video.id, two.video.id, three.video.id, five.video.id]);
  assert.deepEqual(result.unresolvedArtists, []);
  assert.deepEqual(result.missingBrands, []); assert.deepEqual(result.missingArtists, []);
  assert.ok(result.ready.every(item => path.isAbsolute(item.path)));
});

test('unknown publication dates remain unresolved, even if a raw publishedAt value is set', () => {
  const unverified = { ...four, video: { ...four.video, publishedAt: '2099-01-01' } };
  const result = planKaraokeNerdsBatch(base, [three, unverified], { brandSlugs: ['Alpha'], artists: ['Artist Two'], completeArtists: ['Artist Two'] });
  assert.deepEqual(result.ready.map(item => item.candidate.video.id), [three.video.id]);
  assert.equal(result.unresolvedArtists.length, 1);
  assert.deepEqual(result.unresolvedArtists[0].videoIds, [three.video.id, four.video.id]);
});

test('yt-dlp upload date can choose the newest version and is labeled approximate', () => {
  const upload = { ...two, verifiedPublicationDate: null,
    ytDlpMetadata: { youtubeId: two.video.id, uploadDate: '2025-03-05', provenance: 'yt-dlp' as const } };
  const result = planKaraokeNerdsBatch(base, [one, upload], { brandSlugs: [], artists: ['Artist One'], completeArtists: ['Artist One'] });
  assert.equal(result.ready[0].candidate.video.id, two.video.id);
  assert.deepEqual(result.ready[0].artistDecision, { dateSource: 'yt-dlp-upload', approximate: true });
});

test('verified publication wins over its own upload fallback and mixed-source results remain approximate', () => {
  const mixed = { ...one, ytDlpMetadata: { youtubeId: one.video.id, uploadDate: '2030-01-01', provenance: 'yt-dlp' as const } };
  const upload = { ...two, verifiedPublicationDate: null,
    ytDlpMetadata: { youtubeId: two.video.id, uploadDate: '2022-01-01', provenance: 'yt-dlp' as const } };
  const result = planKaraokeNerdsBatch(base, [mixed, upload], { brandSlugs: [], artists: ['Artist One'], completeArtists: ['Artist One'] });
  assert.equal(result.ready[0].candidate.video.id, one.video.id);
  assert.deepEqual(result.ready[0].artistDecision, { dateSource: 'verified-publication', approximate: true });
});

test('invalid or mismatched upload evidence is unresolved; valid upload replaces malformed publication', () => {
  for (const metadata of [
    { youtubeId: 'wrong000000', uploadDate: '2025-01-01', provenance: 'yt-dlp' },
    { youtubeId: two.video.id, uploadDate: '2026-02-31', provenance: 'yt-dlp' },
    { youtubeId: two.video.id, uploadDate: '2025-01-01', provenance: 'other' },
  ]) {
    const invalid = { ...two, verifiedPublicationDate: null, ytDlpMetadata: metadata as BatchCandidate['ytDlpMetadata'] };
    const result = planKaraokeNerdsBatch(base, [one, invalid], { brandSlugs: [], artists: ['Artist One'], completeArtists: ['Artist One'] });
    assert.equal(result.ready.length, 0); assert.equal(result.unresolvedArtists[0].reason, 'missing-publication-date');
  }
  const fallback = { ...two, verifiedPublicationDate: '2026-02-31',
    ytDlpMetadata: { youtubeId: two.video.id, uploadDate: '2025-01-01', provenance: 'yt-dlp' as const } };
  const result = planKaraokeNerdsBatch(base, [one, fallback], { brandSlugs: [], artists: ['Artist One'], completeArtists: ['Artist One'] });
  assert.equal(result.ready[0].candidate.video.id, two.video.id);
  assert.equal(result.ready[0].artistDecision?.dateSource, 'yt-dlp-upload');
});

test('equal dates use deterministic video IDs and unambiguous single tracks need no dates', () => {
  const equal = { ...two, verifiedPublicationDate: null,
    ytDlpMetadata: { youtubeId: two.video.id, uploadDate: '2023-01-01', provenance: 'yt-dlp' as const } };
  const selection = { brandSlugs: [], artists: ['Artist One'], completeArtists: ['Artist One'] };
  for (const input of [[one, equal], [equal, one]]) {
    const result = planKaraokeNerdsBatch(base, input, selection);
    assert.equal(result.ready[0].candidate.video.id, one.video.id);
    assert.deepEqual(result.ready[0].artistDecision, { dateSource: 'verified-publication', approximate: true });
  }
  const single = planKaraokeNerdsBatch(base, [five], { brandSlugs: [], artists: ['Artist Three'], completeArtists: ['Artist Three'] });
  assert.deepEqual(single.ready[0].artistDecision, { dateSource: 'sole-candidate', approximate: false });
});

test('artist selections cannot infer the newest video from an incomplete catalog', () => {
  const result = planKaraokeNerdsBatch(base, [one], { brandSlugs: [], artists: ['Artist One'] });
  assert.deepEqual(result.ready, []);
  assert.equal(result.unresolvedArtists[0].reason, 'incomplete-catalog');
  assert.throws(() => planKaraokeNerdsBatch(base, [one], { brandSlugs: [], artists: [], completeArtists: ['Artist One'] }), /Completeness/);
});

test('reports requested unknown brands and artists and rejects duplicate or spoofed identities', () => {
  const result = planKaraokeNerdsBatch(base, [one], { brandSlugs: ['Missing'], artists: ['Nobody'] });
  assert.deepEqual(result.ready, []); assert.deepEqual(result.missingBrands, ['Missing']); assert.deepEqual(result.missingArtists, ['Nobody']);
  assert.throws(() => planKaraokeNerdsBatch(base, [one, one], { brandSlugs: ['Alpha'], artists: [] }), /duplicate/i);
  assert.throws(() => planKaraokeNerdsBatch(base, [{ ...one, watchUrl: 'https://youtube.com.evil.example/watch?v=11111111111' }], { brandSlugs: ['Alpha'], artists: [] }), /Invalid/);
});

test('colliding filenames are flagged rather than queued for overwrite', () => {
  const another = candidate('66666666666', 'Alpha', 'Artist One', 'Song One', '2025-01-01');
  const result = planKaraokeNerdsBatch(base, [one, another], { brandSlugs: ['Alpha'], artists: [] });
  assert.equal(result.ready.length, 0); assert.deepEqual(result.collisions[0].videoIds, [one.video.id, another.video.id]);
});

test('executor stops after a sanitized failure without starting another download', async () => {
  const plan = planKaraokeNerdsBatch(base, [one, three, five], { brandSlugs: ['Alpha', 'Beta'], artists: [] });
  let running = false; const calls: string[] = [];
  const result = await executeKaraokeNerdsBatch(plan, async item => {
    assert.equal(running, false); running = true; calls.push(item.video.id); await Promise.resolve(); running = false;
    throw new Error('Sensitive subprocess detail');
  });
  assert.equal(calls.length, 1); assert.deepEqual(result.results.map(item => item.status), ['failed']);
  assert.equal(result.remainingVideoIds.length, 2);
});

test('executor proceeds serially after success and stops on cancellation', async () => {
  const plan = planKaraokeNerdsBatch(base, [one, three, five], { brandSlugs: ['Alpha', 'Beta'], artists: [] });
  let calls = 0;
  const result = await executeKaraokeNerdsBatch(plan, async () => {
    calls++; return { status: calls === 1 ? 'downloaded' : 'cancelled', path: '', cleanupNeeded: false };
  });
  assert.equal(calls, 2); assert.deepEqual(result.results.map(item => item.status), ['downloaded', 'cancelled']);
  assert.equal(result.remainingVideoIds.length, 1);
});

test('executor stops when cleanup requires review and does nothing if pre-aborted', async () => {
  const plan = planKaraokeNerdsBatch(base, [one, five], { brandSlugs: ['Alpha', 'Beta'], artists: [] });
  let calls = 0;
  const result = await executeKaraokeNerdsBatch(plan, async () => { calls++; return { status: 'downloaded', path: 'ignored', cleanupNeeded: true }; });
  assert.equal(calls, 1); assert.equal(result.remainingVideoIds.length, 1);
  const controller = new AbortController(); controller.abort();
  const stopped = await executeKaraokeNerdsBatch(plan, async () => { throw new Error('must not execute'); }, controller.signal);
  assert.equal(stopped.results.length, 0); assert.equal(stopped.remainingVideoIds.length, 2);
});
