import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { parseShortcuts } from '../domain/shortcuts';
import { ownerOnlyDiscoveryAccess, profileIdentity, publishControlDiscovery, type DiscoveryAccess } from './discovery';
import { CONTROL_API_VERSION, CONTROL_DISCOVERY_NAME, CONTROL_LIMITS, ControlError, INSTANCE_HEADERS, controlJson, controlSettings, type ControlAdapter, type ControlDiscovery, type ControlInstance } from './protocol';
import { CONTROL_QUEUE_COMMANDS, parseControlQueueEnvelope } from './queue';
import { parseControlLibraryQuery } from './library';

type Lease={controller:AbortController;pending?:Promise<unknown>};
export type LocalControlStatus={status:'disabled'}|{status:'stopped';pendingOperations:number}|{status:'ready';port:number;instance:ControlInstance;discoveryFile:string};
export type LocalControlOptions={profileDirectory:string;adapter:ControlAdapter;enabled?:boolean;applicationVersion?:string;access?:DiscoveryAccess;
  deadlineMs?:number;maxConcurrent?:number;maxRequestBytes?:number;maxResponseBytes?:number};
const statusCode:Partial<Record<ControlError['code'],number>>={'unauthorized':401,'request-denied':403,'invalid-request':400,'stale-cursor':409,'not-found':404,'method-not-allowed':405,'body-too-large':413,'busy':429,'timed-out':504,'unsupported':501,'adapter-failed':500,'response-too-large':503};
function validLimit(value:unknown,minimum:number,maximum:number):value is number{return Number.isInteger(value)&&(value as number)>=minimum&&(value as number)<=maximum;}

