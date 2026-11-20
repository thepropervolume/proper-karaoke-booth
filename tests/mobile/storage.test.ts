import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { acquireMobileHostLock, MobileHostLockUnsupported } from '../../src/mobile/storage';

test('unsupported host locking is distinct from a busy show or a failed lock request', async () => {
  await assert.rejects(acquireMobileHostLock(null), MobileHostLockUnsupported);
  const failed = { request: () => Promise.reject(new Error('policy denied')) } as unknown as Pick<LockManager, 'request'>;
  await assert.rejects(acquireMobileHostLock(failed), error => error instanceof Error && !(error instanceof MobileHostLockUnsupported) && error.message.includes('could not be started'));
});

const candidates = process.platform === 'win32' ? [join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const executablePath = candidates.find(path => { try { accessSync(path); return true; } catch { return false; } });

test('browser IndexedDB recovery, local media identity and cross-tab host ownership', { skip: executablePath || process.env.TPV_REQUIRE_CHROMIUM === '1' ? false : 'An installed Chromium browser is required for real IndexedDB/Web Locks coverage.', timeout: 90_000 }, async t => {
  assert.ok(executablePath, 'A Chromium browser is required for the mobile release tests.');
  const repo = resolve(import.meta.dirname, '../..');
  const bundle = await build({ stdin: { contents: "import * as storage from './src/mobile/storage'; window.mobileStorage = storage;", resolveDir: repo }, bundle: true, platform: 'browser', format: 'iife', write: false });
  const server = createServer((request, response) => {
    if (request.url === '/storage.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="en"><title>Mobile storage test</title><script src="/storage.js"></script></html>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({ executablePath, headless: true, timeout: 45_000,
    args: process.platform !== 'win32' && process.getuid?.() === 0 ? ['--no-sandbox'] : [] }).catch(async error => {
    await new Promise<void>(resolve => server.close(() => resolve())); throw error;
  });
  const origin = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext();
  const first = await context.newPage(); await first.goto(origin);
  async function rawActive(page: Page): Promise<unknown> {
    return await page.evaluate(async () => await new Promise(resolve => {
      const open = indexedDB.open('tpv-mobile', 1);
      open.onsuccess = () => { const db = open.result, tx = db.transaction('show', 'readonly'), read = tx.objectStore('show').get('active'); tx.oncomplete = () => { db.close(); resolve(read.result); }; };
    }));
  }
  try {
    await t.test('raw future-format show survives replacement and a failed backup never changes active', async () => {
      const original = { format: 99, title: 'Unknown future show', nested: { history: ['kept'] } };
      const initial = await first.evaluate(async value => {
        const storage = (window as unknown as { mobileStorage: typeof import('../../src/mobile/storage') }).mobileStorage;
        await storage.saveMobileShow(value as never);
        const key = await storage.preserveMobileRecovery();
        await storage.saveMobileShow({ format: 1, name: 'Replacement' } as never);
        return { key, backup: await storage.readMobileRecovery(key), listed: await storage.listMobileRecoveries() };
      }, original);
      assert.deepEqual(initial.backup?.value, original); assert.equal(initial.listed[0].key, initial.key);
      assert.deepEqual(await rawActive(first), { format: 1, name: 'Replacement' });
      const failed = await first.evaluate(async () => {
        const storage = (window as unknown as { mobileStorage: typeof import('../../src/mobile/storage') }).mobileStorage;
        const before = (await storage.listMobileRecoveries()).length;
        const originalAdd = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function () { throw new DOMException('Injected full storage', 'QuotaExceededError'); };
        let rejected = false;
        try { await storage.preserveMobileRecovery(); } catch { rejected = true; }
        finally { IDBObjectStore.prototype.add = originalAdd; }
        return { rejected, before, after: (await storage.listMobileRecoveries()).length };
      });
      assert.equal(failed.rejected, true); assert.equal(failed.after, failed.before);
      assert.deepEqual(await rawActive(first), { format: 1, name: 'Replacement' });
    });
    await t.test('relink and delete replace only a chosen blob under its stable recording ID', async () => {
      const result = await first.evaluate(async () => {
        const storage = (window as unknown as { mobileStorage: typeof import('../../src/mobile/storage') }).mobileStorage;
        await storage.saveLocalMedia('recording_one', new Blob(['old'])); await storage.saveLocalMedia('recording_two', new Blob(['other']));
        await storage.relinkLocalMedia('recording_one', new Blob(['replacement']));
        const replaced = await (await storage.loadLocalMedia('recording_one'))?.text();
        await storage.deleteLocalMedia('recording_one');
        return { replaced, deleted: await storage.loadLocalMedia('recording_one') === undefined, other: await (await storage.loadLocalMedia('recording_two'))?.text() };
      });
      assert.deepEqual(result, { replaced: 'replacement', deleted: true, other: 'other' });
      assert.deepEqual(await rawActive(first), { format: 1, name: 'Replacement' });
    });
    await t.test('the inventory reads saved copy sizes, then reflects relinking and removal after reload', async () => {
      const initial = await first.evaluate(async () => {
        const storage = (window as unknown as { mobileStorage: typeof import('../../src/mobile/storage') }).mobileStorage;
        await storage.saveLocalMedia('recording_one', new File(['video'], 'first.mp4', { type: 'video/mp4' }));
        return storage.listLocalVideoCopies();
      });
      assert.deepEqual(initial, [{ id: 'recording_one', bytes: 5, fileName: 'first.mp4' }, { id: 'recording_two', bytes: 5 }]);
      await first.evaluate(async () => {
        const storage = (window as unknown as { mobileStorage: typeof import('../../src/mobile/storage') }).mobileStorage;
        await storage.relinkLocalMedia('recording_one', new File(['larger-video'], 'replacement.webm', { type: 'video/webm' }));
        await storage.deleteLocalMedia('recording_two');
      });
      await first.reload();
      assert.deepEqual(await first.evaluate(async () => (window as unknown as { mobileStorage: typeof import('../../src/mobile/storage') }).mobileStorage.listLocalVideoCopies()),
        [{ id: 'recording_one', bytes: 12, fileName: 'replacement.webm' }]);
      assert.deepEqual(await rawActive(first), { format: 1, name: 'Replacement' });
    });
    await t.test('another tab cannot acquire the host until release, and release is idempotent', async () => {
      const second = await context.newPage(); await second.goto(origin);
      const firstAcquired = await first.evaluate(async () => {
        const w = window as unknown as { mobileStorage: typeof import('../../src/mobile/storage'); releaseHost: (() => void) | null };
        w.releaseHost = await w.mobileStorage.acquireMobileHostLock(); return !!w.releaseHost;
      });
      assert.equal(firstAcquired, true);
      assert.equal(await second.evaluate(async () => await (window as unknown as { mobileStorage: typeof import('../../src/mobile/storage') }).mobileStorage.acquireMobileHostLock() === null), true);
      await first.evaluate(() => { const w = window as unknown as { releaseHost: () => void }; w.releaseHost(); w.releaseHost(); });
      // request()'s promise finishes after its callback releases, before the next task.
      await first.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
      assert.equal(await second.evaluate(async () => { const release = await (window as unknown as { mobileStorage: typeof import('../../src/mobile/storage') }).mobileStorage.acquireMobileHostLock(); release?.(); return !!release; }), true);
      await second.close();
    });
  } finally {
    await context.close(); await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
