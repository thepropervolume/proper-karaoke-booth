// Deterministic full UI rehearsal. Public relay URLs are intercepted only inside
// disposable test processes and routed to the loopback contract fixture below.
// Run after building: node --import tsx scripts/internet-session-smoke.mjs <repo> <synthetic-mp4>
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoArg, fixtureArg] = process.argv.slice(2);
if (!repoArg || !fixtureArg) throw new Error('Usage: node --import tsx scripts/internet-session-smoke.mjs <repository> <synthetic-mp4>');
const repo = await realpath(resolve(repoArg)), fixture = await realpath(resolve(fixtureArg));
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
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
const { RelayStore } = await import(pathToFileURL(join(repo, 'src/relay/store.ts')).href);
const { RelayBroker } = await import(pathToFileURL(join(repo, 'src/relay/broker.ts')).href);
const { startQueueRelayService } = await import(pathToFileURL(join(repo, 'src/relay/http.ts')).href);
const relayDb = new DatabaseSync(':memory:');
const relayStore = new RelayStore(relayDb, { publicOrigin });
const relayBroker = new RelayBroker(relayStore);
const relay = await startQueueRelayService({ publicOrigin, owners: [{ id: randomUUID(), tokenSha256: createHash('sha256').update(ownerToken).digest('hex') }],
  broker: relayBroker, staticHandler, port: 0, closeDependencies: () => relayDb.close() });
const loopback = `http://127.0.0.1:${relay.port}`;
const bootstrap = join(temporary, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(String(input));
  if (url.origin !== process.env.TPV_QA_PUBLIC) return originalFetch(input, options);
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
if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe test profile');
require(process.env.TPV_QA_ENTRY);
`);
let app, browser, host;
const env = { ...process.env, TPV_QA_PUBLIC: publicOrigin, TPV_QA_LOOPBACK: loopback, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry,
  XDG_CONFIG_HOME: join(temporary, 'config'), APPDATA: join(temporary, 'appdata'), LOCALAPPDATA: join(temporary, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
try {
  app = await electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'], cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, video);
  host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.internetSessions);
  assert.equal((await host.evaluate(() => window.tpv.internetSessions.status())).state, 'stopped'); assert.equal(relayDb.prepare('SELECT COUNT(*) AS count FROM relay_leases').get().count, 0);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await host.waitForFunction(async () => (await window.tpv.getState()).versions.length === 1);
  await host.getByRole('button', { name: 'Remote Sessions', exact: true }).click();
  const slug = `qa-${randomBytes(5).toString('hex')}`;
  await host.getByLabel('Session address').fill(slug); await host.getByRole('button', { name: 'Start Session', exact: true }).click();
  await host.getByText('Session online. Share the singer link to invite your guests.', { exact: true }).waitFor();
  const link = await host.getByLabel('Singer link').inputValue(); assert.equal(link, `${publicOrigin}/${slug}`);
  await host.getByRole('button', { name: 'Copy Link', exact: true }).click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), link);
  const chrome = process.env.TPV_QA_CHROME ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
  if (!chrome) throw new Error('Set TPV_QA_CHROME to a Chromium executable.');
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext();
  await context.route(`${publicOrigin}/**`, async route => {
    assert.notEqual(route.request().headers().authorization, `Bearer ${ownerToken}`);
    const url = new URL(route.request().url());
    const local = await route.fetch({ url: loopback + url.pathname + url.search, headers: { ...route.request().headers(), host: new URL(publicOrigin).host, origin: publicOrigin }, maxRedirects: 0 });
    await route.fulfill({ response: local });
  });
  const singer = await context.newPage(); await singer.goto(link, { waitUntil: 'domcontentloaded' });
  await singer.getByLabel('Your name').fill('Internet QA Singer'); await singer.getByRole('button', { name: 'Join the show', exact: true }).click();
  await singer.getByText('Hello, Internet QA Singer!', { exact: true }).waitFor();
  await singer.getByRole('button', { name: 'Request', exact: true }).click(); await singer.getByText('accepted', { exact: true }).waitFor();
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests.length, 1);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'requests cannot start playback');
  await singer.getByRole('button', { name: 'Withdraw', exact: true }).click(); await singer.getByText('withdrawn', { exact: true }).waitFor();
  await singer.getByLabel('Minutes away').fill('5'); await singer.getByRole('button', { name: 'Mark me unavailable', exact: true }).click();
  await singer.getByText('Availability updated.', { exact: true }).waitFor();
  await singer.getByRole('button', { name: "I'm back", exact: true }).click();
  await singer.getByLabel('Song title', { exact: true }).fill('Internet Missing Song'); await singer.getByRole('button', { name: 'Send to host', exact: true }).click();
  await singer.getByText('Missing-song request sent to the host.', { exact: true }).waitFor();
  assert.ok((await host.evaluate(() => window.tpv.getMissingSongRequests())).some(item => item.title === 'Internet Missing Song'));
  await host.getByRole('button', { name: 'End Session', exact: true }).click();
  await host.getByText('Session ended. Internet singers no longer have access.', { exact: true }).waitFor(); assert.equal(relayStore.lookup(slug)?.active, false);
  await singer.getByRole('button', { name: 'Refresh', exact: true }).click();
  await singer.getByText('This session ended or changed. Check with the host before joining again.', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Start Session', exact: true }).click();
  await host.getByLabel('Singer link').waitFor(); assert.equal(relayStore.lookup(slug)?.active, true);
  await browser.close(); browser = undefined;
  await app.close(); app = undefined; assert.equal(relayStore.lookup(slug)?.active, false, 'application shutdown must close its internet session');
  console.log('PASS: isolated Electron Start/Copy/End, real browser singer join/request/withdraw/availability/missing song, no autoplay, generation fencing and shutdown. Relay used the actual source handler/broker/store on loopback; no public service or private credentials used.');
} catch (error) {
  if (host && !host.isClosed()) console.error('Host session diagnostic:', JSON.stringify(await host.evaluate(() => window.tpv?.internetSessions.status()).catch(() => null)));
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app) await app.close().catch(() => {});
  await relay.stop();
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
