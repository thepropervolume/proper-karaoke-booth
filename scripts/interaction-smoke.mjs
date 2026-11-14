import { waitForHostCondition } from './wait-for-host-condition.mjs';
// Run with: node scripts/interaction-smoke.mjs <repository> <synthetic-mp4>
// Requires a built application, platform-native Electron, playwright-core and a
// synthetic H.264/AAC MP4 of at least 20 seconds (never a real song).
// On Linux, run under a desktop session or xvfb-run. Audio is always muted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [repoArg, fixtureArg] = process.argv.slice(2);
if (!repoArg || !fixtureArg) throw new Error('Usage: node scripts/interaction-smoke.mjs <repository> <synthetic-mp4>');
const repo = await realpath(resolve(repoArg));
const fixture = await realpath(resolve(fixtureArg));
if (!(await stat(fixture)).isFile() || !fixture.toLowerCase().endsWith('.mp4')) throw new Error('Fixture must be an existing synthetic MP4 file.');
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
if (typeof executablePath !== 'string') throw new Error('Platform-native Electron is not installed for this environment.');

const temp = await mkdtemp(join(tmpdir(), 'tpv-ui-qa-'));
const profile = join(temp, 'profile');
await mkdir(profile);
const canonicalProfile = await realpath(profile);
// This fixture exercises the seeded local catalog, never the public service.
await writeFile(join(profile, 'settings.json'), JSON.stringify({ sharedCatalogEnabled: false, providerCatalogEnabled: false }));
const localCatalogBase = join(temp, process.platform === 'win32' ? 'localappdata' : 'xdg-data');
const localCatalogDir = join(localCatalogBase, 'ProperKaraokeBooth', 'karaokenerds');
await mkdir(localCatalogDir, { recursive: true });
const syntheticCatalog = new DatabaseSync(join(localCatalogDir, 'community.sqlite'));
syntheticCatalog.exec('CREATE TABLE community_catalog (id INTEGER PRIMARY KEY, snapshot TEXT, last_success INTEGER)');
syntheticCatalog.prepare('INSERT INTO community_catalog VALUES (1, ?, 1)').run(JSON.stringify({ Items: [
  { Id: 1, Artist: 'Synthetic Artist', Title: 'Synthetic Song', Brand: 'unmapped', Watch: 'https://www.youtube.com/watch?v=abcdefghijk', Created: null },
] }));
syntheticCatalog.close();
const bootstrap = join(temp, 'isolated-bootstrap.cjs');
const copiedFixture = join(temp, 'DJID-002 - Nada Surf - Popular.mp4');
await copyFile(fixture, copiedFixture);
const matchingFixture = join(temp, 'moved-original.mp4');
const wrongFixture = join(temp, 'wrong-recording.mp4');
await copyFile(fixture, matchingFixture);
await writeFile(wrongFixture, 'a different synthetic file');
const logoFixture = join(temp, 'logo.png');
await writeFile(logoFixture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=', 'base64'));
// Set and check userData before the real main bundle can open its database.
await writeFile(bootstrap, `const { app } = require('electron');\nconst fs = require('node:fs');\napp.setPath('userData', process.env.TPV_QA_PROFILE);\nif (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe userData path');\nrequire(process.env.TPV_QA_ENTRY);\n`);

let app;
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry,
  XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data'), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');

