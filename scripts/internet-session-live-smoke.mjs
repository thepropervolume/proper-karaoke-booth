// Explicit production rehearsal with an isolated show and one temporary public room.
// Never logs owner credentials, guest bearer tokens or private configuration contents.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {copyFile,mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {waitForHostCondition} from './wait-for-host-condition.mjs';

const [repoInput,fixtureInput,privateConfigInput,privateParentInput]=process.argv.slice(2);
if(!repoInput||!fixtureInput||!privateConfigInput||!privateParentInput)throw new Error('Usage: node scripts/internet-session-live-smoke.mjs <repo> <synthetic-video> <private-owner-config> <private-test-parent>');
const repo=await realpath(resolve(repoInput)),fixture=await realpath(resolve(fixtureInput));
const privateParent=await realpath(resolve(privateParentInput));
const temporary=await mkdtemp(join(privateParent,'live-internet-qa-')),profile=join(temporary,'profile');await mkdir(profile);
await copyFile(await realpath(resolve(privateConfigInput)),join(profile,'remote-queue-connection.json'));
const require=createRequire(join(repo,'package.json')),{_electron:electron,chromium}=require('playwright-core');
const executablePath=join(repo,'release/win-unpacked/proper-karaoke-booth.exe');
const chrome=process.env.TPV_QA_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe';
const slug=process.env.TPV_QA_SLUG??`qa-${randomBytes(6).toString('hex')}`;
if(!/^qa-[a-z0-9-]{6,40}$/.test(slug))throw new Error('Use an explicitly known QA session name.');
await writeFile(join(privateParent,'last-public-rehearsal.json'),JSON.stringify({slug,createdAt:new Date().toISOString()}),{mode:0o600});
let app,browser,host,link;
try{
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('TPV_')&&key!=='ELECTRON_RUN_AS_NODE'));
 app=await electron.launch({executablePath,args:[`--user-data-dir=${profile}`,'--mute-audio'],env,cwd:temporary,timeout:30000});
 assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))),await realpath(profile));
 await app.evaluate(({dialog,clipboard},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});clipboard.writeText=value=>{globalThis.qaCopiedSingerLink=value;};},fixture);
 host=await app.firstWindow();await host.waitForFunction(()=>!!window.tpv?.internetSessions);
 assert.equal(await host.evaluate(()=>window.tpv.getAppVersion()),'0.3.0');
 assert.equal((await host.evaluate(()=>window.tpv.getState())).versions.length,0);
 await host.evaluate(()=>window.tpv.importFiles('files'));
 await waitForHostCondition(host,async()=>(await window.tpv.getState()).versions.length===1);
 await host.getByRole('button',{name:'Remote Sessions',exact:true}).click();
 await host.getByLabel('Session address').fill(slug);await host.getByRole('button',{name:'Start Session',exact:true}).click();
 await host.getByText('Session online. Share the singer link to invite your guests.',{exact:true}).waitFor({timeout:25000});
 link=await host.getByLabel('Singer link').inputValue();assert.equal(link,`https://queue.thepropervolume.com/${slug}`);
 await host.getByRole('button',{name:'Copy Link',exact:true}).click();assert.equal(await app.evaluate(()=>globalThis.qaCopiedSingerLink),link);
 browser=await chromium.launch({executablePath:chrome,headless:true});const context=await browser.newContext();
 const singer=await context.newPage();await singer.goto(link,{waitUntil:'domcontentloaded',timeout:30000});
 await singer.getByLabel('Your name').fill('Internet QA Singer');await singer.getByRole('button',{name:'Join the show',exact:true}).click();
 await singer.getByText('Hello, Internet QA Singer!',{exact:true}).waitFor({timeout:30000});
 let loseReply=true;
 await context.route('**/guest/request',async route=>{if(loseReply){loseReply=false;const received=await route.fetch({maxRedirects:0});assert.equal(received.status(),200);await route.abort('failed');}else await route.continue();});
 await singer.getByRole('button',{name:'Request',exact:true}).click();
 await singer.getByRole('button',{name:'Check request outcome',exact:true}).waitFor({timeout:30000});
 assert.equal((await host.evaluate(()=>window.tpv.getState())).requests.length,1);
 await singer.getByRole('button',{name:'Check request outcome',exact:true}).click();await singer.getByText('accepted',{exact:true}).waitFor({timeout:30000});
 const state=await host.evaluate(()=>window.tpv.getState());assert.equal(state.requests.length,1);assert.equal(state.playback,null);
 await singer.getByRole('button',{name:'Withdraw',exact:true}).click();await singer.getByText('withdrawn',{exact:true}).waitFor({timeout:30000});
 await app.evaluate(()=>{
  const original=globalThis.fetch;let rejectNextPoll=true;
  globalThis.fetch=(input,options)=>{const url=new URL(String(input));if(rejectNextPoll&&url.origin==='https://queue.thepropervolume.com'&&url.pathname==='/v1/relay/host/poll'){rejectNextPoll=false;return Promise.reject(new Error('Synthetic brief connection failure'));}return original(input,options);};
 });
 await singer.getByRole('button',{name:'Refresh',exact:true}).click();
 await waitForHostCondition(host,async()=>(await window.tpv.internetSessions.status()).state==='reconnecting',undefined,{timeout:15000});
 await waitForHostCondition(host,async()=>(await window.tpv.internetSessions.status()).state==='online',undefined,{timeout:35000});
 await singer.getByRole('button',{name:'Refresh',exact:true}).click();await singer.getByText('Hello, Internet QA Singer!',{exact:true}).waitFor();
 await singer.getByLabel('Minutes away').fill('5');await singer.getByRole('button',{name:'Mark me unavailable',exact:true}).click();
 await singer.getByText('Availability updated.',{exact:true}).waitFor({timeout:30000});await singer.getByRole('button',{name:"I'm back",exact:true}).click();
 await singer.getByLabel('Song title',{exact:true}).fill('Internet Missing Song');await singer.getByRole('button',{name:'Send to host',exact:true}).click();
 await singer.getByText('Missing-song request sent to the host.',{exact:true}).waitFor({timeout:30000});
 assert.ok((await host.evaluate(()=>window.tpv.getMissingSongRequests())).some(item=>item.title==='Internet Missing Song'));
 await host.getByRole('button',{name:'End Session',exact:true}).click();await host.getByText('Session ended. Internet singers no longer have access.',{exact:true}).waitFor({timeout:15000});
 await singer.getByRole('button',{name:'Refresh',exact:true}).click();await singer.getByText('This session ended or changed. Check with the host before joining again.',{exact:true}).waitFor({timeout:30000});
 await host.getByRole('button',{name:'Start Session',exact:true}).click();await host.getByLabel('Singer link').waitFor({timeout:25000});
 await browser.close();browser=undefined;await app.close();app=undefined;
 const probe=await fetch(`https://queue.thepropervolume.com/v1/relay/lookup/${slug}`,{signal:AbortSignal.timeout(10000)});
 if(probe.ok)assert.equal((await probe.json()).online,false);else assert.ok([404,410].includes(probe.status));
 console.log('PASS: packaged 0.3.0 over real public HTTPS: custom session, browser join/request, lost-reply receipt recovery without duplication, brief poll outage with same guest scope, withdraw/availability/missing song, no autoplay, End fencing and shutdown.');
}catch(error){
 if(host&&!host.isClosed())console.error('Public session status:',JSON.stringify(await host.evaluate(()=>window.tpv.internetSessions.status()).catch(()=>null)));
 throw error;
}finally{
 if(host&&!host.isClosed())await host.evaluate(()=>window.tpv.internetSessions.stop()).catch(()=>{});
 if(browser)await browser.close().catch(()=>{});if(app)await app.close().catch(()=>{});
 const actual=await realpath(temporary);if(dirname(actual)!==privateParent||!basename(actual).startsWith('live-internet-qa-'))throw new Error('Unsafe test cleanup');
 await rm(actual,{recursive:true,force:true,maxRetries:10,retryDelay:250});
}
