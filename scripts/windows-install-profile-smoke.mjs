/** Run only on a disposable Windows runner during installer verification. */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

function checkedSchema(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const check = db.prepare('PRAGMA integrity_check').get();
    assert.equal(check.integrity_check, 'ok');
    return db.prepare('PRAGMA user_version').get().user_version;
  } finally { db.close(); }
}

const schema = checkedSchema(join(profile, 'show.sqlite'));
const baseline = join(profile, 'installer-qa-baseline.json');
if (mode === 'seed') await writeFile(baseline, JSON.stringify({ schema }), { flag: 'wx' });
else {
  const before = JSON.parse(await readFile(baseline, 'utf8')).schema;
  assert.ok(Number.isSafeInteger(before) && schema >= before);
  if (schema > before) {
    const backups = join(profile, 'show-upgrade-backups');
    const snapshot = (await readdir(backups)).find(name => name.endsWith('.sqlite'));
    assert.ok(snapshot, 'An upgraded installed show must keep its previous schema snapshot.');
    assert.equal(checkedSchema(join(backups, snapshot)), before);
    console.log(`Verified the pre-upgrade schema ${before} backup after migration to schema ${schema}.`);
  }
}
