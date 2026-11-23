// Historical pre-0.5 Electron UI harness. For current host stars, run workspace-shortcuts-smoke.mjs.
// Actual app → public catalog / shared ratings, with synthetic media and a QA voter.
// Usage: npx tsx scripts/song-ratings-integration-smoke.mjs /private/qa-rating.json
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { readSongRatingsConfig, SongRatingsConnection } from '../src/main/song-ratings-connection.ts';
import { PUBLIC_CATALOG_ORIGIN } from '../src/main/shared-catalog-connection.ts';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

if (process.argv.length !== 3) throw new Error('Usage: npx tsx scripts/song-ratings-integration-smoke.mjs /private/qa-rating.json');
const repo = await realpath(resolve('.'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const supplied = await realpath(resolve(process.argv[2]));
if (basename(supplied) !== 'qa-rating.json') throw new Error('Use the dedicated qa-rating.json voter, never an owner profile.');
const qa = await readSongRatingsConfig(supplied);
assert.ok(qa); assert.equal(qa.baseUrl, PUBLIC_CATALOG_ORIGIN);
const owner = await readSongRatingsConfig(join(dirname(supplied), 'host-rating.json'));
assert.ok(!owner || owner.token !== qa.token, 'QA and owner voters must be distinct.');
const parent = await realpath(dirname(supplied));
const temp = await mkdtemp(join(parent, 'qa-app-ratings-'));
const identity = await lstat(temp);
const profile = join(temp, 'profile');
let app, host, recordingKey, cleanupRatings, voteAttempted = false;
try {
if (process.platform === 'win32') {
  const sid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], {encoding:'utf8',windowsHide:true}).trim();
  if (!/^S-\d+(?:-\d+)+$/.test(sid)) throw new Error('Could not establish the private QA owner.');
  execFileSync('icacls.exe', [temp, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], {windowsHide:true,stdio:'pipe'});
} else await chmod(temp, 0o700);
await mkdir(profile);
const config = join(profile, 'rating-connection.json');
await copyFile(supplied, config); if (process.platform !== 'win32') await chmod(config, 0o600);
const staged = await readSongRatingsConfig(config);
assert.ok(staged && staged.token === qa.token && staged.baseUrl === qa.baseUrl, 'The QA profile changed while staging.');
const source = join(temp, 'QA Artist - Ratings Smoke.mp4');
const made = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=25:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
  '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'comment=tpv-ratings-qa:' + randomUUID(), '-shortest', '-movflags', '+faststart', source], {windowsHide:true,stdio:'pipe'});
assert.equal(made.status, 0, 'Synthetic MP4 generation failed.');
const expectedKey = 'sha256:' + createHash('sha256').update(await readFile(source)).digest('hex');
const invalidProfile = join(temp, 'invalid-rating.json'); await writeFile(invalidProfile, 'This is deliberately not JSON.');
const bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(bootstrap, `const {app,dialog}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.TPV_QA_PROFILE);app.setAppPath(process.env.TPV_QA_REPO);if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe QA profile');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.TPV_QA_SOURCE]});require(process.env.TPV_QA_ENTRY);`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('TPV_')));
Object.assign(env, {TPV_QA_PROFILE:await realpath(profile),TPV_QA_REPO:repo,TPV_QA_SOURCE:source,TPV_QA_ENTRY:await realpath(join(repo, 'dist/main/index.cjs')),
  APPDATA:join(temp,'appdata'),LOCALAPPDATA:join(temp,'localappdata'),XDG_CONFIG_HOME:join(temp,'config'),XDG_DATA_HOME:join(temp,'data')});
