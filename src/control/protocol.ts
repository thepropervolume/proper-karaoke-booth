import { parseSettings } from '../domain/settings';
import { PROVIDER_CATALOG_IDS } from '../domain/provider-catalog';

export const CONTROL_API_VERSION = 1;
export const CONTROL_DISCOVERY_NAME = 'control-api.json';
export const CONTROL_LIMITS = { requestBytes: 2048, responseBytes: 2 * 1024 * 1024, concurrent: 4, deadlineMs: 5000 } as const;
export type ControlInstance = { pid:number;instanceId:string;profileId:string };
export type ControlDiscovery = ControlInstance & {format:1;host:'127.0.0.1';port:number;token:string;profileDirectory:string};
export type ControlAction = 'settings' | 'keybindings';
export type ControlAdapter = {
  getState(signal:AbortSignal):unknown | Promise<unknown>;
  getSettings(signal:AbortSignal):unknown | Promise<unknown>;
  getShortcuts(signal:AbortSignal):unknown | Promise<unknown>;
  openSettings?(signal:AbortSignal):void | Promise<void>;
  openKeybindings?(signal:AbortSignal):void | Promise<void>;
};
export type ControlErrorCode = 'disabled' | 'not-running' | 'already-running' | 'unsafe-discovery' | 'unauthorized' | 'request-denied' | 'invalid-request' | 'not-found' | 'method-not-allowed' | 'body-too-large' | 'busy' | 'timed-out' | 'unsupported' | 'adapter-failed' | 'response-too-large' | 'invalid-response' | 'unavailable';
export class ControlError extends Error {
  constructor(public readonly code:ControlErrorCode, message:string) { super(message);this.name='ControlError'; }
}

export const INSTANCE_HEADERS = {instance:'x-tpv-control-instance',profile:'x-tpv-control-profile',pid:'x-tpv-control-pid'} as const;
const privateSettings = ['sharedCatalogConfigFile','ratingProfileConfigFile','lyricBackdropFile','karaokeNerdsCacheDirectory','ytDlpExecutable'] as const;
export function controlSettings(value:unknown, includePrivatePaths=false):{settings:ReturnType<typeof parseSettings>;redactedFields:string[]} {
  const settings=parseSettings(value),redactedFields:string[]=[];
  if(!includePrivatePaths)for(const key of privateSettings)if(settings[key]){settings[key]='';redactedFields.push(key);}
  if(!includePrivatePaths)for(const provider of PROVIDER_CATALOG_IDS)if(settings.providerCatalogProfiles[provider]){
    settings.providerCatalogProfiles[provider]='';redactedFields.push(`providerCatalogProfiles.${provider}`);
  }
  return {settings,redactedFields};
}

/** Bound adapter serialization and remove accidentally returned credential fields. */
export function controlJson(value:unknown, maximumBytes=CONTROL_LIMITS.responseBytes):string {
  const seen=new Set<object>();let nodes=0,remaining=maximumBytes;
  const charge=(bytes:number)=>{remaining-=bytes;if(remaining<0)throw new ControlError('response-too-large','The authorized snapshot exceeds the control API limit.');};
  // Count JSON escaping and UTF-8 without first allocating an escaped string.
  const string=(text:string)=>{
    charge(2);
    for(let index=0;index<text.length;index++){
      const code=text.charCodeAt(index);
      if(code===34||code===92)charge(2);
      else if(code<32)charge([8,9,10,12,13].includes(code)?2:6);
      else if(code<128)charge(1);
      else if(code<2048)charge(2);
      else if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(index+1);if(next>=0xdc00&&next<=0xdfff){charge(4);index++;}else charge(6);}
      else charge(code>=0xdc00&&code<=0xdfff?6:3);
    }
  };
  const visit=(item:unknown,depth:number):unknown=>{
    if(++nodes>100000||depth>32)throw new ControlError('response-too-large','The authorized snapshot exceeds the control API limit.');
    if(item===null){charge(4);return item;}
    if(typeof item==='boolean'){charge(item?4:5);return item;}
    if(typeof item==='number'){if(!Number.isFinite(item))throw Error();charge(Buffer.byteLength(JSON.stringify(item)));return item;}
    if(typeof item==='string'){string(item);return item;}
    if(!item||typeof item!=='object'||seen.has(item))throw Error();
    seen.add(item);
    try{
      charge(2);
      if(Array.isArray(item)){
        const result:unknown[]=[];
        for(let index=0;index<item.length;index++){if(index)charge(1);result.push(visit(index in item?item[index]:null,depth+1));}
        return result;
      }
      const result:Record<string,unknown>={};let first=true;
      for(const key in item){
        if(!Object.hasOwn(item,key))continue;
        const secret=/^(?:password|passphrase|token|secret|authorization|api[_-]?key|private[_-]?key|credentials?)$/i.test(key);
        const entry=secret?'[redacted]':(item as Record<string,unknown>)[key];if(entry===undefined)continue;
        if(!first)charge(1);first=false;string(key);charge(1);
        Object.defineProperty(result,key,{value:visit(entry,depth+1),enumerable:true,configurable:true,writable:true});
      }
      return result;
    }finally{seen.delete(item);}
  };
  const result=JSON.stringify(visit(value,0));
  if(Buffer.byteLength(result)>maximumBytes)throw new ControlError('response-too-large','The authorized snapshot exceeds the control API limit.');
  return result;
}
