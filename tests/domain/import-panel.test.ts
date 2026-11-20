import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatImportBytes, importActive, ImportProgressView } from '../../src/renderer/ImportPanel';
import type { ImportProgress, ImportResultsPage } from '../../src/domain/import-job';

const noop = () => {};
const running: ImportProgress = { jobId: 'job-1', phase: 'hashing', discovered: 3, processed: 2, imported: 1, duplicates: 1, failed: 0, cancelled: 0, needsReview: 1,
  current: { name: 'Artist & Title.mp4', bytesRead: 1024 * 1024, bytesTotal: 4 * 1024 * 1024 } };
const page: ImportResultsPage = { offset: 0, total: 3, nextOffset: 2, items: [
  { name: '<Song>.mp4', kind: 'file', outcome: 'imported', needsReview: true },
  { name: 'Duplicate.mp4', kind: 'file', outcome: 'duplicate', needsReview: false },
] };
function render(progress: ImportProgress, results: ImportResultsPage | null = page) {
  return renderToStaticMarkup(React.createElement(ImportProgressView, { progress, page: results, onCancel: noop, onPrevious: noop, onNext: noop }));
}

test('running import exposes accessible progress, cancellation, counts and paginated results', () => {
  const html = render(running);
  assert.match(html, /aria-label="Import progress"/);
  assert.match(html, /role="status"/);
  assert.match(html, /Cancel import/);
  assert.match(html, /aria-label="Hashing Artist &amp; Title\.mp4"/);
  assert.match(html, /1\.0 MiB \/ 4\.0 MiB/);
  assert.match(html, /Imported · Review metadata/);
  assert.match(html, /&lt;Song&gt;\.mp4/);
  assert.match(html, /Showing 1–2 of 3/);
  assert.match(html, /<button type="button" disabled="">Previous<\/button>/);
  assert.match(html, /<button type="button">Next<\/button>/);
});

test('cancelled and failed jobs explain that prior imports remain and do not offer cancellation', () => {
  const cancelled = render({ ...running, phase: 'cancelled', current: null, cancelled: 1 });
  assert.match(cancelled, /Import cancelled/);
  assert.match(cancelled, /Files not yet discovered were not processed/);
  assert.match(cancelled, /Songs already imported remain in the library/);
  assert.doesNotMatch(cancelled, /Cancel import<\/button>/);
  const failed = render({ ...running, phase: 'failed', current: null }, null);
  assert.match(failed, /The import stopped before all files could be processed/);
  assert.doesNotMatch(failed, /Cancel import<\/button>/);
});

test('empty sizes and phase helpers do not suggest an unknown total is complete', () => {
  assert.equal(importActive('scanning'), true); assert.equal(importActive('cancelling'), true); assert.equal(importActive('completed'), false);
  assert.equal(formatImportBytes(0), '0 B'); assert.equal(formatImportBytes(1536), '1.5 KiB'); assert.equal(formatImportBytes(NaN), '0 B');
  const html = render({ ...running, current: { name: 'empty.mp4', bytesRead: 0, bytesTotal: 0 } }, null);
  assert.match(html, /<progress aria-label="Preparing empty\.mp4"><\/progress>/);
});

test('folder scan explains skipped formats and cloud availability without inventing a total', () => {
  const scanning = render({ ...running, phase: 'scanning', directoriesScanned: 2, skippedUnsupported: 3, current: { name: 'Video/Artist', bytesRead: 0, bytesTotal: 0 } }, null);
  assert.match(scanning, /2 folders scanned/); assert.match(scanning, /3 other files skipped/);
  assert.match(scanning, /aria-label="Scanning Video\/Artist"/); assert.match(scanning, /cloud-only files may take time/i);
  const empty = render({ ...running, phase: 'completed', discovered: 0, processed: 0, imported: 0, duplicates: 0, needsReview: 0, current: null }, null);
  assert.match(empty, /No MP4 videos were found/); assert.match(empty, /Import CD\+G \/ LRC \/ ZIP/);
});

test('progress explains a changed-file retry and its full recheck', () => {
  const html = render({ ...running, current: { name: 'song.mp4', bytesRead: 0, bytesTotal: 0, retry: 2 } }, null);
  assert.match(html, /File changed while reading\. Retrying 2 of 2 with a full check\./);
});
