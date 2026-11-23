// Real loopback API and compiled CLI; only a private, disposable muted show.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const repo = await realpath(resolve('.')), root = await realpath(tmpdir());
const require = createRequire(join(repo, 'package.json')), { _electron: electron } = require('playwright-core');
if (process.argv.length > 3) throw new Error('Usage: node scripts/local-control-app-smoke.mjs [packaged-executable]');
const packagedExecutable = process.argv[2] ? await realpath(resolve(process.argv[2])) : null;
const queueMedia = process.env.TPV_CONTROL_QUEUE_MEDIA && await realpath(resolve(process.env.TPV_CONTROL_QUEUE_MEDIA));
const run = promisify(execFile), temp = await mkdtemp(join(root, 'tpv-control-app-'));
const profile = join(temp, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile), discoveryFile = join(profile, 'control-api.json');
await writeFile(join(profile, 'settings.json'), JSON.stringify({ sharedCatalogEnabled: false }));
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.TPV_QA_PROFILE);app.setAppPath(process.env.TPV_QA_REPO);if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile');globalThis.fetch=async()=>{throw Error('External service access disabled in this rehearsal');};require(process.env.TPV_QA_ENTRY);`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_REPO: repo,
  TPV_QA_ENTRY: packagedExecutable ? '' : await realpath(join(repo, 'dist/main/index.cjs')), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'),
  XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const cli = async (...args) => {
  try {
    let executable = process.execPath, parameters = [join(repo, 'dist/control/cli.cjs'), '--profile-dir', canonicalProfile, ...args];
    if (packagedExecutable) {
      const wrapper = join(dirname(packagedExecutable), process.platform === 'win32' ? 'tpv-karaoke.cmd' : 'tpv-karaoke');
      parameters = ['--profile-dir', canonicalProfile, ...args];
      if (process.platform === 'win32') {
        executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
        const quote = value => "'" + value.replaceAll("'", "''") + "'";
        const command = `& ${[wrapper, ...parameters].map(quote).join(' ')}; exit $LASTEXITCODE`;
        parameters = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')];
      } else executable = wrapper;
    }
    const result = await run(executable, parameters, { windowsHide: true, timeout: 20000, maxBuffer: 3 * 1024 * 1024 });
    return { code: 0, out: result.stdout, err: result.stderr };
  }
  catch (error) { if (typeof error.code !== 'number') throw error; return { code: error.code, out: error.stdout, err: error.stderr }; }
};
const successful = async (...args) => { const result = await cli(...args); assert.equal(result.code, 0, result.err); const body = JSON.parse(result.out); assert.equal(body.ok, true); return body; };
const launch = async (navigationFlags = []) => {
  app = await electron.launch({ executablePath: packagedExecutable || require('electron'), args: [...(packagedExecutable ? [] : [bootstrap]), `--user-data-dir=${canonicalProfile}`, '--mute-audio', ...navigationFlags], cwd: repo, env });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), !!packagedExecutable);
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const page = await waitForHostWindow(app); await page.waitForFunction(() => !!window.tpv);
  await waitForHostCondition(page, async () => !!(await window.tpv.getSettings()).path);
  return page;
};
const toggle = async (page, value, queueEnabled = false) => {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const section = page.locator('summary').filter({ hasText: /^Local API and CLI$/ });
  if (!await section.evaluate(element => element.parentElement.open)) await section.click();
  await page.getByRole('checkbox', { name: 'Enable Local API and CLI', exact: true }).setChecked(value);
  if (queueEnabled) await page.getByRole('checkbox', { name: 'Allow Local API to change the queue', exact: true }).setChecked(true);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences', exact: true }).waitFor({ state: 'hidden' });
  await waitForHostCondition(page, async expected => (await window.tpv.getLocalControlStatus()).status === expected, value ? 'ready' : 'disabled');
};
try {
  let host = await launch();
  await host.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = host.getByRole('dialog', { name: 'Preferences', exact: true });
  await preferences.locator('summary').filter({ hasText: /^Local API and CLI$/ }).click();
  assert.match(await preferences.getByText('tpv-karaoke-booth --help', { exact: true }).innerText(), /tpv-karaoke-booth/);
  const helpWindow = app.waitForEvent('window');
  await preferences.getByRole('button', { name: 'Local API and CLI documentation', exact: true }).click();
  const help = await helpWindow;
  await help.waitForURL('**/index.html#local-control-api', { waitUntil: 'domcontentloaded' });
  await help.locator('article').getByRole('heading', { name: /Local .*CLI/ }).first().waitFor();
  await help.close();
  await preferences.getByRole('button', { name: 'Close preferences' }).click();
  await preferences.waitFor({ state: 'hidden' });
  assert.equal((await host.evaluate(() => window.tpv.getLocalControlStatus())).status, 'disabled');
  await assert.rejects(access(discoveryFile));
  assert.equal((await cli('status')).code, 3);
  assert.equal((await cli('--help')).code, 0);
  await toggle(host, true);
  const initialDiscovery = JSON.parse(await readFile(discoveryFile, 'utf8'));
  const status = await successful('status'); assert.equal(status.status, 'ready'); assert.equal(status.result.completeApplicationControl, false);
  assert.equal(status.result.apiVersion, 1);
  assert.equal((await successful('state')).result.playback, null);
  assert.equal((await successful('shortcuts')).result.keybindings.includes('F1'), true);
  const settings = await successful('settings'); assert.equal(settings.result.settings.localControlEnabled, true);
  assert.ok(Array.isArray(settings.result.redactedFields));
  assert.equal(settings.result.settings.ratingProfileConfigFile, '');
  const added = await host.evaluate(() => window.tpv.command({ type: 'addSinger', singer: { id: 'control-smoke-singer', name: 'Control Smoke Singer' } }));
  assert.equal(added.ok, true);
  assert.ok((await successful('state')).result.singers.some(singer => singer.id === 'control-smoke-singer'));
  let queueCommand;
  if (queueMedia) {
    // Supply an explicitly generated test file to the real import flow.
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, queueMedia);
    await host.evaluate(() => window.tpv.importFiles('files'));
    await waitForHostCondition(host, async () => (await window.tpv.getState()).versions.length === 1);
    const imported = await successful('state');
    if (status.result.reads.includes('library')) {
      const confirmed = (await successful('library', imported.result.versions[0].artist)).result;
      assert.deepEqual(confirmed.items.map(song => song.id), [imported.result.versions[0].id]);
      assert.ok(!JSON.stringify(confirmed).includes(queueMedia));
    }
    const { showId, hostEpoch, revision } = (await successful('queue')).result;
    queueCommand = JSON.stringify({ commandId: randomUUID(), showId, hostEpoch, expectedRevision: revision,
      command: { type: 'request', versionId: imported.result.versions[0].id, requestId: 'control-cli-queue-request', singerId: 'control-smoke-singer' } });
    assert.equal((await cli('queue', 'command', queueCommand)).code, 6, 'Prior API opt-in must not enable queue writes.');
    await toggle(host, true, true);
    const accepted = await successful('queue', 'command', queueCommand);
    assert.equal(accepted.result.ok, true);
    assert.deepEqual((await successful('queue', 'command', queueCommand)).result, accepted.result);
    assert.deepEqual((await successful('queue')).result.requests.map(request => request.id), ['control-cli-queue-request']);
    assert.equal((await successful('state')).result.playback, null);
  }
  await successful('open', 'keybindings');
  await host.getByRole('dialog', { name: 'Preferences', exact: true }).waitFor();
  assert.equal(await host.locator('[data-settings-section="keyboard-shortcuts"]').evaluate(element => element.open), true);
  await host.getByRole('button', { name: 'Cancel', exact: true }).click();
  await successful('open', 'settings'); await host.getByRole('dialog', { name: 'Preferences', exact: true }).waitFor();
  await host.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await cli('play')).code, 2, 'Unsupported mutation must be refused, never guessed.');
  const unauthorized = await fetch(`http://127.0.0.1:${initialDiscovery.port}/v1/state`); assert.equal(unauthorized.status, 401);
  await unauthorized.body?.cancel();
  await app.close(); app = undefined;
  await assert.rejects(access(discoveryFile));
  host = await launch();
  await waitForHostCondition(host, async () => (await window.tpv.getLocalControlStatus()).status === 'ready');
  const restarted = JSON.parse(await readFile(discoveryFile, 'utf8'));
  assert.notEqual(restarted.token, initialDiscovery.token); assert.notEqual(restarted.instanceId, initialDiscovery.instanceId);
  const stale = await fetch(`http://127.0.0.1:${restarted.port}/v1/state`, { headers: { Authorization: `Bearer ${initialDiscovery.token}` } });
  assert.equal(stale.status, 401); await stale.body?.cancel();
  assert.ok((await successful('state')).result.singers.some(singer => singer.id === 'control-smoke-singer'));
  if (queueCommand) {
    assert.deepEqual((await successful('queue')).result.requests.map(request => request.id), ['control-cli-queue-request']);
    const prior = await cli('queue', 'command', queueCommand);
    assert.equal(prior.code, 5);
    assert.equal(JSON.parse(prior.err).result.code, 'STALE_SHOW');
  }
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  await toggle(host, false); await assert.rejects(access(discoveryFile));
  assert.equal((await cli('status')).code, 3);
  if (packagedExecutable) {
    // The desktop launch aliases must also work while the control API is off.
    const wrapper = join(dirname(packagedExecutable), process.platform === 'win32' ? 'tpv-karaoke.cmd' : 'tpv-karaoke');
    for (const flag of ['--settings', '--keybindings']) {
      const args = [flag, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
      if (process.platform === 'win32') {
        const quote = value => "'" + value.replaceAll("'", "''") + "'";
        const command = `& ${[wrapper, ...args].map(quote).join(' ')}; exit $LASTEXITCODE`;
        await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000 });
      } else await run(wrapper, args, { timeout: 20000 });
      await host.getByRole('dialog', { name: 'Preferences', exact: true }).waitFor();
      if (flag === '--keybindings') assert.equal(await host.locator('[data-settings-section="keyboard-shortcuts"]').evaluate(element => element.open), true);
      assert.equal((await app.windows()).length, 1, 'Navigation must focus the original host.');
      await host.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await app.close(); app = undefined;
    host = await launch(['--settings']);
    await host.getByRole('dialog', { name: 'Preferences', exact: true }).waitFor();
    assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  }
  console.log(`Local API/CLI: opt-in, private discovery, live reads/navigation, token rotation, restart and no autoplay passed.${queueCommand ? ' Queue opt-in, replay receipt, persistence and epoch fencing passed.' : ''}`);
} finally {
  if (app) await app.close();
  const actual = await realpath(temp);
  if (!actual.startsWith(root + sep) || dirname(actual) !== root || !actual.split(sep).at(-1)?.startsWith('tpv-control-app-')) throw new Error('Unsafe control rehearsal cleanup.');
  await rm(actual, { recursive: true, force: true });
}
