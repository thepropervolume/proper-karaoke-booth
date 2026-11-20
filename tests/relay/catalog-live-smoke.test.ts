import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { request } from 'node:http';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RelayStore } from '../../src/relay/store';
import { RelayBroker } from '../../src/relay/broker';
import { startQueueRelayService } from '../../src/relay/http';

/** Runs the exact production smoke against a disposable loopback relay and synthetic owner. */
test('public catalog smoke completes against the real loopback relay without external traffic', async () => {
  const origin='https://queue.thepropervolume.com', token=randomBytes(32).toString('base64url');
  const directory=await mkdtemp(join(tmpdir(),'tpv-catalog-smoke-')), config=join(directory,'owner.json');
  await writeFile(config,JSON.stringify({baseUrl:origin,ownerToken:token}),{mode:0o600});
  const db=new DatabaseSync(':memory:'), broker=new RelayBroker(new RelayStore(db,{publicOrigin:origin}),{pollTimeoutMs:500,rpcTimeoutMs:2000});
  const server=await startQueueRelayService({publicOrigin:origin,screenOrigin:'https://booth.thepropervolume.com',owners:[{id:randomUUID(),tokenSha256:createHash('sha256').update(token).digest('hex')}],broker,port:0,staticHandler:async()=>false,closeDependencies:()=>db.close()});
  const originalFetch=globalThis.fetch, originalArgv=process.argv;
  try {
    globalThis.fetch=(input,init) => {
      const url=new URL(String(input)); assert.ok([origin,'https://booth.thepropervolume.com'].includes(url.origin),'External network is forbidden in this test');
      const headers=Object.fromEntries(new Headers(init?.headers)); headers.host=url.host;
      return new Promise<Response>((resolve,reject)=>{
        const req=request(`http://127.0.0.1:${server.port}${url.pathname}${url.search}`,{method:init?.method ?? 'GET',headers,signal:init?.signal ?? undefined},response=>{
          const chunks: Buffer[]=[]; response.on('data',chunk=>chunks.push(chunk)); response.on('error',reject);
          response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers as HeadersInit})));
        });
        req.on('error',reject); req.end(init?.body as string | undefined);
      });
    };
    process.argv=['node','smoke','--execute-live',config,'--screen-test'];
    await import(pathToFileURL(resolve('scripts/internet-catalog-live-smoke.mts')).href);
    const leases=db.prepare('SELECT active FROM relay_leases').all() as {active:number}[];
    assert.equal(leases.length,1); assert.equal(leases[0].active,0,'The synthetic room must close');
  } finally {
    process.argv=originalArgv; globalThis.fetch=originalFetch; await server.stop();
    const actual=await realpath(directory); assert.equal(dirname(actual),await realpath(tmpdir()));
    assert.ok(basename(actual).startsWith('tpv-catalog-smoke-')); await rm(actual,{recursive:true,force:true});
  }
});
