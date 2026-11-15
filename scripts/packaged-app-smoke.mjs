import { waitForHostWindow } from './wait-for-host-window.mjs';
// Verify the actual packaged application, using only a new disposable profile.
// Run after packaging: node scripts/packaged-app-smoke.mjs <executable>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
if (process.argv.length !== 3) throw new Error('Usage: node scripts/packaged-app-smoke.mjs <executable>');
const executablePath = await realpath(resolve(process.argv[2]));
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const temporaryRoot = await realpath(tmpdir());
const temp = await mkdtemp(join(temporaryRoot, 'tpv-packaged-qa-'));
const profile = join(temp, 'profile');
await mkdir(profile);
const canonicalProfile = await realpath(profile);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'),
  XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data') });
const args = [`--user-data-dir=${canonicalProfile}`, '--mute-audio'];
let app;
const launch = async () => {
  const instance = await electron.launch({ executablePath, args, cwd: temp, env, timeout: 30000 });
  try {
    const identity = await instance.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), profile: app.getPath('userData'), entry: app.getAppPath() }));
    assert.equal(identity.packaged, true);
    assert.equal(identity.version, metadata.version);
    assert.equal(await realpath(identity.profile), canonicalProfile, 'Refusing to use any non-disposable profile.');
    assert.ok(identity.entry.endsWith('app.asar'));
    return instance;
  } catch (error) { await instance.close(); throw error; }
};
try {
  app = await launch();
  let host = await waitForHostWindow(app);
  await host.waitForFunction(() => !!window.tpv);
  assert.equal(await host.evaluate(() => window.tpv.getAppVersion()), metadata.version);
  await host.getByLabel('Application version').waitFor();
  assert.equal(await host.getByLabel('Application version').innerText(), `v${metadata.version}`);
  const initial = await host.evaluate(() => window.tpv.getState());
  assert.equal(initial.versions.length, 0);
  assert.equal(initial.playback, null);
  const result = await host.evaluate(() => window.tpv.command({ type: 'addSinger', singer: { id: 'packaged-qa', name: 'Packaged QA Singer' } }));
  assert.equal(result.ok, true);
  await app.close(); app = undefined;
  app = await launch();
  host = await waitForHostWindow(app);
  await host.waitForFunction(() => !!window.tpv);
  const restored = await host.evaluate(() => window.tpv.getState());
  assert.ok(restored.singers.some(singer => singer.id === 'packaged-qa' && singer.name === 'Packaged QA Singer'));
  assert.equal(restored.playback, null);
  console.log(`Packaged ${metadata.version}: host UI opened, explicit disposable profile was honored, singer persisted after restart, playback stayed stopped.`);
} finally {
  if (app) await app.close();
  const actual = await realpath(temp);
  if (!actual.startsWith(temporaryRoot + sep) || dirname(actual) !== temporaryRoot || !actual.split(sep).at(-1)?.startsWith('tpv-packaged-qa-')) throw new Error('Unsafe packaged QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
