import { runControlCli } from './cli';
// The CLI is an authenticated client of the running host, never a second
// SQLite writer. Stable exit codes let shell scripts distinguish failure kinds.
void runControlCli(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(()=>{process.stderr.write('{"ok":false,"error":{"code":"unavailable","message":"The local control CLI could not start."}}\n');process.exitCode=5;});