try {
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  const effectiveProfile = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(await realpath(effectiveProfile), canonicalProfile, 'Refusing to interact: Electron userData is not the disposable profile.');
  await app.evaluate(({ dialog }, paths) => {
    globalThis.tpvRelinkChoice = paths.wrong;
    globalThis.tpvWarnings = [];
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options?.title === 'Choose singer display logo' ? paths.logo : options?.title === 'Choose bumper music' ? paths.bumper : options?.title === 'Relink original video file' ? globalThis.tpvRelinkChoice : paths.video] });
    dialog.showMessageBox = async (_window, options) => { globalThis.tpvWarnings.push(options); return { response: 0, checkboxChecked: false }; };
  }, { video: copiedFixture, logo: logoFixture, bumper: join(canonicalProfile, 'bumper-builtins', 'builtin-ambient-v1.wav'), wrong: wrongFixture });
  const host = await app.firstWindow();
  const untilState = async (predicate, description) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await host.evaluate(() => window.tpv.getState());
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${description}`);
  };
  host.on('dialog', dialog => void dialog.accept().catch(() => {}));
  const errors = [];
  host.on('pageerror', error => errors.push(error.message));
  await host.waitForFunction(() => !!window.tpv);
  const initial = await host.evaluate(() => window.tpv.getState());
  assert.equal(initial.versions.length, 0, 'Temporary profile unexpectedly has songs.');
  assert.equal(initial.requests.length, 0, 'Temporary profile unexpectedly has requests.');

  await host.getByRole('button', { name: 'Sources', exact: true }).click();
  const community = host.getByRole('region', { name: 'Karaoke Nerds catalog' });
  await community.getByLabel('Artist or song title').fill('synthetic artist');
  await community.getByRole('button', { name: 'Search catalog' }).click();
  await community.getByText('Synthetic Song', { exact: true }).waitFor();
  await community.getByText('YouTube ID: abcdefghijk', { exact: true }).waitFor();
  await community.getByText('Synthetic Artist · Brand not identified', { exact: true }).waitFor();
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests.length, 0, 'Catalog search must not enqueue a song.');
  assert.equal((await host.evaluate(() => window.tpv.getState())).versions.length, 0, 'Catalog search must not import a song.');
  await host.getByRole('button', { name: 'Library', exact: true }).click();

  await host.getByRole('button', { name: 'Preferences', exact: true }).click();
  await host.locator('summary').filter({ hasText: 'Remote Queueing' }).click();
  await host.getByText('Room: closed', { exact: true }).waitFor();
  const remoteStatus = await host.evaluate(() => window.tpv.remote.status());
  assert.equal(remoteStatus.available, true);
  assert.equal(remoteStatus.room, 'closed', 'Remote access must remain closed until explicitly opened.');
  assert.equal(await host.evaluate(async () => { try { await window.tpv.remote.openLan({}); return false; } catch { return true; } }), true, 'Malformed remote room settings must be rejected.');
  await host.getByText('Library Settings', { exact: true }).click();
  const templates = host.getByLabel('Filename and folder templates, one per line');
  await templates.fill('${DJ Code} - ${Artist} - ${Track Name}');
  await host.locator('summary').filter({ hasText: /^Singer Display$/ }).click();
  await host.getByLabel('Show the next singers').check();
  await host.getByRole('button', { name: 'Choose logo…' }).click();
  await host.getByText('Audio Controls', { exact: true }).click();
  await host.getByLabel('Pause Interval (seconds)').fill('2');
  const outputPicker = host.getByRole('combobox', { name: 'Output Device' });
  await outputPicker.waitFor();
  const availableOutputs = await outputPicker.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  if (availableOutputs.length) await outputPicker.selectOption(availableOutputs[0]);
  await host.getByRole('button', { name: 'Save preferences' }).click();
  assert.deepEqual((await host.evaluate(() => window.tpv.getSettings())).settings.metadataTemplates, ['${DJ Code} - ${Artist} - ${Track Name}']);
  if (availableOutputs.length) assert.equal((await host.evaluate(() => window.tpv.getSettings())).settings.audioOutputId, availableOutputs[0]);
  await host.getByRole('button', { name: 'Import Video File', exact: true }).click();
  const song = (await untilState(state => state.versions.length === 1, 'import')).versions[0];
  assert.equal(song.artist, 'Nada Surf');
  assert.equal(song.title, 'Popular');
  assert.equal(song.djCode, 'DJID-002');

  await host.getByRole('button', { name: 'Singers', exact: true }).click();
  const addSinger = host.locator('form').filter({ has: host.getByRole('button', { name: 'Add singer', exact: true }) });
  await addSinger.getByLabel('Singer name').fill('QA Singer');
  await addSinger.getByRole('button', { name: 'Add singer', exact: true }).click();
  const singer = (await untilState(state => state.singers.some(s => s.name === 'QA Singer'), 'singer creation')).singers.find(s => s.name === 'QA Singer');
  await host.getByRole('button', { name: 'Library', exact: true }).click();
  const songs = host.getByRole('listbox', { name: 'Songs' });
  // Search the actual filename extension, which is not part of the song metadata.
  const librarySearch = host.getByRole('searchbox', { name: 'Search library' });
  await waitForHostCondition(host, async () => Object.values(await window.tpv.getLibraryFilenames()).some(name => name.endsWith('.mp4')));
  await librarySearch.fill('.mp4');
  await songs.getByRole('option').filter({ hasText: 'Popular' }).waitFor();
  await host.getByRole('combobox', { name: 'Filter songs' }).selectOption('missing-artist');
  await host.getByText('No local or Karaoke Nerds songs match this search or filter.').waitFor();
  await host.getByRole('combobox', { name: 'Filter songs' }).selectOption('all');
  await host.getByRole('combobox', { name: 'Sort songs' }).selectOption('title-asc');
  await librarySearch.clear();
  const songRow = songs.getByRole('option').filter({ hasText: 'Popular' });
  await songRow.click();
  await host.waitForFunction(() => [...document.querySelectorAll('[role="listbox"][aria-label="Songs"] [role="option"][aria-selected="true"]')].some(row => row.textContent?.includes('Popular')));
  assert.equal(await songRow.getAttribute('aria-selected'), 'true', 'Single-click must select the song.');
  await songRow.dblclick();
  await host.getByRole('dialog', { name: 'Add to Queue' }).waitFor({ state: 'visible' });
  await host.keyboard.press('Control+f');
  await host.getByRole('dialog', { name: 'Add to Queue' }).waitFor({ state: 'hidden' });
  await host.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search library');
  const layout = await host.evaluate(() => {
    const list = document.querySelector('.song-list');
    const added = Array.from({ length: 100 }, () => { const row = document.createElement('div'); row.style.height = '62px'; list.append(row); return row; });
    const footer = document.querySelector('.transport').getBoundingClientRect();
    const result = { footerBottom: footer.bottom, viewport: window.innerHeight, pageHeight: document.documentElement.scrollHeight, listScrolls: (() => { const scroll = document.querySelector('.library-results') || list; return scroll.scrollHeight > scroll.clientHeight; })() };
    added.forEach(row => row.remove()); return result;
  });
  assert.ok(layout.listScrolls && layout.footerBottom <= layout.viewport + 1 && layout.pageHeight <= layout.viewport + 1, `The player must stay visible with a long library: ${JSON.stringify(layout)}`);
  await host.getByRole('button', { name: 'Import Video File', exact: true }).hover();
  await host.getByRole('tooltip', { name: 'Import Video File' }).waitFor({ state: 'visible', timeout: 1000 });
  await songRow.click({ button: 'right' });
  await host.getByRole('menuitem', { name: 'Add to Playlist' }).click();
  const playlistDialog = host.getByRole('dialog', { name: 'Add to Playlist' });
  await playlistDialog.getByRole('button', { name: 'Add Song' }).click();
  await playlistDialog.waitFor({ state: 'hidden' });
  assert.ok((await host.evaluate(() => window.tpv.getCollections())).items.some(i => i.versionId === song.id && i.playlistId === 'kj-picks'));
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests.length, 0, 'Selecting a song must not enqueue it.');

  const requestSong = async () => {
    await songRow.dblclick();
    const dialog = host.getByRole('dialog', { name: 'Add to Queue' });
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('combobox').selectOption(singer.id);
    await dialog.getByRole('button', { name: /add to queue/i }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  await requestSong();
  await untilState(state => state.requests.some(r => r.status === 'accepted'), 'accepted request');
  const rotation = host.getByRole('listbox', { name: 'Singer Rotation' });
  const queued = rotation.getByRole('option').filter({ hasText: 'QA Singer' });
  await queued.click();
  await songRow.click();
  await host.keyboard.press('Delete');
  await host.waitForTimeout(200);
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests.filter(r => r.status === 'accepted').length, 1, 'Delete in the song library must not remove the selected queue request.');
  await host.getByRole('button', { name: 'Stage next' }).focus();
  await host.keyboard.press('Delete');
  await host.waitForTimeout(200);
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests.filter(r => r.status === 'accepted').length, 1, 'Delete on an unrelated button must not remove the selected queue request.');
  await queued.focus();
  await host.keyboard.press('Delete');
  await untilState(state => state.requests.some(r => r.status === 'removed'), 'queue removal');

  await requestSong();
  await untilState(state => state.requests.filter(r => r.status === 'accepted').length === 1, 'second request');
  await host.getByRole('button', { name: 'Singer display', exact: true }).click();
  let display;
  for (let n = 0; n < 100 && !display; n++) {
    display = app.windows().find(w => w !== host);
    if (!display) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(display, 'Singer display did not open.');
  assert.equal(await display.evaluate(async () => { try { await window.tpv.remote.status(); return false; } catch { return true; } }), true, 'The singer window must not access host remote controls.');
  await display.locator('video').waitFor({ state: 'attached' });
  await display.getByText('Coming up: QA Singer').waitFor();
  await display.waitForFunction(() => { const logo = document.querySelector('#idle-logo'); return logo && !logo.hidden && logo.complete && logo.naturalWidth > 0; });
  await host.getByRole('button', { name: 'Preferences', exact: true }).click();
  await host.getByText('Audio Controls', { exact: true }).click();
  const bumperPanel = host.getByRole('region', { name: 'Bumper music' });
  await bumperPanel.getByRole('button', { name: 'Add audio (0/5)' }).click();
  await bumperPanel.getByRole('button', { name: 'Add audio (1/5)' }).waitFor();
  if (availableOutputs.length) {
    await bumperPanel.getByRole('button', { name: 'Play bumper' }).click();
    await waitForHostCondition(host, async () => (await window.tpv.getBumpers()).status.status === 'playing');
  }
  await host.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Change only the disposable imported file; the exact original remains in matchingFixture.
  await writeFile(copiedFixture, 'changed synthetic file');
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await host.getByText('The song file has changed since import. Relink the original file before playing.', { exact: true }).waitFor();
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'Changed source must not start.');
  await rm(copiedFixture);
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await host.getByText('The source file is unavailable. Right-click the song in Song Library and choose Relink File.', { exact: true }).waitFor();
  await songRow.click({ button: 'right' });
  await host.getByRole('menuitem', { name: 'Relink File…' }).click();
  await host.getByText(/does not match the original recording/).waitFor();
  await app.evaluate((_electron, path) => { globalThis.tpvRelinkChoice = path; }, matchingFixture);
  await songRow.click({ button: 'right' });
  await host.getByRole('menuitem', { name: 'Relink File…' }).click();
  await host.getByText('Song file relinked.', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await untilState(state => state.playback?.status === 'playing', 'playback');
  if (availableOutputs.length) assert.equal((await host.evaluate(() => window.tpv.getBumpers())).status.status, 'stopped', 'Bumper audio must stop before karaoke starts.');
  await display.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0 && !v.paused; }, null, { timeout: 15000 });
  const generation = (await host.evaluate(() => window.tpv.getState())).playback.generationId;
  await display.evaluate(id => window.tpvDisplay.event({ type: 'error', generation: id, code: 'MEDIA_ERR_DECODE' }), generation);
  await untilState(state => state.playback?.status === 'paused', 'media error pause');
  assert.ok((await app.evaluate(() => globalThis.tpvWarnings)).some(w => w.message === 'Song playback paused' && /codec/i.test(w.detail)), 'Host must receive an actionable playback warning.');
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await untilState(state => state.playback?.status === 'playing', 'resume after playback warning');
  await display.close();
  await untilState(state => state.playback?.status === 'paused', 'singer display close pause');
  assert.ok((await app.evaluate(() => globalThis.tpvWarnings)).some(w => w.message === 'Singer display closed'), 'Host must be told how to recover from display loss.');
  await host.getByRole('button', { name: 'Singer display', exact: true }).click();
  display = undefined;
  for (let n = 0; n < 100 && !display; n++) { display = app.windows().find(w => w !== host); if (!display) await new Promise(r => setTimeout(r, 100)); }
  assert.ok(display, 'Singer display did not reopen.');
  await display.locator('video').waitFor({ state: 'attached' });
  await display.getByText('QA Singer · Popular', { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await untilState(state => state.playback?.status === 'playing', 'resume after display reopened');
  await display.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0 && !v.paused; }, null, { timeout: 15000 });
  if (availableOutputs.length) await display.waitForFunction(id => document.querySelector('video')?.sinkId === id, availableOutputs[0]);
  await host.getByLabel('Global Volume').fill('45');
  await display.waitForFunction(() => Math.abs(document.querySelector('video').volume - 0.45) < 0.001);
  assert.equal(await display.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), true);
  await display.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
  await untilState(state => state.playback?.status === 'paused', 'audio device change pause');
  assert.equal(await display.locator('video').evaluate(video => video.muted && video.paused), true);
  await host.getByRole('button', { name: 'Play/Pause', exact: true }).click();
  await untilState(state => state.playback?.status === 'playing', 'explicit resume after device change');
  await display.bringToFront();
  await display.keyboard.press('Space');
  await untilState(state => state.playback?.status === 'paused', 'pause');
  await display.waitForFunction(() => document.querySelector('video')?.paused === true);
  await display.keyboard.press('Space');
  await untilState(state => state.playback?.status === 'playing', 'resume');
  await display.waitForFunction(() => document.querySelector('video')?.paused === false);
  await host.bringToFront();
  await requestSong();
  await untilState(state => state.requests.some(r => r.status === 'accepted'), 'next song queued');
  await host.getByRole('button', { name: 'Skip', exact: true }).click();
  await untilState(state => state.requests.some(r => r.status === 'skipped'), 'skip');
  await host.waitForFunction(() => document.querySelector('button[aria-label="Play/Pause"]')?.disabled);
  assert.equal(await host.getByRole('button', { name: 'Play/Pause', exact: true }).isDisabled(), true, 'The inter-song interval must block starting the next song.');
  await host.waitForFunction(() => !document.querySelector('button[aria-label="Play/Pause"]')?.disabled, null, { timeout: 5000 });
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'Ending the interval must not autoplay.');
  await host.getByRole('button', { name: 'Playlists', exact: true }).click();
  await host.getByRole('button', { name: 'History', exact: true }).click();
  await host.getByText('QA Singer', { exact: false }).last().waitFor();
  const collections = await host.evaluate(() => window.tpv.getCollections());
  assert.ok(collections.history.some(h => h.singerId === singer.id && h.versionId === song.id && h.outcome === 'skipped'), 'Skipped performance was not retained in history.');
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join('; ')}`);
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile, 'Refusing restart with an unexpected userData path.');
  const restored = await app.firstWindow();
  await restored.waitForFunction(() => !!window.tpv);
  const restoredHistory = (await restored.evaluate(() => window.tpv.getCollections())).history;
  assert.ok(restoredHistory.some(h => h.singerId === singer.id && h.versionId === song.id && h.outcome === 'skipped'), 'History did not persist across restart.');
  console.log(`PASS: isolated preferences/template import, source-change refusal and exact-file relinking, song selection/double-click request, queue Delete, output routing/device-change pause, inter-song gap, bumper file selection${availableOutputs.length ? ' and bumper-to-karaoke transition' : ' (bumper playback skipped: no explicit output)'}, singer-display pause/resume and history. Audio was muted.`);
} finally {
  if (app) await app.close().catch(() => {});
  // Only the exact directory created by mkdtemp for this run is removed.
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}



