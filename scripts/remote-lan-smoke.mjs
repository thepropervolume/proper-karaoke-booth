// Isolated Electron LAN test. The bootstrap redirects the test-only private
// interface to loopback so it cannot expose a listener to the venue network.
// Run: node scripts/remote-lan-smoke.mjs <repository> <synthetic-mp4>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const [repoArg, fixtureArg] = process.argv.slice(2);
if (!repoArg || !fixtureArg) throw new Error('Usage: node scripts/remote-lan-smoke.mjs <repository> <synthetic-mp4>');
const repo = await realpath(resolve(repoArg)), fixture = await realpath(resolve(fixtureArg));
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
const certPath = await realpath(join(repo, 'tests/fixtures/tls/test-only.crt'));
const keyPath = await realpath(join(repo, 'tests/fixtures/tls/test-only.key'));
const ca = await readFile(certPath);
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron, chromium } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const temp = await mkdtemp(join(tmpdir(), 'tpv-remote-qa-'));
const profile = join(temp, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile);
const video = join(temp, 'Artist - Sample.mp4'); await copyFile(fixture, video);
const bootstrap = join(temp, 'bootstrap.cjs');
// Only this disposable test process is altered. The listener and TLS probe are
// both redirected to 127.0.0.1; the application still exercises its real IPC,
// provider, lifecycle, HTTPS server, static assets and SQLite authority.
await writeFile(bootstrap, `const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const dns = require('node:dns/promises');
const net = require('node:net');
const tls = require('node:tls');
const fakeAddress = '192.168.42.31';
os.networkInterfaces = () => ({ 'Isolated QA': [{ address: fakeAddress, family: 'IPv4', internal: false, netmask: '255.255.255.0', cidr: fakeAddress + '/24', mac: '00:00:00:00:00:00' }] });
const realLookup = dns.lookup;
dns.lookup = (name, options) => name === 'localhost' ? Promise.resolve([{address: fakeAddress, family: 4}]) : realLookup(name, options);
const realListen = net.Server.prototype.listen;
net.Server.prototype.listen = function(options, ...rest) { if (options && typeof options === 'object' && options.host === fakeAddress) options = { ...options, host: '127.0.0.1' }; return realListen.call(this, options, ...rest); };
const realConnect = tls.connect;
tls.connect = function(options, ...rest) { if (options && typeof options === 'object' && options.host === fakeAddress) options = { ...options, host: '127.0.0.1', ca: fs.readFileSync(process.env.TPV_QA_CERT) }; return realConnect.call(this, options, ...rest); };
app.setPath('userData', process.env.TPV_QA_PROFILE);
if (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe profile');
require(process.env.TPV_QA_ENTRY);
`);
const reservation = createServer();
await new Promise((yes, no) => { reservation.once('error', no); reservation.listen(0, '127.0.0.1', yes); });
const port = reservation.address().port;
await new Promise((yes, no) => reservation.close(error => error ? no(error) : yes()));
const origin = `https://localhost:${port}`;
function api(path, data, session) {
  const body = JSON.stringify(data);
  return new Promise((yes, no) => {
    const req = request({ hostname: '127.0.0.1', port, servername: 'localhost', ca, method: 'POST', path, agent: false,
      headers: { host: `localhost:${port}`, origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
        ...(session ? { authorization: `Bearer ${session}` } : {}) } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { try { yes({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }); } catch (error) { no(error); } });
    });
    req.on('error', no); req.end(body);
  });
}
function listening() {
  return new Promise(resolveResult => { const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolveResult(true); }); socket.once('error', () => resolveResult(false)); });
}
let app, browser;
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry, TPV_QA_CERT: certPath,
  XDG_CONFIG_HOME: join(temp, 'config'), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
