import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, lstat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { ownerOnlyDiscoveryAccess, profileIdentity, readControlDiscovery, type DiscoveryAccess } from '../../src/control/discovery';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';
import { LocalControlServer, type LocalControlOptions } from '../../src/control/server';
import type { ControlDiscovery } from '../../src/control/protocol';

// Fixtures are synthetic and their enclosing directory is protected once below.
// Separate discovery tests exercise the real per-file production permission guard.
export const fixtureAccess:DiscoveryAccess={protect:async()=>{},verify:async()=>{}};
export async function privateFixture(work:(profile:string)=>Promise<void>):Promise<void>{
  const root=await realpath(tmpdir()),profile=await mkdtemp(join(root,'tpv-control-test-')),identity=await lstat(profile);
  await ownerOnlyDiscoveryAccess.protect(profile,true);
  try{await work(await realpath(profile));}
  finally{const actual=await realpath(profile),current=await lstat(profile);assert.equal(dirname(actual),root);assert.ok(actual.startsWith(root+sep));assert.equal(current.ino,identity.ino);assert.equal(current.dev,identity.dev);assert.equal(current.isSymbolicLink(),false);await rm(actual,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
export function discoveryFor(profile:string,extra:Partial<ControlDiscovery>={}):ControlDiscovery{return{format:1,host:'127.0.0.1',port:12345,pid:process.pid,instanceId:randomBytes(16).toString('hex'),token:randomBytes(32).toString('base64url'),profileDirectory:profile,profileId:profileIdentity(profile),...extra};}
export async function serverFixture(work:(server:LocalControlServer,d:ControlDiscovery,profile:string)=>Promise<void>,extra:Partial<LocalControlOptions>={}):Promise<void>{
  await privateFixture(async profile=>{
    const server=new LocalControlServer({profileDirectory:profile,enabled:true,access:fixtureAccess,applicationVersion:'0.0.1',adapter:{getState:()=>({showId:'synthetic-show',revision:1}),getSettings:()=>({...DEFAULT_SETTINGS,sharedCatalogConfigFile:'/private/catalog.json',ratingProfileConfigFile:'/private/voter.json'}),getShortcuts:()=>DEFAULT_SHORTCUTS},...extra});
    try{await server.start();const d=await readControlDiscovery(profile,fixtureAccess);await work(server,d,profile);}finally{await server.stop();}
  });
}
export async function httpControl(d:ControlDiscovery,path:string,options:{method?:string;headers?:Record<string,string|string[]>;body?:string;chunks?:string[];anonymous?:boolean}={}):Promise<{status:number;headers:Record<string,string|string[]|undefined>;body:unknown}>{
  return new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:d.port,path,method:options.method??'GET',headers:{...(!options.anonymous?{Authorization:'Bearer '+d.token}:{}),...options.headers}},response=>{
      const chunks:Buffer[]=[];response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);response.once('end',()=>{const text=Buffer.concat(chunks).toString();let body:unknown;try{body=JSON.parse(text);}catch{body=text;}resolve({status:response.statusCode??0,headers:response.headers,body});});
    });
    req.once('error',reject);if(options.chunks){for(const chunk of options.chunks)req.write(chunk);}req.end(options.body);
  });
}
