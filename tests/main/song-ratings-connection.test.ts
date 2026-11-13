import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSongRatingsConfig, SongRatingsConnection } from '../../src/main/song-ratings-connection';
const recordingKey='youtube:Abcdefghijk',token='rating-writer-0123456789-abcdefghijklmnopqrstuvwxyz',baseUrl='https://apps.example.test';
const summary={recordingKey,average:8,count:1,ownVote:null};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function fixture(work:(folder:string)=>Promise<void>){const folder=await mkdtemp(join(tmpdir(),'tpv-ratings-'));try{await work(folder);}finally{await rm(folder,{recursive:true,force:true});}}
function deferred<T>(){let resolve!:(value:T)=>void;return{promise:new Promise<T>(done=>{resolve=done;}),resolve:(value:T)=>resolve(value)};}

test('a missing host credential enables public aggregate reads but cannot write; bad existing credentials never fall back',async()=>fixture(async folder=>{
  const file=join(folder,'rating-connection.json');let calls=0;
  const connection=new SongRatingsConnection(file,{fetch:async(_input,init)=>{calls++;assert.equal((init?.headers as Record<string,string>).Authorization,undefined);return json({items:[summary]});}});
  assert.equal(await readSongRatingsConfig(file),null);
  const result=await connection.lookup([recordingKey]);assert.equal(result.status,'ready');if(result.status==='ready')assert.equal(result.canVote,false);
  assert.equal((await connection.vote(recordingKey,8)).status,'configuration-required');
  await writeFile(file,'not a private config',{mode:0o600});
  assert.equal((await connection.lookup([recordingKey])).status,'configuration-error');assert.equal(calls,1);
  await assert.rejects(readSongRatingsConfig('relative.json'));
}));

test('a dedicated host credential authorizes exactly the current host vote and rejects URL-carried secrets',async()=>fixture(async folder=>{
  const file=join(folder,'rating-connection.json');await writeFile(file,JSON.stringify({baseUrl,token}),{mode:0o600});
  const connection=new SongRatingsConnection(file,{fetch:async(_input,init)=>{
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+token);
    return json({...summary,ownVote:JSON.parse(init?.body as string).value});
  }});
  assert.equal((await connection.vote(recordingKey,9)).status,'ready');
  await writeFile(file,JSON.stringify({baseUrl:baseUrl+'?token=bad',token}));
  await assert.rejects(readSongRatingsConfig(file),error=>error instanceof Error&&!error.message.includes(token)&&!error.message.includes(folder));
}));

test('an explicitly selected missing profile is an error and cannot silently switch to public access',async()=>fixture(async folder=>{
  let calls=0;
  const connection=new SongRatingsConnection(join(folder,'explicit.json'),{requireConfig:true,fetch:async()=>{calls++;return json({items:[summary]});}});
  assert.equal((await connection.lookup([recordingKey])).status,'configuration-error');
  assert.equal((await connection.vote(recordingKey,8)).status,'configuration-error');assert.equal(calls,0);
}));

test('POSIX rating credentials must belong to this user with no group/world access',{skip:process.platform==='win32'},async()=>fixture(async folder=>{
  const file=join(folder,'rating-connection.json');await writeFile(file,JSON.stringify({baseUrl,token}),{mode:0o600});
  await chmod(file,0o644);await assert.rejects(readSongRatingsConfig(file));
  await chmod(file,0o600);assert.equal((await readSongRatingsConfig(file))?.token,token);
}));

test('an old credential read cannot replace a newly installed voter or surface that old voter’s own score',async()=>fixture(async folder=>{
  const first=deferred<{baseUrl:string;token:string}>();let reads=0,calls=0;
  const connection=new SongRatingsConnection(join(folder,'ratings.json'),{readConfig:()=>++reads===1?first.promise:Promise.resolve({baseUrl,token:token+'-new'}),fetch:async(_input,init)=>{
    calls++;assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+token+'-new');return json({items:[{...summary,ownVote:8}]});
  }});
  const old=connection.lookup([recordingKey]);assert.equal((await connection.lookup([recordingKey])).status,'ready');
  first.resolve({baseUrl,token});assert.equal((await old).status,'unavailable');assert.equal(calls,1);
}));

test('a newer unreadable credential fences pending replies instead of presenting revoked own votes',async()=>fixture(async folder=>{
  const started=deferred<void>(),reply=deferred<Response>();let reads=0;
  const connection=new SongRatingsConnection(join(folder,'ratings.json'),{readConfig:async()=>{if(++reads>1)throw Error('bad config');return{baseUrl,token};},fetch:async()=>{started.resolve();return reply.promise;}});
  const old=connection.lookup([recordingKey]);await started.promise;
  assert.equal((await connection.lookup([recordingKey])).status,'configuration-error');
  reply.resolve(json({items:[{...summary,ownVote:8}]}));assert.equal((await old).status,'unavailable');
}));
