// Actual host UI/authority with a narrowly scoped synthetic yt-dlp process seam.
// Run after build: node scripts/youtube-search-ui-smoke.mjs
// No real provider request, copyrighted download, playback or existing show data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(join(repo, 'package.json')), { _electron: electron } = require('playwright-core');
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const temporaryRoot = await realpath(tmpdir()), temp = await mkdtemp(join(temporaryRoot, 'tpv-youtube-ui-'));
const profile = join(temp, 'profile'); await mkdir(profile, { mode: 0o700 });
const canonicalProfile = await realpath(profile), cache = join(temp, 'cache');
const executable = join(temp, process.platform === 'win32' ? 'synthetic-yt-dlp.exe' : 'synthetic-yt-dlp');
// A real native executable passes the production resolver, but the bootstrap
// intercepts only this exact, canonical temporary path before main is loaded.
await copyFile(process.execPath, executable); await chmod(executable, 0o700);
const canonicalExecutable = await realpath(executable);
const alpha = 'UC' + 'A'.repeat(22), beta = 'UC' + 'B'.repeat(22);
const videoId = index => `ytqa${String(index).padStart(7, '0')}`;
const entries = Array.from({ length: 20 }, (_, index) => ({
  id: videoId(index), title: `Uploader ${index} - Video Title ${index} (Karaoke)`, artist: 'Canonical Artist',
  track: `Canonical Song ${String(index).padStart(2, '0')}`, channel_id: index < 4 ? alpha : beta,
  channel: index < 4 ? 'Alpha Karaoke Studio' : 'Beta Karaoke Studio', uploader_id: index < 4 ? '@alpha-karaoke' : '@beta-karaoke',
  duration: 180, age_limit: 0, availability: 'public', is_live: false,
}));
for (let index = 8; index < 12; index++) entries[index].title = `Music Video ${index}`;
for (let index = 12; index < 16; index++) { entries[index].channel = 'Ordinary Music Channel'; entries[index].uploader_id = '@ordinarymusic'; }
entries[16].is_live = true; entries[17].duration = 20; entries[18].age_limit = 18; entries[19].channel_id = 'invalid-channel';
await writeFile(join(temp, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, main: 'bootstrap.cjs' }));
await writeFile(join(profile, 'settings.json'), JSON.stringify({ appearance: 'day', sharedCatalogEnabled: false,
  providerCatalogEnabled: false, youtubeSearchEnabled: true, ytDlpExecutable: canonicalExecutable,
  karaokeNerdsCacheDirectory: cache, maxFutureRequestsPerSinger: 10, singerDisplayFullscreen: false,
  ratingProfileConfigFile: join(temp, 'intentionally-missing-rating-profile.json') }));
