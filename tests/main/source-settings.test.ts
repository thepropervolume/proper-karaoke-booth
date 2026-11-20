import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveWithDiscoveryRevision } from '../../src/main/source-settings';

test('discovery setting updates save a revision before settings and retain a safe revision if settings write fails', () => {
 let state={revision:4}, persisted=state, settings=false, notices=0;
 const save=(next:typeof state)=>{persisted=next}, set=(next:typeof state)=>{state=next};
 assert.throws(()=>saveWithDiscoveryRevision(state,()=>{throw Error('database failed')},set,()=>{settings=true},()=>{notices++}),/database failed/);
 assert.equal(settings,false); assert.equal(state.revision,4); assert.equal(persisted.revision,4); assert.equal(notices,0);
 assert.throws(()=>saveWithDiscoveryRevision(state,save,set,()=>{throw Error('settings failed')},()=>{notices++}),/settings failed/);
 assert.equal(settings,false); assert.equal(state.revision,5); assert.equal(persisted.revision,5); assert.equal(notices,1);
 saveWithDiscoveryRevision(state,save,set,()=>{settings=true},()=>{notices++});
 assert.equal(settings,true); assert.equal(state.revision,6); assert.equal(notices,1);
});