cleanupRatings = new SongRatingsConnection(config, {requireConfig:true});
const launch = async () => {
  app = await electron.launch({executablePath:require('electron'),args:[bootstrap,`--user-data-dir=${profile}`,'--mute-audio'],cwd:repo,env});
  assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))), await realpath(profile), 'Refusing any non-disposable app profile.');
  host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv?.lookupSongRatings);
};
const lookup = async () => host.evaluate(key => window.tpv.lookupSongRatings([key]), recordingKey);
const libraryRow = () => host.getByRole('listbox', {name:'Songs',exact:true}).getByRole('option').filter({hasText:'Ratings Smoke'});
const queueRow = () => host.getByRole('listbox', {name:'Singer Rotation',exact:true}).getByRole('option').filter({hasText:'Ratings Smoke'});
const waitRatingLabel = async (area, score) => {
  await waitForHostCondition(host, ({area,score}) => [...document.querySelectorAll(area + ' .song-rating-button')].some(button => {
    const label = button.getAttribute('aria-label') ?? '';
    return label.startsWith('Rate Ratings Smoke.') && label.includes('1 rating') && label.includes(`Your host rating: ${score} out of 10 hearts`);
  }), {area,score});
};
  await launch();
  const initial = await host.evaluate(() => window.tpv.getState());
  assert.equal(initial.versions.length, 0); assert.equal(initial.requests.length, 0); assert.equal(initial.playback, null);
  const preferences = await host.evaluate(() => window.tpv.getSettings());
  assert.equal(preferences.settings.sharedCatalogConfigFile, ''); assert.equal(preferences.settings.ratingProfileConfigFile, '');
  await assert.rejects(lstat(join(profile, 'catalog-connection.json')), error => error.code === 'ENOENT');
  const catalog = await host.evaluate(() => window.tpv.searchCommunityCatalog('Nada Surf Amateur'));
  assert.equal(catalog.status, 'ready'); assert.ok(catalog.tracks.length > 0);
  const search = host.getByRole('searchbox', {name:'Search library',exact:true});
  await search.fill('Nada Surf Amateur');
  await host.getByRole('listbox', {name:'Songs',exact:true}).getByText('Amateur', {exact:true}).first().waitFor();
  await search.fill('');
  await host.getByRole('button', {name:'Import Video File',exact:true}).click();
  await waitForHostCondition(host, async () => {
    const status = await window.tpv.imports.status();
    if (status?.phase === 'failed') throw new Error('Synthetic import failed.');
    return status?.phase === 'completed';
  });
  const imported = await host.evaluate(() => window.tpv.getState()); assert.equal(imported.versions.length, 1);
  const version = imported.versions[0]; assert.equal(version.title, 'Ratings Smoke');
  const keys = await host.evaluate(id => window.tpv.ratingKeys([id]), version.id);
  recordingKey = keys[version.id]; assert.equal(recordingKey, expectedKey);
  const before = await lookup(); assert.equal(before.status, 'ready'); assert.deepEqual(before.items, [{recordingKey,average:null,count:0,ownVote:null}]);
  await libraryRow().getByRole('button', {name:/^Rate Ratings Smoke\./}).click();
  const dialog = host.getByRole('dialog', {name:'Rate This Recording',exact:true}); await dialog.waitFor();
  await dialog.getByRole('radio', {name:'3 hearts out of 10',exact:true}).click(); voteAttempted = true;
  await dialog.getByRole('button', {name:'Save Host Rating',exact:true}).click();
  await dialog.getByRole('status').filter({hasText:'Your host rating was saved.'}).waitFor();
  const three = await lookup(); assert.equal(three.status, 'ready'); assert.deepEqual(three.items, [{recordingKey,average:3,count:1,ownVote:3}]);
  await dialog.getByRole('radio', {name:'9 hearts out of 10',exact:true}).click();
  await dialog.getByRole('button', {name:'Save Host Rating',exact:true}).click();
  await dialog.getByRole('status').filter({hasText:'Your host rating was saved.'}).waitFor();
  const nine = await lookup(); assert.equal(nine.status, 'ready'); assert.deepEqual(nine.items, [{recordingKey,average:9,count:1,ownVote:9}]);
  await dialog.getByRole('button', {name:'Close',exact:true}).click();
  await waitRatingLabel('.song-list', 9);
  const singerId = 'ratings-qa-' + randomUUID(), requestId = 'ratings-request-' + randomUUID();
  const singer = await host.evaluate(id => window.tpv.command({type:'addSinger',singer:{id,name:'Ratings QA Singer'}}), singerId); assert.equal(singer.ok, true);
  const requested = await host.evaluate(({singerId,requestId,versionId}) => window.tpv.command({type:'request',singerId,requestId,versionId}), {singerId,requestId,versionId:version.id}); assert.equal(requested.ok, true);
  await waitRatingLabel('[data-queue-list]', 9); assert.equal(await queueRow().count(), 1);
  assert.match(await queueRow().getByRole('button', {name:/^Rate Ratings Smoke\./}).getAttribute('aria-label'), /9\.0 \/ 10; 1 rating.*Your host rating: 9/);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  await app.close(); app = undefined; await launch();
  const restored = await lookup(); assert.equal(restored.status, 'ready'); assert.deepEqual(restored.items, [{recordingKey,average:9,count:1,ownVote:9}]);
  await waitRatingLabel('.song-list', 9); await waitRatingLabel('[data-queue-list]', 9);
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);

  // A draft check must not switch the active host's authority before Save.
  await host.getByRole('button', {name:'Preferences',exact:true}).click();
  await host.locator('summary').filter({hasText:/^Song Ratings$/}).click();
  await app.evaluate(({dialog},file) => { dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}); }, invalidProfile);
  await host.getByRole('button', {name:'Choose Host Rating Profile…',exact:true}).click();
  await host.getByRole('button', {name:'Profile: invalid-rating.json',exact:true}).waitFor();
  await host.getByRole('button', {name:'Check Rating Profile',exact:true}).click();
  await host.getByRole('status').filter({hasText:'This host rating profile cannot be read or is invalid.'}).waitFor();
  const draft = await lookup(); assert.equal(draft.status, 'ready'); assert.equal(draft.items[0].ownVote, 9);
  await host.getByRole('button', {name:'Save preferences',exact:true}).click();
  await host.getByRole('dialog', {name:'Preferences',exact:true}).waitFor({state:'hidden'});
  assert.equal((await lookup()).status, 'configuration-error');
  const unaffected = await host.evaluate(() => window.tpv.getState()); assert.equal(unaffected.requests.length, 1); assert.equal(unaffected.playback, null);
  await host.evaluate(async () => { const current=await window.tpv.getSettings(); await window.tpv.saveSettings({...current.settings,ratingProfileConfigFile:''}); });
  const recovered = await lookup(); assert.equal(recovered.status, 'ready'); assert.equal(recovered.items[0].ownVote, 9);
  console.log('Actual app/live services passed: reader-free public catalog search and UI results; imported synthetic MP4 heart dialog; UI vote3→9/count1; matching library/queue hearts; service vote after restart; draft-only invalid profile check and explicit applied failure; local queue/no-autoplay preserved.');
} finally {
  if (app) await app.close().catch(() => {});
  let cleanupFailure;
  if (voteAttempted && recordingKey && cleanupRatings) {
    const cleared = await cleanupRatings.vote(recordingKey, null);
    const checked = cleared.status === 'ready' ? await cleanupRatings.lookup([recordingKey]) : null;
    if (!checked || checked.status !== 'ready' || checked.items[0]?.count !== 0 || checked.items[0]?.ownVote !== null)
      cleanupFailure = new Error(`Synthetic QA rating cleanup could not be confirmed for ${recordingKey}.`);
    else console.log('Synthetic QA vote cleared and zero-count confirmed; owner voter and real show were never used.');
  }
  const actual = await realpath(temp), current = await lstat(temp);
  if (dirname(actual) !== parent || !actual.startsWith(parent + sep) || !basename(actual).startsWith('qa-app-ratings-') || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
    throw new Error('Unsafe private app QA cleanup path; staging retained for review.');
  await rm(actual, {recursive:true,force:true,maxRetries:10,retryDelay:250});
  if (cleanupFailure) throw cleanupFailure;
}
