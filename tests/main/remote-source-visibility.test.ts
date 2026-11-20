import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState } from '../../src/domain';
import { DEFAULT_SETTINGS } from '../../src/domain/settings';
import { RemoteQueue } from '../../src/main/remote-queue';

test('disabled singer sources disappear from discovery and reject stale requests without hiding existing queue entries', () => {
 const db = new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const state = createInitialState('show-00001', 'epoch-0001');
  state.versions.push(
   {id:'local-0001',title:'Local',artist:'A',rating:'unrated'},
   {id:'kn-brand01',title:'KN brand',artist:'A',rating:'unrated',source:{provider:'youtube',videoId:'abcdefghijk',brandSlug:'A'}},
   {id:'kn-plain01',title:'KN unbranded',artist:'A',rating:'unrated',source:{provider:'youtube',videoId:'bcdefghijkl'},discoveryOrigin:'karaokenerds'},
   {id:'youtube-01',title:'YT',artist:'A',rating:'unrated',source:{provider:'youtube',videoId:'cdefghijklm'}},
   {id:'karafun-01',title:'KF',artist:'A',rating:'unrated',source:{provider:'karafun',catalog:'catalog',songId:'123'}});
  db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
  const settings=structuredClone(DEFAULT_SETTINGS), service=new RemoteQueue(db,()=>settings,()=>{},()=>1000);
  const guest=service.join(service.createInvitation(5000),'join-id-0001',randomBytes(32).toString('base64url'),'Singer',0);
  const initial=service.snapshot(guest.session);
  const queued=service.submit(guest.session,{ commandId:'command-0001',showId:initial.showId,hostEpoch:initial.hostEpoch,expectedRevision:initial.revision,versionId:'local-0001' });
  assert.equal(queued.ok,true);
  settings.sourceVisibility.local=false; settings.sourceVisibility.youtube=false;
  const after=service.snapshot(guest.session);
  assert.deepEqual(after.catalog.map(item=>item.id),['kn-brand01','kn-plain01','karafun-01']);
  assert.equal(after.requests.length,1); assert.equal(after.requests[0].versionId,'local-0001');
  assert.equal(service.catalogItem(guest.session,'youtube-01'),null);
  const stale=service.submit(guest.session,{commandId:'command-stale',showId:after.showId,hostEpoch:after.hostEpoch,expectedRevision:after.revision - 1,versionId:'youtube-01'});
  assert.equal(stale.ok,false); if (!stale.ok) assert.equal(stale.code,'REVISION_CONFLICT');
  const refused=service.submit(guest.session,{commandId:'command-0002',showId:after.showId,hostEpoch:after.hostEpoch,expectedRevision:after.revision,versionId:'youtube-01'});
  assert.equal(refused.ok,false); if (!refused.ok) assert.equal(refused.code,'NOT_AVAILABLE');
  settings.sourceVisibility.youtube=true; settings.sourceVisibility.karaokenerds=false;
  assert.deepEqual(service.catalog(guest.session).items.map(item=>item.id),['youtube-01','karafun-01']);
  assert.deepEqual(service.submit(guest.session,{commandId:'command-0002',showId:after.showId,hostEpoch:after.hostEpoch,expectedRevision:after.revision,versionId:'youtube-01'}),refused,'duplicate receipt does not create a late request');
 } finally { db.close(); }
});


test('authenticated search scans past the first page, respects hidden sources, and returns only public song fields', () => {
 const db = new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const state = createInitialState('show-00001', 'epoch-0001');
  for (let i=0; i<80; i++) state.versions.push({id:`song-${String(i).padStart(4,'0')}`, title: i >= 60 ? `Wonderwall ${i}` : `Song ${i}`, artist: i >= 60 ? 'Oasis' : 'Other', rating:'unrated'});
  state.versions.push({id:'youtube-01', title:'Wonderwall hidden', artist:'Oasis', rating:'unrated', source:{provider:'youtube', videoId:'abcdefghijk'}});
  db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
  const settings=structuredClone(DEFAULT_SETTINGS); settings.sourceVisibility.youtube=false;
  const service=new RemoteQueue(db,()=>settings,()=>{},()=>1000);
  const guest=service.join(service.createInvitation(5000),'join-id-0001',randomBytes(32).toString('base64url'),'Singer',0);
  assert.equal(service.snapshot(guest.session).catalog.some(song=>song.title.includes('Wonderwall')),false);
  const first=service.catalog(guest.session,0,7,'OASIS Wonderwall');
  const next=service.catalog(guest.session,first.nextOffset!,7,'OASIS Wonderwall');
  assert.equal(first.items.length,7); assert.equal(next.items.length,7);
  assert.deepEqual(Object.keys(first.items[0]).sort(),['artist','id','title']);
  assert.equal(service.catalog(guest.session,0,100,'hidden').items.length,0);
  assert.throws(()=>service.catalog('invalid',0,50,'Wonderwall'));
  assert.throws(()=>service.catalog(guest.session,0,50,'x'.repeat(201)));
  assert.throws(()=>service.catalog(guest.session,0,50,'bad\nquery'));
 } finally { db.close(); }
});


test('archiving a remote singer ends access and resume without erasing the stored identity', () => {
 const db = new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE show_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const state=createInitialState('show-00001','epoch-0001'); db.prepare('INSERT INTO show_state VALUES (1, ?)').run(JSON.stringify(state));
  const service=new RemoteQueue(db,()=>DEFAULT_SETTINGS,()=>{},()=>1000), resume=randomBytes(32).toString('base64url');
  const invite=service.createInvitation(5000), guest=service.join(invite,'join-id-0001',resume,'Singer',0);
  const saved=JSON.parse((db.prepare('SELECT value FROM show_state WHERE id=1').get() as {value:string}).value);
  saved.singers.find((s:{id:string})=>s.id===guest.singerId).archived=true;
  db.prepare('UPDATE show_state SET value=? WHERE id=1').run(JSON.stringify(saved));
  assert.deepEqual(service.listGuests(), []);
  const add=db.prepare('INSERT INTO remote_guests (id,singer_id,show_id,resume_hash,resume_expires,join_id,join_name,join_revision) VALUES (?,?,?,?,?,?,?,?)');
  for (let i=0;i<199;i++) add.run(`guest-${i}`,`singer-${i}`,saved.showId,`hash-${i}`,999999,`join-${i}`,`Guest ${i}`,0);
  assert.equal(service.listGuests().length,199);
  assert.throws(()=>service.snapshot(guest.session)); assert.throws(()=>service.resume(resume));
  assert.ok(service.join(invite,'join-id-0002',randomBytes(32).toString('base64url'),'New Singer',saved.revision));
  assert.throws(()=>service.join(invite,'join-id-0001',resume,'Singer',0));
  assert.equal(saved.singers[0].name,'Singer');
 } finally {db.close();}
});
