// Standalone browser rehearsal with a fake host bridge. Does not import media.
// Run: node scripts/import-panel-smoke.mjs <repository>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = await realpath(resolve(process.argv[2] ?? '.'));
const fromRepo = createRequire(join(repo, 'package.json'));
const { build } = fromRepo('esbuild');
const sass = fromRepo('sass');
const { chromium } = fromRepo('playwright-core');
const executablePath = process.env.TPV_QA_CHROME ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
if (!executablePath) throw new Error('Set TPV_QA_CHROME to a Chromium executable.');
const directory = await mkdtemp(join(tmpdir(), 'tpv-import-panel-'));
let browser;
try {
  const harness = `import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ImportPanel } from './src/renderer/ImportPanel';
    const bridge = {
      status: () => new Promise(resolve => { window.resolveInitial = resolve; }),
      subscribe: callback => { window.emitProgress = callback; return () => {}; },
      cancel: async id => { window.cancelledId = id; return true; },
      results: async (id, offset, limit) => {
        if (id === 'old-job') return await new Promise(resolve => { window.resolveOldPage = resolve; });
        const total = 30, items = Array.from({ length: Math.min(limit, total - offset) }, (_, index) => ({ name: 'song-' + (offset + index) + '.mp4', kind: 'file', outcome: 'imported', needsReview: false }));
        return { items, offset, total, nextOffset: offset + items.length < total ? offset + items.length : null };
      },
    };
    createRoot(document.getElementById('root')).render(React.createElement(ImportPanel, { bridge }));`;
  const bundled = await build({ stdin: { contents: harness, resolveDir: repo, sourcefile: 'import-panel-harness.jsx', loader: 'jsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  await writeFile(join(directory, 'app.js'), bundled.outputFiles[0].contents);
  await writeFile(join(directory, 'styles.css'), sass.compile(join(repo, 'src/styles/import-panel.scss')).css);
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><div id="root"></div><script src="app.js"></script>');
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 780, height: 600 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(join(directory, 'index.html')).href);
  await page.waitForFunction(() => typeof window.emitProgress === 'function' && typeof window.resolveInitial === 'function');
  const base = { phase: 'hashing', discovered: 31, processed: 30, imported: 30, duplicates: 0, failed: 0, cancelled: 0, needsReview: 0,
    current: { name: 'active.mp4', bytesRead: 1024, bytesTotal: 4096 } };
  await page.evaluate(value => window.emitProgress(value), { ...base, jobId: 'old-job' });
  await page.waitForFunction(() => typeof window.resolveOldPage === 'function');
  await page.evaluate(value => window.emitProgress(value), { ...base, jobId: 'new-job' });
  await page.evaluate(() => window.resolveInitial(null));
  await page.getByRole('region', { name: 'Import progress' }).waitFor();
  await page.getByText('1.0 KiB / 4.0 KiB').waitFor();
  await page.getByRole('button', { name: 'Cancel import' }).click();
  assert.equal(await page.evaluate(() => window.cancelledId), 'new-job');
  await page.getByText('File results (30)', { exact: true }).click();
  await page.getByText('song-0.mp4', { exact: true }).waitFor();
  await page.evaluate(() => window.resolveOldPage({ items: [{ name: 'stale.mp4', kind: 'file', outcome: 'imported', needsReview: false }], offset: 0, total: 1, nextOffset: null }));
  assert.equal(await page.getByText('stale.mp4', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('song-25.mp4', { exact: true }).waitFor();
  await page.getByText('Showing 26–30 of 30', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.getByText('song-0.mp4', { exact: true }).waitFor();
  await page.evaluate(value => window.emitProgress(value), { ...base, jobId: 'new-job', phase: 'cancelled', current: null, cancelled: 1 });
  await page.getByText('Files not yet discovered were not processed. Songs already imported remain in the library.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cancel import' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: import panel status race, current bytes, cancellation, stale results, pagination and cancelled messaging.');
} finally {
  if (browser) await browser.close().catch(() => {});
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
