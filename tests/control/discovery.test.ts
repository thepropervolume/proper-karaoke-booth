import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CONTROL_DISCOVERY_NAME, ControlError } from '../../src/control/protocol';
import { ownerOnlyDiscoveryAccess, publishControlDiscovery, readControlDiscovery } from '../../src/control/discovery';
import { discoveryFor, fixtureAccess, privateFixture } from './fixtures';

test('discovery is published with real owner-only protection, profile binding and bounded strict fields',async()=>privateFixture(async profile=>{
  const value=discoveryFor(profile),cleanup=await publishControlDiscovery(value);
  try{
    assert.deepEqual(await readControlDiscovery(profile),value);
    await ownerOnlyDiscoveryAccess.verify(join(profile,CONTROL_DISCOVERY_NAME));
    const changed={...value,profileId:'0'.repeat(64)};await writeFile(join(profile,CONTROL_DISCOVERY_NAME),JSON.stringify(changed));
    await assert.rejects(readControlDiscovery(profile),error=>error instanceof ControlError&&error.code==='unsafe-discovery');
    await writeFile(join(profile,CONTROL_DISCOVERY_NAME),JSON.stringify({...value,host:'example.test'}));await assert.rejects(readControlDiscovery(profile));
    await writeFile(join(profile,CONTROL_DISCOVERY_NAME),JSON.stringify({...value,token:value.token+'x'}));await assert.rejects(readControlDiscovery(profile));
    await writeFile(join(profile,CONTROL_DISCOVERY_NAME),'x'.repeat(8193));await assert.rejects(readControlDiscovery(profile));
  }finally{await cleanup();}
}));

test('discovery rejects broadened permissions on both native platforms',async()=>privateFixture(async profile=>{
  const value=discoveryFor(profile);await publishControlDiscovery(value);
  const file=join(profile,CONTROL_DISCOVERY_NAME);
  if(process.platform==='win32')execFileSync('icacls.exe',[file,'/inheritance:e'],{windowsHide:true,stdio:'pipe'});else await chmod(file,0o644);
  await assert.rejects(readControlDiscovery(profile),error=>error instanceof ControlError&&error.code==='unsafe-discovery');
}));

test('live-PID discovery cannot be overwritten and cleanup cannot remove a replacement instance',async()=>privateFixture(async profile=>{
  const first=discoveryFor(profile),cleanup=await publishControlDiscovery(first,fixtureAccess);
  await assert.rejects(publishControlDiscovery(discoveryFor(profile),fixtureAccess),error=>error instanceof ControlError&&error.code==='already-running');
  const path=join(profile,CONTROL_DISCOVERY_NAME);assert.equal(JSON.parse(await readFile(path,'utf8')).instanceId,first.instanceId);
  const replacement=discoveryFor(profile);await writeFile(path,JSON.stringify(replacement));await cleanup();
  assert.equal(JSON.parse(await readFile(path,'utf8')).instanceId,replacement.instanceId);
}));