try {
  app = await electron.launch({ executablePath, args: [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'], cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options?.title === 'Choose TLS certificate' ? paths.cert : options?.title === 'Choose TLS private key' ? paths.key : paths.video] });
  }, { cert: certPath, key: keyPath, video });
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.remote);
  const status = await host.evaluate(() => window.tpv.remote.status());
  assert.equal(status.available, true); assert.equal(status.room, 'closed'); assert.equal(await listening(), false, 'No listener may exist before explicit open.');
  await host.evaluate(() => window.tpv.importFiles('files'));
  let initial;
  for (let attempt = 0; attempt < 200; attempt++) {
    initial = await host.evaluate(() => window.tpv.getState());
    if (initial.versions.length === 1) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(initial.versions.length, 1);
  const certificate = await host.evaluate(() => window.tpv.remote.chooseCertificate());
  const key = await host.evaluate(() => window.tpv.remote.choosePrivateKey());
  assert.ok(certificate?.token && key?.token);
  await host.evaluate(input => window.tpv.remote.openLan(input), { interfaceId: status.interfaces[0].id, hostname: 'localhost', port, certificateToken: certificate.token, privateKeyToken: key.token });
  assert.equal(await listening(), true);
  const link = await host.evaluate(() => window.tpv.remote.createInvitation(300));
  const invite = new URLSearchParams(new URL(link).hash.slice(1)).get('invite'); assert.ok(invite);
  const info = await api('/api/v1/admission', { invitation: invite }); assert.equal(info.status, 200);
  const joined = await api('/api/v1/join', { invitation: invite, joinId: 'qa-join-0001', resumeSecret: randomBytes(32).toString('base64url'), name: 'QA Singer', expectedRevision: info.body.revision });
  assert.equal(joined.status, 200); const session = joined.body.session;
  const snapshot = await api('/api/v1/snapshot', {}, session); assert.equal(snapshot.status, 200);
  const requested = await api('/api/v1/request', { command: { commandId: 'qa-request-0001', showId: snapshot.body.showId, hostEpoch: snapshot.body.hostEpoch, expectedRevision: snapshot.body.revision, versionId: initial.versions[0].id } }, session);
  assert.equal(requested.body.ok, true);
  assert.ok((await host.evaluate(() => window.tpv.getState())).requests.some(item => item.singerId === joined.body.singerId));
  const missing = await api('/api/v1/missing-request', { command: { commandId: 'qa-missing-0001', title: 'Missing Song', artist: 'Artist' } }, session);
  assert.equal(missing.body.ok, true);
  assert.ok((await host.evaluate(() => window.tpv.getMissingSongRequests())).some(item => item.singer === 'QA Singer' && item.title === 'Missing Song'));
  const browserExecutable = process.env.TPV_QA_CHROME ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
  if (!browserExecutable) throw new Error('Set TPV_QA_CHROME to a Chromium executable to test the singer page.');
  browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true }); // public test-only self-signed certificate
  const singer = await context.newPage();
  await singer.goto(link, { waitUntil: 'domcontentloaded' });
  await singer.getByLabel('Your name').fill('Browser Singer');
  await singer.getByRole('button', { name: 'Join the show' }).click();
  await singer.getByText('Hello, Browser Singer!').waitFor();
  assert.equal(new URL(singer.url()).hash, '', 'The admission fragment must be removed from browser history.');
  await singer.getByRole('button', { name: 'Request', exact: true }).click();
  await singer.getByText('accepted', { exact: true }).waitFor();
  await singer.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await singer.getByText('withdrawn', { exact: true }).waitFor();
  assert.ok((await host.evaluate(() => window.tpv.getState())).requests.some(item => item.status === 'withdrawn'));
  await host.getByRole('button', { name: 'Requests', exact: true }).click();
  await host.getByRole('region', { name: 'Unavailable song requests' }).waitFor();
  await host.getByText('Request history', { exact: true }).click();
  await host.getByText(/withdrawn/).waitFor();
  await singer.getByLabel('Song title').fill('Browser Missing');
  await singer.getByRole('button', { name: 'Send to host' }).click();
  await host.getByText('Browser Missing', { exact: true }).waitFor();
  await browser.close(); browser = undefined;
  await host.evaluate(id => window.tpv.remote.revokeGuest(id), joined.body.singerId);
  assert.equal((await api('/api/v1/snapshot', {}, session)).status, 400);
  await host.evaluate(() => window.tpv.remote.closeRoom());
  assert.equal(await listening(), false);
  const certificateAgain = await host.evaluate(() => window.tpv.remote.chooseCertificate());
  const keyAgain = await host.evaluate(() => window.tpv.remote.choosePrivateKey());
  await host.evaluate(input => window.tpv.remote.openLan(input), { interfaceId: status.interfaces[0].id, hostname: 'localhost', port, certificateToken: certificateAgain.token, privateKeyToken: keyAgain.token });
  assert.equal(await listening(), true);
  await app.close(); app = undefined;
  assert.equal(await listening(), false, 'Quitting with an open room must close its listener.');
  console.log('PASS: isolated Electron opt-in room, test TLS, browser and API guest requests, host state, revocation and shutdown. Network was bound to loopback only.');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app) await app.close().catch(() => {});
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
