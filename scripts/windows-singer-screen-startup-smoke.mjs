// Run on Windows after npm run build. Uses a disposable show and loopback only.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('This rehearsal requires Windows.');

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(repo, 'dist/main/index.cjs');
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', resolve);
});
const { port } = reservation.address();
await new Promise(resolve => reservation.close(resolve));

function reachable(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(3000);
    socket.once('timeout', () => socket.destroy(new Error('Loopback probe timed out.')));
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => {
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
}

const parent = await realpath(tmpdir());
const directory = await mkdtemp(join(parent, 'tpv-booth-startup-test-'));
let app;
try {
  const profile = join(directory, 'profile');
  await mkdir(profile);
  await writeFile(join(profile, 'settings.json'), JSON.stringify({
    settingsVersion: 2, singerScreenEnabled: true, singerScreenPort: port, desktopUpdateMode: 'off',
    autoBumper: false, bumperOnLaunch: false, autoAdvance: false, localControlEnabled: false,
    providerCatalogEnabled: false, sharedCatalogEnabled: false, youtubeSearchEnabled: false,
  }));
  const bootstrap = join(directory, 'bootstrap.cjs');
  await writeFile(bootstrap, `
const { app } = require('electron');
app.setPath('userData', process.env.TPV_QA_PROFILE);
app.setAppPath(process.env.TPV_QA_REPO);
require('node:os').networkInterfaces = () => ({});
globalThis.fetch = async () => { throw new Error('External requests are disabled for this rehearsal.'); };
require(process.env.TPV_QA_ENTRY);
`);
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
  Object.assign(env, { TPV_QA_PROFILE: profile, TPV_QA_REPO: repo, TPV_QA_ENTRY: entry,
    APPDATA: join(directory, 'appdata'), LOCALAPPDATA: join(directory, 'localappdata') });
  app = await electron.launch({ args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio', '--disable-background-networking'], env, timeout: 30_000 });
  const actual = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(await realpath(actual), await realpath(profile), 'Use the disposable show only.');
  await app.firstWindow();
  const host = await Promise.any(app.windows().map(async page => {
    await page.waitForURL(/\/renderer\/index\.html/, { timeout: 10_000 });
    return page;
  }));
  const status = () => host.evaluate(() => window.tpv.singerScreens.status());
  assert.equal((await status()).status, 'stopped');
  assert.equal(await reachable(port), false, 'Saved sharing must not open a startup listener.');
  const settings = await host.evaluate(() => window.tpv.saveSettings({ showDisplayLogo: false }));
  assert.equal(settings.singerScreenEnabled, true, 'The saved preference must be kept.');
  assert.equal(await reachable(port), false, 'Saving an unrelated preference must not open a listener.');

  await host.getByRole('button', { name: 'Remote Sessions', exact: true }).click({ timeout: 10_000 });
  await host.getByRole('button', { name: 'Start Singer-Screen Sharing', exact: true }).click({ timeout: 10_000 });
  const stop = host.getByRole('button', { name: 'Stop Singer-Screen Sharing', exact: true });
  await stop.waitFor({ timeout: 10_000 });
  assert.equal((await status()).port, port, 'Explicit Start must use the saved port.');
  assert.equal(await reachable(port), true);
  await stop.click();
  await host.getByRole('button', { name: 'Start Singer-Screen Sharing', exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(await reachable(port), false, 'Explicit Stop must close the listener.');
  console.log('PASS: Windows startup, unrelated settings save, and explicit sharing Start/Stop.');
} finally {
  await app?.close();
  const actual = await realpath(directory);
  assert.equal(dirname(actual), parent);
  assert.ok(basename(actual).startsWith('tpv-booth-startup-test-'));
  await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
