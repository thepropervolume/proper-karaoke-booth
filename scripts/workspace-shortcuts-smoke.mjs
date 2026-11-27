// Run after building: node scripts/workspace-shortcuts-smoke.mjs [repository]
// Uses only a fresh profile, synthetic media, muted windows and cancelled pickers.
// Node fetch is replaced by an offline stub before the app starts: no credentials,
// external service, real show, remote session or real media are used.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..')));
if (process.argv.length > 3) throw new Error('Usage: node scripts/workspace-shortcuts-smoke.mjs [repository]');
const require = createRequire(join(repo, 'package.json')), { _electron: electron } = require('playwright-core');
const executablePath = require('electron'), root = await realpath(tmpdir());
const temp = await mkdtemp(join(root, 'tpv-workspace-qa-')), profile = join(temp, 'profile');
await mkdir(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ sharedCatalogEnabled: false }));
const canonicalProfile = await realpath(profile), entry = await realpath(join(repo, 'dist/main/index.cjs'));
const fixture = join(temp, 'Synthetic Artist - Workspace Shortcuts.mp4'), bootstrap = join(temp, 'bootstrap.cjs');
const encoded = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x180:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', fixture], { windowsHide: true });
assert.equal(encoded.status, 0, `Synthetic fixture creation needs FFmpeg: ${encoded.stderr?.toString()}`);
await writeFile(bootstrap, `const {app,dialog,shell}=require('electron');const fs=require('node:fs');
app.setPath('userData',process.env.TPV_WORKSPACE_QA_PROFILE);app.setAppPath(process.env.TPV_WORKSPACE_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_WORKSPACE_QA_PROFILE))throw Error('Unsafe QA profile');
// This bootstrap bypasses Electron's normal manifest entrypoint. Supply the
// source manifest version for UI labels, rather than the wrapper runtime version.
const qaVersion=JSON.parse(fs.readFileSync(require('node:path').join(process.env.TPV_WORKSPACE_QA_REPO,'package.json'),'utf8')).version;app.getVersion=()=>qaVersion;
globalThis.workspaceQa={dialogs:[],openedFiles:[],nextOpenFile:null};
globalThis.fetch=async()=>new Response('QA offline',{status:503});
dialog.showOpenDialog=async(first,second)=>{const options=second||first;workspaceQa.dialogs.push({kind:'open',title:options?.title||'',properties:options?.properties||[]});const file=workspaceQa.nextOpenFile;workspaceQa.nextOpenFile=null;return file?{canceled:false,filePaths:[file]}:{canceled:true,filePaths:[]};};
dialog.showSaveDialog=async(first,second)=>{const options=second||first;workspaceQa.dialogs.push({kind:'save',title:options?.title||''});return {canceled:true};};
dialog.showMessageBox=async(first,second)=>{const options=second||first;workspaceQa.dialogs.push({kind:'message',title:options?.title||''});return {response:0,checkboxChecked:false};};
shell.openPath=async path=>{workspaceQa.openedFiles.push(path);return '';};
require(process.env.TPV_WORKSPACE_QA_ENTRY);`);
const env = { ...process.env, TPV_WORKSPACE_QA_PROFILE: canonicalProfile, TPV_WORKSPACE_QA_REPO: repo, TPV_WORKSPACE_QA_ENTRY: entry,
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
const baseArgs = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio', '--disable-background-networking'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') baseArgs.push('--no-sandbox');
let app, host;
const children = new Set(), pageErrors = [];
const screenshotDirectory = process.env.TPV_QA_SCREENSHOT_DIR ? resolve(process.env.TPV_QA_SCREENSHOT_DIR) : null;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const screenshot = async name => { if (screenshotDirectory) await host.screenshot({ path: join(screenshotDirectory, name) }); };
const preferences = () => host.getByRole('dialog', { name: 'Preferences', exact: true });
const untilHost = (predicate, arg) => waitForHostCondition(host, predicate, arg, { timeout: 15000, polling: 30 });
const untilApp = (predicate, arg) => waitForHostCondition(app, predicate, arg, { timeout: 15000, polling: 30 });
const launch = async flag => {
  app = await electron.launch({ executablePath, args: [...baseArgs, flag], cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  host = undefined;
  await untilApp(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('/renderer/')));
  host = app.windows().find(window => window.url().includes('/renderer/'));
  assert.ok(host, 'Host renderer did not open.');
  host.on('pageerror', error => pageErrors.push(error.message));
  await untilHost(async () => !!window.tpv?.saveShortcuts && (await window.tpv.getState()).playback === null);
  return host;
};
const closePreferences = async () => {
  await preferences().getByRole('button', { name: 'Cancel', exact: true }).click();
  await preferences().waitFor({ state: 'hidden' });
};
const requireSection = async section => {
  await preferences().waitFor();
  await untilHost(value => {
    const section = document.querySelector(`dialog[open] [data-settings-section="${value}"]`);
    return !!section?.open && section.querySelector('summary').getBoundingClientRect().top >= 0 && section.querySelector('summary').getBoundingClientRect().top < innerHeight;
  }, section);
};
const openShortcuts = async key => { await host.keyboard.press(key ?? 'F1'); await requireSection('keyboard-shortcuts'); };
const clickMenu = async path => {
  const deadline = performance.now() + 15000;
  for (;;) {
    // Check every ancestor and click atomically in one main-process turn. A
    // cancelled picker can otherwise refresh menu objects between read/click.
    const clicked = await app.evaluate(({ Menu, BrowserWindow }, labels) => {
      let menu = Menu.getApplicationMenu(), item;
      for (const label of labels) {
        item = menu?.items.find(value => value.label === label);
        if (!item) throw Error(`Missing menu item ${labels.join(' → ')}`);
        if (!item.enabled) return false;
        menu = item.submenu;
      }
      item.click(item, BrowserWindow.getAllWindows().find(window => !window.getTitle().startsWith('Singer Display')), {});
      return true;
    }, path);
    if (clicked) return;
    if (performance.now() >= deadline) throw Error(`Menu action stayed disabled: ${path.join(' → ')}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
};
const capture = async (label, combination) => {
  const editor = preferences().getByRole('region', { name: 'Keyboard Shortcut Editor' });
  await editor.getByRole('button', { name: `Add Shortcut for ${label}`, exact: true }).click();
  const input = editor.getByRole('textbox', { name: `Record Shortcut for ${label}`, exact: true });
  await input.press(combination); await input.waitFor({ state: 'hidden' });
};
const secondary = async flag => {
  const expected = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const child = spawn(executablePath, [...baseArgs, flag], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child); let output = '';
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
  await new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('Second-instance CLI request timed out.')); }, 15000);
    child.once('error', error => { clearTimeout(timer); children.delete(child); reject(error); });
    child.once('exit', code => { clearTimeout(timer); children.delete(child); code === 0 ? accept() : reject(Error(`Second-instance CLI request exited ${code}: ${output}`)); });
  });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), expected, 'CLI routing must not create another app window.');
};

try {
  await launch('--settings'); await preferences().waitFor();
  assert.equal((await host.evaluate(() => window.tpv.getState())).versions.length, 0);
  assert.ok((await preferences().boundingBox()).width >= 800, 'Desktop settings should use the wider overlay.');
  assert.ok(await preferences().locator('summary').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 20));
  assert.equal(await preferences().locator('.settings-groups > details').count(), 8);
  const preferenceSearch = preferences().getByRole('searchbox', { name: 'Search preferences' });
  await preferenceSearch.fill('filename templates');
  const draftTemplates = preferences().getByLabel('Filename and folder templates, one per line');
  const priorTemplateValue = await draftTemplates.inputValue();
  await draftTemplates.fill('${Artist}/${Title}');
  await preferenceSearch.fill('  PAUSE interval seconds ');
  await preferences().getByLabel('Pause Interval (seconds)').waitFor();
  assert.deepEqual(await preferences().locator('.settings-groups > details:visible > summary').allTextContents(), ['Audio & Display']);
  assert.equal(await draftTemplates.isVisible(), false);
  await preferenceSearch.fill('no setting matches this exact phrase');
  await preferences().getByText('No preferences match your search.').waitFor();
  await preferenceSearch.fill('');
  assert.equal(await draftTemplates.isVisible(), false);
  await preferences().locator('summary').filter({ hasText: /^Library & Sources$/ }).click();
  assert.equal(await draftTemplates.inputValue(), '${Artist}/${Title}');
  await draftTemplates.fill(priorTemplateValue);
  await preferences().locator('summary').filter({ hasText: /^Library & Sources$/ }).click();
  await closePreferences();

  // Requested defaults open settings/help from a normal focused host window.
  for (const key of ['Control+,', 'Meta+,', 'Alt+,']) { await host.keyboard.press(key); await preferences().waitFor(); await closePreferences(); }
  for (const key of ['Control+/', 'Meta+/', 'F1']) { await openShortcuts(key); await closePreferences(); }
  const search = host.getByRole('searchbox', { name: 'Search library' });
  await search.fill('typing'); await search.press('Space'); assert.equal(await search.inputValue(), 'typing ');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);

  // Repeated deep links must reopen a section collapsed since the last request.
  await openShortcuts();
  await preferences().locator('[data-settings-section="keyboard-shortcuts"] > summary').click();
  await host.keyboard.press('F1'); await requireSection('keyboard-shortcuts');
  await screenshot('keyboard-shortcuts-wide.png');
  let editor = preferences().getByRole('region', { name: 'Keyboard Shortcut Editor' });
  await editor.getByRole('button', { name: 'Change Spacebar for Play/Pause', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Record Shortcut for Play/Pause' }).press('Control+Alt+p');
  await capture('Search Song Library', 'Control+Alt+s');
  await capture('Search Song Library', 'Control+Shift+s');
  await capture('Search Song Library', 'g');
  await editor.getByRole('button', { name: 'Add Shortcut for Play/Pause', exact: true }).click();
  const conflicting = editor.getByRole('textbox', { name: 'Record Shortcut for Play/Pause' });
  await conflicting.press('Control+f'); await editor.getByRole('alert').filter({ hasText: 'Conflicting shortcut' }).waitFor();
  await conflicting.press('F1'); await editor.getByRole('alert').filter({ hasText: 'Open Keyboard Shortcuts' }).waitFor();
  assert.equal(await preferences().count(), 1, 'Recording help/search keys cannot navigate or open a second modal.');
  await editor.getByRole('button', { name: 'Cancel Recording' }).click();
  await editor.getByRole('button', { name: 'Remove Delete from Remove Selected Queue Request', exact: true }).click();
  await capture('Restart Current Song', 'Delete');
  await editor.getByRole('button', { name: 'Save Shortcuts', exact: true }).click();
  await editor.getByRole('status').filter({ hasText: 'Keyboard shortcuts saved.' }).waitFor();
  const saved = JSON.parse(await readFile(join(profile, 'keybindings.json'), 'utf8'));
  assert.deepEqual(saved.playPause, ['Control+Alt+KeyP']);
  assert.ok(saved.search.includes('Control+Alt+KeyS') && saved.search.includes('Control+Shift+KeyS') && saved.search.includes('KeyG'));
  assert.deepEqual(saved.previous, ['Delete']); assert.deepEqual(saved.removeRequest, []);
  await editor.getByRole('button', { name: 'Edit custom shortcuts', exact: true }).click();
  await untilApp((_electron, path) => globalThis.workspaceQa.openedFiles.includes(path), join(profile, 'keybindings.json'));
  await closePreferences();
  await search.fill('typing'); await search.press('g'); assert.equal(await search.inputValue(), 'typingg', 'Bare custom navigation keys must preserve text entry.');
  await host.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Sources', exact: true }).click();
  await host.keyboard.press('Control+Alt+s');
  assert.equal(await search.evaluate(element => document.activeElement === element), true);

  // Import only the generated fixture, then verify remapped Delete cannot remove it.
  await app.evaluate((_electron, file) => { globalThis.workspaceQa.nextOpenFile = file; }, fixture);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await untilHost(async () => (await window.tpv.imports.status())?.phase === 'completed');
  await search.fill('');
  const song = host.getByRole('listbox', { name: 'Songs', exact: true }).getByRole('option').first();
  const star = song.getByRole('button', { name: 'Star Workspace Shortcuts in KJ Picks', exact: true });
  await star.click();
  await song.getByRole('button', { name: 'Remove Workspace Shortcuts from KJ Picks', pressed: true }).waitFor();
  assert.equal(await host.getByRole('dialog', { name: 'Add to Queue', exact: true }).count(), 0);
  assert.equal((await host.evaluate(() => window.tpv.getState())).requests.length, 0);
  assert.equal(await song.getByRole('button', { name: /^Rate / }).count(), 0);
  await song.dblclick({ position: { x: 10, y: 10 } });
  await host.getByRole('dialog', { name: 'Add to Queue', exact: true }).waitFor();
  await host.getByRole('dialog', { name: 'Add to Queue', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  const versionId = (await host.evaluate(() => window.tpv.getState())).versions[0].id;
  await host.evaluate(async id => {
    for (const command of [{ type: 'addSinger', singer: { id: 'shortcut-singer', name: 'Shortcut Singer' } }, { type: 'request', requestId: 'shortcut-request', singerId: 'shortcut-singer', versionId: id }]) {
      const result = await window.tpv.command(command); if (!result.ok) throw Error(result.error);
    }
  }, versionId);
  const queue = host.getByRole('listbox', { name: 'Singer Rotation', exact: true });
  await queue.getByRole('option').first().click(); await host.keyboard.press('Delete');
  assert.ok(['accepted', 'staged'].includes((await host.evaluate(() => window.tpv.getState())).requests.find(value => value.id === 'shortcut-request').status));
  await app.close(); app = undefined;

  // Cold CLI deep link, persisted editor values, and default reset.
  await launch('--keybindings'); await requireSection('keyboard-shortcuts');
  assert.deepEqual((await host.evaluate(() => window.tpv.getShortcuts())).shortcuts, saved);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  editor = preferences().getByRole('region', { name: 'Keyboard Shortcut Editor' });
  await editor.getByRole('button', { name: 'Reset to Defaults', exact: true }).click();
  await editor.getByRole('status').filter({ hasText: 'Default keyboard shortcuts restored.' }).waitFor();
  const reset = (await host.evaluate(() => window.tpv.getShortcuts())).shortcuts;
  assert.deepEqual(reset.playPause, ['Space']); assert.deepEqual(reset.removeRequest, ['Delete']); assert.deepEqual(reset.previous, []);
  await closePreferences();
  const persistedStar = host.getByRole('button', { name: 'Remove Workspace Shortcuts from KJ Picks', pressed: true });
  await persistedStar.click();
  await host.getByRole('button', { name: 'Star Workspace Shortcuts in KJ Picks', pressed: false }).waitFor();
  assert.equal((await host.evaluate(() => window.tpv.getCollections())).items.length, 0);
  await host.getByRole('listbox', { name: 'Singer Rotation', exact: true }).getByRole('option').first().click(); await host.keyboard.press('Delete');
  await untilHost(async () => (await window.tpv.getState()).requests.find(value => value.id === 'shortcut-request')?.status === 'removed');

  const nav = host.getByRole('navigation', { name: 'Workspace' });
  assert.equal(await nav.getByRole('button', { name: /Back up show/ }).count(), 0);
  const sources = nav.getByRole('button', { name: 'Sources', exact: true }); await sources.click();
  await host.getByRole('heading', { name: 'Sources', exact: true }).waitFor();
  await host.getByRole('textbox', { name: 'YouTube video link' }).waitFor();
  await host.getByRole('heading', { name: 'Third-Party Services', exact: true }).waitFor();
  await screenshot('sources-workspace.png');
  if (screenshotDirectory) {
    await host.locator('.main-panel').evaluate(element => element.scrollTo(0, element.scrollHeight));
    await screenshot('sources-services.png');
    await host.locator('.main-panel').evaluate(element => element.scrollTo(0, 0));
  }
  assert.ok(await sources.evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 16 && Number(getComputedStyle(element).fontWeight) >= 700));
  assert.ok((await nav.getByRole('button', { name: 'Requests', exact: true }).boundingBox()).y > (await sources.boundingBox()).y);

  // Actual native menu callbacks route through the shared action bus.
  for (const [label, expected] of [['Import Video…', 'Import local MP4 files'], ['Import Folder…', 'Import MP4 folder'], ['Import CD+G / LRC / ZIP…', 'Import CD+G, LRC or ZIP']]) {
    const before = await app.evaluate((_electron, title) => globalThis.workspaceQa.dialogs.filter(value => value.title === title).length, expected);
    await clickMenu(['File', label]);
    await untilApp((_electron, value) => globalThis.workspaceQa.dialogs.filter(item => item.title === value.title).length > value.before, { title: expected, before });
  }
  await clickMenu(['File', 'Back up show…']);
  await untilApp(() => globalThis.workspaceQa.dialogs.some(value => value.kind === 'save' && value.title === 'Back up show to a new file'));
  await clickMenu(['View', 'Appearance', 'Appearance Settings…']); await requireSection('appearance');
  await preferences().locator('summary').filter({ hasText: /^Audio & Display$/ }).click();
  await preferences().getByLabel('Pause Interval (seconds)').fill('3');
  await clickMenu(['View', 'Choose Accent Color', 'Pink']);
  await untilHost(async () => (await window.tpv.getSettings()).settings.accentColor === 'pink');
  await untilHost(() => document.querySelector('dialog[open] select[aria-label="Accent Color"]')?.value === 'pink');
  assert.equal(await preferences().getByRole('combobox', { name: 'Accent Color', exact: true }).inputValue(), 'pink');
  assert.equal(await preferences().getByLabel('Pause Interval (seconds)').inputValue(), '3', 'Menu preference changes must retain unrelated unsaved edits.');
  await clickMenu(['View', 'Appearance', 'Day']);
  await untilHost(async () => (await window.tpv.getSettings()).settings.appearance === 'day');
  await clickMenu(['View', 'Layout', 'Wide Song Library']);
  await untilHost(async () => (await window.tpv.getSettings()).settings.layout === 'library');
  await closePreferences();
  assert.equal((await host.evaluate(() => window.tpv.getSettings())).settings.pauseIntervalSeconds, 0);
  await host.getByRole('button', { name: 'Appearance', exact: true }).click(); await requireSection('appearance'); await closePreferences();
  await clickMenu(['Help', 'Keyboard Shortcuts']); await requireSection('keyboard-shortcuts'); await closePreferences();

  // The exact six filename templates previously rejected by Save Preferences.
  const templates = ['${DJ Code}-${Track Number} - ${Artist} - ${Title}', '${Artist}/${Artist} - ${Title}', '${Artist}/${Title}', '${Artist}/${Track Number}.${Title}', '${Track Number}.${Artist} - ${Title}', '${Artist}/${Track Number} - ${Artist} - ${Title}'];
  await host.keyboard.press('Control+,'); await preferences().waitFor();
  await preferences().locator('summary').filter({ hasText: /^Library & Sources$/ }).click();
  await preferences().getByLabel('Filename and folder templates, one per line').fill(templates.join('\n'));
  await preferences().getByRole('button', { name: 'Save preferences', exact: true }).click(); await preferences().waitFor({ state: 'hidden' });
  assert.deepEqual((await host.evaluate(() => window.tpv.getSettings())).settings.metadataTemplates, templates);

  // Focused player keys, plus requested settings/help shortcuts from that window.
  await host.keyboard.press('f');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), false);
  const [display] = await Promise.all([app.waitForEvent('window', { timeout: 15000 }), host.evaluate(() => window.tpv.openDisplay())]);
  await untilApp(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.getTitle().startsWith('Singer Display')));
  await display.waitForURL(url => url.pathname.endsWith('/display/index.html'), { waitUntil: 'load', timeout: 15000 });
  await waitForHostCondition(display, () => document.readyState === 'complete' && !!window.tpvDisplay && !!document.querySelector('#video'), undefined, { timeout: 10000, polling: 30 });
  await display.keyboard.press('f');
  await untilApp(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle().startsWith('Singer Display'))?.isFullScreen() === true);
  await display.keyboard.press('Shift+f');
  await untilApp(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle().startsWith('Singer Display'))?.isFullScreen() === false);
  for (const key of ['Control+,', 'Meta+,', 'Alt+,']) { await display.keyboard.press(key); await preferences().waitFor(); await closePreferences(); }
  for (const key of ['Control+/', 'Meta+/', 'F1']) { await display.keyboard.press(key); await requireSection('keyboard-shortcuts'); await closePreferences(); }

  // Real second processes must target the running app instead of another window.
  await secondary('--settings'); await preferences().waitFor(); await closePreferences();
  await secondary('--keybindings'); await requireSection('keyboard-shortcuts');
  await preferences().locator('[data-settings-section="keyboard-shortcuts"] > summary').click();
  await secondary('--keybindings'); await requireSection('keyboard-shortcuts');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  assert.deepEqual(pageErrors, []);
  console.log('Workspace shortcuts: cold and second-instance CLI routing, defaults, capture/conflicts/multiple bindings/reset/persistence, contextual Delete, text entry, native menus, Sources, metadata templates and player fullscreen verified in an isolated muted profile.');
} finally {
  for (const child of children) child.kill('SIGKILL');
  if (app) await app.close().catch(() => {});
  const actual = await realpath(temp);
  if (!actual.startsWith(root + sep) || dirname(actual) !== root || !actual.split(sep).at(-1)?.startsWith('tpv-workspace-qa-')) throw new Error('Unsafe workspace QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
