// Live public metadata, actual packaged application, disposable muted profile.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  let page = await app.firstWindow(); await page.waitForFunction(() => !!window.tpv);
  await page.getByRole('searchbox', { name: 'Search library', exact: true }).fill('Radiohead');
  const group = page.getByRole('region', { name: 'KaraFun catalog results', exact: true });
  await group.getByRole('listitem').first().waitFor({ timeout: 65_000 });
  const party = page.getByRole('region', { name: 'Party Tyme catalog results', exact: true });
  assert.ok(await group.getByRole('listitem').count() > 0); assert.ok(await party.getByRole('listitem').count() > 0);
  const providerSection = page.getByRole('region', { name: 'Service catalog matches', exact: true });
  assert.equal(await providerSection.getByRole('button', { name: /queue|play|request/i }).count(), 0);
  const state = await page.evaluate(() => window.tpv.getState()); assert.equal(state.playback, null); assert.equal(state.versions.length, 0); assert.equal(state.requests.length, 0);
  await page.getByRole('searchbox', { name: 'Search library', exact: true }).fill('SF1124621');
  const sunfly = page.getByRole('region', { name: 'Sunfly Store catalog results', exact: true });
  await sunfly.getByRole('listitem').first().waitFor({ timeout: 45_000 });
  assert.ok(await sunfly.getByText('Our Song', { exact: true }).count() > 0);
  assert.ok((await sunfly.getByRole('listitem').first().innerText()).includes('Anne-Marie'));
  const shots = process.argv[3] ? resolve(process.argv[3]) : null;
  if (shots) { await mkdir(shots, { recursive: true }); await sunfly.getByRole('listitem').first().scrollIntoViewIfNeeded(); await page.screenshot({ path: join(shots, 'library-service-search.png') }); }
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('region', { name: 'Third-party service catalogs', exact: true }).getByText('Stingray', { exact: true }).waitFor();
  const statuses = await page.evaluate(() => window.tpv.getProviderCatalogStatus());
  assert.equal(statuses.filter(s => s.configured && s.searchAvailable).length, 3);
  assert.ok(statuses.every(s => !s.playbackAvailable));
  if (shots) { await page.getByRole('region', { name: 'Third-party service catalogs', exact: true }).getByRole('heading', { name: 'Third-Party Services', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(shots, 'sources-service-catalogs.png') }); }
  await page.evaluate(() => window.tpv.saveSettings({ providerCatalogEnabled: false }));
  assert.ok((await page.evaluate(() => window.tpv.searchProviderCatalog('Radiohead'))).every(r => r.songs.length === 0));
  await page.evaluate(() => window.tpv.saveSettings({ providerCatalogEnabled: true }));
  const fakeProfiles = { karafun: '', partytyme: '', sunfly: join(canonicalProfile, 'private-sunfly.key'), stingray: join(canonicalProfile, 'private-stingray.json') };
  await writeFile(fakeProfiles.sunfly, 'synthetic-developer-fixture-not-real', { mode: 0o600 });
  await page.evaluate(profiles => window.tpv.saveSettings({ localControlEnabled: true, providerCatalogProfiles: profiles }), fakeProfiles);
  const cli = await app.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath() }));
  const cliBundle = join(dirname(cli.appPath), 'control', 'cli.cjs');
  const runCli = async (extra = []) => JSON.parse((await promisify(execFile)(cli.executable, [cliBundle, '--profile-dir', canonicalProfile, 'settings', ...extra], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 15_000 })).stdout);
  const normal = await runCli();
  assert.deepEqual(normal.result.settings.providerCatalogProfiles, { karafun: '', partytyme: '', sunfly: '', stingray: '' });
  assert.ok(normal.result.redactedFields.includes('providerCatalogProfiles.sunfly'));
  const explicit = await runCli(['--include-private-paths']);
  assert.deepEqual(explicit.result.settings.providerCatalogProfiles, fakeProfiles);
  assert.deepEqual((await page.evaluate(() => window.tpv.getSettings())).settings.providerCatalogProfiles, fakeProfiles);
  await page.evaluate(() => window.tpv.clearProviderCatalogProfile('sunfly'));
  assert.equal(await readFile(fakeProfiles.sunfly, 'utf8'), 'synthetic-developer-fixture-not-real');
  assert.equal((await page.evaluate(() => window.tpv.getSettings())).settings.providerCatalogProfiles.sunfly, '');
  await page.evaluate(() => window.tpv.saveSettings({ localControlEnabled: false }));
  // Policy editing is not an exposed host command. Restore a private policy
  // fixture only while its app is closed, as in the existing policy rehearsal.
  await app.close(); app = undefined;
  const db = new DatabaseSync(join(canonicalProfile, 'show.sqlite'));
  try {
    const saved = JSON.parse(db.prepare('SELECT value FROM show_state WHERE id = 1').get().value);
    saved.policy.ageRestricted = true;
    db.prepare('UPDATE show_state SET value = ? WHERE id = 1').run(JSON.stringify(saved));
  } finally { db.close(); }
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${canonicalProfile}`, '--mute-audio'], env, cwd: temp });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  page = await app.firstWindow(); await page.waitForFunction(() => !!window.tpv);
  assert.ok((await page.evaluate(() => window.tpv.searchProviderCatalog('Radiohead'))).every(r => r.songs.length === 0));
  assert.equal((await page.evaluate(() => window.tpv.getState())).playback, null);
  console.log(`PASS: packaged ${identity.version} live KaraFun/Party Tyme and Sunfly Store SKU metadata search, inactive Stingray, no queue/play promotion, toggle/policy guards, CLI private-path redaction and clearing a profile without deleting its file; empty private show stays stopped.`);
} finally {
  if (app) await app.close();
  const actual = await realpath(temp);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-provider-smoke-')) throw Error('Unsafe provider QA cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
