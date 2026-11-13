import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalControlClient } from '../../src/control/client';
import { runControlCli, CONTROL_CLI_EXIT, defaultControlProfile } from '../../src/control/cli';
import { CONTROL_DISCOVERY_NAME, ControlError, INSTANCE_HEADERS } from '../../src/control/protocol';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';
import { fixtureAccess, privateFixture, serverFixture } from './fixtures';

test('CLI help and usage are structured without reading discovery or making network calls',async()=>{
  let stdout='',stderr='',calls=0;
  const io={out:(s:string)=>{stdout+=s;},err:(s:string)=>{stderr+=s;},fetch:async()=>{calls++;throw Error('must not fetch');}};
  assert.equal(await runControlCli(['--help'],io),0);assert.match(stdout,/off by default/);assert.equal(stderr,'');
  stdout='';assert.equal(await runControlCli(['--token','not-allowed'],io),CONTROL_CLI_EXIT.usage);assert.equal(stdout,'');assert.equal(JSON.parse(stderr).error.code,'invalid-request');assert.equal(calls,0);
  assert.equal(defaultControlProfile({XDG_CONFIG_HOME:'/config'},'linux','/home/test'),join('/config','proper-karaoke-booth'));
  assert.equal(defaultControlProfile({},'darwin','/home/test'),join('/home/test','Library','Application Support','proper-karaoke-booth'));
  assert.equal(defaultControlProfile({APPDATA:'/appdata'},'win32','/home/test'),join('/appdata','proper-karaoke-booth'));
});

test('CLI discovers one profile, returns JSON snapshots and uses only advertised navigation actions',async()=>{
  let opened=0;
  await serverFixture(async(_server,d,profile)=>{
    const invoke=async(args:string[])=>{let out='',err='';const code=await runControlCli(['--profile-dir',profile,...args],{access:fixtureAccess,out:s=>{out+=s;},err:s=>{err+=s;}});return{code,out,err};};
    const status=await invoke(['status']);assert.equal(status.code,0);assert.equal(JSON.parse(status.out).status,'ready');assert.equal(status.err,'');assert.ok(!status.out.includes(d.token));
    const state=await invoke(['state']);assert.equal(state.code,0);assert.equal(JSON.parse(state.out).result.showId,'qa-show');
    const settings=await invoke(['settings']);assert.equal(settings.code,0);assert.equal(JSON.parse(settings.out).result.settings.sharedCatalogConfigFile,'');assert.equal(JSON.parse(settings.out).result.settings.providerCatalogProfiles.sunfly,'');assert.doesNotMatch(settings.out,/sunfly\.key/);
    const explicit=await invoke(['settings','--include-private-paths']);assert.equal(JSON.parse(explicit.out).result.settings.sharedCatalogConfigFile,'/private/catalog.json');assert.equal(JSON.parse(explicit.out).result.settings.providerCatalogProfiles.sunfly,'/private/sunfly.key');
    assert.equal((await invoke(['shortcuts'])).code,0);
    assert.equal((await invoke(['open','settings'])).code,0);assert.equal((await invoke(['--settings'])).code,0);assert.equal(opened,2);
    const unsupported=await invoke(['open','keybindings']);assert.equal(unsupported.code,CONTROL_CLI_EXIT.unsupported);assert.equal(JSON.parse(unsupported.err).error.code,'unsupported');
  },{adapter:{getState:()=>({showId:'qa-show'}),getSettings:()=>({...DEFAULT_SETTINGS,sharedCatalogConfigFile:'/private/catalog.json',providerCatalogProfiles:{...DEFAULT_SETTINGS.providerCatalogProfiles,sunfly:'/private/sunfly.key'}}),getShortcuts:()=>DEFAULT_SHORTCUTS,openSettings:()=>{opened++;}}});
});

test('dead-PID discovery never causes an HTTP request and has a stable not-running exit',async()=>serverFixture(async(_server,_d,profile)=>{
  let calls=0,err='';
  const code=await runControlCli(['--profile-dir',profile,'state'],{access:fixtureAccess,isRunning:()=>false,fetch:async()=>{calls++;throw Error();},out:()=>{},err:s=>{err+=s;}});
  assert.equal(code,CONTROL_CLI_EXIT.notRunning);assert.equal(JSON.parse(err).error.code,'not-running');assert.equal(calls,0);
}));

test('stale/wrong credentials cannot be retried anonymously or shown in CLI errors',async()=>serverFixture(async(_server,d,profile)=>{
  const changed={...d,token:'z'.repeat(43)};await writeFile(join(profile,CONTROL_DISCOVERY_NAME),JSON.stringify(changed));
  let out='',err='';const code=await runControlCli(['--discovery',join(profile,CONTROL_DISCOVERY_NAME),'state'],{access:fixtureAccess,out:s=>{out+=s;},err:s=>{err+=s;}});
  assert.equal(code,CONTROL_CLI_EXIT.access);assert.equal(out,'');assert.equal(JSON.parse(err).error.code,'unauthorized');assert.ok(!err.includes(changed.token));assert.ok(!err.includes(d.token));
}));

test('mismatched instance/profile headers are rejected before returning host data',async()=>serverFixture(async(_server,_d,profile)=>{
  const client=new LocalControlClient(profile,{access:fixtureAccess,fetch:async(input,init)=>{
    const response=await fetch(input,init),headers=new Headers(response.headers);headers.set(INSTANCE_HEADERS.instance,'0'.repeat(32));
    return new Response(await response.text(),{status:response.status,headers});
  }});
  await assert.rejects(client.get('state'),error=>error instanceof ControlError&&error.code==='invalid-response');
  let err='';const code=await runControlCli(['--profile-dir',profile,'state'],{access:fixtureAccess,fetch:async()=>new Response('not-json',{headers:{'Content-Type':'application/json'}}),out:()=>{},err:s=>{err+=s;}});
  assert.equal(code,CONTROL_CLI_EXIT.invalidResponse);assert.equal(JSON.parse(err).error.code,'invalid-response');
}));

test('client deadlines bound an uncooperative local transport and do not replay actions',async()=>serverFixture(async(_server,_d,profile)=>{
  let calls=0;
  const client=new LocalControlClient(profile,{access:fixtureAccess,timeoutMs:20,fetch:async()=>{calls++;return new Promise(()=>{});}});
  await assert.rejects(client.open('settings'),error=>error instanceof ControlError&&error.code==='timed-out');assert.equal(calls,1);
}));

test('missing profile has a stable not-running result rather than creating data or exposing raw errors',async()=>privateFixture(async profile=>{
  let err='';const code=await runControlCli(['--profile-dir',join(profile,'missing'),'capabilities'],{out:()=>{},err:s=>{err+=s;}});
  assert.equal(code,CONTROL_CLI_EXIT.notRunning);assert.equal(JSON.parse(err).error.code,'not-running');assert.ok(!err.includes(profile));
}));
