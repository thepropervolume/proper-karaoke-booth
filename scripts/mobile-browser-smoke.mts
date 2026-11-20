/** Local synthetic end-to-end rehearsal; no real account, provider feed or microphone. */
import { createServer, request as requestHttp } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { RelayStore } from '../src/relay/store';
import { RelayBroker } from '../src/relay/broker';
import { startQueueRelayService } from '../src/relay/http';
const origin = 'https://queue.thepropervolume.com', directory = resolve('release/mobile-browser-090');
const { version: appVersion } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
await mkdir(directory, { recursive: true });
const db = new DatabaseSync(':memory:');
const broker = new RelayBroker(new RelayStore(db), { pollTimeoutMs: 300, rpcTimeoutMs: 1500 });
const relay = await startQueueRelayService({ publicOrigin: origin, owners: [{ id: crypto.randomUUID(), tokenSha256: createHash('sha256').update('x'.repeat(43)).digest('hex') }],
  broker, staticHandler: async () => false, port: 0, closeDependencies: () => db.close(), mobileEnabled: true,
  mobileCatalog: async query => ({ items: [{ id: 'youtube_Video123456', videoId: 'Video123456', title: query === 'Oasis' ? 'Wonderwall' : query, artist: 'Oasis', provider: 'karaokenerds' }] }) });
