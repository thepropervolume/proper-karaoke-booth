// Real packaged application, synthetic files, isolated temporary profile; never reads user media.
// Usage: node scripts/packaged-directory-import-smoke.mjs <packaged-executable>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 3) throw new Error('Usage: node scripts/packaged-directory-import-smoke.mjs <packaged-executable>');
const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const executablePath = await realpath(resolve(process.argv[2]));
const { _electron: electron } = createRequire(join(repo, 'package.json'))('playwright-core');
const temporaryRoot = await realpath(tmpdir());
const temp = await mkdtemp(join(temporaryRoot, 'tpv-packaged-import-'));
const profile = join(temp, 'profile'), directory = join(temp, 'synthetic-video'), nested = join(directory, 'artist');
await mkdir(profile); await mkdir(nested, { recursive: true });
await writeFile(join(directory, 'Artist - One.mp4'), 'synthetic mp4 fingerprint fixture one');
await writeFile(join(nested, 'Artist - Two.MP4'), 'synthetic mp4 fingerprint fixture two');
await writeFile(join(nested, 'ignored.txt'), 'not a video');
const canonicalProfile = await realpath(profile);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data') });
let app;
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${canonicalProfile}`, '--mute-audio'], cwd: temp, env, timeout: 30000 });
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData'), entry: app.getAppPath() }));
  assert.equal(identity.packaged, true); assert.ok(identity.entry.endsWith('app.asar'));
  assert.equal(await realpath(identity.profile), canonicalProfile, 'Refusing to use any non-disposable profile.');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, directory);
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.imports);
  assert.equal((await host.evaluate(() => window.tpv.getState())).versions.length, 0);
  await host.getByRole('button', { name: 'Import Custom Directory', exact: true }).click();
  let status;
  for (let n = 0; n < 600; n++) {
    status = await host.evaluate(() => window.tpv.imports.status());
    if (status && ['completed', 'failed', 'cancelled'].includes(status.phase)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(status, 'Import status did not appear.');
  assert.equal(status.phase, 'completed'); assert.equal(status.imported, 2); assert.equal(status.failed, 0);
  assert.equal((await host.evaluate(() => window.tpv.getState())).versions.length, 2);
  console.log('PASS: packaged app imported two synthetic files recursively via native-folder-picker flow in an isolated profile. Files were not decoded or played.');
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(temp);
  if (dirname(actual) !== temporaryRoot || !actual.startsWith(temporaryRoot + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-packaged-import-')) throw new Error('Unsafe packaged QA cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
