// Read-only/native-key probe in a disposable profile. Never uses the clipboard.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
if (process.argv.length > 3 || process.argv[2] && process.argv[2] !== '--assert') throw Error('Usage: node scripts/native-menu-shortcut-probe.mjs [--assert]');
const require = createRequire(join(repo, 'package.json')), { _electron: electron } = require('playwright-core');
const root = await realpath(tmpdir()), temp = await mkdtemp(join(root, 'tpv-native-menu-probe-')), profile = join(temp, 'profile');
await mkdir(profile); await writeFile(join(profile, 'settings.json'), JSON.stringify({ sharedCatalogEnabled: false }));
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.TPV_NATIVE_QA_PROFILE);app.setAppPath(process.env.TPV_NATIVE_QA_REPO);if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_NATIVE_QA_PROFILE))throw Error('Unsafe probe profile');globalThis.fetch=async()=>new Response('QA offline',{status:503});require(process.env.TPV_NATIVE_QA_ENTRY);`);
const env = { ...process.env, TPV_NATIVE_QA_PROFILE: profile, TPV_NATIVE_QA_REPO: repo, TPV_NATIVE_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')),
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio', '--keybindings'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  const host = await app.firstWindow();
  await waitForHostCondition(host, () => !!document.querySelector('dialog[open] [data-settings-section="keyboard-shortcuts"][open]'));
  await host.evaluate(() => { window.nativeMenuProbe = { keys: [] }; addEventListener('keydown', event => {
    if (event.code === 'KeyA' && event.ctrlKey) window.nativeMenuProbe.keys.push({ code: event.code, target: event.target?.tagName, recording: event.target?.hasAttribute('data-shortcut-capture') });
  }, true); });
  const editor = host.getByRole('region', { name: 'Keyboard Shortcut Editor' });
  await editor.getByRole('button', { name: 'Add Shortcut for Search Song Library', exact: true }).click();
  const recorder = editor.getByRole('textbox', { name: 'Record Shortcut for Search Song Library' });
  await recorder.press('Control+a');
  await host.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const captured = await editor.getByRole('button', { name: 'Change Ctrl+A for Search Song Library', exact: true }).count() === 1;
  if (captured) {
    await editor.getByRole('button', { name: 'Save Shortcuts', exact: true }).click();
    await editor.getByRole('status').filter({ hasText: 'Keyboard shortcuts saved.' }).waitFor();
  } else {
    await editor.getByRole('button', { name: 'Cancel Recording', exact: true }).click();
    // Continue the dispatch/editing observations even if native interception
    // prevented UI capture; this setup affects only the disposable profile.
    await host.evaluate(async () => { const { shortcuts } = await window.tpv.getShortcuts(); await window.tpv.saveShortcuts({ ...shortcuts, search: [...shortcuts.search, 'Control+KeyA'] }); });
  }
  const saved = (await host.evaluate(() => window.tpv.getShortcuts())).shortcuts.search.includes('Control+KeyA');
  await host.getByRole('dialog', { name: 'Preferences', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await host.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Sources', exact: true }).click();
  await host.getByRole('heading', { name: 'Sources', exact: true }).waitFor();
  await host.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
  await host.keyboard.press('Control+a');
  await host.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dispatchedFromBody = await host.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search library');
  await host.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Library', exact: true }).click();
  const search = host.getByRole('searchbox', { name: 'Search library' });
  await search.fill('Native editing probe'); await search.press('End'); await search.press('Control+a');
  const selection = await search.evaluate(element => ({ start: element.selectionStart, end: element.selectionEnd, length: element.value.length }));
  const selectedText = selection.start === 0 && selection.end === selection.length;
  const keys = await host.evaluate(() => window.nativeMenuProbe.keys);
  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === 'Edit')?.submenu?.items.map(item => ({ role: item.role, accelerator: item.accelerator ?? null })));
  console.log(JSON.stringify({ capturedInEditor: captured, setup: captured ? 'editor' : 'IPC fallback after failed editor capture', saved, dispatchedFromBody, selectedTextInInput: selectedText, selection, receivedCtrlAEvents: keys, nativeEditMenu: menu }, null, 2));
  if (process.argv[2] === '--assert') {
    assert.ok(menu.some(item => item.role === 'selectall'), 'The native Edit menu must contain Select All for this probe.');
    assert.ok(captured && saved, 'Ctrl+A must be recordable and save through the editor.');
    assert.ok(dispatchedFromBody, 'A custom Ctrl+A must dispatch from a non-editing body target.');
    assert.ok(selectedText, 'Ctrl+A must retain Select All inside ordinary text entry.');
  }
} finally {
  if (app) await app.close();
  const actual = await realpath(temp);
  if (dirname(actual) !== root || !actual.startsWith(root + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-native-menu-probe-')) throw Error('Unsafe native probe cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