const staticRoot = resolve('dist/mobile');
const mobileConfig = await readFile(resolve('deploy/queue-relay/mobile.conf'), 'utf8');
const csp = /Header always set Content-Security-Policy "([^"]+)"/.exec(mobileConfig)?.[1];
if (!csp) throw new Error('Mobile deployment CSP is missing.');
const server = createServer((request, response) => {
  if (request.url?.startsWith('/v1/')) {
    const proxy = requestHttp({ host: '127.0.0.1', port: relay.port, path: request.url, method: request.method, headers: { ...request.headers, host: new URL(origin).host } }, remote => { response.writeHead(remote.statusCode ?? 500, remote.headers); remote.pipe(response); });
    proxy.on('error', () => response.destroy()); request.pipe(proxy); return;
  }
  const path = resolve(staticRoot, request.url === '/app/' ? 'index.html' : (request.url ?? '').replace(/^\/app\//, ''));
  if (!path.startsWith(staticRoot + sep)) { response.writeHead(404); response.end(); return; }
  void readFile(path).then(bytes => { const extension = path.split('.').at(-1)!; response.writeHead(200, { 'Content-Security-Policy': csp, 'Content-Type': ({ html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', woff: 'font/woff', woff2: 'font/woff2', webmanifest: 'application/manifest+json' } as Record<string,string>)[extension] ?? 'application/octet-stream' }); response.end(bytes); }).catch(() => { response.writeHead(404); response.end(); });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing rehearsal address.');
const browser = await chromium.launch({ executablePath: process.env.TPV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--mute-audio'] });
const errors: string[] = [], checks: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.route(origin + '/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const reply = await fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, { method: request.method(), headers: { ...request.headers(), host: url.host },
      ...(request.method() !== 'GET' ? { body: request.postDataBuffer() } : {}) });
    await route.fulfill({ status: reply.status, headers: Object.fromEntries(reply.headers), body: Buffer.from(await reply.arrayBuffer()) });
  });
  const host = await context.newPage(); host.on('pageerror', error => errors.push(error.message));
  await host.goto(origin + '/app/');
  assert.equal(await host.locator('.mobile-version').innerText(), appVersion);
  await host.getByRole('button', { name: /^Full Host Mode/ }).click();
  await host.getByRole('searchbox').fill('Oasis');
  await host.getByRole('button', { name: 'Queue Wonderwall' }).click();
  await host.getByLabel('Singer (optional)').fill('Ben');
  await host.getByRole('button', { name: 'Add Song', exact: true }).click();
  await host.getByRole('button', { name: /^Room$/ }).click();
  await host.getByLabel('Room address').fill('mobile-rehearsal');
  await host.getByRole('button', { name: 'Open Room', exact: true }).click();
  await host.getByRole('button', { name: 'Close Room', exact: true }).waitFor();
  checks.push('Phone host publishes a real relay room.');
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await guestContext.route(origin + '/**', async route => { const request = route.request(), url = new URL(request.url()); const reply = await fetch(`http://127.0.0.1:${address.port}${url.pathname}`, { method: request.method(), headers: { ...request.headers(), host: url.host }, ...(request.method() !== 'GET' ? { body: request.postDataBuffer() } : {}) }); await route.fulfill({ status: reply.status, headers: Object.fromEntries(reply.headers), body: Buffer.from(await reply.arrayBuffer()) }); });
  const guest = await guestContext.newPage(); guest.on('pageerror', error => errors.push(error.message)); await guest.goto(origin + '/app/');
  await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
  await guest.getByLabel('Your name').fill('Alice'); await guest.getByRole('button', { name: 'Join the show', exact: true }).click();
  const photoBytes = await guest.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#601ce9'; ctx.fillRect(0, 0, 8, 8); return canvas.toDataURL('image/png').split(',')[1]; });
  await guest.getByLabel('JPEG or PNG').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(photoBytes, 'base64') });
  await host.bringToFront();
  await guest.getByRole('button', { name: 'Send to singer display' }).click();
  await host.bringToFront();
  await guest.getByText('Photo sent to the host.', { exact: true }).waitFor();
  const photoReview = host.getByRole('complementary', { name: 'Photo from Alice' });
  await photoReview.waitFor();
  assert.equal(await photoReview.locator('img').count(), 0);
  assert.equal(await host.locator('.mobile-photo-overlay img').count(), 0);
  await host.getByText(/Alice · 0 points/).waitFor();
  await guest.getByRole('button', { name: 'Request', exact: true }).click();
  await guest.getByText('Queued', { exact: true }).waitFor();
  await host.getByRole('button', { name: /^Queue \(2\)$/ }).waitFor();
  await host.getByText(/Alice · 18 points/).waitFor();
  checks.push('Nearby suggestion requires consent; the singer can queue a song while photo review is pending.');
  await photoReview.getByRole('button', { name: 'Review Photo', exact: true }).click();
  assert.equal(await host.locator('.mobile-photo-overlay img').count(), 0);
  await photoReview.getByRole('button', { name: 'Show Photo', exact: true }).click();
  try { await host.locator('.mobile-photo-overlay img').waitFor({ timeout: 7000 }); }
  catch (error) { console.error('Guest photo state:', await guest.locator('body').innerText(), 'Host state:', await host.locator('body').innerText()); throw error; }
  await host.getByText(/Alice · 42 points/).waitFor();
  checks.push('Authenticated guest photo is acknowledged immediately, then displays and scores only after host review and approval under the production CSP.');
  await host.getByRole('button', { name: /^Queue \(2\)$/ }).click();
  const queue = host.getByRole('region', { name: 'Singer Queue' });
  const status = queue.getByRole('status');
  const statusNode = await status.elementHandle();
  const aliceRow = queue.getByRole('listitem', { name: 'Wonderwall for Alice' });
  const benRow = queue.getByRole('listitem', { name: 'Wonderwall for Ben' });
  await aliceRow.getByRole('button', { name: 'Move Wonderwall for Alice up', exact: true }).click();
  assert.match(await host.locator('.mobile-queue li').first().innerText(), /Alice/);
  await aliceRow.getByRole('button', { name: 'Move Wonderwall for Alice down', exact: true }).focus();
  await host.keyboard.press('Enter');
  assert.equal(await status.textContent(), 'Wonderwall for Alice moved to position 2 of 2.');
  assert.equal(await aliceRow.evaluate(row => row === document.activeElement), true);
  await benRow.getByRole('button', { name: 'Remove Wonderwall for Ben', exact: true }).focus();
  await host.keyboard.press('Space');
  assert.equal(await status.textContent(), 'Wonderwall for Ben removed. 1 song waiting.');
  assert.equal(await aliceRow.evaluate(row => row === document.activeElement), true);
  await aliceRow.getByRole('button', { name: 'Remove Wonderwall for Alice', exact: true }).focus();
  await host.keyboard.press('Enter');
  assert.equal(await status.textContent(), 'Wonderwall for Alice removed. 0 songs waiting.');
  assert.equal(await queue.getByRole('heading', { name: 'Singer Queue' }).evaluate(heading => heading === document.activeElement), true);
  assert.equal(await status.evaluate((element, original) => element === original, statusNode), true);
  await statusNode.dispose();
  checks.push('Pointer reorder preserves singer identity. Keyboard reorder and removal restore focus and update the same polite status region.');
  await host.getByRole('button', { name: 'Songs', exact: true }).click(); await host.getByRole('searchbox').fill('');
  await host.getByText('Add a Video', { exact: true }).click();
  await host.getByLabel('Import Local Video').setInputFiles(resolve('release/mobile-test.mp4'));
  await host.getByRole('button', { name: 'Queue mobile-test', exact: true }).click();
  const dialog = host.getByRole('dialog');
  await host.keyboard.press('Shift+Tab'); assert.equal(await host.evaluate(() => document.activeElement?.textContent), 'Add Song');
  await host.keyboard.press('Tab'); assert.equal(await host.getByLabel('Singer (optional)').evaluate(node => node === document.activeElement), true);
  await host.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
  assert.equal(await host.getByRole('button', { name: 'Queue mobile-test', exact: true }).evaluate(node => node === document.activeElement), true);
  checks.push('Dialog traps focus, closes on Escape and restores trigger focus.');
  await host.getByRole('button', { name: 'Queue mobile-test', exact: true }).click(); await host.getByRole('button', { name: 'Add Song', exact: true }).click();
  await host.bringToFront(); await host.getByRole('button', { name: 'Play', exact: true }).click();
  await host.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.2);
  await host.locator('video').evaluate(video => video.pause()); await host.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await host.locator('video').evaluate(video => video.play()); await host.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await host.getByLabel('Track position').fill('5'); assert.ok(await host.locator('video').evaluate(video => video.currentTime) >= 4.9);
  checks.push('Real synthetic local video plays; embedded controls synchronize; timeline seeks.');
  await host.getByRole('button', { name: 'Pause', exact: true }).click();
  await host.getByRole('button', { name: 'Switch Mode', exact: true }).click();
  await host.getByRole('button', { name: /^Full Host Mode/ }).click();
  await host.waitForFunction(() => { const video = document.querySelector('video'); return !!video && video.readyState >= 1 && video.paused && video.currentTime >= 4.8; });
  await host.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await host.getByRole('button', { name: 'Play', exact: true }).click();
  checks.push('Switching modes restores the same local-video checkpoint paused; the host must press Play.');
  // Exercise completion through the actual player and verify the host's gap
  // and auto-advance setting while another request remains in the queue.
  for (let i = 0; i < 2; i++) {
    await host.getByRole('button', { name: 'Queue mobile-test', exact: true }).click();
    await host.getByRole('button', { name: 'Add Song', exact: true }).click();
  }
  await host.getByRole('button', { name: /^Room$/ }).click();
  await host.getByLabel('Gap between songs (seconds)').fill('2');
  const firstEndRequestedAt = Date.now();
  await host.locator('video').evaluate(video => { video.currentTime = video.duration - 0.05; });
  await host.getByText(/Next song in/).waitFor();
  assert.equal(await host.locator('video').count(), 0);
  await host.waitForFunction(() => Boolean(document.querySelector('video') && (document.querySelector('video')?.currentTime ?? 0) > 0.1), undefined, { timeout: 8000 });
  assert.ok(Date.now() - firstEndRequestedAt >= 1900, 'The next song started before the configured two-second gap.');
  await host.locator('video').evaluate(video => { video.currentTime = video.duration - 0.05; });
  await host.getByText(/Next song in/).waitFor();
  await host.getByLabel('Play the next song automatically').uncheck();
  await host.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await host.waitForTimeout(2500);
  assert.equal(await host.locator('video').count(), 0);
  await host.getByRole('button', { name: /^Queue \(1\)$/ }).waitFor();
  checks.push('Completion advances after the configured gap; disabling auto-advance during the gap leaves the next song waiting.');
  await host.getByRole('button', { name: 'Play', exact: true }).click();
  await host.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0.1);
  await host.getByRole('button', { name: 'Pause', exact: true }).click();
  await host.screenshot({ path: resolve(directory, 'host-390.png'), fullPage: true });
  await guest.screenshot({ path: resolve(directory, 'singer-390.png'), fullPage: true });
  const secondTab = await context.newPage(); await secondTab.goto(origin + '/app/');
  assert.equal(await secondTab.getByRole('button', { name: /^Full Host Mode/ }).isDisabled(), true); checks.push('A second tab can join as singer but cannot overwrite the active host show.');
  await host.getByRole('button', { name: /^Room$/ }).click(); await host.getByRole('button', { name: 'Close Room', exact: true }).click();
  await guest.getByRole('button', { name: 'Refresh', exact: true }).click(); await guest.getByText('This room ended. Ask the host for a new link.').waitFor();
  checks.push('Closing the mobile room revokes guest access.');
  await host.getByLabel('Track position').fill('5');
  await host.waitForFunction(async () => await new Promise<boolean>(resolve => {
    const open = indexedDB.open('tpv-mobile', 1); open.onsuccess = () => { const db = open.result, tx = db.transaction('show', 'readonly'), request = tx.objectStore('show').get('active');
      tx.oncomplete = () => { db.close(); resolve(request.result?.positionSeconds >= 4.8); }; }; open.onerror = () => resolve(false);
  }));
  await host.reload(); await host.getByRole('button', { name: /^Full Host Mode/ }).click();
  await host.waitForFunction(() => { const video = document.querySelector('video'); return !!video && video.readyState >= 1 && video.paused && video.currentTime >= 4.8; });
  await host.getByRole('button', { name: 'Play', exact: true }).waitFor();
  checks.push('Reload restores the saved local-video checkpoint paused.');
  for (const width of [320, 390, 768]) { await host.setViewportSize({ width, height: 844 }); assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await host.screenshot({ path: resolve(directory, `room-${width}.png`), fullPage: true }); }
  checks.push('320/390/768px layouts have no page overflow.');
  assert.deepEqual(errors, []);
  await guestContext.close(); await context.close();
} finally {
  await writeFile(resolve(directory, 'result.json'), JSON.stringify({ passed: errors.length === 0, checks, errors }, null, 2));
  await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await relay.stop();
}
console.log(JSON.stringify({ checks, errors, evidence: directory }, null, 2));
