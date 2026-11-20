import { CONTROL_API_VERSION, CONTROL_LIMITS, ControlError, INSTANCE_HEADERS, type ControlAction, type ControlDiscovery, type ControlInstance } from './protocol';
import { ownerOnlyDiscoveryAccess, processIsRunning, readControlDiscovery, type DiscoveryAccess } from './discovery';
import type { ControlQueueEnvelope } from './queue';
import { parseControlLibraryQuery } from './library';

export type ControlReply={ok:true;instance:ControlInstance;result:unknown};
type FetchFn=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
type ClientOptions={access?:DiscoveryAccess;fetch?:FetchFn;timeoutMs?:number;isRunning?:(pid:number)=>boolean};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const messages:Partial<Record<ControlError['code'],string>>={
  unauthorized:'The running host rejected local control authorization.', 'request-denied':'The running host rejected this control client.',
  'invalid-request':'The control request was rejected.', 'not-found':'The control API resource is unavailable.', 'unsupported':'This host does not support the requested control action.',
  'busy':'The local control API is busy.', 'timed-out':'The local control API did not respond in time.', 'adapter-failed':'The host could not complete the control operation.',
  'body-too-large':'The control request exceeds the host limit.', 'response-too-large':'The host snapshot exceeds the control API response limit.',
  'stale-cursor':'The library changed. Repeat the search without its previous cursor.',
};
function failure(status:number,value:unknown):ControlError{
  const code=record(value)&&record(value.error)&&typeof value.error.code==='string'&&Object.hasOwn(messages,value.error.code)?value.error.code as ControlError['code']:
    status===401?'unauthorized':status===403?'request-denied':status===429?'busy':status===504?'timed-out':status===501?'unsupported':'unavailable';
  return new ControlError(code,messages[code]??'The local control API is unavailable.');
}

