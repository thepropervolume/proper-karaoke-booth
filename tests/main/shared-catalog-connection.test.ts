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
function deferred<T>() {
  let resolve!:(value:T)=>void;
  return {promise:new Promise<T>(done=>{resolve=done;}),resolve:(value:T)=>resolve(value)};
}

test('a new installation can search the public service without reading or embedding a private configuration',async()=>fixture(async root=>{
  let privateReads=0,offline=false;
  const createPublic=(cacheFile:string)=>new SharedCatalogClient({baseUrl,public:true,cacheFile,fetch:async input=>{
    if(offline)throw new Error('offline');return json(String(input).endsWith('/status')?serviceStatus:searchPage);
  }});
  const connection=new SharedCatalogConnection(join(root,'cache.json'),()=>{throw Error('private factory must not run');},async()=>{privateReads++;throw Error('no private config');},createPublic);
  assert.equal((await connection.publicSearch('Song')).status,'ready');
  const status=await connection.publicStatus();assert.equal(status.status,'ready');assert.equal(status.connectionMode,'public');
  assert.equal(privateReads,0);
  offline=true;
  const restarted=new SharedCatalogConnection(join(root,'cache.json'),undefined,undefined,createPublic);
  const cached=await restarted.publicSearch('Song');assert.equal(cached.status,'ready');if(cached.status==='ready')assert.equal(cached.source,'offline-cache');
  assert.equal((await restarted.publicSearch('new query')).status,'unavailable');
}));

test('both catalog authorities preserve continuations and cache each page independently',async()=>fixture(async root=>{
  const config=await configFile(root,'connected.json'),seen: (string | null)[]=[];
  let offline=false;
  const fetcher: typeof fetch=async input=>{
    if(offline)throw new Error('offline');
    const cursor=new URL(String(input)).searchParams.get('cursor');
    seen.push(cursor);
    return json(cursor === null ? {...searchPage,nextCursor:'p2'} :
      {...searchPage,items:[{...searchPage.items[0],youtubeId:'klmnopqrstu',title:'Next'}]});
  };
  const build=()=>new SharedCatalogConnection(join(root,'pages.json'),
    (configuration,cacheFile)=>new SharedCatalogClient({...configuration,cacheFile,fetch:fetcher}),
    undefined,cacheFile=>new SharedCatalogClient({baseUrl,public:true,cacheFile,fetch:fetcher}));
  const connection=build();
  const publicPage=await connection.publicSearch('Song');
  assert.equal(publicPage.status,'ready');assert.ok(publicPage.nextCursor);
  const nextPublic=await connection.publicSearch('Song',publicPage.nextCursor);
  assert.equal(nextPublic.status,'ready');assert.equal(nextPublic.tracks[0].title,'Next');assert.equal(nextPublic.nextCursor,null);
  const privatePage=await connection.search(config,'Song');
  assert.equal(privatePage.status,'ready');assert.ok(privatePage.nextCursor);
  const nextPrivate=await connection.search(config,'Song',privatePage.nextCursor);
  assert.equal(nextPrivate.status,'ready');assert.equal(nextPrivate.tracks[0].title,'Next');
  assert.deepEqual(seen,[null,'p2',null,'p2']);
  offline=true;
  const restarted=build();
  const cachedPublicPage=await restarted.publicSearch('Song');
  assert.equal(cachedPublicPage.status,'ready');assert.ok(cachedPublicPage.nextCursor);
  const cached=await restarted.publicSearch('Song',cachedPublicPage.nextCursor);
  assert.equal(cached.status,'ready');assert.equal(cached.source,'offline-cache');assert.equal(cached.tracks[0].title,'Next');
  const cachedPrivatePage=await restarted.search(config,'Song');
  assert.equal(cachedPrivatePage.status,'ready');assert.ok(cachedPrivatePage.nextCursor);
  assert.equal((await restarted.search(config,'Song',cachedPrivatePage.nextCursor)).status,'ready');
}));

