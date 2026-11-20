// Focus styling regression in a real, muted Electron app with a disposable
// offline profile. Never reads owner accounts, media, or connection files.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitForHostWindow } from './wait-for-host-window.mjs';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(join(repo, 'package.json'));
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const { _electron: electron } = require('playwright-core'), { build } = require('esbuild');
const { build: buildUi } = await import(pathToFileURL(require.resolve('vite')).href);
const temporaryRoot = await realpath(tmpdir()), temp = await mkdtemp(join(temporaryRoot, 'tpv-search-focus-'));
const profile = join(temp, 'profile'), stage = join(temp, 'app');
await mkdir(profile); await mkdir(join(stage, 'main'), { recursive: true });
const canonicalProfile = await realpath(profile);
const screenshots = resolve(process.argv[2] ?? join(repo, 'release/qa/search-focus'));
await mkdir(screenshots, { recursive: true });
let app, host;
const observations = [], pageErrors = [];
try {
  await Promise.all(['main', 'preload'].map(entry => build({ entryPoints: [join(repo, `src/${entry}/index.ts`)],
    outfile: join(stage, `${entry}/index.cjs`), bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] })));
  await buildUi({ root: repo, configFile: join(repo, 'vite.config.mts'), build: { outDir: join(stage, 'ui'), emptyOutDir: true }, logLevel: 'warn' });
  await writeFile(join(profile, 'settings.json'), JSON.stringify({ settingsVersion: 2, appearance: 'day',
    sharedCatalogEnabled: false, providerCatalogEnabled: false, youtubeSearchEnabled: false,
    autoBumper: false, bumperOnLaunch: false, autoAdvance: false, masterVolume: 0 }));
  const bootstrap = join(temp, 'bootstrap.cjs');
  const fixture = join(temp, 'Synthetic Artist - Keyboard Queue.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x180:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', fixture]);
  await writeFile(bootstrap, `const {app,dialog,session,shell}=require('electron');const fs=require('node:fs');
app.setPath('userData',process.env.TPV_FOCUS_PROFILE);app.setAppPath(process.env.TPV_FOCUS_REPO);app.getVersion=()=>${JSON.stringify(metadata.version)};
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_FOCUS_PROFILE))throw Error('Unsafe focus QA profile');
globalThis.__focusQaNetwork=0;globalThis.fetch=async()=>{globalThis.__focusQaNetwork++;throw Error('External requests disabled in focus QA');};
shell.openExternal=async()=>{throw Error('External browsers disabled in focus QA');};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_FOCUS_FIXTURE]});
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,callback)=>callback({cancel:true})));
require(process.env.TPV_FOCUS_ENTRY);`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
  Object.assign(env, { TPV_FOCUS_PROFILE: canonicalProfile, TPV_FOCUS_REPO: repo, TPV_FOCUS_ENTRY: join(stage, 'main/index.cjs'), TPV_FOCUS_FIXTURE: fixture,
    APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') });
  const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio', '--disable-background-networking'];
  if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
  app = await electron.launch({ executablePath: require('electron'), args, env, cwd: repo });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  host = await waitForHostWindow(app); host.on('pageerror', error => pageErrors.push(error.message));
  await host.waitForFunction(() => !!window.tpv?.getSettings);
  const search = host.getByRole('searchbox', { name: 'Search library', exact: true });
  const inspect = () => search.evaluate(input => {
    const wrapper = input.closest('.search-field'), sidebar = input.closest('.sidebar');
    const field = getComputedStyle(input), outer = getComputedStyle(wrapper);
    const sample = document.createElement('span'); sample.style.color = 'var(--accent)'; sample.hidden = true; wrapper.append(sample);
    const expectedColor = getComputedStyle(sample).color; sample.remove();
    const box = wrapper.getBoundingClientRect(), available = sidebar.getBoundingClientRect();
    return { focused: document.activeElement === input, inputOutline: field.outlineWidth, inputShadow: field.boxShadow,
      outerOutline: outer.outlineWidth, outerOffset: outer.outlineOffset, outerStyle: outer.outlineStyle,
      outerColor: outer.outlineColor, expectedColor,
      unclipped: box.left - 4 >= available.left && box.right + 4 <= available.right && box.top - 4 >= available.top,
      viewport: { width: window.innerWidth, height: window.innerHeight } };
  });
  for (const appearance of ['day', 'night']) for (const accentColor of ['blue', 'pink', 'purple']) {
    await host.evaluate(value => window.tpv.saveSettings(value), { appearance, accentColor });
    await host.waitForFunction(({ appearance, accentColor }) => document.documentElement.dataset.theme === appearance && document.documentElement.dataset.accent === accentColor, { appearance, accentColor });
    for (const method of ['pointer', 'shortcut']) {
      await host.getByRole('button', { name: 'Sources', exact: true }).click();
      if (method === 'pointer') await search.click(); else await host.keyboard.press('Control+f');
      await host.waitForFunction(() => {
        const input = document.querySelector('.global-search input'); return document.activeElement === input && getComputedStyle(input).boxShadow === 'none';
      }, undefined, { timeout: 2500 });
      const result = await inspect(); observations.push({ appearance, accentColor, method, ...result });
      assert.equal(result.focused, true); assert.equal(result.inputOutline, '0px'); assert.equal(result.inputShadow, 'none');
      assert.equal(result.outerOutline, '2px'); assert.equal(result.outerOffset, '2px'); assert.equal(result.outerStyle, 'solid'); assert.equal(result.unclipped, true);
      assert.equal(result.outerColor, result.expectedColor);
    }
    await host.mouse.move(5, 5);
    await host.screenshot({ path: join(screenshots, `${appearance}-${accentColor}-focus.png`) });
  }
  for (const section of ['Singers', 'Playlists']) {
    await host.getByRole('button', { name: section, exact: true }).click(); await host.keyboard.press('Control+f');
    assert.equal(await search.evaluate(input => document.activeElement === input), true);
  }
  const state = await host.evaluate(() => window.tpv.getState()); assert.equal(state.requests.length, 0); assert.equal(state.playback, null);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await waitForHostCondition(host, async () => (await window.tpv.imports.status())?.phase === 'completed');
  const imported = await host.evaluate(() => window.tpv.imports.status());
  assert.equal(imported?.imported, 1, `Could not import the queue fixture: ${JSON.stringify(imported)}`);
  await host.evaluate(async () => {
    const [recording] = (await window.tpv.getState()).versions;
    for (const name of ['First Singer', 'Second Singer', 'Third Singer']) {
      const singerId = name.split(' ')[0];
      for (const command of [{ type: 'addSinger', singer: { id: singerId, name } }, { type: 'request', requestId: `request-${singerId}`, singerId, versionId: recording.id }]) {
        const result = await window.tpv.command(command);
        if (!result.ok) throw Error(result.error);
      }
    }
  });
  const queue = host.getByRole('listbox', { name: 'Singer Rotation', exact: true });
  const rows = queue.getByRole('option');
  const queueFocus = () => queue.evaluate(list => Array.from(list.children).findIndex(row => row === document.activeElement && row.getAttribute('aria-selected') === 'true'));
  await rows.nth(2).waitFor(); await rows.first().focus();
  for (const [key, position] of [['ArrowUp', 0], ['ArrowDown', 1], ['End', 2], ['ArrowDown', 2], ['ArrowUp', 1], ['Home', 0]]) {
    await host.keyboard.press(key); assert.equal(await queueFocus(), position, `Queue focus after ${key}`);
  }
  const rating = rows.first().getByRole('button', { name: /^Rate Keyboard Queue/ });
  await rating.focus(); await host.keyboard.press('ArrowDown');
  assert.equal(await rating.evaluate(button => document.activeElement === button), true, 'Queue navigation leaves the rating control focused.');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  assert.equal(await app.evaluate(() => globalThis.__focusQaNetwork), 0); assert.deepEqual(pageErrors, []);
  await writeFile(join(screenshots, 'focus-verification.json'), JSON.stringify({ version: metadata.version, passed: true, observations }, null, 2) + '\n');
  console.log(`PASS: unclipped search focus across Day/Night × Blue/Pink/Purple, keyboard queue traversal, and focused rating control isolation. Evidence: ${screenshots}`);
} catch (error) {
  if (host) { await host.screenshot({ path: join(screenshots, 'failure.png') }).catch(() => {}); console.error(JSON.stringify(await inspectForFailure(host))); }
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(temp);
  if (dirname(actual) !== temporaryRoot || !actual.startsWith(temporaryRoot + sep) || !basename(actual).startsWith('tpv-search-focus-')) throw Error('Unsafe focus QA cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
async function inspectForFailure(page) {
  return page.locator('.global-search input').evaluate(input => ({ outline: getComputedStyle(input).outline, shadow: getComputedStyle(input).boxShadow, outer: getComputedStyle(input.closest('.search-field')).outline })).catch(() => ({}));
}
