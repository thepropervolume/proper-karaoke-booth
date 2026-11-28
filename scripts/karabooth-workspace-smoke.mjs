// Disposable Windows Electron rehearsal. Build the app first with npm run build.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const repository = await realpath(resolve('.'));
const require = createRequire(join(repository, 'package.json'));
const { _electron: electron } = require('playwright-core');
const tempRoot = await realpath(tmpdir()), temporary = await mkdtemp(join(tempRoot, 'karabooth-workspace-'));
const profile = join(temporary, 'profile'), exported = join(temporary, 'karaoke-config.json');
let app;
try {
  await mkdir(profile);
  const canonicalProfile = await realpath(profile);
  const bootstrap = join(temporary, 'bootstrap.cjs');
  await writeFile(bootstrap, `const {app,dialog,session,shell}=require('electron');
app.setAppPath(process.env.TPV_QA_REPO);
app.setPath('userData',process.env.TPV_QA_PROFILE);
globalThis.fetch=async()=>{throw Error('Network disabled for workspace QA');};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true})));
dialog.showSaveDialog=async()=>({canceled:false,filePath:process.env.TPV_QA_EXPORT});
dialog.showMessageBox=async()=>({response:0});
shell.showItemInFolder=path=>{globalThis.tpvRevealed=path;};
require(process.env.TPV_QA_ENTRY);`);
  const env = { ...process.env, TPV_QA_REPO: repository, TPV_QA_PROFILE: canonicalProfile, TPV_QA_EXPORT: exported,
    TPV_QA_ENTRY: join(repository, 'dist/main/index.cjs'), APPDATA: join(temporary, 'appdata'), LOCALAPPDATA: join(temporary, 'local'), XDG_CONFIG_HOME: join(temporary, 'linux') };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = async () => {
    app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, '--mute-audio'], env, cwd: repository });
    assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
    return waitForHostWindow(app);
  };
  const clickMenu = async (menu, label) => app.evaluate(({ Menu, BrowserWindow }, { menu, label }) => {
    const item = Menu.getApplicationMenu()?.items.find(item => item.label === menu)?.submenu?.items.find(item => item.label === label);
    if (!item?.enabled) throw Error(`Missing enabled menu item ${menu} → ${label}`);
    item.click({}, BrowserWindow.getFocusedWindow(), {});
  }, { menu, label });
  let host = await launch();
  const setup = host.getByRole('dialog', { name: 'Set up KaraBooth' });
  await setup.getByLabel('DJ or brand name').fill('QA Karaoke Collective');
  await setup.getByLabel('Host handle').fill('qa-karaoke');
  await setup.getByRole('button', { name: 'Continue' }).click();
  await setup.waitFor({ state: 'detached' });
  assert.equal(await host.evaluate(async () => (await window.tpv.internetSessions.status()).suggestedSlug), 'qa-karaoke');
  await clickMenu('View', 'Zoom In');
  await waitForHostCondition(host, () => document.documentElement.style.zoom === '1.1');
  await clickMenu('File', 'Export Current Configuration…');
  await waitForHostCondition(host, async () => (await window.tpv.getSettings()).settings.hostZoom === 110);
  const bundle = JSON.parse(await readFile(exported, 'utf8'));
  assert.equal(bundle.preferences.hostZoom, 110);
  assert.equal(bundle.preferences.hostHandle, 'qa-karaoke');
  await host.getByRole('button', { name: 'Preferences', exact: true }).click();
  await host.locator('summary').filter({ hasText: /^Configuration Files$/ }).click();
  await host.getByRole('button', { name: 'Show Diagnostic Log in File Manager' }).click();
  assert.equal(await app.evaluate(() => globalThis.tpvRevealed), join(canonicalProfile, 'karabooth.log'));
  assert.match(await readFile(join(canonicalProfile, 'karabooth.log'), 'utf8'), /"event":"startup"/);
  await app.close(); app = undefined;
  host = await launch();
  await waitForHostCondition(host, () => document.documentElement.style.zoom === '1.1');
  assert.equal(await host.getByRole('dialog', { name: 'Set up KaraBooth' }).count(), 0);
  await clickMenu('View', 'Reset Zoom');
  await waitForHostCondition(host, () => document.documentElement.style.zoom === '1');
  console.log('PASS: first-run host details, room suggestion, configuration export, local diagnostics and persisted zoom.');
} finally {
  await app?.close();
  if (dirname(await realpath(temporary)) === tempRoot) await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
}
