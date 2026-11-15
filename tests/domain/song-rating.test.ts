import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalRecordingKey, isRecordingKey, parseRecordingKeys, parseSongRating, ratingStorageFor, recordingKeyFor, validHeartVote } from '../../src/domain/song-rating';

test('rating identities use exact case-sensitive YouTube recordings ahead of local download fingerprints',()=>{
  const hash='a'.repeat(64);
  assert.equal(recordingKeyFor({provider:'youtube',videoId:'Abcdefghijk'},hash),'youtube:Abcdefghijk');
  assert.equal(recordingKeyFor(undefined,hash),`sha256:${hash}`);
  assert.equal(recordingKeyFor(undefined),null);
  assert.equal(recordingKeyFor(undefined,'PVOL-003'),null);
  assert.equal(isRecordingKey('youtube:abcdefghijk'),true);assert.equal(isRecordingKey(`sha256:${hash}`),true);
  assert.equal(ratingStorageFor(`sha256:${hash}`),'local'); assert.equal(ratingStorageFor('youtube:Abcdefghijk'),'global');
  assert.equal(isLocalRecordingKey('youtube:Abcdefghijk'),false); assert.equal(isLocalRecordingKey(`sha256:${hash}`),true);
  for(const key of ['Artist - Title','youtube:too-short',`sha256:${hash.toUpperCase()}`,'../local','https://youtube.com/watch?v=abcdefghijk'])assert.equal(isRecordingKey(key),false);
});

test('KaraFun catalog and community identities can be rated before download without fingerprint fallback',()=>{
  const hash='a'.repeat(64);
  for (const catalog of ['catalog','community'] as const) {
    const source={provider:'karafun' as const,catalog,songId:'6229'};
    const key=`karafun:${catalog}:6229` as const;
    assert.equal(recordingKeyFor(source),key); assert.equal(recordingKeyFor(source,hash),key);
    assert.equal(isRecordingKey(key),true); assert.equal(isLocalRecordingKey(key),false); assert.equal(ratingStorageFor(key),'global');
  }
  for (const songId of ['0','06229','-1','1.5','1234567890123','../../6229'])
    assert.equal(recordingKeyFor({provider:'karafun',catalog:'catalog',songId},hash),null);
  for (const key of ['karafun:6229','karafun:catalog:0','karafun:catalog:06229','karafun:community:1234567890123','KaraFun:catalog:6229','karafun:other:6229','karafun:catalog:6229?key=secret'])
    assert.equal(isRecordingKey(key),false);
  assert.deepEqual(parseRecordingKeys(['karafun:catalog:6229','karafun:community:6229']),['karafun:catalog:6229','karafun:community:6229']);
});

test('heart votes are integer1–10 or an explicit clear; batches are bounded and distinct',()=>{
  for(const score of [1,5,10,null])assert.equal(validHeartVote(score),true);
  for(const score of [0,11,1.5,'5',undefined,NaN])assert.equal(validHeartVote(score),false);
  assert.deepEqual(parseRecordingKeys(['youtube:abcdefghijk']),['youtube:abcdefghijk']);
  assert.throws(()=>parseRecordingKeys(['youtube:abcdefghijk','youtube:abcdefghijk']));
  assert.throws(()=>parseRecordingKeys(Array(101).fill('youtube:abcdefghijk')));
});

test('ratings validate aggregate bounds and project only public fields',()=>{
  const unrated={recordingKey:'youtube:abcdefghijk',average:null,count:0,ownVote:null};
  assert.deepEqual(parseSongRating({...unrated,privateVoter:'secret'}),unrated);
  assert.ok(parseSongRating({...unrated,average:7.2,count:5,ownVote:8}));
  for(const change of [{average:0,count:1},{average:11,count:1},{average:NaN,count:1},{average:5,count:0},{count:1},{count:-1},{count:1.5},{ownVote:1},{average:5,count:1,ownVote:0}])assert.equal(parseSongRating({...unrated,...change}),null);
});