await writeFile(join(temp, 'bootstrap.cjs'), `
const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');
const processes=require('node:child_process');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
app.setPath('userData',process.env.TPV_QA_PROFILE);app.setAppPath(process.env.TPV_QA_REPO);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe QA profile');
const selected=fs.realpathSync(process.env.TPV_QA_TOOL),owned=fs.realpathSync(process.env.TPV_QA_TEMP),original=processes.spawn;
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
globalThis.tpvYouTubeUiCalls=[];globalThis.tpvYouTubeUiUnexpectedFetch=0;
globalThis.fetch=async()=>{globalThis.tpvYouTubeUiUnexpectedFetch++;throw Error('External HTTP is disabled in this synthetic rehearsal');};
const entries=${JSON.stringify(entries)};
processes.spawn=function(file,args,options){
  let actual;try{actual=fs.realpathSync(file);}catch{return original.apply(this,arguments);}
  if(!same(actual,selected))return original.apply(this,arguments);
  if(options?.shell!==false||!Array.isArray(args))throw Error('Unsafe synthetic process invocation');
  const search=args.find(value=>typeof value==='string'&&value.startsWith('ytsearch20:'));
  if(search&&!args.includes('--skip-download'))throw Error('Metadata search tried to download');
  if(!search&&(!options.cwd||!fs.realpathSync(options.cwd).startsWith(owned+path.sep)))throw Error('Download stage escaped temporary rehearsal');
  const url=args.find(value=>typeof value==='string'&&value.startsWith('https://www.youtube.com/watch?v='));
  const id=url?new URL(url).searchParams.get('v'):null;
  globalThis.tpvYouTubeUiCalls.push({kind:search?'search':'download',query:search||null,videoId:id,shell:options.shell});
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=undefined;child.killed=false;let closed=false;
  const finish=(code)=>{if(closed)return;closed=true;child.stdout.end();child.stderr.end();child.emit('close',code,null);};
  child.kill=()=>{child.killed=true;finish(1);return true;};child.unref=()=>child;
  queueMicrotask(()=>{if(closed)return;if(search){child.stdout.write(JSON.stringify({entries}));finish(0);}else{child.stdout.write('TPV_ID:'+id+'\\n');finish(1);}});
  return child;
};
require(process.env.TPV_QA_ENTRY);
`);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { TPV_QA_PROFILE: canonicalProfile, TPV_QA_REPO: repo, TPV_QA_TEMP: temp, TPV_QA_TOOL: canonicalExecutable,
  TPV_QA_ENTRY: join(repo, 'dist/main/index.cjs'), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'),
  XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') });
let app;
try {
  app = await electron.launch({ executablePath: require('electron'), args: [temp, `--user-data-dir=${canonicalProfile}`, '--mute-audio'], cwd: repo, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const host = await app.firstWindow(); await host.waitForFunction(() => !!window.tpv);
  assert.equal(await host.evaluate(() => window.tpv.getAppVersion()), metadata.version);
  const search = host.getByRole('searchbox', { name: 'Search library', exact: true });
  const panel = host.getByRole('region', { name: 'YouTube karaoke search', exact: true });
  const candidate = index => panel.locator('.youtube-song').filter({ hasText: `Canonical Song ${String(index).padStart(2, '0')}` });
  const waitRows = async count => { await host.waitForFunction(expected => document.querySelectorAll('.youtube-search-results .youtube-song').length === expected, count); };
  const snapshot = async expectedRequests => {
    const state = await host.evaluate(() => window.tpv.getState());
    assert.equal(state.requests.length, expectedRequests); assert.equal(state.playback, null); assert.equal(state.stagedRequestId, null);
    assert.ok(state.versions.every(version => !version.id.startsWith('youtube-search:')));
    return state;
  };
  const refresh = async query => { await search.fill(query); await waitRows(8); };
  const receipt = async (query, expectedSongs = 8) => {
    const value = await host.evaluate(query => window.tpv.youtubeSearch.search(query), query);
    assert.equal(value.status, 'ok'); assert.ok(value.searchId); assert.equal(value.counts.examined, 20); assert.equal(value.songs.length, expectedSongs);
    return value;
  };
  const request = async (found, index, singerId, extra = {}) => host.evaluate(input => window.tpv.youtubeSearch.request(input), { searchId: found.searchId, videoId: videoId(index), singerId, requestId: randomUUID(), ...extra });

  await refresh('synthetic first'); await snapshot(0);
  assert.equal(await candidate(8).count(), 0); assert.equal(await candidate(12).count(), 0);
  const volume = host.getByRole('slider', { name: 'Global Volume', exact: true }); await volume.focus(); await volume.press('Home');
  await waitForHostCondition(host, () => window.tpv.getSettings().then(value => value.settings.masterVolume === 0));
  const queueWidth = (await host.evaluate(() => window.tpv.getSettings())).settings.hostPanelSizes.queue;
  const separator = host.getByRole('separator', { name: 'Resize Host Queue Width' }); await separator.focus(); await separator.press('ArrowLeft');
  await waitForHostCondition(host, previous => window.tpv.getSettings().then(value => value.settings.hostPanelSizes.queue > previous), queueWidth);
  assert.equal(await panel.locator('.youtube-song').count(), 8, 'Unrelated saved preferences must not discard the current search.');
  await candidate(0).getByRole('button', { name: 'Choose Singer', exact: true }).click();
  let dialog = host.getByRole('dialog', { name: 'Add to Queue', exact: true }); await dialog.waitFor();
  await dialog.locator('select').selectOption('__new__'); await dialog.getByLabel('New singer name', { exact: true }).fill('YouTube UI Singer');
  await dialog.getByRole('button', { name: 'Add to Queue', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  let state = await snapshot(1); const singerId = state.singers.find(value => value.name === 'YouTube UI Singer')?.id; assert.ok(singerId);
  let canonical = state.versions.find(version => version.source?.videoId === videoId(0));
  assert.equal(canonical?.title, 'Canonical Song 00'); assert.equal(canonical?.artist, 'Canonical Artist');
  await waitForHostCondition(host, () => window.tpv.youtubeDownloads.status().then(value => value.queue?.failures.length >= 1));

  await refresh('synthetic existing singer');
  await candidate(1).getByRole('button', { name: 'Choose Singer', exact: true }).click();
  dialog = host.getByRole('dialog', { name: 'Add to Queue', exact: true }); await dialog.locator('select').selectOption(singerId);
  await dialog.getByRole('button', { name: 'Add to Queue', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await snapshot(2);

  const current = await receipt('synthetic canonical identity');
  const spoofed = await request(current, 2, singerId, { title: 'FORGED TITLE', artist: 'FORGED ARTIST', url: 'https://invalid.example/media', source: { provider: 'youtube', videoId: 'XXXXXXXXXXX' } });
  assert.equal(spoofed.ok, true); state = await snapshot(3);
  canonical = state.versions.find(version => version.source?.videoId === videoId(2));
  assert.equal(canonical?.title, 'Canonical Song 02'); assert.equal(canonical?.artist, 'Canonical Artist');
  assert.doesNotMatch(JSON.stringify(state), /FORGED|invalid\.example|XXXXXXXXXXX/);
  await waitForHostCondition(host, () => window.tpv.youtubeDownloads.status().then(value => value.queue?.failures.length >= 3));
  const calls = await app.evaluate(() => globalThis.tpvYouTubeUiCalls);
  const downloads = calls.filter(value => value.kind === 'download');
  assert.deepEqual(downloads.map(value => value.videoId).sort(), [videoId(0), videoId(1), videoId(2)].sort());
  assert.ok(calls.every(value => value.shell === false));
  assert.ok(calls.filter(value => value.kind === 'search').every(value => /karaoke/i.test(value.query)));

  const stale = await receipt('synthetic old receipt'); await receipt('synthetic replacement receipt');
  assert.equal((await request(stale, 3, singerId)).ok, false); await snapshot(3);
  const cancelled = await receipt('synthetic cancelled receipt'); await host.evaluate(() => window.tpv.youtubeSearch.cancel());
  assert.equal((await request(cancelled, 3, singerId)).ok, false); await snapshot(3);

  const beforePolicy = await receipt('synthetic show policy');
  const policy = await host.evaluate(() => window.tpv.command({ type: 'setPolicy', policy: { ageRestricted: true, includeVersionIds: null, excludeVersionIds: [] } }));
  assert.equal(policy.ok, true, JSON.stringify(policy)); await panel.waitFor({ state: 'hidden' });
  assert.equal((await request(beforePolicy, 3, singerId)).ok, false); await snapshot(3);
  assert.equal((await host.evaluate(() => window.tpv.command({ type: 'setPolicy', policy: { ageRestricted: false, includeVersionIds: null, excludeVersionIds: [] } }))).ok, true);
  await waitRows(8);

  const beforeChannel = await receipt('synthetic channel rule');
  await candidate(0).getByRole('button', { name: 'Block Channel', exact: true }).click(); await waitRows(4);
  assert.equal(await candidate(0).count(), 0); assert.equal((await request(beforeChannel, 3, singerId)).ok, false);
  assert.deepEqual((await host.evaluate(() => window.tpv.getSettings())).settings.youtubeBlockedChannels, [alpha]); await snapshot(3);
  const beforeSong = await receipt('synthetic song rule', 4);
  await host.evaluate(() => window.tpv.saveSettings({ songBlacklist: [{ artist: 'Canonical Artist', title: 'Canonical Song 04' }] }));
  await waitRows(3); assert.equal(await candidate(4).count(), 0); assert.equal((await request(beforeSong, 4, singerId)).ok, false); await snapshot(3);
  await host.evaluate(() => window.tpv.saveSettings({ songBlacklist: [], youtubeBlockedChannels: [] })); await waitRows(8);
  assert.equal(await candidate(0).count(), 1); assert.equal(await candidate(4).count(), 1);

  await search.fill('synthetic fresh query');
  assert.equal(await panel.locator('.youtube-song').count(), 0, 'A changed query must not leave old actionable candidates visible.');
  await waitRows(8); await snapshot(3);
  const finalCalls = await app.evaluate(() => globalThis.tpvYouTubeUiCalls);
  assert.equal(finalCalls.filter(value => value.kind === 'download').length, 3, 'Rejected or merely searched candidates must not dispatch downloads.');
  assert.equal(await app.evaluate(() => globalThis.tpvYouTubeUiUnexpectedFetch), 0, 'The isolated rehearsal must not attempt external HTTP.');
  console.log('PASS: real YouTube search UI queues canonical receipts for new/existing singers, dispatches only controlled downloads, preserves choices through volume/panel changes, fences stale/policy/blacklist results and never stages or plays.');
} catch (error) {
  if (app) {
    console.error('Synthetic YouTube process calls:', await app.evaluate(() => globalThis.tpvYouTubeUiCalls).catch(() => []));
    const host = app.windows()[0];
    if (host) console.error('Synthetic download status:', JSON.stringify(await host.evaluate(() => window.tpv.youtubeDownloads.status()).catch(() => null)));
  }
  throw error;
} finally {
  if (app) await app.close();
  const actual = await realpath(temp);
  if (dirname(actual) !== temporaryRoot || !actual.startsWith(temporaryRoot + sep) || !basename(actual).startsWith('tpv-youtube-ui-')) throw new Error('Unsafe YouTube UI smoke cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
