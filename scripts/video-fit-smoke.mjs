// Actual display markup/renderer, synthetic media, a temporary preload and profile.
// Does not open the production main process, show database, audio devices or network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const repo = await realpath(resolve('.'));
const require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
const root = await realpath(tmpdir()), temp = await mkdtemp(join(root, 'tpv-video-fit-'));
const artifacts = await mkdtemp(join(root, 'tpv-video-fit-artifacts-'));
const profile = join(temp, 'profile'); await mkdir(profile);
const fixtures = [ ['landscape', '320x180'], ['standard', '320x240'], ['portrait', '180x320'] ];
let app;
try {
  for (const [name, size] of fixtures) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=5:duration=2`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(temp, `${name}.mp4`)], { windowsHide: true });
  const preload = join(temp, 'preload.cjs'), bootstrap = join(temp, 'bootstrap.cjs');
  await writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('tpvDisplay',{ready:()=>ipcRenderer.send('qa:ready'),shortcut:()=>{},event:()=>{},bumperAck:()=>{},bumperEvent:()=>{},bumperDeviceChange:()=>{},onSeek:()=>()=>{},onBumperCommand:()=>()=>{},subscribe:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('display:state',listener);return()=>ipcRenderer.removeListener('display:state',listener);}});`);
  await writeFile(bootstrap, `const {app,BrowserWindow,ipcMain,protocol}=require('electron');const fs=require('node:fs');const path=require('node:path');app.setPath('userData',process.env.TPV_QA_PROFILE);if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_QA_PROFILE))throw Error('Unsafe profile');protocol.registerSchemesAsPrivileged([{scheme:'tpv-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);app.whenReady().then(()=>{protocol.handle('tpv-media',request=>{const id=new URL(request.url).pathname.slice(1);if(!['landscape','standard','portrait'].includes(id))return new Response(null,{status:404});return new Response(fs.readFileSync(path.join(process.env.TPV_QA_TEMP,id+'.mp4')),{headers:{'Content-Type':'video/mp4'}});});ipcMain.on('qa:ready',event=>event.sender.send('display:state',{playback:{generation:'initial',src:'tpv-media://play/landscape',status:'paused',singer:'Fixture Singer',title:'Viewport fixture',position:0,volume:0,outputId:'default'},next:['Next Singer'],logo:null,shortcuts:{search:['Control+KeyF'],playPause:['Space']},bumperVolume:0}));const win=new BrowserWindow({width:1280,height:800,useContentSize:true,webPreferences:{preload:process.env.TPV_QA_PRELOAD,contextIsolation:true,sandbox:true,nodeIntegration:false}});win.loadFile(process.env.TPV_QA_PAGE);});app.on('window-all-closed',()=>app.quit());`);
  const env = {...process.env, TPV_QA_PROFILE:await realpath(profile), TPV_QA_PRELOAD:preload, TPV_QA_TEMP:temp, TPV_QA_PAGE:await realpath(join(repo,'dist/ui/src/display/index.html')), APPDATA:join(temp,'appdata'), LOCALAPPDATA:join(temp,'localappdata'), XDG_CONFIG_HOME:join(temp,'config'), XDG_DATA_HOME:join(temp,'data')}; delete env.ELECTRON_RUN_AS_NODE;
  const args=[bootstrap,`--user-data-dir=${profile}`,'--mute-audio']; if(process.env.TPV_TEST_NO_SANDBOX==='1')args.push('--no-sandbox');
  app=await electron.launch({executablePath:require('electron'),args,cwd:repo,env});
  assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))),await realpath(profile));
  const page=await app.firstWindow();
  let generation=0;
  for(const [width,height] of [[1280,800],[640,360],[420,740],[320,200]]) {
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);
    await page.waitForFunction(size=>innerWidth===size[0]&&innerHeight===size[1],[width,height]);
    for(const [name] of fixtures) {
      await app.evaluate(({BrowserWindow},input)=>BrowserWindow.getAllWindows()[0].webContents.send('display:state',{playback:{generation:input.generation,src:'tpv-media://play/'+input.name,status:'paused',singer:'Fixture Singer',title:'Viewport '+input.name,position:0,volume:0,outputId:'default'},next:['Next Singer'],logo:null,shortcuts:{search:['Control+KeyF'],playPause:['Space']},bumperVolume:0}),{name,generation:String(++generation)});
      await page.waitForFunction(name=>{const video=document.querySelector('video');return video?.currentSrc==='tpv-media://play/'+name&&video.videoWidth>0;},name);
      const box=await page.evaluate(()=>{const v=document.querySelector('video'),m=document.querySelector('main'),r=v.getBoundingClientRect(),mr=m.getBoundingClientRect();return{width:innerWidth,height:innerHeight,video:{x:r.x,y:r.y,width:r.width,height:r.height},main:{x:mr.x,y:mr.y,width:mr.width,height:mr.height},documentHeight:document.documentElement.scrollHeight,documentWidth:document.documentElement.scrollWidth,bodyHeight:document.body.scrollHeight,fit:getComputedStyle(v).objectFit,intrinsic:[v.videoWidth,v.videoHeight]};});
      assert.equal(box.fit,'contain'); assert.equal(box.video.x,0); assert.equal(box.video.y,0);
      assert.equal(box.video.height,box.height); assert.equal(box.video.width,box.width);
      assert.equal(box.main.height,box.height); assert.ok(box.documentHeight<=box.height); assert.ok(box.bodyHeight<=box.height); assert.ok(box.documentWidth<=box.width);
      // Contain scales the actual picture uniformly, with only letter/pillarboxing.
      const scale=Math.min(box.width/box.intrinsic[0],box.height/box.intrinsic[1]);
      assert.ok(box.intrinsic[0]*scale<=box.width+.01&&box.intrinsic[1]*scale<=box.height+.01);
      if(width===420)await page.screenshot({path:join(artifacts,`${name}-${width}x${height}.png`)});
    }
  }
  console.log('Landscape, 4:3 and portrait media fit all four window sizes without overflow. Screenshots: '+artifacts);
} finally {
  if(app)await app.close();
  if(temp.startsWith(root+sep)&&await realpath(temp)===temp)await rm(temp,{recursive:true,force:true});
}