test('an in-place credential change invalidates old continuation handles',async()=>fixture(async root=>{
  const activeFile=await configFile(root,'active.json');
  let credential=token, requests=0;
  const connection=new SharedCatalogConnection(join(root,'cache.json'),(config,cacheFile)=>new SharedCatalogClient({...config,cacheFile,fetch:async()=>{
    ++requests;return json({...searchPage,nextCursor:'p2'});
  }}),async()=>({baseUrl,token:credential}));
  const initial=await connection.search(activeFile,'Song');
  assert.equal(initial.status,'ready');assert.ok(initial.nextCursor);
  credential+='-replacement';
  assert.equal((await connection.search(activeFile,'Song',initial.nextCursor)).status,'invalid-request');
  assert.equal(requests,1);
}));

test('a cancelled continuation does not wait for the fetcher or return cached results',async()=>fixture(async root=>{
  let observedSignal: AbortSignal | null | undefined;
  const started=deferred<void>();
  let pending=false;
  const connection=new SharedCatalogConnection(join(root,'cancel.json'),undefined,undefined,cacheFile=>new SharedCatalogClient({
    baseUrl,public:true,cacheFile,fetch:async (_input,init)=>{
      if(!pending)return json({...searchPage,nextCursor:'p2'});
      observedSignal=init?.signal;started.resolve();
      return new Promise<Response>(()=>{});
    },timeoutMs:60000,
  }));
  const initial=await connection.publicSearch('Song');
  assert.equal(initial.status,'ready');assert.ok(initial.nextCursor);
  assert.equal((await connection.publicSearch('Song',initial.nextCursor)).status,'ready');
  pending=true;
  const controller=new AbortController();
  const request=connection.publicSearch('Song',initial.nextCursor,controller.signal);
  await started.promise;controller.abort();
  assert.equal((await request).status,'timed-out');
  assert.equal(observedSignal?.aborted,true);
}));

test('public replies are fenced when an explicitly selected private configuration is invalid',async()=>fixture(async root=>{
  const started=deferred<void>(),reply=deferred<Response>();
  const connection=new SharedCatalogConnection(join(root,'cache.json'),undefined,async()=>{throw Error('bad private configuration');},cacheFile=>new SharedCatalogClient({baseUrl,public:true,cacheFile,fetch:async()=>{started.resolve();return reply.promise;}}));
  const pending=connection.publicSearch('Song');await started.promise;
  assert.equal((await connection.search(join(root,'explicit.json'),'Song')).status,'configuration-error');
  reply.resolve(json(searchPage));assert.equal((await pending).status,'unavailable');
}));

test('switching to public scope prevents an older private read from reinstalling credentials',async()=>fixture(async root=>{
  const read=deferred<{baseUrl:string;token:string}>();let privateCalls=0;
  const connection=new SharedCatalogConnection(join(root,'cache.json'),()=>{privateCalls++;throw Error('old client');},()=>read.promise,
    cacheFile=>new SharedCatalogClient({baseUrl,public:true,cacheFile,fetch:async()=>json(searchPage)}));
  const pending=connection.search(join(root,'private.json'),'Song');
  assert.equal((await connection.publicSearch('Song')).status,'ready');
  read.resolve({baseUrl,token});assert.equal((await pending).status,'unavailable');assert.equal(privateCalls,0);
}));

test('an unsaved public status check cannot replace an active private search authority',async()=>fixture(async root=>{
  const started=deferred<void>(),reply=deferred<Response>();
  const connection=new SharedCatalogConnection(join(root,'cache.json'),(config,cacheFile)=>new SharedCatalogClient({...config,cacheFile,fetch:async()=>{started.resolve();return reply.promise;}}),
    async()=>({baseUrl,token}),cacheFile=>new SharedCatalogClient({baseUrl,public:true,cacheFile,fetch:async()=>new Response(null,{status:403})}));
  const pending=connection.search(join(root,'private.json'),'Song');await started.promise;
  assert.equal((await connection.publicStatus(false)).status,'forbidden');
  reply.resolve(json(searchPage));assert.equal((await pending).status,'ready');
}));
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

