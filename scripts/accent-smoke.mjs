// Run after building: node scripts/accent-smoke.mjs
// Uses a disposable profile and never opens the host's real show database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const repo = await realpath(resolve('.'));
const requireFromRepo = createRequire(join(repo, 'package.json'));
const { _electron: electron } = requireFromRepo('playwright-core');
const executablePath = requireFromRepo('electron');
const tempRoot = await realpath(tmpdir());
const temp = await mkdtemp(join(tempRoot, 'tpv-accent-qa-'));
const profile = join(temp, 'profile');
await mkdir(profile);
const canonicalProfile = await realpath(profile);
const entry = await realpath(join(repo, 'dist/main/index.cjs'));
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(join(profile, 'settings.json'), JSON.stringify({ appearance: 'night' }));
await writeFile(bootstrap, `const { app } = require('electron');\nconst fs = require('node:fs');\napp.setPath('userData', process.env.TPV_QA_PROFILE);\nif (fs.realpathSync(app.getPath('userData')) !== fs.realpathSync(process.env.TPV_QA_PROFILE)) throw new Error('Unsafe profile');\nrequire(process.env.TPV_QA_ENTRY);\n`);
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: entry,
  XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data'),
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
try {
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const host = await app.firstWindow();
  await host.waitForFunction(() => document.documentElement.dataset.accent === 'blue' && document.documentElement.dataset.theme === 'night');
  const accent = async () => host.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  assert.equal(await accent(), '#0eb7ff');
  for (const [current, next, expected] of [['blue', 'pink', '#ff92bf'], ['pink', 'purple', '#c7adff'], ['purple', 'blue', '#0eb7ff']]) {
    await host.getByRole('button', { name: `Accent color: ${current}. Switch to ${next}` }).click();
    await host.waitForFunction(value => document.documentElement.dataset.accent === value, next);
    assert.equal(await accent(), expected);
  }
  await host.getByRole('button', { name: 'Preferences', exact: true }).click();
  await host.locator('details').filter({ has: host.locator('summary', { hasText: 'Appearance' }) }).locator('select').first().selectOption('day');
  await host.getByRole('button', { name: 'Save preferences' }).click();
  await host.waitForFunction(() => document.documentElement.dataset.theme === 'day');
  await host.getByRole('button', { name: 'Accent color: blue. Switch to pink' }).click();
  await host.waitForFunction(() => document.documentElement.dataset.accent === 'pink');
  assert.equal(await accent(), '#a91e5c');
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, args, cwd: repo, env, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const reopened = await app.firstWindow();
  await reopened.waitForFunction(() => document.documentElement.dataset.accent === 'pink' && document.documentElement.dataset.theme === 'day');
  console.log('Accent button cycles, switches themes, and persists across restart.');
} finally {
  if (app) await app.close();
  // Delete only the test directory we created under the verified temporary root.
  if (temp.startsWith(tempRoot + sep) && (await realpath(temp)) === temp) await rm(temp, { recursive: true, force: true });
}
