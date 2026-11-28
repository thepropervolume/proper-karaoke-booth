import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';
// Deterministic full UI rehearsal. Public relay URLs are intercepted only inside
// disposable test processes and routed to the loopback contract fixture below.
// Build desktop and mobile first. Use a synthetic MP4 long enough for room join and applause.
// node --import tsx scripts/internet-session-smoke.mjs <repo> <synthetic-mp4>
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoArg, fixtureArg] = process.argv.slice(2);
if (!repoArg || !fixtureArg) throw new Error('Usage: node --import tsx scripts/internet-session-smoke.mjs <repository> <synthetic-mp4>');
const repo = await realpath(resolve(repoArg)), fixture = await realpath(resolve(fixtureArg));
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
const mobileRoot = await realpath(join(repo, 'dist/mobile'));
const mobileConfig = await readFile(join(repo, 'deploy/queue-relay/mobile.conf'), 'utf8');
const mobileCsp = /Header always set Content-Security-Policy "([^"]+)"/.exec(mobileConfig)?.[1];
assert.ok(mobileCsp, 'Missing deployment CSP for the mobile app.');
const mobileTypes = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2', webmanifest: 'application/manifest+json' };
const { createSingerStaticHandler } = await import(pathToFileURL(join(repo, 'src/main/remote-static.ts')).href);
const staticHandler = createSingerStaticHandler(join(repo, 'dist/ui'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron, chromium } = requireFromRepo('playwright-core'), executablePath = requireFromRepo('electron');
const publicOrigin = 'https://queue.thepropervolume.com', ownerToken = randomBytes(32).toString('base64url');
const temporary = await mkdtemp(join(tmpdir(), 'tpv-internet-qa-'));
const profile = join(temporary, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile);
const video = join(temporary, 'Artist - Internet Sample.mp4'); await copyFile(fixture, video);
await writeFile(join(profile, 'remote-queue-connection.json'), JSON.stringify({ baseUrl: publicOrigin, ownerToken }), { mode: 0o600 });
await writeFile(join(profile, 'settings.json'), JSON.stringify({ settingsVersion: 2, desktopUpdateMode: 'off', sharedCatalogEnabled: false,
  providerCatalogEnabled: false, youtubeSearchEnabled: false, singerScreenEnabled: false, autoBumper: false, bumperOnLaunch: false,
  autoAdvance: false, mobileRoomDiscovery: false, masterVolume: 0 }));
const { RelayStore } = await import(pathToFileURL(join(repo, 'src/relay/store.ts')).href);
const { RelayBroker } = await import(pathToFileURL(join(repo, 'src/relay/broker.ts')).href);
const { startQueueRelayService } = await import(pathToFileURL(join(repo, 'src/relay/http.ts')).href);
const relayDb = new DatabaseSync(':memory:');
const relayStore = new RelayStore(relayDb, { publicOrigin });
const relayBroker = new RelayBroker(relayStore);
const relay = await startQueueRelayService({ publicOrigin, owners: [{ id: randomUUID(), tokenSha256: createHash('sha256').update(ownerToken).digest('hex') }],
  broker: relayBroker, staticHandler, mobileEnabled: true, port: 0, closeDependencies: () => relayDb.close() });
const loopback = `http://127.0.0.1:${relay.port}`;
const bootstrap = join(temporary, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app, clipboard, session } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
let copied = '';
clipboard.writeText = value => { copied = value; };
clipboard.readText = () => copied;
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true })));
globalThis.fetch = (input, options) => {
  const url = new URL(String(input));
  if (url.origin !== process.env.TPV_QA_PUBLIC) return Promise.reject(new Error('External networking is disabled for the internet room rehearsal.'));
  const headers = Object.fromEntries(new Headers(options?.headers)); headers.host = url.host;
  return new Promise((resolve, reject) => {
    const request = http.request(process.env.TPV_QA_LOOPBACK + url.pathname + url.search,
      {method:options?.method ?? 'GET',headers,signal:options?.signal}, response => {
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
        response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
      });
    request.on('error',reject);request.end(options?.body);
  });
};
app.setPath('userData', process.env.TPV_QA_PROFILE);
app.setAppPath(process.env.TPV_QA_REPO);
if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe test profile');
require(process.env.TPV_QA_ENTRY);
`);
let app, browser, host, mobile;
const env = { ...process.env, TPV_QA_PUBLIC: publicOrigin, TPV_QA_LOOPBACK: loopback, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry,
  TPV_QA_REPO: repo, XDG_CONFIG_HOME: join(temporary, 'config'), XDG_DATA_HOME: join(temporary, 'data'),
  APPDATA: join(temporary, 'appdata'), LOCALAPPDATA: join(temporary, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
try {
  app = await electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'], cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, video);
  host = await waitForHostWindow(app); await host.waitForFunction(() => !!window.tpv?.internetSessions);
  assert.equal((await host.evaluate(() => window.tpv.internetSessions.status())).state, 'stopped'); assert.equal(relayDb.prepare('SELECT COUNT(*) AS count FROM relay_leases').get().count, 0);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await waitForHostCondition(host, async () => (await window.tpv.getState()).versions.length === 1);
  await host.getByRole('button', { name: 'Remote Sessions', exact: true }).click();
  const slug = `qa-${randomBytes(5).toString('hex')}`;
  await host.getByLabel('Session address').fill(slug); await host.getByRole('button', { name: 'Start Session', exact: true }).click();
  await host.getByText('Session online. Share the singer link to invite your guests.', { exact: true }).waitFor();
  const link = await host.getByLabel('Singer link').inputValue(); assert.equal(link, `${publicOrigin}/${slug}`);
  await host.getByRole('button', { name: 'Copy Link', exact: true }).click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), link);
  const qr = host.getByRole('button', { name: 'Copy public room link', exact: true });
  await qr.locator('img[src^="data:image/png"]').waitFor();
  await qr.click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), link);
  const custom = 'https://example.test/open-mic';
  await host.evaluate(roomQrUrl => window.tpv.saveSettings({ roomQrUrl }), custom);
  await qr.click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), custom);
  await host.evaluate(() => window.tpv.saveSettings({ showRoomQr: false }));
  await qr.waitFor({ state: 'detached' });
  await host.evaluate(() => window.tpv.saveSettings({ roomQrUrl: '', showRoomQr: true }));
  const chrome = process.env.TPV_QA_CHROME ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
  if (!chrome) throw new Error('Set TPV_QA_CHROME to a Chromium executable.');
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    assert.notEqual(route.request().headers().authorization, `Bearer ${ownerToken}`);
    const url = new URL(route.request().url());
    if (url.origin !== publicOrigin) { await route.abort(); return; }
    if (url.pathname.startsWith('/app/')) {
      const asset = resolve(mobileRoot, url.pathname === '/app/' ? 'index.html' : url.pathname.slice(5));
      const contentType = mobileTypes[asset.split('.').at(-1)];
      if (!asset.startsWith(mobileRoot + sep) || !contentType) { await route.fulfill({ status: 404 }); return; }
      try {
        await route.fulfill({ body: await readFile(asset), contentType, headers: { 'Content-Security-Policy': mobileCsp } });
      } catch { await route.fulfill({ status: 404 }); }
      return;
    }
    const local = await route.fetch({ url: loopback + url.pathname + url.search, headers: { ...route.request().headers(), host: new URL(publicOrigin).host, origin: publicOrigin }, maxRedirects: 0 });
    await route.fulfill({ response: local });
  });
  const singer = await context.newPage(); await singer.goto(link, { waitUntil: 'domcontentloaded' });
  await singer.getByLabel('Your name').fill('Internet QA Singer'); await singer.getByRole('button', { name: 'Join the show', exact: true }).click();
  await singer.getByText('Hello, Internet QA Singer!', { exact: true }).waitFor();
  await singer.getByRole('button', { name: 'Request', exact: true }).click(); await singer.getByText('Queued', { exact: true }).waitFor();
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests.length, 1);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'requests cannot start playback');
  await singer.getByRole('button', { name: 'Withdraw', exact: true }).click(); await singer.getByText('withdrawn', { exact: true }).waitFor();
  await singer.getByLabel('Minutes away').fill('5'); await singer.getByRole('button', { name: 'Mark me unavailable', exact: true }).click();
  await singer.getByText('Availability updated.', { exact: true }).waitFor();
  await singer.getByRole('button', { name: "I'm back", exact: true }).click();
  await singer.getByLabel('Song title', { exact: true }).fill('Internet Missing Song'); await singer.getByRole('button', { name: 'Send to host', exact: true }).click();
  await singer.getByText('Missing-song request sent to the host.', { exact: true }).waitFor();
  assert.ok((await host.evaluate(() => window.tpv.getMissingSongRequests())).some(item => item.title === 'Internet Missing Song'));

  mobile = await context.newPage();
  mobile.setDefaultTimeout(10000);
  const landing = await new Promise((resolve, reject) => {
    get(loopback + '/', { headers: { host: new URL(publicOrigin).host } }, response => {
      response.resume();
      resolve({ status: response.statusCode, location: response.headers.location });
    }).once('error', reject);
  });
  const roomPath = landing.location;
  assert.equal(landing.status, 302);
  assert.equal(roomPath, '/app/?rooms=1');
  await mobile.goto(publicOrigin + roomPath);
  await mobile.getByRole('heading', { name: 'Rooms', exact: true }).waitFor();
  await mobile.getByLabel('Room code or invitation link').fill(slug.toUpperCase());
  await mobile.getByRole('button', { name: 'Go', exact: true }).click();
  await mobile.getByRole('textbox', { name: 'Singer name', exact: true }).fill('Mobile QA Listener');
  await mobile.getByRole('dialog', { name: 'Join Room', exact: true }).waitFor();
  await mobile.locator('ion-modal.singer-sheet').getByRole('button', { name: 'Join Room', exact: true }).click();
  const nav = mobile.getByRole('navigation', { name: 'Singer workspace' });
  await mobile.getByRole('heading', { name: 'Search', exact: true }).waitFor();
  await nav.getByRole('tab', { name: 'Rooms', exact: true }).click();
  await mobile.getByRole('button', { name: 'Leave Room', exact: true }).waitFor();
  const before = await host.evaluate(() => window.tpv.getState());
  const performer = before.singers.find(row => row.name === 'Internet QA Singer');
  const listener = before.singers.find(row => row.name === 'Mobile QA Listener');
  const version = before.versions[0];
  assert.ok(performer && listener && version);
  const listenerAccount = state => state.points.accounts.find(row => row.singerId === listener.id);
  const performerAccount = state => state.points.accounts.find(row => row.singerId === performer.id);
  const queued = await host.evaluate(data => window.tpv.command({ type: 'request', ...data }),
    { requestId: randomUUID(), singerId: performer.id, versionId: version.id });
  assert.equal(queued.ok, true, JSON.stringify(queued));
  const played = await host.evaluate(() => window.tpv.playPause());
  assert.equal(played.ok, true, JSON.stringify(played));
  await waitForHostCondition(host, async () => (await window.tpv.getTimeline()).position > 0);
  const active = await host.evaluate(() => window.tpv.getState());
  const performance = active.points.performances.find(row => row.generationId === active.playback.generationId);
  assert.deepEqual(performance.eligibleListeners, [listener.id]);
  await mobile.getByRole('button', { name: 'Refresh', exact: true }).click();
  await nav.getByRole('tab', { name: 'Queue', exact: true }).click();
  await mobile.getByRole('button', { name: `Now Playing: ${version.title}`, exact: true }).click();
  const display = app.windows().find(page => /\/display\/index\.html$/.test(page.url()));
  assert.ok(display, 'Expected the actual desktop singer renderer.');
  const badge = display.locator('#applause-overlay .applause-badge');
  assert.equal(await badge.count(), 0);
  await mobile.getByRole('button', { name: 'Applaud (3)', exact: true }).click();
  await Promise.all([badge.waitFor(), mobile.locator('.singer-applause').waitFor({ state: 'attached' }),
    mobile.getByRole('button', { name: 'Applaud (2)', exact: true }).waitFor()]);
  const applauded = await host.evaluate(() => window.tpv.getState());
  assert.equal(applauded.playback.generationId, active.playback.generationId);
  assert.equal(applauded.playback.status, 'playing');
  assert.equal(listenerAccount(applauded).credits, 2);
  assert.equal(listenerAccount(applauded).points - listenerAccount(active).points, 8);
  assert.equal(performerAccount(applauded).points - performerAccount(active).points, 60);
  await badge.waitFor({ state: 'detached' });
  await host.evaluate(() => window.tpv.command({ type: 'stop' }));

  await host.getByRole('button', { name: 'End Session', exact: true }).click();
  await host.getByText('Session ended. Internet singers no longer have access.', { exact: true }).waitFor(); assert.equal(relayStore.lookup(slug)?.active, false);
  await singer.getByRole('button', { name: 'Refresh', exact: true }).click();
  await singer.getByText('This session ended or changed. Check with the host before joining again.', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Start Session', exact: true }).click();
  await host.getByLabel('Singer link').waitFor(); assert.equal(relayStore.lookup(slug)?.active, true);
  await browser.close(); browser = undefined;
  await app.close(); app = undefined; assert.equal(relayStore.lookup(slug)?.active, false, 'application shutdown must close its internet session');
  console.log('PASS: desktop room lifecycle, share QR and clipboard, singer requests, mobile applause, both visual cues, credits and points. Synthetic video was muted and the relay ran on loopback.');
} catch (error) {
  if (host && !host.isClosed()) console.error('Host session diagnostic:', JSON.stringify(await host.evaluate(() => window.tpv?.internetSessions.status()).catch(() => null)));
  if (mobile && !mobile.isClosed()) console.error('Mobile view diagnostic:', (await mobile.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(0, 2000));
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app) await app.close().catch(() => {});
  await relay.stop();
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
