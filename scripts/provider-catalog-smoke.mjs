// Live public metadata, actual packaged application, disposable muted profile.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
const repo = await realpath(resolve('.')), require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
if (process.argv.length < 3 || process.argv.length > 4) throw Error('Usage: node scripts/provider-catalog-smoke.mjs <executable> [screenshots-directory]');
const executablePath = await realpath(resolve(process.argv[2]));
const parent = await realpath(tmpdir()), temp = await mkdtemp(join(parent, 'tpv-provider-smoke-'));
const profile = join(temp, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ sharedCatalogEnabled: false, providerCatalogEnabled: true }));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') });
let app;
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${canonicalProfile}`, '--mute-audio'], env, cwd: temp });
  const identity = await app.evaluate(({ app }) => ({ profile: app.getPath('userData'), packaged: app.isPackaged, version: app.getVersion() }));
  assert.equal(await realpath(identity.profile), canonicalProfile); assert.equal(identity.packaged, true);
  assert.equal(identity.version, JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).version);
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.tpv);
  await page.getByRole('searchbox', { name: 'Search library', exact: true }).fill('Radiohead');
  const group = page.getByRole('region', { name: 'KaraFun catalog results', exact: true });
  await group.getByRole('listitem').first().waitFor({ timeout: 65_000 });
  const party = page.getByRole('region', { name: 'Party Tyme catalog results', exact: true });
  assert.ok(await group.getByRole('listitem').count() > 0); assert.ok(await party.getByRole('listitem').count() > 0);
  const providerSection = page.getByRole('region', { name: 'Service catalog matches', exact: true });
  assert.equal(await providerSection.getByRole('button', { name: /queue|play|request/i }).count(), 0);
  const state = await page.evaluate(() => window.tpv.getState()); assert.equal(state.playback, null); assert.equal(state.versions.length, 0); assert.equal(state.requests.length, 0);
  const shots = process.argv[3] ? resolve(process.argv[3]) : null;
  if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: join(shots, 'library-service-search.png') }); }
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('region', { name: 'Third-party service catalogs', exact: true }).getByText('Stingray', { exact: true }).waitFor();
  const statuses = await page.evaluate(() => window.tpv.getProviderCatalogStatus());
  assert.equal(statuses.filter(s => s.configured && s.searchAvailable).length, 2);
  assert.ok(statuses.every(s => !s.playbackAvailable));
  if (shots) await page.screenshot({ path: join(shots, 'sources-service-catalogs.png') });
  await page.evaluate(() => window.tpv.saveSettings({ providerCatalogEnabled: false }));
  assert.ok((await page.evaluate(() => window.tpv.searchProviderCatalog('Radiohead'))).every(r => r.songs.length === 0));
  await page.evaluate(() => window.tpv.saveSettings({ providerCatalogEnabled: true }));
  const outcome = await page.evaluate(() => window.tpv.command({ type: 'setPolicy', policy: { ageRestricted: true, includeVersionIds: null, excludeVersionIds: [] } }));
  assert.equal(outcome.ok, true);
  assert.ok((await page.evaluate(() => window.tpv.searchProviderCatalog('Radiohead'))).every(r => r.songs.length === 0));
  assert.equal((await page.evaluate(() => window.tpv.getState())).playback, null);
  console.log(`PASS: packaged ${identity.version} live public KaraFun/Party Tyme library search, unconfigured partner status, no queue/play promotion, toggle and policy guard; empty private show stays stopped.`);
} finally {
  if (app) await app.close();
  const actual = await realpath(temp);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-provider-smoke-')) throw Error('Unsafe provider QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
