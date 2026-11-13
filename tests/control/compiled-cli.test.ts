import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { LocalControlServer } from '../../src/control/server';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { DEFAULT_SHORTCUTS } from '../../src/domain/shortcuts';
import { privateFixture } from './fixtures';
const exec=promisify(execFile);

test('a bundled standalone Node CLI reaches the real loopback adapter using native owner-only discovery',async()=>privateFixture(async profile=>{
  const entry=join(profile,'tpv-control.cjs');
  await build({entryPoints:[resolve('src/control/entry.ts')],outfile:entry,bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'silent'});
  const help=await exec(process.execPath,[entry,'--help'],{windowsHide:true,timeout:15000});assert.match(help.stdout,/off by default/);
  let opened=0;
  const server=new LocalControlServer({profileDirectory:profile,enabled:true,adapter:{getState:()=>({showId:'compiled-cli-synthetic'}),getSettings:()=>DEFAULT_SETTINGS,getShortcuts:()=>DEFAULT_SHORTCUTS,openSettings:()=>{opened++;}}});
  try{
    await server.start();
    const state=await exec(process.execPath,[entry,'--profile-dir',profile,'state'],{windowsHide:true,timeout:15000});
    assert.equal(JSON.parse(state.stdout).result.showId,'compiled-cli-synthetic');assert.equal(state.stderr,'');
    const openedResult=await exec(process.execPath,[entry,'--profile-dir',profile,'--settings'],{windowsHide:true,timeout:15000});
    assert.deepEqual(JSON.parse(openedResult.stdout).result,{action:'settings',opened:true});assert.equal(opened,1);
  }finally{await server.stop();}
}));
