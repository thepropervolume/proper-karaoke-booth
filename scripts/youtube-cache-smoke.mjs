// Offline integration regression: fake yt-dlp copies a generated MP4 into the
// production downloader's staging directory. Isolated profile and muted audio.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const repo = await realpath(resolve('.')), require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const executablePath = require('electron');
const tempRoot = await realpath(tmpdir()), temp = await mkdtemp(join(tempRoot, 'tpv-youtube-cache-qa-'));
const profile = join(temp, 'profile'), cache = join(temp, 'permanent-videos');
await mkdir(profile); await mkdir(cache);
const canonicalProfile = await realpath(profile), fixture = join(temp, 'fixture.mp4'), calls = join(temp, 'download-calls.txt');
const fake = join(temp, 'fake-ytdlp.cjs'), bootstrap = join(temp, 'bootstrap.cjs');
await writeFile(fake, `const fs=require('node:fs'); const path=require('node:path');
fs.appendFileSync(process.env.TPV_QA_CALLS,'download\\n');
console.log('TPV_ID:'+process.env.TPV_QA_VIDEO_ID); console.log('TPV_PROGRESS:25%');
setTimeout(()=>{fs.copyFileSync(process.env.TPV_QA_FIXTURE,path.join(process.cwd(),'video.mp4'));console.log('TPV_PROGRESS:100%');},1500);
`);
await writeFile(bootstrap, `const {app,session}=require('electron'); const fs=require('node:fs'), cp=require('node:child_process');
app.setPath('userData',process.env.TPV_QA_PROFILE);
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe test profile');
const originalSpawn=cp.spawn;
cp.spawn=function(executable,args,options){
  if(Array.isArray(args)&&args.includes('--ignore-config')&&args.includes('--format')){
    const id=new URL(args.at(-1)).searchParams.get('v');
    if(id!=='abcdefghijk')throw Error('Unexpected fake download identity');
    return originalSpawn(process.execPath,[process.env.TPV_QA_FAKE],{...options,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',TPV_QA_VIDEO_ID:id}});
  }
  return originalSpawn(executable,args,options);
};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
require(process.env.TPV_QA_ENTRY);
`);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ appearance: 'night', masterVolume: 0, karaokeNerdsCacheDirectory: cache, ytDlpExecutable: executablePath }));
const env = { ...process.env, TPV_QA_PROFILE: canonicalProfile, TPV_QA_ENTRY: await realpath(join(repo, 'dist/main/index.cjs')),
  TPV_QA_FIXTURE: fixture, TPV_QA_CALLS: calls, TPV_QA_FAKE: fake,
  APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') };
delete env.ELECTRON_RUN_AS_NODE;
const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio'];
if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
let app;
const launch = async () => {
  app = await electron.launch({ executablePath, args, env, cwd: repo, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))), canonicalProfile);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});
  return app.firstWindow();
};
const poll = async (read, matches, message, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await read(); if (matches(value)) return value;
    assert.ok(Date.now() < deadline, message); await new Promise(resolve=>setTimeout(resolve,50));
  }
};
try {
  execFileSync('ffmpeg', ['-hide_banner','-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=10:d=30',
    '-f','lavfi','-i','sine=frequency=440:duration=30','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',fixture], { windowsHide: true, stdio: 'pipe' });
  let host = await launch();
  const added = await host.evaluate(()=>window.tpv.addYouTube({url:'https://youtu.be/abcdefghijk',title:'Cache Smoke',artist:'Synthetic Artist'}));
  assert.equal(added.ok, true, added.notice || added.error); assert.ok(added.versionId);
  assert.equal((await host.evaluate(()=>window.tpv.getState())).playback, null, 'Adding/downloading must not play automatically');
  await host.evaluate(async versionId=>{
    for(const command of [{type:'addSinger',singer:{id:'cache-singer',name:'Cache Singer'}},
      {type:'request',requestId:'cache-request',singerId:'cache-singer',versionId},{type:'stage'}]) {
      const result=await window.tpv.command(command); if(!result.ok)throw Error(result.error);
    }
  }, added.versionId);
  const downloaded = await poll(()=>host.evaluate(()=>window.tpv.youtubeDownloads.status()), value=>{
    assert.notEqual(value.job?.phase,'failed',value.job?.message); return value.job?.phase==='completed';
  },'Synthetic download timed out');
  assert.deepEqual(downloaded.cachedVersionIds,[added.versionId]);
  let state=await host.evaluate(()=>window.tpv.getState());
  assert.equal(state.playback,null,'Download completion must not start playback');
  assert.equal(state.versions.length,1); assert.deepEqual(state.versions[0].source,{provider:'youtube',videoId:'abcdefghijk'});
  assert.equal(state.stagedRequestId,'cache-request');
  await host.getByRole('listbox',{name:'Songs'}).getByText('YouTube · Saved locally',{exact:false}).waitFor();
  const row=host.getByRole('listbox',{name:'Songs'}).getByRole('option').first();
  await row.click({button:'right'}); assert.equal(await host.getByRole('menuitem',{name:'Show in Files...',exact:true}).isEnabled(),true); await host.keyboard.press('Escape');
  const directory=join(cache,'youtube','Synthetic Artist'), file=join(directory,'Synthetic Artist - Cache Smoke.mp4');
  assert.deepEqual(await readFile(file),await readFile(fixture));
  const ownership=JSON.parse(await readFile(file+'.tpv.json','utf8')); assert.equal(ownership.videoId,'abcdefghijk');
  const initialDisplay=app.waitForEvent('window'); await host.evaluate(()=>window.tpv.openDisplay()); const display=await initialDisplay;
  await display.locator('video').waitFor({state:'attached'});
  assert.equal((await host.evaluate(()=>window.tpv.command({type:'start',generationId:crypto.randomUUID()}))).ok,true);
  await display.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1;});
  assert.match(await display.locator('video').evaluate(video=>video.currentSrc),/^tpv-media:\/\/play\//);
  assert.equal((await host.evaluate(()=>window.tpv.command({type:'pause'}))).ok,true);
  await display.waitForFunction(()=>document.querySelector('video').paused);
  const generation=(await host.evaluate(()=>window.tpv.getState())).playback.generationId;
  await poll(()=>host.evaluate(()=>window.tpv.getTimeline()),value=>value.seekable,'Cached media did not become seekable');
  assert.equal((await host.evaluate(input=>window.tpv.seek(input),{generation,position:12})).ok,true);
  assert.equal(await display.locator('video').evaluate(video=>video.paused),true,'Paused cached seeks must remain paused');
  assert.equal(await readFile(calls,'utf8'),'download\n');
  await app.close(); app=undefined;
  host=await launch();
  state=await host.evaluate(()=>window.tpv.getState()); assert.equal(state.playback?.status,'paused'); assert.equal(state.versions.length,1); assert.equal(state.versions[0].source.videoId,'abcdefghijk');
  assert.deepEqual((await host.evaluate(()=>window.tpv.youtubeDownloads.status())).cachedVersionIds,[added.versionId]);
  const reopenedDisplay=app.waitForEvent('window'); await host.evaluate(()=>window.tpv.openDisplay()); const reopened=await reopenedDisplay;
  await reopened.waitForFunction(()=>{const v=document.querySelector('video');return v?.paused&&Math.abs(v.currentTime-12)<.5;});
  assert.equal((await host.evaluate(()=>window.tpv.command({type:'resume'}))).ok,true);
  await reopened.waitForFunction(()=>!document.querySelector('video').paused);
  assert.equal(await readFile(calls,'utf8'),'download\n','Reopening/resuming must reuse the permanent file without yt-dlp');
  assert.deepEqual((await readdir(directory)).sort(),['Synthetic Artist - Cache Smoke.mp4','Synthetic Artist - Cache Smoke.mp4.tpv.json']);
  console.log('Permanent YouTube caching, unchanged source/request identity, no autoplay, local transport/seek and offline restart reuse passed in an isolated profile.');
} finally {
  if(app)await app.close();
  if(temp.startsWith(tempRoot+sep)&&await realpath(temp)===temp)await rm(temp,{recursive:true,force:true});
}
