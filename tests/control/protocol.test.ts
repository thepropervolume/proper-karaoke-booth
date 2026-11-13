import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlJson, controlSettings } from '../../src/control/protocol';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';

test('settings expose useful values while private paths require an explicit owner request',()=>{
  const value={...DEFAULT_SETTINGS,masterVolume:0.4,sharedCatalogConfigFile:'/private/catalog.json',ratingProfileConfigFile:'/private/voter.json',lyricBackdropFile:'/private/background.mp4'};
  const normal=controlSettings(value);assert.equal(normal.settings.masterVolume,0.4);assert.equal(normal.settings.sharedCatalogConfigFile,'');assert.ok(normal.redactedFields.includes('ratingProfileConfigFile'));
  assert.equal(controlSettings(value,true).settings.ratingProfileConfigFile,'/private/voter.json');assert.equal(value.ratingProfileConfigFile,'/private/voter.json');
  assert.throws(()=>controlSettings({...value,password:'do-not-return'}));
});
test('nested provider profile paths are private by default and projection never mutates host settings',()=>{
  const paths={karafun:'/private/kf.json',partytyme:'/private/pt.json',sunfly:'/private/sunfly.key',stingray:'/private/stingray.json'};
  const value={...DEFAULT_SETTINGS,providerCatalogProfiles:paths};
  const normal=controlSettings(value);
  assert.deepEqual(normal.settings.providerCatalogProfiles,{karafun:'',partytyme:'',sunfly:'',stingray:''});
  assert.ok(Object.keys(paths).every(key=>normal.redactedFields.includes(`providerCatalogProfiles.${key}`)));
  assert.doesNotMatch(JSON.stringify(normal),/\/private\//);
  const explicit=controlSettings(value,true);assert.deepEqual(explicit.settings.providerCatalogProfiles,paths);
  explicit.settings.providerCatalogProfiles.sunfly='/changed';
  assert.equal(value.providerCatalogProfiles.sunfly,'/private/sunfly.key');
});
test('adapter output redacts credential fields and bounds depth, cycles and bytes',()=>{
  const text=controlJson({state:{showId:'qa',token:'never-return',password:'never-return',apiKey:'never-return'},revision:3});
  assert.doesNotMatch(text,/never-return/);assert.equal(JSON.parse(text).revision,3);
  const cyclic:{self?:unknown}={};cyclic.self=cyclic;assert.throws(()=>controlJson(cyclic));
  assert.throws(()=>controlJson({text:'x'.repeat(1024)},256),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='response-too-large');
  let deep:unknown={};for(let i=0;i<35;i++)deep={deep};assert.throws(()=>controlJson(deep));
});

test('cumulative JSON budget stops before visiting or serializing a large repeated result',()=>{
  const shared='x'.repeat(128),values=Array(10000);let reads=0;
  for(let index=0;index<values.length;index++)Object.defineProperty(values,index,{get(){reads++;return shared;},enumerable:true});
  assert.throws(()=>controlJson(values,256),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='response-too-large');
  assert.ok(reads<=2,`A bounded response must not visit the remaining ${values.length} entries.`);
});

test('serialization accounting includes exact escaped UTF-8 keys, values and punctuation',()=>{
  const value={'quoted"key': '"\\\n\u0000',unicode:'🎤é\ud800\udc00\ud800',numbers:[-0,1e30],yes:true,no:false,nothing:null,empty:{}};
  const expected=JSON.stringify(value),bytes=Buffer.byteLength(expected);
  assert.equal(controlJson(value,bytes),expected);
  assert.throws(()=>controlJson(value,bytes-1),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='response-too-large');
});