/** Fixed loopback adapter, with no database, generic IPC, filesystem or shell actions. */
export class LocalControlServer{
  private server:Server|null=null;
  private discovery:ControlDiscovery|null=null;
  private removeDiscovery:(()=>Promise<void>)|null=null;
  private lifecycle:Promise<unknown>=Promise.resolve();
  private stopping=false;
  private readonly active=new Set<Lease>();
  private readonly deadlineMs:number;
  private readonly maxConcurrent:number;
  private readonly maxRequestBytes:number;
  private readonly maxResponseBytes:number;
  constructor(private readonly options:LocalControlOptions){
    this.deadlineMs=options.deadlineMs??CONTROL_LIMITS.deadlineMs;this.maxConcurrent=options.maxConcurrent??CONTROL_LIMITS.concurrent;
    this.maxRequestBytes=options.maxRequestBytes??CONTROL_LIMITS.requestBytes;this.maxResponseBytes=options.maxResponseBytes??CONTROL_LIMITS.responseBytes;
    if(!isAbsolute(options.profileDirectory)||/[\x00-\x1f\x7f]/.test(options.profileDirectory)||!validLimit(this.deadlineMs,20,60000)||!validLimit(this.maxConcurrent,1,16)||
      !validLimit(this.maxRequestBytes,64,65536)||!validLimit(this.maxResponseBytes,256,8*1024*1024))throw new ControlError('invalid-request','Invalid local control server configuration.');
  }
  status():LocalControlStatus{
    if(this.options.enabled!==true)return{status:'disabled'};
    const d=this.discovery;return d&&this.removeDiscovery&&!this.stopping?{status:'ready',port:d.port,instance:{pid:d.pid,instanceId:d.instanceId,profileId:d.profileId},discoveryFile:join(d.profileDirectory,CONTROL_DISCOVERY_NAME)}:{status:'stopped',pendingOperations:this.active.size};
  }
  start():Promise<LocalControlStatus>{
    const next=this.lifecycle.then(()=>this.startNow(),()=>this.startNow());this.lifecycle=next.catch(()=>{});return next;
  }
  private async startNow():Promise<LocalControlStatus>{
    if(this.options.enabled!==true)return{status:'disabled'};
    if(this.server)return this.status();
    if(this.active.size)throw new ControlError('busy','Previous control adapter work has not stopped; the API cannot restart yet.');
    this.stopping=false;
    const profile=await realpath(this.options.profileDirectory);
    const server=createServer({maxHeaderSize:8192,requestTimeout:this.deadlineMs,headersTimeout:this.deadlineMs,connectionsCheckingInterval:1000},(request,response)=>{void this.handle(request,response);});
    this.server=server;server.maxConnections=32;server.keepAliveTimeout=1000;server.maxRequestsPerSocket=16;
    server.on('error',()=>{if(this.discovery)void this.stop().catch(()=>{});});
    server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');else socket.destroy();});
    try{
      await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
      const address=server.address();if(!address||typeof address==='string')throw Error();
      const d:ControlDiscovery={format:1,host:'127.0.0.1',port:address.port,pid:process.pid,instanceId:randomBytes(16).toString('hex'),token:randomBytes(32).toString('base64url'),profileDirectory:profile,profileId:profileIdentity(profile)};
      this.discovery=d;
      this.removeDiscovery=await publishControlDiscovery(d,this.options.access??ownerOnlyDiscoveryAccess);
      return this.status();
    }catch(error){await this.stopNow();throw error instanceof ControlError?error:new ControlError('unavailable','The local control API could not start.');}
  }
  stop():Promise<void>{const next=this.lifecycle.then(()=>this.stopNow(),()=>this.stopNow());this.lifecycle=next.catch(()=>{});return next;}
  private async stopNow():Promise<void>{
    this.stopping=true;
    for(const lease of this.active)lease.controller.abort();
    const server=this.server;this.server=null;this.discovery=null;
    if(server){const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();await closed;}
    const cleanup=this.removeDiscovery;this.removeDiscovery=null;if(cleanup)await cleanup();
    if(this.active.size){
      const pending=[...this.active].flatMap(lease=>lease.pending?[lease.pending]:[]);
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([Promise.allSettled(pending),new Promise<void>(resolve=>{timer=setTimeout(resolve,Math.min(this.deadlineMs,1000));})]);}
      finally{if(timer)clearTimeout(timer);}
      if(this.active.size)throw new ControlError('busy','Control API transport stopped, but adapter work did not drain; keep its authority alive until it settles.');
    }
  }
  private respond(response:ServerResponse,status:number,body:unknown,authenticated=false):void{
    if(response.destroyed||response.writableEnded)return;
    const d=this.discovery;
    response.statusCode=status;response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Connection','close');
    if(authenticated&&d){response.setHeader(INSTANCE_HEADERS.instance,d.instanceId);response.setHeader(INSTANCE_HEADERS.profile,d.profileId);response.setHeader(INSTANCE_HEADERS.pid,String(d.pid));}
    response.end(controlJson(body,this.maxResponseBytes));
  }
  private reject(response:ServerResponse,error:ControlError,authenticated=false):void{
    this.respond(response,statusCode[error.code]??503,{ok:false,error:{code:error.code,message:error.message}},authenticated);
  }
  private ingress(request:IncomingMessage):ControlDiscovery{
    const d=this.discovery;
    if(!d||this.stopping)throw new ControlError('unavailable','The local control API is stopping.');
    const count=(name:string)=>request.rawHeaders.filter((_part,index)=>index%2===0&&request.rawHeaders[index].toLowerCase()===name).length;
    if(request.socket.remoteAddress!=='127.0.0.1'||count('host')!==1||request.headers.host!==`127.0.0.1:${d.port}`||request.headers.origin!==undefined||request.headers['sec-fetch-site']!==undefined)
      throw new ControlError('request-denied','This request is not an allowed local control client.');
    const supplied=request.headers.authorization,expected=Buffer.from('Bearer '+d.token);
    if(count('authorization')!==1||typeof supplied!=='string'||Buffer.byteLength(supplied)!==expected.length||!timingSafeEqual(Buffer.from(supplied),expected))
      throw new ControlError('unauthorized','Local control authorization is required.');
    return d;
  }
  private async readJson(request:IncomingMessage,signal:AbortSignal):Promise<unknown>{
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??'')||request.headers['content-encoding']!==undefined&&request.headers['content-encoding']!=='identity')
      throw new ControlError('invalid-request','Actions require an uncompressed JSON body.');
    const length=request.headers['content-length'];
    if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>this.maxRequestBytes))throw new ControlError('body-too-large','The control action body is too large.');
    const raw=await new Promise<Buffer>((resolve,reject)=>{
      const chunks:Buffer[]=[];let bytes=0;
      const cleanup=()=>{request.removeListener('data',data);request.removeListener('end',end);request.removeListener('error',failed);request.removeListener('aborted',aborted);signal.removeEventListener('abort',aborted);};
      const failed=()=>{cleanup();reject(new ControlError('invalid-request','The action body could not be read.'));};
      const aborted=()=>{cleanup();reject(new ControlError('timed-out','The local control request timed out.'));};
      const data=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>this.maxRequestBytes){cleanup();reject(new ControlError('body-too-large','The control action body is too large.'));request.resume();}else chunks.push(chunk);};
      const end=()=>{cleanup();resolve(Buffer.concat(chunks,bytes));};
      request.on('data',data);request.once('end',end);request.once('error',failed);request.once('aborted',aborted);signal.addEventListener('abort',aborted,{once:true});
      if(signal.aborted)aborted();
    });
    try{
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as unknown;
    }catch{throw new ControlError('invalid-request','Provide a valid UTF-8 JSON body.');}
  }
  private async readAction(request:IncomingMessage,signal:AbortSignal):Promise<'settings'|'keybindings'>{
    const value=await this.readJson(request,signal);
    if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).join(',')==='action'){
      const action=(value as {action:unknown}).action;
      if(action==='settings'||action==='keybindings')return action;
    }
    throw new ControlError('invalid-request','Choose the settings or keybindings navigation action.');
  }
  private async handle(request:IncomingMessage,response:ServerResponse):Promise<void>{
    let authenticated=false,lease:Lease|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const d=this.ingress(request);authenticated=true;
      if(this.active.size>=this.maxConcurrent)throw new ControlError('busy','The local control API is busy.');
      lease={controller:new AbortController()};this.active.add(lease);const signal=lease.controller.signal;
      const expired=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{lease!.controller.abort();reject(new ControlError('timed-out','The local control request timed out.'));},this.deadlineMs);});
      const work=(async()=>{
        if(!request.url||request.url.length>2048||!request.url.startsWith('/')||request.url.startsWith('//'))throw new ControlError('invalid-request','Invalid control API path.');
        const url=new URL(request.url,`http://127.0.0.1:${d.port}`);
        if(url.pathname==='/v1/queue/commands'){
          if(request.method!=='POST')throw new ControlError('method-not-allowed','Use POST for queue commands.');
          if(url.search)throw new ControlError('invalid-request','Queue commands do not accept URL parameters.');
          const {applyQueueCommand,isQueueControlEnabled}=this.options.adapter;
          if(!applyQueueCommand||!isQueueControlEnabled?.())throw new ControlError('unsupported','Queue changes are disabled on this host.');
          const command=parseControlQueueEnvelope(await this.readJson(request,signal));
          if(signal.aborted)throw new ControlError('timed-out','The local control request timed out.');
          if(!isQueueControlEnabled())throw new ControlError('unsupported','Queue changes are disabled on this host.');
          return applyQueueCommand(command,signal);
        }
        if(url.pathname==='/v1/actions'){
          if(request.method!=='POST')throw new ControlError('method-not-allowed','Use POST for navigation actions.');
          if(url.search)throw new ControlError('invalid-request','Navigation actions do not accept URL parameters.');
          const action=await this.readAction(request,signal);
          const adapter=action==='settings'?this.options.adapter.openSettings:this.options.adapter.openKeybindings;
          if(!adapter)throw new ControlError('unsupported','That navigation action is not provided by this host.');
          if(signal.aborted)throw new ControlError('timed-out','The local control request timed out.');
          await adapter(signal);return{action,opened:true};
        }
        if(request.method!=='GET')throw new ControlError('method-not-allowed','This control resource is read-only.');
        if(request.headers['transfer-encoding']!==undefined||request.headers['content-length']!==undefined&&request.headers['content-length']!=='0')throw new ControlError('invalid-request','Read-only requests do not accept a body.');
        if(url.pathname!=='/v1/settings'&&url.pathname!=='/v1/library'&&url.search)throw new ControlError('invalid-request','This control resource does not accept URL parameters.');
        if(url.pathname==='/v1/capabilities')return{apiVersion:CONTROL_API_VERSION,applicationVersion:this.options.applicationVersion??'unknown',
          reads:['capabilities','state','settings','shortcuts',...(this.options.adapter.getQueue?['queue']:[]),...(this.options.adapter.getLibrary?['library']:[])],actions:{settings:!!this.options.adapter.openSettings,keybindings:!!this.options.adapter.openKeybindings},
          ...(this.options.adapter.getQueue ? { queueCommands: this.options.adapter.applyQueueCommand && this.options.adapter.isQueueControlEnabled?.() ? CONTROL_QUEUE_COMMANDS : [] } : {}),
          limits:{requestBytes:this.maxRequestBytes,responseBytes:this.maxResponseBytes,concurrent:this.maxConcurrent,deadlineMs:this.deadlineMs},completeApplicationControl:false};
        if(url.pathname==='/v1/queue'){
          if(!this.options.adapter.getQueue)throw new ControlError('unsupported','This host does not publish a queue view.');
          return this.options.adapter.getQueue(signal);
        }
        if(url.pathname==='/v1/library'){
          if(!this.options.adapter.getLibrary)throw new ControlError('unsupported','This host does not publish a library view.');
          return this.options.adapter.getLibrary(parseControlLibraryQuery(url.searchParams),signal);
        }
        if(url.pathname==='/v1/state')return await this.options.adapter.getState(signal);
        if(url.pathname==='/v1/shortcuts')return parseShortcuts(await this.options.adapter.getShortcuts(signal));
        if(url.pathname==='/v1/settings'){
          if([...url.searchParams.keys()].some(key=>key!=='includePrivatePaths')||url.searchParams.getAll('includePrivatePaths').length>1||url.searchParams.has('includePrivatePaths')&&!['true','false'].includes(url.searchParams.get('includePrivatePaths')!))
            throw new ControlError('invalid-request','Invalid settings projection options.');
          return controlSettings(await this.options.adapter.getSettings(signal),url.searchParams.get('includePrivatePaths')==='true');
        }
        throw new ControlError('not-found','This control resource does not exist.');
      })();
      lease.pending=work;
      void work.finally(()=>{this.active.delete(lease!);}).catch(()=>{});
      const result=await Promise.race([work,expired]);
      if(result===undefined)throw new ControlError('adapter-failed','The host did not provide this control resource.');
      this.respond(response,200,{ok:true,instance:{pid:d.pid,instanceId:d.instanceId,profileId:d.profileId},result},true);
    }catch(error){
      try{this.reject(response,error instanceof ControlError?error:new ControlError('adapter-failed','The host could not complete this control request.'),authenticated);}
      catch{response.destroy();}
    }finally{
      if(timer)clearTimeout(timer);lease?.controller.abort();if(lease&&!lease.pending)this.active.delete(lease);
      request.resume();
    }
  }
}