test('dead-PID discovery is replaced atomically; shutdown only removes its own published file',async()=>privateFixture(async profile=>{
  const previous=discoveryFor(profile,{pid:2147483647});await publishControlDiscovery(previous,fixtureAccess);
  const next=discoveryFor(profile),cleanup=await publishControlDiscovery(next,fixtureAccess);
  assert.equal((await readControlDiscovery(profile,fixtureAccess)).instanceId,next.instanceId);await cleanup();
  await assert.rejects(lstat(join(profile,CONTROL_DISCOVERY_NAME)),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
}));

test('a discovery symlink is refused instead of reading another profile',{skip:process.platform==='win32'},async()=>privateFixture(async profile=>{
  const outside=join(profile,'outside.json');await writeFile(outside,JSON.stringify(discoveryFor(profile)),{mode:0o600});
  await symlink(outside,join(profile,CONTROL_DISCOVERY_NAME));await assert.rejects(readControlDiscovery(profile));
}));

test('cleanup preserves a replacement inserted during its final asynchronous ACL verification',async()=>privateFixture(async profile=>{
  const first=discoveryFor(profile),replacement=discoveryFor(profile),target=join(profile,CONTROL_DISCOVERY_NAME);let cleaning=false,checks=0;
  const access={protect:fixtureAccess.protect,verify:async(path:string)=>{
    if(cleaning&&path===target&&++checks===2){await rename(target,join(profile,'old-discovery.json'));await writeFile(target,JSON.stringify(replacement),{mode:0o600});}
  }};
  const cleanup=await publishControlDiscovery(first,access);cleaning=true;await cleanup();
  assert.equal(checks,2);assert.equal(JSON.parse(await readFile(target,'utf8')).instanceId,replacement.instanceId);
}));

test('stale reclamation rejects a new owner installed during asynchronous verification',async()=>privateFixture(async profile=>{
  const stale=discoveryFor(profile,{pid:2147483647}),replacement=discoveryFor(profile),target=join(profile,CONTROL_DISCOVERY_NAME);let reclaiming=false,checks=0;
  const access={protect:fixtureAccess.protect,verify:async(path:string)=>{
    if(reclaiming&&path===target&&++checks===2){await rename(target,join(profile,'stale-original.json'));await writeFile(target,JSON.stringify(replacement),{mode:0o600});}
  }};
  await publishControlDiscovery(stale,access);reclaiming=true;
  await assert.rejects(publishControlDiscovery(discoveryFor(profile),access),error=>error instanceof ControlError&&error.code==='unsafe-discovery');
  assert.equal(JSON.parse(await readFile(target,'utf8')).instanceId,replacement.instanceId);
}));

test('native permission setup cannot redirect staging writes through a swapped directory junction',async()=>privateFixture(async profile=>privateFixture(async outside=>{
  await writeFile(join(outside,'preserve.txt'),'outside-owned-fixture');let swapped=false;
  const access={verify:ownerOnlyDiscoveryAccess.verify,protect:async(path:string,directory:boolean)=>{
    await ownerOnlyDiscoveryAccess.protect(path,directory);
    if(directory&&!swapped){await rename(path,path+'-original');await symlink(outside,path,process.platform==='win32'?'junction':'dir');swapped=true;}
  }};
  await assert.rejects(publishControlDiscovery(discoveryFor(profile),access),error=>error instanceof ControlError&&error.code==='unsafe-discovery');assert.equal(swapped,true);
  await assert.rejects(lstat(join(outside,CONTROL_DISCOVERY_NAME)),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
  await assert.rejects(lstat(join(profile,CONTROL_DISCOVERY_NAME)),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
  assert.equal(await readFile(join(outside,'preserve.txt'),'utf8'),'outside-owned-fixture');
})));

test('a staged inode replacement during native verification is never linked into discovery',async()=>privateFixture(async profile=>{
  let swapped=false;
  const replacement=discoveryFor(profile);
  const access={protect:ownerOnlyDiscoveryAccess.protect,verify:async(path:string)=>{
    await ownerOnlyDiscoveryAccess.verify(path);
    if(!swapped&&basename(path)===CONTROL_DISCOVERY_NAME&&basename(dirname(path)).startsWith('.tpv-control-')){
      await rename(path,path+'.original');await writeFile(path,JSON.stringify(replacement),{mode:0o600});swapped=true;
    }
  }};
  await assert.rejects(publishControlDiscovery(discoveryFor(profile),access),error=>error instanceof ControlError&&error.code==='unsafe-discovery');assert.equal(swapped,true);
  await assert.rejects(lstat(join(profile,CONTROL_DISCOVERY_NAME)),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
}));

test('directory swaps after native file verification cannot publish or delete outside-owned files',async()=>privateFixture(async profile=>privateFixture(async outside=>{
  await writeFile(join(outside,'preserve.txt'),'outside-owned-fixture');let swapped=false,attempted=false,blockedByOpenHandle=false;
  const access={protect:ownerOnlyDiscoveryAccess.protect,verify:async(path:string)=>{
    await ownerOnlyDiscoveryAccess.verify(path);
    const directory=dirname(path);
    if(!swapped&&basename(directory).startsWith('.tpv-control-')){
      attempted=true;
      try{await rename(directory,directory+'-original');}
      catch(error){blockedByOpenHandle=process.platform==='win32'&&['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??'');throw error;}
      await symlink(outside,directory,process.platform==='win32'?'junction':'dir');swapped=true;
    }
  }};
  await assert.rejects(publishControlDiscovery(discoveryFor(profile),access),error=>error instanceof ControlError&&error.code==='unsafe-discovery');assert.equal(attempted,true);assert.ok(swapped||blockedByOpenHandle);
  await assert.rejects(lstat(join(outside,CONTROL_DISCOVERY_NAME)),error=>(error as NodeJS.ErrnoException).code==='ENOENT');
  assert.equal(await readFile(join(outside,'preserve.txt'),'utf8'),'outside-owned-fixture');
})));
