import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { LocalControlClient } from './client';
import { CONTROL_DISCOVERY_NAME, CONTROL_LIMITS, ControlError, controlJson } from './protocol';
import type { DiscoveryAccess } from './discovery';
import { parseControlQueueEnvelope } from './queue';

export const CONTROL_CLI_EXIT={ok:0,usage:2,notRunning:3,access:4,service:5,unsupported:6,invalidResponse:7} as const;
export const CONTROL_CLI_HELP=`The Proper Volume local control CLI

Usage: karabooth-cli [--profile-dir DIR | --discovery FILE] COMMAND
Commands:
  status              Check this profile's running API and capabilities
  capabilities        List implemented reads and desktop navigation actions
  state               Read the authorized host show snapshot
  library [QUERY] [CURSOR]  Find saved songs and copy a version ID
  queue               Read upcoming and pending requests
  queue command JSON  Submit a revisioned queue command (use - to read stdin)
  settings            Read settings with private paths redacted
  shortcuts           Read effective keyboard shortcuts
  open settings       Open Preferences if the running host provides that action
  open keybindings    Open Keyboard Shortcuts if the host provides that action

Options:
  --include-private-paths  Explicitly include local paths with settings
  --settings              Alias for open settings (requires enabled API)
  --keybindings           Alias for open keybindings (requires enabled API)
  --json                  Structured JSON is already the default
  --help, -h              Show this help without reading credentials

The API and queue changes are both off by default. The API does
not control playback, imports, databases, or arbitrary application commands.
Existing desktop launch flags work separately without the local API.
`;
type CliIO={out?:(text:string)=>void;err?:(text:string)=>void;env?:NodeJS.ProcessEnv;platform?:NodeJS.Platform;home?:string;
  access?:DiscoveryAccess;fetch?:typeof fetch;isRunning?:(pid:number)=>boolean; input?: AsyncIterable<Buffer | string>};
export function defaultControlProfile(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform,userHome=homedir()):string{
  if(platform==='win32')return join(env.APPDATA||join(userHome,'AppData','Roaming'),'proper-karaoke-booth');
  if(platform==='darwin')return join(userHome,'Library','Application Support','proper-karaoke-booth');
  if(env.XDG_CONFIG_HOME&&!isAbsolute(env.XDG_CONFIG_HOME))throw new ControlError('invalid-request','XDG_CONFIG_HOME must be an absolute path.');
  return join(env.XDG_CONFIG_HOME||join(userHome,'.config'),'proper-karaoke-booth');
}
async function readQueueInput(argument: string, input: AsyncIterable<Buffer | string>): Promise<string> {
  const failure = () => new ControlError('invalid-request', 'Queue JSON must fit within 2048 UTF-8 bytes.');
  if (argument !== '-') {
    if (Buffer.byteLength(argument) > CONTROL_LIMITS.requestBytes) throw failure();
    return argument;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > CONTROL_LIMITS.requestBytes) throw failure();
    chunks.push(buffer);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)); }
  catch { throw new ControlError('invalid-request', 'Queue JSON must be valid UTF-8.'); }
}
function exitFor(error:ControlError):number{
  if(error.code==='not-running'||error.code==='disabled')return CONTROL_CLI_EXIT.notRunning;
  if(['unauthorized','request-denied','unsafe-discovery'].includes(error.code))return CONTROL_CLI_EXIT.access;
  if(error.code==='unsupported')return CONTROL_CLI_EXIT.unsupported;
  if(error.code==='invalid-response')return CONTROL_CLI_EXIT.invalidResponse;
  if(error.code==='invalid-request')return CONTROL_CLI_EXIT.usage;
  return CONTROL_CLI_EXIT.service;
}
/** Testable CLI entry; it never receives a bearer token on the command line. */
export async function runControlCli(args:string[],io:CliIO={}):Promise<number>{
  const out=io.out??(value=>process.stdout.write(value)),err=io.err??(value=>process.stderr.write(value));
  if(args.includes('--help')||args.includes('-h')){out(CONTROL_CLI_HELP);return CONTROL_CLI_EXIT.ok;}
  try{
    let profile:string|undefined,discovery:string|undefined,privatePaths=false,alias:string|undefined;const commands:string[]=[];
    for(let i=0;i<args.length;i++){
      const value=args[i];
      if(value==='--profile-dir'||value==='--discovery'){
        const path=args[++i];if(!path||path.startsWith('--'))throw new ControlError('invalid-request','A profile or discovery option needs its path.');
        if(value==='--profile-dir'){if(profile)throw new ControlError('invalid-request','Provide the profile directory once.');profile=resolve(path);}else{if(discovery)throw new ControlError('invalid-request','Provide the discovery file once.');discovery=resolve(path);}
      }else if(value==='--include-private-paths')privatePaths=true;
      else if(value==='--settings'||value==='--keybindings'){if(alias)throw new ControlError('invalid-request','Choose one navigation action.');alias=value.slice(2);}
      else if(value==='--json')continue;
      else if(value.startsWith('-')&&!(value==='-'&&commands.length===2&&commands[0]==='queue'&&commands[1]==='command'))throw new ControlError('invalid-request','Unknown CLI option. Use --help.');
      else commands.push(value);
    }
    if(profile&&discovery||alias&&commands.length)throw new ControlError('invalid-request','Choose one profile selector and one command.');
    if(discovery&&basename(discovery)!==CONTROL_DISCOVERY_NAME)throw new ControlError('invalid-request','The discovery filename must be control-api.json.');
    const selected=profile??(discovery?dirname(discovery):defaultControlProfile(io.env,io.platform,io.home));
    const command=alias?['open',alias]:commands.length?commands:['status'];
    const read=command.length===1&&['status','capabilities','state','settings','shortcuts','queue'].includes(command[0]);
    const open=command.length===2&&command[0]==='open'&&['settings','keybindings'].includes(command[1]);
    const queue=command.length===3&&command[0]==='queue'&&command[1]==='command';
    const library=command[0]==='library'&&command.length<=3;
    if(!read&&!open&&!queue&&!library||privatePaths&&command[0]!=='settings')throw new ControlError('invalid-request','Unknown command or incompatible option. Use --help.');
    const client=new LocalControlClient(selected,{access:io.access,fetch:io.fetch,isRunning:io.isRunning});
    if(queue){
      const input=await readQueueInput(command[2],io.input??process.stdin);
      let value:unknown;
      try{value=JSON.parse(input);}catch{throw new ControlError('invalid-request','Provide the queue command as JSON.');}
      const result=await client.applyQueueCommand(parseControlQueueEnvelope(value));
      const ok=(result.result as {ok:boolean}).ok;
      (ok?out:err)(controlJson(result)+'\n');
      return ok?CONTROL_CLI_EXIT.ok:CONTROL_CLI_EXIT.service;
    }
    const result=library?await client.library(command[1],command[2]):open?await client.open(command[1] as 'settings'|'keybindings'):
      await client.get(command[0]==='status'?'capabilities':command[0] as 'capabilities'|'state'|'settings'|'shortcuts'|'queue',privatePaths);
    out(controlJson(command[0]==='status'?{...result,status:'ready'}:result)+'\n');return CONTROL_CLI_EXIT.ok;
  }catch(error){
    const failure=error instanceof ControlError?error:new ControlError('unavailable','The local control request could not be completed.');
    err(JSON.stringify({ok:false,error:{code:failure.code,message:failure.message}})+'\n');return exitFor(failure);
  }
}