test('older configuration reads cannot replace a newer client, lose its result or overwrite its offline cache',{timeout:5000},async()=>fixture(async root=>{
  for(const samePath of [false,true]){
    const cacheFile=join(root,`switch-${samePath}.json`),pathA=join(root,'a.json'),pathB=samePath?pathA:join(root,'b.json');
    const configA={baseUrl,token},configB={baseUrl,token:token+'-new'};
    const oldRead=deferred<typeof configA>(),started=deferred<void>(),newResponse=deferred<Response>();
    let reads=0;const clients:string[]=[],fetches:string[]=[];
    const connection=new SharedCatalogConnection(cacheFile,(config,cacheFile)=>{
      clients.push(config.token);
      return new SharedCatalogClient({...config,cacheFile,fetch:async()=>{
        fetches.push(config.token);started.resolve();return newResponse.promise;
      }});
    },async()=>++reads===1?oldRead.promise:configB);
    const oldSearch=connection.search(pathA,'Song'),newSearch=connection.search(pathB,'Song');
    await started.promise;oldRead.resolve(configA);
    assert.equal((await oldSearch).status,'unavailable');
    assert.deepEqual(clients,[configB.token]);assert.deepEqual(fetches,[configB.token]);
    newResponse.resolve(json(searchPage));assert.equal((await newSearch).status,'ready');
    const restarted=new SharedCatalogConnection(cacheFile,(config,cacheFile)=>new SharedCatalogClient({...config,cacheFile,fetch:async()=>{throw new Error('offline');}}),async()=>configB);
    const cached=await restarted.search(pathB,'Song');assert.equal(cached.status,'ready');
    if(cached.status==='ready')assert.equal(cached.source,'offline-cache');
  }
}));

test('parallel reads of the same active credentials share one authority without rejecting an older read',{timeout:5000},async()=>fixture(async root=>{
  const path=join(root,'active.json'),first=deferred<{baseUrl:string;token:string}>(),second=deferred<{baseUrl:string;token:string}>();
  let reads=0,clients=0;
  const connection=new SharedCatalogConnection(join(root,'parallel.json'),(config,cacheFile)=>{
    ++clients;return new SharedCatalogClient({...config,cacheFile,fetch:async input=>json(String(input).endsWith('/status')?serviceStatus:searchPage)});
  },()=>++reads===1?first.promise:second.promise);
  const search=connection.search(path,'Song'),status=connection.status(path);
  second.resolve({baseUrl,token});assert.equal((await status).status,'ready');
  first.resolve({baseUrl,token});assert.equal((await search).status,'ready');assert.equal(clients,1);
}));

test('a delayed same-scope read preserves the active status denial latch',{timeout:5000},async()=>fixture(async root=>{
  const path=join(root,'active.json'),cacheFile=join(root,'denial.json'),config={baseUrl,token};
  const create=(config:{baseUrl:string;token:string},cacheFile:string)=>new SharedCatalogClient({...config,cacheFile,fetch:async input=>{
    if(String(input).endsWith('/status'))return new Response(null,{status:403});throw new Error('offline');
  }});
  const seed=new SharedCatalogClient({...config,cacheFile,fetch:async()=>json(searchPage)});assert.equal((await seed.search({query:'Song'})).status,'ready');
  const oldRead=deferred<typeof config>();let reads=0,clients=0;
  const connection=new SharedCatalogConnection(cacheFile,(config,cacheFile)=>{++clients;return create(config,cacheFile);},async()=>++reads===1?oldRead.promise:config);
  const delayedSearch=connection.search(path,'Song');assert.equal((await connection.status(path)).status,'forbidden');
  oldRead.resolve(config);assert.equal((await delayedSearch).status,'unavailable');assert.equal(clients,1);
  const restarted=new SharedCatalogConnection(cacheFile,create,async()=>config);assert.equal((await restarted.search(path,'Song')).status,'unavailable');
}));

test('an active path change supersedes in-flight replies even when the replacement configuration cannot be read',{timeout:5000},async()=>fixture(async root=>{
  const oldResponse=deferred<Response>(),started=deferred<void>(),pathA=join(root,'a.json'),pathB=join(root,'b.json');
  const connection=new SharedCatalogConnection(join(root,'reply.json'),(config,cacheFile)=>new SharedCatalogClient({...config,cacheFile,fetch:async()=>{
    started.resolve();return oldResponse.promise;
  }}),async path=>{if(path===pathB)throw new Error('Invalid replacement');return {baseUrl,token};});
  const oldSearch=connection.search(pathA,'Song');await started.promise;
  assert.equal((await connection.search(pathB,'Song')).status,'configuration-error');
  oldResponse.resolve(json(searchPage));assert.equal((await oldSearch).status,'unavailable');
}));
