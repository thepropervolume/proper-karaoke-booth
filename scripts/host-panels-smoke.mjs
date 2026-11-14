// Actual host UI with synthetic media, muted audio and an isolated disposable show.
// Run after build: node scripts/host-panels-smoke.mjs [screenshots-directory]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(join(repo, 'package.json')), { _electron: electron } = require('playwright-core');
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const root = await realpath(tmpdir()), temp = await mkdtemp(join(root, 'tpv-host-panels-'));
const profile = join(temp, 'profile'); await mkdir(profile, { mode: 0o700 });
const canonicalProfile = await realpath(profile), screenshots = process.argv[2] ? resolve(process.argv[2]) : null;
const fixture = join(temp, 'Test Artist - Test Song.mp4'), bootstrap = join(temp, 'bootstrap.cjs');
const settings = { sharedCatalogEnabled: false, providerCatalogEnabled: false, youtubeSearchEnabled: false, singerDisplayFullscreen: false, appearance: 'day' };
await writeFile(join(profile, 'settings.json'), JSON.stringify(settings));
await writeFile(join(temp, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, main: 'bootstrap.cjs' }));
await writeFile(bootstrap, `const{app}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.TPV_QA_PROFILE);app.setAppPath(process.env.TPV_QA_REPO);if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe QA profile');require(process.env.TPV_QA_ENTRY);`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { TPV_QA_PROFILE: canonicalProfile, TPV_QA_REPO: repo, TPV_QA_ENTRY: join(repo, 'dist/main/index.cjs'), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') });
let app;
try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', fixture], { windowsHide: true, timeout: 30000 });
  app = await electron.launch({ executablePath: require('electron'), args: [temp, `--user-data-dir=${canonicalProfile}`, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture);
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv);
  assert.equal(await host.evaluate(() => window.tpv.getAppVersion()), metadata.version);
  await host.getByRole('region', { name: 'Singer preview', exact: true }).waitFor();
  const prefs = async () => { await host.getByRole('button', { name: 'Preferences', exact: true }).click(); const dialog = host.getByRole('dialog', { name: 'Preferences', exact: true }); await dialog.waitFor(); return dialog; };
  const save = async dialog => { await dialog.getByRole('button', { name: 'Save preferences', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); };
  const fit = async () => {
    const dimensions = await host.evaluate(() => {
      const list = document.querySelector('.library-results'), local = list.querySelector('.song-list');
      const rows = Array.from({ length: 100 }, () => { const row = document.createElement('div'); row.style.height = '62px'; local.append(row); return row; });
      const footer = document.querySelector('.transport').getBoundingClientRect();
      const result = { footerBottom: footer.bottom, viewport: innerHeight, pageHeight: document.documentElement.scrollHeight, listScrolls: list.scrollHeight > list.clientHeight, resultsHeight: list.clientHeight, resultsScrollHeight: list.scrollHeight };
      rows.forEach(row => row.remove()); return result;
    });
    assert.ok(dimensions.listScrolls && dimensions.footerBottom <= dimensions.viewport + 1 && dimensions.pageHeight <= dimensions.viewport + 1, JSON.stringify(dimensions));
  };
  await fit();
  const original = (await host.evaluate(() => window.tpv.getSettings())).settings.hostPanelSizes;
  const sidebar = host.getByRole('separator', { name: 'Resize Workspace Sidebar' });
  const position = await sidebar.boundingBox(); assert.ok(position);
  await host.mouse.move(position.x + position.width / 2, position.y + 50); await host.mouse.down(); await host.mouse.move(position.x + position.width / 2 + 32, position.y + 50); await host.mouse.up();
  await waitForHostCondition(host, before => window.tpv.getSettings().then(result => result.settings.hostPanelSizes.sidebar > before), original.sidebar);
  const queueSeparator = host.getByRole('separator', { name: 'Resize Host Queue Width' }); await queueSeparator.focus(); await queueSeparator.press('ArrowLeft');
  await waitForHostCondition(host, before => window.tpv.getSettings().then(result => result.settings.hostPanelSizes.queue > before), original.queue);
  const previewSeparator = host.getByRole('separator', { name: 'Resize Singer Preview' }); await previewSeparator.focus(); await previewSeparator.press('ArrowDown');
  await waitForHostCondition(host, before => window.tpv.getSettings().then(result => result.settings.hostPanelSizes.preview > before), original.preview);
  await fit();

  let dialog = await prefs(); await dialog.getByLabel('Singer Preview Position', { exact: true }).selectOption('below'); await save(dialog);
  assert.equal(await host.locator('.host-queue-panel').getAttribute('data-preview-position'), 'below');
  assert.equal(await host.locator('.host-queue-panel').evaluate(panel => panel.querySelector('.singer-preview').getBoundingClientRect().top > panel.querySelector('.rotation').getBoundingClientRect().top), true);
  dialog = await prefs(); await dialog.getByLabel('Workspace layout', { exact: true }).selectOption('library'); await save(dialog);
  await host.getByRole('separator', { name: 'Resize Host Queue Height' }).waitFor(); await fit();
  dialog = await prefs(); await dialog.getByLabel('Singer Preview Position', { exact: true }).selectOption('hidden'); await dialog.getByLabel('Workspace layout', { exact: true }).selectOption('standard'); await save(dialog);
  assert.equal(await host.getByRole('region', { name: 'Singer preview', exact: true }).count(), 0); await fit();

  await host.getByRole('button', { name: 'Import Video File', exact: true }).click();
  await waitForHostCondition(host, () => window.tpv.getState().then(value => value.versions.length === 1));
  const songs = host.getByRole('listbox', { name: 'Songs', exact: true }), song = songs.getByRole('option').filter({ hasText: 'Test Song' }); await song.waitFor();
  await song.click({ button: 'right' }); await host.getByRole('menuitem', { name: 'Blacklist Song', exact: true }).click();
  await song.waitFor({ state: 'hidden' });
  assert.deepEqual((await host.evaluate(() => window.tpv.getSettings())).settings.songBlacklist, [{ artist: 'Test Artist', title: 'Test Song' }]);
  dialog = await prefs(); await dialog.locator('summary').filter({ hasText: /^Song and Artist Blacklist$/ }).click();
  await dialog.getByRole('button', { name: 'Remove song blacklist: Test Artist — Test Song', exact: true }).click(); await save(dialog); await song.waitFor();
  dialog = await prefs(); await dialog.locator('summary').filter({ hasText: /^Song and Artist Blacklist$/ }).click();
  await dialog.getByLabel('Artist to blacklist', { exact: true }).fill('Test Artist'); await dialog.getByRole('button', { name: 'Blacklist Artist', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual((await host.evaluate(() => window.tpv.getSettings())).settings.artistBlacklist, []); await song.waitFor();
  await song.getByRole('button', { name: /^Rate Test Song\./ }).click();
  const rating = host.getByRole('dialog', { name: 'Rate This Recording', exact: true }); await rating.waitFor();
  assert.equal(await rating.getByRole('radio', { name: '7 hearts out of 10' }).isEnabled(), true);
  await rating.getByRole('radio', { name: '7 hearts out of 10' }).click(); await rating.getByRole('button', { name: 'Save Local Rating', exact: true }).click();
  await rating.getByRole('status').filter({ hasText: 'Your local rating was saved.' }).waitFor(); await rating.getByRole('button', { name: 'Close', exact: true }).click();
  await song.getByRole('button', { name: /Your local rating: 7 out of 10 hearts/ }).waitFor();

  dialog = await prefs(); await dialog.getByLabel('Singer Preview Position', { exact: true }).selectOption('above'); await save(dialog);
  await host.getByRole('button', { name: 'Remote Sessions', exact: true }).click(); await host.getByRole('region', { name: 'LAN singer screens', exact: true }).waitFor();
  await host.getByRole('button', { name: 'Library', exact: true }).click();
  if (screenshots) { await mkdir(screenshots, { recursive: true }); await host.screenshot({ path: join(screenshots, 'host-panels-day.png') }); }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1040, 700)); await fit();
  await host.evaluate(() => window.tpv.saveSettings({ appearance: 'night' })); await host.waitForFunction(() => document.documentElement.dataset.theme === 'night');
  if (screenshots) await host.screenshot({ path: join(screenshots, 'host-panels-night.png') });
  const state = await host.evaluate(() => window.tpv.getState()); assert.equal(state.requests.length, 0); assert.equal(state.playback, null);
  console.log('PASS: draggable panels persist; all layouts keep transport visible; preview placement, blacklist save/cancel/removal, local ratings and LAN screen navigation work in a muted disposable show.');
} finally {
  if (app) await app.close();
  const actual = await realpath(temp);
  if (dirname(actual) !== root || !actual.startsWith(root + sep) || !basename(actual).startsWith('tpv-host-panels-')) throw new Error('Unsafe host panels smoke cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
