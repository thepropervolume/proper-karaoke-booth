import { runControlCli } from './cli';
void runControlCli(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(()=>{process.stderr.write('{"ok":false,"error":{"code":"unavailable","message":"The local control CLI could not start."}}\n');process.exitCode=5;});
