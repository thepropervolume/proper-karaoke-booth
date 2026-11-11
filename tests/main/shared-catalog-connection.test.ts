import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { SharedCatalogConnection, readSharedCatalogConfig } from '../../src/main/shared-catalog-connection';
import { SharedCatalogClient } from '../../src/main/shared-catalog-client';
import { parseSettings } from '../../src/domain/settings';
const token = 'fake-read-only-client-token-123456789';
const baseUrl = 'https://apps.example.test';
const metadata = {revision:'1',lastSuccess:null,lastAttempt:null};
const searchPage = {items:[{artist:'Artist',title:'Song',brandSlug:'Example',youtubeId:'abcdefghijk',uploadDate:null}],nextCursor:null,metadata};
const serviceStatus = {...metadata,recordCount:1,searchableCount:1};
const json = (value:unknown) => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function fixture(run:(root:string)=>Promise<void>) {
  const temporaryRoot = await realpath(tmpdir()), root = await mkdtemp(join(temporaryRoot,'shared-connection-'));
  try { await run(root); }
  finally { assert.equal(dirname(await realpath(root)),temporaryRoot); await rm(root,{recursive:true,force:true}); }
}
async function configFile(root:string,name:string,credential=token) {
  const file=join(root,name);await writeFile(file,JSON.stringify({baseUrl,token:credential}),{mode:0o600});return file;
}
test('catalog settings upgrade defaults and private config parsing reject secrets in URLs or unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(),'shared-config-'));
  try {
    assert.equal(parseSettings({}).sharedCatalogEnabled,true);assert.equal(parseSettings({}).sharedCatalogConfigFile,'');
    for(const value of ['relative',null,42]) assert.throws(()=>parseSettings({sharedCatalogConfigFile:value}));
    const file = join(root,'client.json');
    await writeFile(file,JSON.stringify({baseUrl:'https://apps.thepropervolume.com',token}),{mode:0o600});
    assert.deepEqual(await readSharedCatalogConfig(file),{baseUrl:'https://apps.thepropervolume.com',token});
    for(const config of [{baseUrl:'http://example.test',token},{baseUrl:'https://example.test/?token=bad',token},{baseUrl:'https://user:pass@example.test',token},{baseUrl:'https://example.test',token,password:'private'}]) {
      await writeFile(file,JSON.stringify(config));await assert.rejects(readSharedCatalogConfig(file),error=>error instanceof Error&&!error.message.includes(token)&&!error.message.includes(root));
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
test('host projection preserves unknown brand identity and freshness without exposing credentials or provider extras',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shared-projection-'));
  try{
    const file=join(root,'client.json');await writeFile(file,JSON.stringify({baseUrl:'https://apps.thepropervolume.com',token}),{mode:0o600});
    const connection=new SharedCatalogConnection(join(root,'cache.json'),(config,cacheFile)=>new SharedCatalogClient({...config,cacheFile,fetch:async()=>new Response(JSON.stringify({items:[{artist:'Artist',title:'Song',brandSlug:'',brandCode:'RAW',youtubeId:'abcdefghijk',uploadDate:null,secret:'do not project'}],nextCursor:null,metadata:{revision:'2',lastSuccess:null,lastAttempt:null}}),{headers:{'content-type':'application/json'}})}));
    const result=await connection.search(file,'Song');assert.equal(result.status,'ready');
    if(result.status==='ready'){assert.equal(result.tracks[0].brand,'RAW');assert.equal(result.tracks[0].brandSlug,undefined);assert.equal(result.source,'shared');assert.equal(result.lastSuccess,null);}
    assert.doesNotMatch(JSON.stringify(result),/do not project|fake-read-only/);
    await assert.rejects(connection.search(file,'x'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('unsaved configuration checks cannot replace the active client or invalidate its offline queries',{timeout:5000},async()=>fixture(async root=>{
  const activeFile=await configFile(root,'active.json'),draftFile=await configFile(root,'draft.json',token+'-draft'),cacheFile=join(root,'cache.json');
  let pending=false,draftDenied=false,offline=false,resolveSearch!:(response:Response)=>void;
  let markStarted!:()=>void;const activeStarted=new Promise<void>(resolve=>{markStarted=resolve;});
  const connection=new SharedCatalogConnection(cacheFile,(config,cacheFile)=>new SharedCatalogClient({...config,cacheFile,fetch:async input=>{
    if(config.token!==token)return draftDenied?new Response(null,{status:403}):json(serviceStatus);
    if(offline)throw new Error('offline');
    if(pending&&!String(input).endsWith('/status'))return new Promise(resolve=>{resolveSearch=resolve;markStarted();});
    return json(searchPage);
  }}));
  assert.equal((await connection.search(activeFile,'Song')).status,'ready');
  pending=true;
  const activeSearch=connection.search(activeFile,'Song');
  // Wait for the active request to be issued without relying on scheduling delays.
  await activeStarted;
  assert.equal((await connection.status(draftFile,false)).status,'ready');
  resolveSearch(json(searchPage));assert.equal((await activeSearch).status,'ready');
  draftDenied=true;assert.equal((await connection.status(draftFile,false)).status,'forbidden');
  offline=true;
  const cached=await connection.search(activeFile,'Song');assert.equal(cached.status,'ready');
  if(cached.status==='ready')assert.equal(cached.source,'offline-cache');
  const restarted=new SharedCatalogConnection(cacheFile,(config,cacheFile)=>new SharedCatalogClient({...config,cacheFile,fetch:async()=>{throw new Error('offline');}}));
  const restored=await restarted.search(activeFile,'Song');assert.equal(restored.status,'ready');
  if(restored.status==='ready')assert.equal(restored.source,'offline-cache');
}));

test('active status denial invalidates future offline queries, including after restart before the first search',async()=>fixture(async root=>{
  const activeFile=await configFile(root,'active.json');
  for(const coldStart of [false,true]){
    const cacheFile=join(root,`cache-${coldStart}.json`);let denied=false,offline=false;
    const create=(config:{baseUrl:string;token:string},cacheFile:string)=>new SharedCatalogClient({...config,cacheFile,fetch:async input=>{
      if(offline)throw new Error('offline');
      return denied&&String(input).endsWith('/status')?new Response(null,{status:403}):json(searchPage);
    }});
    let connection=new SharedCatalogConnection(cacheFile,create);
    assert.equal((await connection.search(activeFile,'Song')).status,'ready');
    if(coldStart)connection=new SharedCatalogConnection(cacheFile,create);
    denied=true;assert.equal((await connection.status(activeFile)).status,'forbidden');
    offline=true;assert.equal((await connection.search(activeFile,'Song')).status,'unavailable');
    const restarted=new SharedCatalogConnection(cacheFile,create);
    assert.equal((await restarted.search(activeFile,'Song')).status,'unavailable');
  }
}));

test('host search and status projections report failed cache persistence',async()=>fixture(async root=>{
  const file=await configFile(root,'active.json'),occupied=join(root,'directory-not-cache');await mkdir(occupied);
  let offline=false;
  const connection=new SharedCatalogConnection(occupied,(config,cacheFile)=>new SharedCatalogClient({...config,cacheFile,fetch:async input=>{
    if(offline)throw new Error('offline');return json(String(input).endsWith('/status')?serviceStatus:searchPage);
  }}));
  const search=await connection.search(file,'Song');assert.equal(search.status,'ready');
  if(search.status==='ready')assert.equal(search.cachePersisted,false);
  const status=await connection.status(file);assert.equal(status.status,'ready');assert.equal(status.cachePersisted,false);
  offline=true;
  const cached=await connection.search(file,'Song');assert.equal(cached.status,'ready');
  if(cached.status==='ready'){assert.equal(cached.source,'offline-cache');assert.equal(cached.cachePersisted,false);}
  assert.equal((await connection.status(file)).cachePersisted,false);
}));

test('private configurations reject Unix group or world access', {skip:process.platform==='win32'},async()=>fixture(async root=>{
  const file=await configFile(root,'active.json');await chmod(file,0o644);await assert.rejects(readSharedCatalogConfig(file));
  await chmod(file,0o600);assert.equal((await readSharedCatalogConfig(file)).baseUrl,baseUrl);
}));
