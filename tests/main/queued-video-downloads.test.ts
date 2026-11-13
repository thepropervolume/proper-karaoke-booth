import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QueuedVideoDownloads} from '../../src/main/queued-video-downloads';
import type {YouTubeDownloadProgress} from '../../src/main/youtube-download';
const finished=(id:string,cleanupNeeded=false):YouTubeDownloadProgress=>({id,versionId:id,videoId:'abcdefghijk',phase:cleanupNeeded?'failed':'completed',percent:100,message:'Result',cleanupNeeded});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('dispatch begins immediately, runs serially, deduplicates, and follows reordered future requests',async()=>{
 const started:string[]=[],release:(()=>void)[]=[];
 const queue=new QueuedVideoDownloads(async id=>{started.push(id);await new Promise<void>(resolve=>release.push(resolve));return finished(id);});
 queue.reconcile(['a','b','c','a']);assert.deepEqual(started,['a']);assert.deepEqual(queue.snapshot().pendingVersionIds,['b','c']);
 queue.reconcile(['c','a','b']);assert.deepEqual(queue.snapshot().pendingVersionIds,['c','b']);
 release.shift()!();await turn();assert.deepEqual(started,['a','c']);
 queue.reconcile(['c','a']);release.shift()!();await queue.idle();assert.deepEqual(started,['a','c']);
 queue.reconcile(['a','c']);await queue.idle();assert.equal(started.length,2);
});
test('ordinary failures retain retry diagnostics and permit other videos without a retry loop',async()=>{
 const calls:string[]=[];const queue=new QueuedVideoDownloads(async id=>{calls.push(id);if(id==='a')throw new Error('Install yt-dlp in Preferences.');return finished(id);});
 queue.reconcile(['a','b']);await queue.idle();queue.reconcile(['a','b']);await queue.idle();assert.deepEqual(calls,['a','b']);
 assert.equal(queue.snapshot().failures[0].versionId,'a');queue.enqueue('a',true);await queue.idle();assert.deepEqual(calls,['a','b','a']);
});
test('uncertain cleanup halts the queue and shutdown never starts waiting work',async()=>{
 const calls:string[]=[];const queue=new QueuedVideoDownloads(async id=>{calls.push(id);return finished(id,true);});
 queue.reconcile(['a','b']);await queue.idle();assert.deepEqual(calls,['a']);assert.equal(queue.snapshot().blocked,true);
 assert.throws(()=>queue.enqueue('b',true),/temporary files/);await queue.shutdown();assert.deepEqual(queue.snapshot().pendingVersionIds,[]);
});
