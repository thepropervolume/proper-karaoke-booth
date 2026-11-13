// Isolated UI integration: synthetic catalog, fake yt-dlp, muted generated video,
// no provider credentials and no outbound requests or real media downloads.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const repo = await realpath(resolve('.')), require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core'), executablePath = require('electron');
const tempRoot = await realpath(tmpdir()), temp = await mkdtemp(join(tempRoot, 'tpv-unified-library-qa-'));
const profile = join(temp, 'profile'), cache = join(temp, 'permanent-videos');
await mkdir(profile);await mkdir(cache);
const canonicalProfile = await realpath(profile), fixture = join(temp, 'fixture.mp4');
const calls = join(temp, 'download-calls.txt'), searches = join(temp, 'catalog-searches.txt');
const fake = join(temp, 'fake-ytdlp.cjs'), bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(fake, `const fs=require('node:fs'),path=require('node:path');
fs.appendFileSync(process.env.TPV_QA_CALLS,'download\\n');
console.log('TPV_ID:abcdefghijk');console.log('TPV_PROGRESS:25%');
setTimeout(()=>{fs.copyFileSync(process.env.TPV_QA_FIXTURE,path.join(process.cwd(),'video.mp4'));console.log('TPV_PROGRESS:100%');},750);
`);
await writeFile(bootstrap, `const {app,session}=require('electron'),fs=require('node:fs'),cp=require('node:child_process');
app.setPath('userData',process.env.TPV_QA_PROFILE);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe test profile');
const originalSpawn=cp.spawn;
cp.spawn=function(executable,args,options){
  if(Array.isArray(args)&&args.includes('--ignore-config')&&args.includes('--format')){
    if(new URL(args.at(-1)).searchParams.get('v')!=='abcdefghijk')throw Error('Unexpected fake video identity');
    return originalSpawn(process.execPath,[process.env.TPV_QA_FAKE],{...options,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
  }
  return originalSpawn(executable,args,options);
};
global.__tpvQACatalogOnline=true;
global.fetch=async input=>{
  const url=new URL(String(input));
  if(url.origin!=='https://catalog.example.test'||url.pathname!=='/v1/catalog/tracks')throw Error('Unexpected synthetic request');
  const q=url.searchParams.get('q');fs.appendFileSync(process.env.TPV_QA_SEARCHES,q+'\\n');
  if(!global.__tpvQACatalogOnline||q.toLowerCase().includes('unavailable'))throw Error('Synthetic offline');
  let item={artist:'Synthetic Artist',title:'Catalog Match',brandSlug:'',youtubeId:'abcdefghijk',uploadDate:null};
  if(q==='Old'){await new Promise(resolve=>setTimeout(resolve,800));item={...item,title:'Old Result',youtubeId:'lmnopqrstuv'};}
  if(q==='New')item={...item,title:'New Result',youtubeId:'ABCDEFGHIJK'};
  return new Response(JSON.stringify({items:[item,item],nextCursor:null,metadata:{revision:'1',lastSuccess:null,lastAttempt:null}}),{headers:{'content-type':'application/json'}});
};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
require(process.env.TPV_QA_ENTRY);
`);
await writeFile(join(profile, 'catalog-connection.json'), JSON.stringify({ baseUrl: 'https://catalog.example.test', token: 'synthetic-read-only-client-token-123456789' }), { mode: 0o600 });
await writeFile(join(profile, 'settings.json'), JSON.stringify({ appearance: 'night', masterVolume: 0, karaokeNerdsCacheDirectory: cache, ytDlpExecutable: executablePath }));
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')),
  TPV_QA_FIXTURE: fixture, TPV_QA_CALLS: calls, TPV_QA_SEARCHES: searches, TPV_QA_FAKE: fake,
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
const poll = async (read, matches, message, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  for (;;) { const value = await read();if (matches(value)) return value;assert.ok(Date.now() < deadline, message);await new Promise(resolve => setTimeout(resolve, 50)); }
};
try {
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=10:d=10', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '10', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { windowsHide: true, stdio: 'pipe' });
  app = await electron.launch({ executablePath, args, env, cwd: repo, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const host = await app.firstWindow();
  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  await host.evaluate(() => window.tpv.importFiles('files'));
  await poll(() => host.evaluate(() => window.tpv.imports.status()), value => value?.phase === 'completed', 'Synthetic local import did not complete');
  const localId = (await host.evaluate(() => window.tpv.getState())).versions[0].id;
  const localEdited = await host.evaluate(id => window.tpv.command({ type: 'editVersion', id, title: 'Unavailable Local', artist: 'Synthetic Artist' }), localId);
  assert.equal(localEdited.ok, true, localEdited.error);
  const search = host.getByRole('searchbox', { name: 'Search library', exact: true }), songs = host.getByRole('listbox', { name: 'Songs' });
  await search.fill('Synthetic');
  await songs.getByText('Catalog Match', { exact: true }).waitFor();assert.equal(await songs.getByRole('option').count(), 2, 'Repeated catalog IDs should be merged');
  assert.equal(await songs.getByText('YouTube', { exact: true }).count(), 1);
  await songs.getByText('Catalog Match', { exact: true }).dblclick();
  let dialog = host.getByRole('dialog', { name: 'Add to Queue' });
  await dialog.waitFor();await dialog.getByRole('combobox').selectOption('__new__');
  await dialog.getByLabel('New singer name', { exact: true }).fill('Catalog Singer');await dialog.getByRole('button', { name: 'Add to Queue', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const queued = await poll(() => host.evaluate(() => window.tpv.getState()), value => value.requests.length === 1, 'Catalog request was not committed');
  assert.equal(queued.versions.length, 2);assert.equal(queued.playback, null);const versionId = queued.requests[0].versionId;
  assert.equal(queued.versions.find(version => version.id === versionId)?.source?.videoId, 'abcdefghijk');
  await poll(() => host.evaluate(() => window.tpv.youtubeDownloads.status()), value => {
    assert.notEqual(value.job?.phase, 'failed', value.job?.message);return value.cachedVersionIds.includes(versionId);
  }, 'Queued catalog video was not downloaded');
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null, 'Download completion must not play automatically');
  assert.equal(await readFile(calls, 'utf8'), 'download\n');

  await search.fill('Old');await poll(async () => readFile(searches, 'utf8'), value => value.includes('Old\n'), 'Old query was not issued');
  await search.fill('New');await songs.getByText('New Result', { exact: true }).waitFor();await new Promise(resolve => setTimeout(resolve, 950));
  assert.equal(await songs.getByText('Old Result', { exact: true }).count(), 0, 'Late query results must not replace current results');

  await search.fill('Unavailable');await host.getByText('Karaoke Nerds results are unavailable.', { exact: false }).waitFor();
  await songs.getByText('Unavailable Local', { exact: true }).waitFor();assert.equal(await songs.getByRole('option').count(), 1);
  assert.equal((await host.evaluate(input => window.tpv.command({ type: 'editVersion', id: input, title: 'Host Catalog Name', artist: 'Host Artist' }), versionId)).ok, true);
  await search.fill('Synthetic');await songs.getByText('Host Catalog Name', { exact: true }).waitFor();
  assert.equal(await songs.getByText('YouTube', { exact: true }).count(), 1, 'Existing exact identity must win over catalog duplicates');
  const existing = songs.getByRole('option').filter({ hasText: 'Host Catalog Name' });await existing.focus();await existing.press('Enter');
  dialog = host.getByRole('dialog', { name: 'Add to Queue' });await dialog.getByRole('combobox').selectOption(queued.singers[0].id);
  await dialog.getByRole('button', { name: 'Add to Queue', exact: true }).click();await dialog.waitFor({ state: 'detached' });
  await poll(() => host.evaluate(() => window.tpv.getState()), value => value.requests.length === 2, 'Existing recording request did not commit');
  assert.equal(await readFile(calls, 'utf8'), 'download\n', 'An already saved recording must not download twice');
  await app.evaluate(() => { globalThis.__tpvQACatalogOnline = false; });
  await search.fill('Unavailable');await songs.getByText('Unavailable Local', { exact: true }).waitFor();await search.fill('Synthetic');
  await host.getByText('Saved Karaoke Nerds results', { exact: false }).waitFor();await songs.getByText('Host Catalog Name', { exact: true }).waitFor();
  assert.equal((await host.evaluate(() => window.tpv.getState())).playback, null);
  console.log('Unified library search, exact-ID merge, latest-query wins, singer dialog via double-click/Enter, queue-time download, local-error fallback and offline cached results passed in an isolated profile.');
} finally {
  if (app) await app.close();
  if (temp.startsWith(tempRoot + sep) && await realpath(temp) === temp) await rm(temp, { recursive: true, force: true });
}
