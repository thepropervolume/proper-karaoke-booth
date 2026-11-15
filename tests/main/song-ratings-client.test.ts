import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SongRatingsClient } from '../../src/main/song-ratings-client';
const baseUrl='https://apps.example.test',token='fake-rating-writer-0123456789-abcdefghijklmnopqrstuvwxyz';
const recordingKey='youtube:Abcdefghijk';
const summary={recordingKey,average:7.5,count:2,ownVote:null};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('tokenless reads use fixed HTTPS metadata routes, contain no credentials, and cannot vote',async()=>{
  let calls=0;
  const client=new SongRatingsClient({baseUrl,fetch:async(input,init)=>{
    calls++;assert.equal(String(input),baseUrl+'/v1/ratings/lookup');assert.equal(init?.method,'POST');
    assert.equal((init?.headers as Record<string,string>).Authorization,undefined);assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');
    assert.deepEqual(JSON.parse(init?.body as string),{recordingKeys:[recordingKey]});return json({items:[{...summary,privateVoter:'hidden'}]});
  }});
  const result=await client.lookup([recordingKey]);assert.deepEqual(result,{status:'ready',items:[summary],canVote:false});
  assert.equal((await client.vote(recordingKey,8)).status,'configuration-required');assert.equal(calls,1);
});

test('authenticated writes map one exact recording and acknowledge the saved own vote including clearing it',async()=>{
  const client=new SongRatingsClient({baseUrl,token,fetch:async(input,init)=>{
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+token);
    assert.equal(init?.method,'PUT');assert.equal(String(input),baseUrl+'/v1/ratings/vote');
    const body=JSON.parse(init?.body as string);assert.equal(body.recordingKey,recordingKey);
    return json({...summary,ownVote:body.value});
  }});
  assert.deepEqual(await client.vote(recordingKey,10),{status:'ready',item:{...summary,ownVote:10},canVote:true});
  assert.deepEqual(await client.vote(recordingKey,null),{status:'ready',item:summary,canVote:true});
});

test('empty profile lookups still authenticate with the server instead of guessing from a file',async()=>{
  let calls=0;
  const valid=new SongRatingsClient({baseUrl,token,fetch:async(_input,init)=>{calls++;assert.deepEqual(JSON.parse(init?.body as string),{recordingKeys:[]});return json({items:[]});}});
  assert.deepEqual(await valid.lookup([]),{status:'ready',items:[],canVote:true});
  const denied=new SongRatingsClient({baseUrl,token,fetch:async()=>{calls++;return new Response(null,{status:403});}});
  assert.equal((await denied.lookup([])).status,'forbidden');assert.equal(calls,2);
});

test('KaraFun votes and summaries use global provider IDs without media fingerprints',async()=>{
  const key='karafun:catalog:6229',community='karafun:community:6229';
  const client=new SongRatingsClient({baseUrl,token,fetch:async(input,init)=>{
    const body=JSON.parse(init?.body as string);assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+token);
    if(String(input).endsWith('/lookup')){assert.deepEqual(body,{recordingKeys:[key,community]});return json({items:[key,community].map(recordingKey=>({recordingKey,average:null,count:0,ownVote:null}))});}
    assert.deepEqual(body,{recordingKey:key,value:8});return json({recordingKey:key,average:8,count:1,ownVote:8});
  }});
  assert.equal((await client.lookup([key,community])).status,'ready');
  assert.deepEqual(await client.vote(key,8),{status:'ready',item:{recordingKey:key,average:8,count:1,ownVote:8},canVote:true});
});

test('bad input does not call the network; unsafe configurations are rejected without including secrets',async()=>{
  let calls=0;const client=new SongRatingsClient({baseUrl,token,fetch:async()=>{calls++;throw Error('should not call');}});
  for(const keys of [['Artist - Title'],[recordingKey,recordingKey],Array(101).fill(recordingKey),null])assert.equal((await client.lookup(keys)).status,'invalid-request');
  for(const score of [0,11,4.5,'8',undefined])assert.equal((await client.vote(recordingKey,score)).status,'invalid-request');
  assert.equal((await client.vote('other',8)).status,'invalid-request');assert.equal(calls,0);
  for(const override of [{baseUrl:'http://example.test'},{baseUrl:'https://user:secret@example.test'},{baseUrl:'https://example.test/?token=secret'},{baseUrl:'https://example.test:443/path'},{token:'short'},{timeoutMs:0}])
    assert.throws(()=>new SongRatingsClient({baseUrl,token,...override}),error=>error instanceof Error && error.message==='Invalid song ratings connection.');
});

test('lookup rejects mismatched, duplicate, absent and impossible summaries rather than displaying another recording’s vote',async()=>{
  const bad=[{items:[]},{items:[summary,summary]},{items:[{...summary,recordingKey:'youtube:abcdefghijk'}]},{items:[{...summary,count:-1}]},{items:[{...summary,average:11}]},{items:[{...summary,ownVote:8}]}];
  for(const body of bad)assert.equal((await new SongRatingsClient({baseUrl,fetch:async()=>json(body)}).lookup([recordingKey])).status,'invalid-response');
  for(const body of [{...summary,ownVote:7},{...summary,recordingKey:'youtube:abcdefghijk',ownVote:8},null])
    assert.equal((await new SongRatingsClient({baseUrl,token,fetch:async()=>json(body)}).vote(recordingKey,8)).status,'invalid-response');
});

test('access denials, rate limits and malformed data remain failures; a lost vote reply never triggers automatic replay',async()=>{
  for(const [code,status] of [[401,'unauthorized'],[403,'forbidden'],[429,'rate-limited'],[503,'unavailable']] as const){
    const client=new SongRatingsClient({baseUrl,token,fetch:async()=>new Response('private diagnostic',{status:code})});
    assert.equal((await client.vote(recordingKey,8)).status,status);
  }
  let calls=0;
  const client=new SongRatingsClient({baseUrl,token,fetch:async()=>{calls++;throw new Error('signed private URL');}});
  assert.deepEqual(await client.vote(recordingKey,8),{status:'unavailable'});assert.equal(calls,1);
  const html=new SongRatingsClient({baseUrl,fetch:async()=>new Response('<html>gateway</html>',{headers:{'content-type':'text/html'}})});
  assert.equal((await html.lookup([recordingKey])).status,'invalid-response');
  const oversized=new SongRatingsClient({baseUrl,fetch:async()=>new Response('x'.repeat(128*1024+1),{headers:{'content-type':'application/json'}})});
  assert.equal((await oversized.lookup([recordingKey])).status,'invalid-response');
});

test('timeouts bound an uncooperative fetch and a stalled response body',async()=>{
  for(const bodyStalls of [false,true]){
    const client=new SongRatingsClient({baseUrl,timeoutMs:20,fetch:async()=>bodyStalls ? new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}}) : new Promise(()=>{})});
    assert.equal((await client.lookup([recordingKey])).status,'timed-out');
  }
});

test('a late authenticated success cannot expose own votes after the same authority is denied',async()=>{
  let resolve!:(value:Response)=>void,calls=0;
  const client=new SongRatingsClient({baseUrl,token,fetch:async()=>++calls===1 ? new Promise(done=>{resolve=done;}) : new Response(null,{status:403})});
  const first=client.lookup([recordingKey]);assert.equal((await client.lookup([recordingKey])).status,'forbidden');
  resolve(json({items:[{...summary,ownVote:8}]}));assert.equal((await first).status,'forbidden');
});
