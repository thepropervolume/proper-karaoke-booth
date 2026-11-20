import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createInitialState, type Actor, type Command, type ShowState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { DatabaseSync } from 'node:sqlite';
import { migrateShowSchema } from '../../src/main/schema-migrations';
import { inspectShowSnapshot } from '../../src/main/show-snapshots';

function run(state: ShowState, command: Command, actor: Actor = {role:'host',id:'host'}) {
  return applyCommand(state, {commandId:crypto.randomUUID(),showId:state.showId,hostEpoch:state.hostEpoch,expectedRevision:state.revision,actor,command}, DEFAULT_SETTINGS, 1000);
}
function fixture() {
  let state=createInitialState('show','epoch');
  for (const id of ['lead','partner','listener']) state=run(state,{type:'addSinger',singer:{id,name:id}}).state;
  state=run(state,{type:'addVersion',version:{id:'song',title:'Song',artist:'Artist',rating:'clean',isDuet:true}}).state;
  return state;
}
test('archiving preserves history, names and points, blocks further assignments and denies singer actors', () => {
  let state=fixture();
  const savedPoints=structuredClone(state.points);
  const archived=run(state,{type:'removeSinger',singerId:'listener'}); assert.equal(archived.outcome.ok,true); state=archived.state;
  assert.equal(state.singers.find(s=>s.id==='listener')?.archived,true); assert.deepEqual(state.points,savedPoints);
  assert.equal(run(state,{type:'request',requestId:'r',singerId:'listener',versionId:'song'}).outcome.ok,false);
  assert.equal(run(state,{type:'request',requestId:'r2',singerId:'lead',coSingerId:'listener',versionId:'song'}).outcome.ok,false);
  assert.equal(run(state,{type:'setSingerAvailability',singerId:'listener',minutes:5},{role:'singer',id:'listener'}).outcome.ok,false);
  assert.equal(run(state,{type:'applause'},{role:'singer',id:'listener'}).outcome.ok,false);
  assert.equal(run(state,{type:'removeSinger',singerId:'lead'},{role:'singer',id:'listener'}).outcome.ok,false);
});
test('lead and duet singers cannot be archived while a song remains active or pending', () => {
  let state=fixture(); state=run(state,{type:'request',requestId:'req',singerId:'lead',coSingerId:'partner',versionId:'song'}).state;
  for (const singerId of ['lead','partner']) {
    const result=run(state,{type:'removeSinger',singerId}); assert.equal(result.outcome.ok,false); if (!result.outcome.ok) assert.equal(result.outcome.code,'LOCKED');
  }
  state=run(state,{type:'removeRequest',requestId:'req'}).state;
  state=run(state,{type:'removeSinger',singerId:'partner'}).state;
  assert.equal(state.singers.find(s=>s.id==='partner')?.name,'partner'); assert.equal(state.requests[0].coSingerId,'partner');
});


test('show backups retain archived singers and reject impossible active references', () => {
  let state=fixture(); state=run(state,{type:'request',requestId:'req',singerId:'lead',coSingerId:'partner',versionId:'song'}).state;
  state=run(state,{type:'removeRequest',requestId:'req'}).state;
  state=run(state,{type:'removeSinger',singerId:'partner'}).state;
  const db=new DatabaseSync(':memory:');
  try {
    migrateShowSchema(db);
    const save=(value:ShowState)=>db.prepare('INSERT OR REPLACE INTO show_state VALUES (1, ?)').run(JSON.stringify(value));
    save(state); assert.equal(inspectShowSnapshot(db).requests,1);
    const restored=JSON.parse((db.prepare('SELECT value FROM show_state WHERE id=1').get() as {value:string}).value) as ShowState;
    assert.equal(restored.singers.find(s=>s.id==='partner')?.archived,true); assert.equal(restored.requests[0].coSingerId,'partner');
    restored.requests[0].status='accepted'; save(restored); assert.throws(()=>inspectShowSnapshot(db), /incomplete or incompatible/);
  } finally {db.close();}
});
