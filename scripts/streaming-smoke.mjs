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
const temp = await mkdtemp(join(tempRoot, 'tpv-streaming-qa-'));
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
  await host.waitForFunction(() => !!window.tpv?.addYouTube);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response:0, checkboxChecked:false }); });
  const added = await host.evaluate(() => window.tpv.addYouTube({ url:'https://youtu.be/M7lc1UVf-VE', title:'YouTube API sample', artist:'YouTube' }));
  assert.equal(added.ok, true);
  assert.equal((await host.evaluate(() => window.tpv.addYouTube({url:'M7lc1UVf-VE',title:'duplicate',artist:''}))).versionId, added.versionId);
  await host.getByRole('option').filter({hasText:'YouTube API sample'}).waitFor();
  assert.match(await host.getByRole('option').filter({hasText:'YouTube API sample'}).innerText(), /YouTube/);
  await host.evaluate(async versionId => {
    await window.tpv.command({type:'addSinger',singer:{id:'qa-singer',name:'QA Singer'}});
    await window.tpv.command({type:'request',requestId:'qa-request',singerId:'qa-singer',versionId});
    await window.tpv.openDisplay();
  }, added.versionId);
  await new Promise(resolve => setTimeout(resolve,500));
  assert.equal((await host.evaluate(()=>window.tpv.command({type:'stage'}))).ok,true);
  const started = await host.evaluate(()=>window.tpv.command({type:'start',generationId:crypto.randomUUID()}));
  console.log('Start result:',JSON.stringify(started));
  if (!started.ok) throw new Error(started.error);
  const deadline=Date.now()+15000;
  let report;
  while(Date.now()<deadline){
    report=await app.evaluate(async ({webContents})=>{
      const player=webContents.getAllWebContents().find(value=>value.getURL().startsWith('http://127.0.0.1:'));
      return player ? player.executeJavaScript('window.tpvYouTube.snapshot()') : null;
    });
    if(report?.state===1&&report?.duration>0)break;
    if(report?.error)throw new Error('YouTube error '+report.error);
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.equal(report?.state,1,'live YouTube embed must actually play');
  assert.ok(report.duration>0);
  assert.equal((await host.evaluate(()=>window.tpv.command({type:'pause'}))).ok,true);
  await new Promise(resolve=>setTimeout(resolve,700));
  assert.equal((await host.evaluate(()=>window.tpv.getState())).playback.status,'paused');
  const timeline=await host.evaluate(()=>window.tpv.getTimeline());
  assert.equal(timeline.seekable,true);
  const seeked=await host.evaluate(generation=>window.tpv.seek({generation,position:5}), timeline.generation);
  assert.equal(seeked.ok,true);
  assert.equal((await host.evaluate(()=>window.tpv.getState())).playback.status,'paused');
  assert.equal((await host.evaluate(()=>window.tpv.command({type:'resume'}))).ok,true);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('/display/index.html')).minimize());
  await host.waitForFunction(async()=> (await window.tpv.getState()).playback?.status==='paused');
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('/display/index.html')).restore());
  await new Promise(resolve=>setTimeout(resolve,500));
  const resumed=await host.evaluate(()=>window.tpv.command({type:'resume'})); console.log('Restored resume:',JSON.stringify(resumed)); assert.equal(resumed.ok,true);
  assert.equal((await host.evaluate(()=>window.tpv.command({type:'stop'}))).ok,true);
  assert.equal((await host.evaluate(()=>window.tpv.getState())).requests.find(r=>r.id==='qa-request').status,'accepted');
  await app.close(); app=undefined;
  app=await electron.launch({executablePath,args,cwd:repo,env,timeout:30000});
  const reopened=await app.firstWindow(); await reopened.waitForFunction(()=>!!window.tpv);
  const recovered=await reopened.evaluate(()=>window.tpv.getState());
  assert.equal(recovered.playback,null); assert.equal(recovered.versions.find(v=>v.id===added.versionId).source.videoId,'M7lc1UVf-VE');
  console.log('Live YouTube played, paused, sought while paused, safely paused on minimization, resumed, and stopped without consuming the queued request; source persisted across restart without autoplay.');

} finally {
  if (app) await app.close();
  // Delete only the test directory we created under the verified temporary root.
  if (temp.startsWith(tempRoot + sep) && (await realpath(temp)) === temp) await rm(temp, { recursive: true, force: true });
}
