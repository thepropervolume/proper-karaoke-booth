import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState} from '../../src/domain';
import {catalogRequest} from '../../src/domain/catalog-request';
import {DEFAULT_SETTINGS} from '../../src/domain/settings';
const setup=()=>{const state=createInitialState('show','epoch');state.singers.push({id:'singer',name:'Singer'});return state;};
const input={track:{youtubeId:'abcdefghijk',title:'Song',artist:'Artist'},singerId:'singer',requestId:'request'};
const ids={versionId:'version',commandId:'command'};
test('catalog queue proposal commits one exact identity and reuses host metadata and request receipts',()=>{
 const before=setup(),planned=catalogRequest(before,input,DEFAULT_SETTINGS,ids,10);
 assert.equal(planned.result.ok,true);assert.equal(before.versions.length,0);assert.equal(before.requests.length,0);
 assert.equal(planned.state.requests[0].status,'accepted');assert.equal(planned.state.playback,null);
 planned.state.versions[0].title='Host correction';
 const repeated=catalogRequest(planned.state,input,DEFAULT_SETTINGS,{versionId:'other',commandId:'other'},11);
 assert.equal(repeated.result.ok,true);assert.equal(repeated.state.requests.length,1);assert.equal(repeated.state.versions[0].title,'Host correction');
 const next=catalogRequest(planned.state,{...input,requestId:'second'},DEFAULT_SETTINGS,{versionId:'other',commandId:'second'},12);
 assert.equal(next.state.versions.length,1);assert.equal(next.state.requests.length,2);
});
test('failed singer, policy or request limit leaves no orphan library additions',()=>{
 for(const change of [(s:ReturnType<typeof setup>)=>{s.singers=[];},(s:ReturnType<typeof setup>)=>{s.policy.ageRestricted=true;},(s:ReturnType<typeof setup>)=>{s.policy.includeVersionIds=[];}]){
  const state=setup();change(state);const result=catalogRequest(state,input,DEFAULT_SETTINGS,ids,1);
  assert.equal(result.result.ok,false);assert.equal(result.state,state);assert.equal(state.versions.length,0);
 }
 const state=catalogRequest(setup(),input,DEFAULT_SETTINGS,ids,1).state;
 const result=catalogRequest(state,{...input,requestId:'another',track:{...input.track,youtubeId:'lmnopqrstuv'}},{...DEFAULT_SETTINGS,maxFutureRequestsPerSinger:1},{versionId:'another',commandId:'another'},2);
 assert.equal(result.result.ok,false);assert.equal(state.versions.length,1);
});
test('blocked exact identities and malformed renderer objects cannot create replacements',()=>{
 const state=catalogRequest(setup(),input,DEFAULT_SETTINGS,ids,1).state;state.policy.excludeVersionIds.push('version');
 assert.equal(catalogRequest(state,{...input,requestId:'new'},DEFAULT_SETTINGS,{versionId:'replacement',commandId:'new'},2).result.ok,false);
 for(const value of [{...input,track:{...input.track,filename:'private'}},{...input,track:{...input.track,youtubeId:'not-an-id'}},{...input,singerId:null}])assert.equal(catalogRequest(setup(),value,DEFAULT_SETTINGS,ids,1).result.ok,false);
});
