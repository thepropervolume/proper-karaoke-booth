/** Run only on a disposable Windows runner during installer verification. */
import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { waitForHostCondition } from './wait-for-host-condition.mjs';
import { waitForHostWindow } from './wait-for-host-window.mjs';

const [mode, executable, version] = process.argv.slice(2);
assert.equal(process.platform, 'win32');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.ok(['seed', 'verify'].includes(mode));
assert.match(version, /^\d+\.\d+\.\d+$/);
const root = await realpath(process.env.RUNNER_TEMP);
const profile = join(root, 'tpv-install-qa-profile');
const appPath = await realpath(resolve(executable));
assert.match(relative(root, appPath), /^tpv-install-qa-app\\[^\\]+\.exe$/i);
await mkdir(profile, { recursive: true });
const canonicalProfile = await realpath(profile);
assert.equal(canonicalProfile, profile);
const app = await electron.launch({ executablePath: appPath, args: [`--user-data-dir=${profile}`, '--mute-audio'], cwd: root });
try {
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const host = await waitForHostWindow(app);
  await waitForHostCondition(host, async () => !!window.tpv && !!(await window.tpv.getSettings()).path);
  if (mode === 'seed') {
    const result = await host.evaluate(() => window.tpv.command({ type: 'addSinger', singer: { id: 'installer-qa-singer', name: 'Installer QA Singer' } }));
    assert.equal(result.ok, true);
    await host.evaluate(() => window.tpv.saveSettings({ accentColor: 'purple', autoBumper: false }));
  }
  const state = await host.evaluate(() => window.tpv.getState());
  assert.ok(state.singers.some(singer => singer.id === 'installer-qa-singer'));
  assert.equal(state.playback, null);
  assert.equal(await host.evaluate(async () => (await window.tpv.getSettings()).settings.accentColor), 'purple');
  console.log(`Windows ${version}: ${mode} passed with a private QA profile and no autoplay.`);
} finally {
  await app.close();
}
