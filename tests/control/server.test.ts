import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';
import { LocalControlServer } from '../../src/control/server';
import { CONTROL_DISCOVERY_NAME } from '../../src/control/protocol';
import { readControlDiscovery } from '../../src/control/discovery';
import { fixtureAccess, httpControl, privateFixture, serverFixture } from './fixtures';

test('control API is disabled by default without creating discovery or invoking the authority',async()=>privateFixture(async profile=>{
  let calls=0;const server=new LocalControlServer({profileDirectory:join(profile,'not-created'),adapter:{getState:()=>{calls++;return{};},getSettings:()=>DEFAULT_SETTINGS,getShortcuts:()=>DEFAULT_SHORTCUTS}});
  assert.deepEqual(await server.start(),{status:'disabled'});assert.deepEqual(server.status(),{status:'disabled'});await server.stop();assert.equal(calls,0);
  await assert.rejects(lstat(join(profile,'not-created')),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
}));

test('loopback reads require bearer auth, exact Host and no browser Origin; unsupported requests never reach the adapter',async()=>{
  let reads=0;
  await serverFixture(async(_server,d)=>{
    assert.equal((await httpControl(d,'/v1/state',{anonymous:true})).status,401);
    assert.equal((await httpControl(d,'/v1/state',{headers:{Origin:'https://attacker.example'}})).status,403);
    assert.equal((await httpControl(d,'/v1/state',{headers:{Host:`attacker.example:${d.port}`}})).status,403);
    assert.equal((await httpControl(d,'/v1/state',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await httpControl(d,'/v1/state',{headers:{Authorization:['Bearer '+d.token,'Bearer '+d.token]}})).status,401);
    assert.equal((await httpControl(d,'/v1/state',{method:'POST',body:'{}'})).status,405);
    assert.equal((await httpControl(d,'/v1/state?token=do-not-echo')).status,400);
    assert.equal((await httpControl(d,'/v1/sql')).status,404);assert.equal(reads,0);
    const result=await httpControl(d,'/v1/state');assert.equal(result.status,200);assert.equal(reads,1);
    assert.equal(result.headers['access-control-allow-origin'],undefined);
    assert.equal(result.headers['cache-control'],'no-store');
    assert.equal((result.body as {result:{token:string}}).result.token,'[redacted]');assert.doesNotMatch(JSON.stringify(result.body),/adapter-private-value/);
  },{adapter:{getState:()=>{reads++;return{showId:'synthetic',token:'adapter-private-value'};},getSettings:()=>DEFAULT_SETTINGS,getShortcuts:()=>DEFAULT_SHORTCUTS}});
});

test('settings paths require explicit projection and only registered navigation callbacks can mutate',async()=>{
  let opened=0;
  await serverFixture(async(_server,d)=>{
    const settings=await httpControl(d,'/v1/settings');assert.equal(settings.status,200);
    assert.equal((settings.body as {result:{settings:{ratingProfileConfigFile:string}}}).result.settings.ratingProfileConfigFile,'');
    const explicit=await httpControl(d,'/v1/settings?includePrivatePaths=true');
    assert.equal((explicit.body as {result:{settings:{ratingProfileConfigFile:string}}}).result.settings.ratingProfileConfigFile,'/private/voter.json');
    const capabilities=await httpControl(d,'/v1/capabilities');
    assert.deepEqual((capabilities.body as {result:{actions:unknown}}).result.actions,{settings:true,keybindings:false});
    const post=(body:unknown)=>httpControl(d,'/v1/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post({action:'play'})).status,400);assert.equal((await post({action:'settings',sql:'arbitrary'})).status,400);
    assert.equal((await post({action:'keybindings'})).status,501);assert.equal(opened,0);
    assert.equal((await post({action:'settings'})).status,200);assert.equal(opened,1);
    assert.equal((await httpControl(d,'/v1/settings?includePrivatePaths=true&includePrivatePaths=false')).status,400);
    assert.equal((await httpControl(d,'/v1/shortcuts')).status,200);
  },{adapter:{getState:()=>({}),getSettings:()=>({...DEFAULT_SETTINGS,ratingProfileConfigFile:'/private/voter.json'}),getShortcuts:()=>DEFAULT_SHORTCUTS,openSettings:()=>{opened++;}}});
});

test('body/header limits and adapter failures produce safe errors without executing arbitrary work',async()=>{
  let opened=0;
  await serverFixture(async(_server,d)=>{
    const oversized=await httpControl(d,'/v1/actions',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1000'},body:'x'.repeat(1000)});assert.equal(oversized.status,413);
    const chunked=await httpControl(d,'/v1/actions',{method:'POST',headers:{'Content-Type':'application/json'},chunks:['x'.repeat(40),'x'.repeat(40)]});assert.equal(chunked.status,413);
    const encoded=await httpControl(d,'/v1/actions',{method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':'gzip'},body:'{}'});assert.equal(encoded.status,400);assert.equal(opened,0);
    const failed=await httpControl(d,'/v1/state');assert.equal(failed.status,500);assert.doesNotMatch(JSON.stringify(failed.body),/database-password-do-not-log/);
    const header=await httpControl(d,'/v1/capabilities',{headers:{'X-Oversized':'x'.repeat(9000)}});assert.equal(header.status,400);
  },{maxRequestBytes:64,adapter:{getState:()=>{throw Error('database-password-do-not-log');},getSettings:()=>DEFAULT_SETTINGS,getShortcuts:()=>DEFAULT_SHORTCUTS,openSettings:()=>{opened++;}}});
});

test('an uncooperative adapter is timed out and retains its bounded concurrency lease until settlement',async()=>{
  let finish!:(value:unknown)=>void,observed:AbortSignal|undefined;
  await serverFixture(async(_server,d)=>{
    const timed=await httpControl(d,'/v1/state');assert.equal(timed.status,504);assert.equal(observed?.aborted,true);
    assert.equal((await httpControl(d,'/v1/capabilities')).status,429);
    finish({showId:'done'});await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await httpControl(d,'/v1/capabilities')).status,200);
  },{deadlineMs:50,maxConcurrent:1,adapter:{getState:signal=>{observed=signal;return new Promise(resolve=>{finish=resolve;});},getSettings:()=>DEFAULT_SETTINGS,getShortcuts:()=>DEFAULT_SHORTCUTS}});
});

test('concurrent lifecycle calls serialize and rotate credentials after stop without overwriting discovery',async()=>privateFixture(async profile=>{
  const server=new LocalControlServer({profileDirectory:profile,enabled:true,access:fixtureAccess,adapter:{getState:()=>({}),getSettings:()=>DEFAULT_SETTINGS,getShortcuts:()=>DEFAULT_SHORTCUTS}});
  try{
    const [a,b]=await Promise.all([server.start(),server.start()]);assert.deepEqual(a,b);
    const first=await readControlDiscovery(profile,fixtureAccess);
    const stop=server.stop(),start=server.start();await stop;await start;
    const next=await readControlDiscovery(profile,fixtureAccess);assert.notEqual(next.instanceId,first.instanceId);assert.ok(next.token!==first.token);
    assert.equal((await httpControl(next,'/v1/capabilities')).status,200);
  }finally{await server.stop();}
  await assert.rejects(lstat(join(profile,CONTROL_DISCOVERY_NAME)),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
}));

test('stop reports undrained work and cannot forget leases or exceed concurrency through restart',async()=>{
  let finish!:(value:unknown)=>void,calls=0;
  await serverFixture(async(server,d,profile)=>{
    assert.equal((await httpControl(d,'/v1/state')).status,504);assert.equal(calls,1);
    await assert.rejects(server.stop(),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='busy');
    assert.deepEqual(server.status(),{status:'stopped',pendingOperations:1});
    await assert.rejects(server.start(),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='busy');assert.equal(calls,1);
    finish({drained:true});await new Promise(resolve=>setImmediate(resolve));await server.start();
    const current=await readControlDiscovery(profile,fixtureAccess);assert.equal((await httpControl(current,'/v1/state')).status,200);assert.equal(calls,2);
  },{deadlineMs:50,maxConcurrent:1,adapter:{getState:()=>++calls===1?new Promise(resolve=>{finish=resolve;}):({drained:true}),getSettings:()=>DEFAULT_SETTINGS,getShortcuts:()=>DEFAULT_SHORTCUTS}});
});

test('status stays stopped during asynchronous protection and becomes ready only after publication',async()=>privateFixture(async profile=>{
  let entered!:()=>void,release!:()=>void;const protecting=new Promise<void>(resolve=>{entered=resolve;}),continueProtecting=new Promise<void>(resolve=>{release=resolve;});
  const server=new LocalControlServer({profileDirectory:profile,enabled:true,access:{verify:fixtureAccess.verify,protect:async(_path,directory)=>{if(directory){entered();await continueProtecting;}}},
    adapter:{getState:()=>({}),getSettings:()=>DEFAULT_SETTINGS,getShortcuts:()=>DEFAULT_SHORTCUTS}});
  try{
    const starting=server.start();await protecting;assert.deepEqual(server.status(),{status:'stopped',pendingOperations:0});
    await assert.rejects(lstat(join(profile,CONTROL_DISCOVERY_NAME)),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
    release();assert.equal((await starting).status,'ready');assert.equal(server.status().status,'ready');
  }finally{release();await server.stop();}
}));
