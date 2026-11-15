// Actual packaged payload, a disposable profile, and an untouched official login.
// No credentials, sign-in submission, account API calls or media acquisition.
// Run: node scripts/packaged-karafun-smoke.mjs [packaged-executable]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

if (process.argv.length > 3) throw new Error('Usage: node scripts/packaged-karafun-smoke.mjs [packaged-executable]');
const repo = await realpath(resolve('.')), require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const packagedExecutable = await realpath(resolve(process.argv[2] ?? 'release/win-unpacked/proper-karaoke-booth.exe'));
const version = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version;
const parent = await realpath(tmpdir()), directory = await mkdtemp(join(parent, 'tpv-packaged-karafun-'));
const profile = join(directory, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ sharedCatalogEnabled: false, providerCatalogEnabled: false,
  youtubeSearchEnabled: false, singerDisplayFullscreen: false, autoBumper: false, localControlEnabled: false }));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { APPDATA: join(directory, 'appdata'), LOCALAPPDATA: join(directory, 'localappdata'),
  XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data') });
let app;
const launch = async () => {
  app = await electron.launch({ executablePath: packagedExecutable, args: [`--user-data-dir=${canonicalProfile}`, '--mute-audio'], env, cwd: repo, timeout: 30000 });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const host = await app.firstWindow();
  await waitForHostCondition(host, () => typeof window.tpv?.karaFun?.status === 'function');
  return host;
};
const methods = ['status', 'signIn', 'signOut', 'search', 'request', 'preparations', 'retry', 'subscribe'];
const waitMain = async (predicate, timeout = 30000) => {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (await app.evaluate(predicate)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Packaged sign-in window did not reach the expected state.');
};
try {
  let host = await launch();
  assert.deepEqual(await host.evaluate(names => names.filter(name => typeof window.tpv.karaFun[name] !== 'function'), methods), []);
  const before = await host.evaluate(() => window.tpv.getState());
  assert.equal(before.playback, null); assert.equal(before.requests.length, 0); assert.equal(before.versions.length, 0);
  const initial = await host.evaluate(() => window.tpv.karaFun.status());
  assert.equal(initial.state, 'disconnected'); assert.equal(initial.persistence, 'memory-only');
  assert.deepEqual(await host.evaluate(() => window.tpv.karaFun.preparations()), []);

  // This additional test-only network fence uses a different webRequest event;
  // it preserves the production helper's onBeforeRequest security handler.
  // The first-party login document can load normally; every write and API/CDN
  // request is refused without logging request URLs, headers or bodies.
  await app.evaluate(({ app }) => {
    globalThis.packagedKaraFunQa = { sessions: 0, loginReads: 0, blocked: 0, writes: 0, providerApis: 0, media: 0 };
    app.on('session-created', isolated => {
      globalThis.packagedKaraFunQa.sessions++;
      isolated.webRequest.onBeforeSendHeaders((details, callback) => {
        const count = globalThis.packagedKaraFunQa;
        let allow = false;
        try {
          const url = new URL(details.url), read = ['GET', 'HEAD', 'OPTIONS'].includes(details.method);
          if (!read) count.writes++;
          if (url.hostname === 'api.karafun.com') count.providerApis++;
          if (details.resourceType === 'media' || /\.(?:kit|kfn|mp3|ogg|mp4|m3u8)$/i.test(url.pathname)) count.media++;
          allow = read && url.protocol === 'https:' && ['www.karafun.com', 'karafun.com'].includes(url.hostname) && details.resourceType !== 'media' && !/\.(?:kit|kfn|mp3|ogg|mp4|m3u8)$/i.test(url.pathname);
          if (allow && details.method === 'GET' && url.hostname === 'www.karafun.com' && url.pathname === '/my/login.html') count.loginReads++;
        } catch {}
        if (!allow) count.blocked++;
        callback({ cancel: !allow });
      });
    });
  });
  await host.getByRole('button', { name: 'Sources', exact: true }).click();
  await host.getByRole('region', { name: 'KaraFun account', exact: true }).waitFor();
  const opened = app.waitForEvent('window');
  await host.getByRole('button', { name: 'Sign In to KaraFun', exact: true }).click();
  const login = await opened;
  await waitForHostCondition(host, async () => (await window.tpv.karaFun.status()).state === 'connecting');
  await waitMain(() => globalThis.packagedKaraFunQa.loginReads > 0);
  await login.waitForURL(url => url.protocol === 'https:' && url.hostname === 'www.karafun.com' && url.pathname === '/my/login.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const isolation = await app.evaluate(({ BrowserWindow, session }) => {
    const login = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('https://www.karafun.com/my/login.html'));
    if (!login) throw new Error('The official sign-in window was not found.');
    const preferences = login.webContents.getLastWebPreferences(), isolated = login.webContents.session;
    return { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation,
      webSecurity: preferences.webSecurity, hasPreload: !!preferences.preload, separateSession: isolated !== session.defaultSession,
      persistentStorage: isolated.getStoragePath(), muted: login.webContents.isAudioMuted() };
  });
  assert.deepEqual(isolation, { sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true,
    hasPreload: false, separateSession: true, persistentStorage: null, muted: true });
  assert.deepEqual(await login.evaluate(() => ({ node: typeof window.require, hostBridge: typeof window.tpv, singerBridge: typeof window.tpvDisplay })),
    { node: 'undefined', hostBridge: 'undefined', singerBridge: 'undefined' });
  assert.ok(await login.locator('input[type="password"]').count() > 0);
  assert.deepEqual(await login.locator('input[type="password"]').evaluateAll(inputs => inputs.map(input => input.value)), ['']);
  await login.close();
  await waitForHostCondition(host, async () => (await window.tpv.karaFun.status()).state === 'disconnected');
  assert.equal(app.windows().length, 1);
  await host.getByRole('button', { name: 'Sign In to KaraFun', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await host.getByRole('button', { name: 'Sign In to KaraFun', exact: true }).isEnabled(), true);
  assert.deepEqual(await host.evaluate(() => window.tpv.getState()), before, 'Cancelled account connection must not change the show.');
  assert.deepEqual(await host.evaluate(() => window.tpv.karaFun.preparations()), []);
  const network = await app.evaluate(() => ({ ...globalThis.packagedKaraFunQa }));
  assert.equal(network.sessions, 1); assert.ok(network.loginReads >= 1); assert.equal(network.writes, 0);
  // Any anonymous provider API attempt is blocked by the added QA fence.
  // In particular, the test never requests or downloads a karaoke recording.
  assert.equal(network.media, 0);
  await app.close(); app = undefined;

  host = await launch();
  assert.equal((await host.evaluate(() => window.tpv.karaFun.status())).state, 'disconnected');
  assert.deepEqual(await host.evaluate(() => window.tpv.karaFun.preparations()), []);
  const restarted = await host.evaluate(() => window.tpv.getState());
  assert.notEqual(restarted.hostEpoch, before.hostEpoch, 'Restart must rotate the host authority epoch.');
  assert.deepEqual({ ...restarted, hostEpoch: before.hostEpoch }, before);
  assert.equal(app.windows().length, 1);
  assert.equal((await host.evaluate(() => window.tpv.getTimeline())).generation, null);
  console.log(JSON.stringify({ passed: true, version, packaged: true, muted: true, methodsVerified: methods.length,
    officialLoginRead: true, isolationChecks: Object.keys(isolation).length, cancellation: 'disconnected; show unchanged',
    restart: 'disconnected; no playback', network }));
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(directory);
  assert.equal(dirname(actual), parent); assert.ok(basename(actual).startsWith('tpv-packaged-karafun-'));
  await rm(actual, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}
