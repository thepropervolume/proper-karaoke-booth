import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecordingKey, parseRecordingKeys, parseSongRating, recordingKeyFor, validHeartVote } from '../../src/domain/song-rating';

test('rating identities use exact case-sensitive YouTube recordings ahead of local download fingerprints',()=>{
  const hash='a'.repeat(64);
  assert.equal(recordingKeyFor({provider:'youtube',videoId:'Abcdefghijk'},hash),'youtube:Abcdefghijk');
  assert.equal(recordingKeyFor(undefined,hash),`sha256:${hash}`);
  assert.equal(recordingKeyFor(undefined),null);
  assert.equal(recordingKeyFor(undefined,'PVOL-003'),null);
  assert.equal(isRecordingKey('youtube:abcdefghijk'),true);assert.equal(isRecordingKey(`sha256:${hash}`),true);
  for(const key of ['Artist - Title','youtube:too-short',`sha256:${hash.toUpperCase()}`,'../local','https://youtube.com/watch?v=abcdefghijk'])assert.equal(isRecordingKey(key),false);
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