/** Discovery and responses must identify the same running owner/profile instance. */
export class LocalControlClient{
  private readonly timeoutMs:number;
  constructor(private readonly profileDirectory:string,private readonly options:ClientOptions={}){
    this.timeoutMs=options.timeoutMs??CONTROL_LIMITS.deadlineMs;
    if(!Number.isInteger(this.timeoutMs)||this.timeoutMs<20||this.timeoutMs>60000)throw new ControlError('invalid-request','Invalid control client timeout.');
  }
  private async discover():Promise<ControlDiscovery>{
    const value=await readControlDiscovery(this.profileDirectory,this.options.access??ownerOnlyDiscoveryAccess);
    if(!(this.options.isRunning??processIsRunning)(value.pid))throw new ControlError('not-running','The discovered host process is no longer running.');
    return value;
  }
  private async request(d:ControlDiscovery,path:string,payload?:object):Promise<ControlReply>{
    const controller=new AbortController();let expired=false,timer:ReturnType<typeof setTimeout>|undefined;
    const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(new ControlError('timed-out','The local control API did not respond in time.'));},this.timeoutMs);});
    const work=(async()=>{
      let response:Response;
      try{response=await(this.options.fetch??fetch)(`http://127.0.0.1:${d.port}${path}`,{method:payload?'POST':'GET',
        headers:{Authorization:'Bearer '+d.token,Accept:'application/json',...(payload?{'Content-Type':'application/json'}:{})},
        ...(payload?{body:JSON.stringify(payload)}:{}),redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});}
      catch{throw new ControlError(expired?'timed-out':'unavailable',expired?'The local control API did not respond in time.':'The discovered local control API could not be reached.');}
      if(expired){void response.body?.cancel().catch(()=>{});throw new ControlError('timed-out','The local control API did not respond in time.');}
      if(!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||Number(response.headers.get('content-length')??0)>CONTROL_LIMITS.responseBytes){void response.body?.cancel().catch(()=>{});throw new ControlError('invalid-response','The local control API returned an invalid response.');}
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      const abort=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>CONTROL_LIMITS.responseBytes)throw Error();chunks.push(part.value);}}
      catch{throw new ControlError(expired?'timed-out':'invalid-response',expired?'The local control API did not respond in time.':'The local control API returned an invalid response.');}
      finally{controller.signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
      let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch{throw new ControlError('invalid-response','The local control API returned invalid JSON.');}
      if(response.status!==200)throw failure(response.status,body);
      if(response.headers.get(INSTANCE_HEADERS.instance)!==d.instanceId||response.headers.get(INSTANCE_HEADERS.profile)!==d.profileId||response.headers.get(INSTANCE_HEADERS.pid)!==String(d.pid)||
        !record(body)||body.ok!==true||!record(body.instance)||body.instance.pid!==d.pid||body.instance.instanceId!==d.instanceId||body.instance.profileId!==d.profileId||!Object.hasOwn(body,'result'))
        throw new ControlError('invalid-response','The control response does not belong to the discovered running profile.');
      return body as ControlReply;
    })();
    try{return await Promise.race([work,deadline]);}finally{if(timer)clearTimeout(timer);}
  }
  private async capabilitiesFor(d:ControlDiscovery):Promise<ControlReply>{
    const value=await this.request(d,'/v1/capabilities');
    if(!record(value.result)||value.result.apiVersion!==CONTROL_API_VERSION||!record(value.result.actions)||typeof value.result.actions.settings!=='boolean'||typeof value.result.actions.keybindings!=='boolean'||
      !Array.isArray(value.result.reads)||!['capabilities','state','settings','shortcuts'].every(item=>(value.result as {reads:unknown[]}).reads.includes(item)))
      throw new ControlError('invalid-response','The running host uses an unsupported control API contract.');
    return value;
  }
  async get(resource:'capabilities'|'state'|'settings'|'shortcuts'|'queue',includePrivatePaths=false):Promise<ControlReply>{
    const d=await this.discover(),capabilities=await this.capabilitiesFor(d);
    if(resource==='capabilities')return capabilities;
    if(resource==='queue'&&!(capabilities.result as {reads:string[]}).reads.includes('queue'))throw new ControlError('unsupported','This host does not publish a queue view.');
    return this.request(d,`/v1/${resource}`+(resource==='settings'&&includePrivatePaths?'?includePrivatePaths=true':''));
  }
  async open(action:ControlAction):Promise<ControlReply>{
    const d=await this.discover(),capabilities=await this.capabilitiesFor(d);
    if(!(capabilities.result as {actions:Record<ControlAction,boolean>}).actions[action])throw new ControlError('unsupported','This host does not provide that desktop navigation action.');
    return this.request(d,'/v1/actions',{action});
  }
  async applyQueueCommand(envelope: ControlQueueEnvelope): Promise<ControlReply> {
    const d = await this.discover(), capabilities = await this.capabilitiesFor(d);
    const advertised = (capabilities.result as { queueCommands?: unknown }).queueCommands;
    if (!Array.isArray(advertised) || !advertised.includes(envelope.command.type))
      throw new ControlError('unsupported', 'Enable queue changes in Local API and CLI preferences.');
    const reply = await this.request(d, '/v1/queue/commands', envelope);
    const outcome = reply.result;
    if (!record(outcome) || !Number.isSafeInteger(outcome.revision) || typeof outcome.revision !== 'number' || outcome.revision < 0 ||
      !(outcome.ok === true || outcome.ok === false && typeof outcome.code === 'string' && typeof outcome.message === 'string'))
      throw new ControlError('invalid-response', 'The host returned an invalid queue outcome.');
    return reply;
  }
  async library(text = '', cursor?: string): Promise<ControlReply> {
    const params = new URLSearchParams({ q: text, ...(cursor === undefined ? {} : { cursor }) });
    parseControlLibraryQuery(params);
    const d = await this.discover(), capabilities = await this.capabilitiesFor(d);
    if (!(capabilities.result as { reads: string[] }).reads.includes('library'))
      throw new ControlError('unsupported', 'This host does not publish a library view.');
    return this.request(d, `/v1/library?${params}`);
  }
}
