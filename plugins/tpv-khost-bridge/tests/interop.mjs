// The real Node client against the real C# HTTP server and a synthetic provider.
// Usage: node --import tsx plugins/tpv-khost-bridge/tests/interop.mjs <dotnet> <BridgeSmoke.dll>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { KHostBridgeClient, readKHostBridgeProfile } from '../../../src/main/khost-client.ts';

assert.equal(process.argv.length, 4);
const parent = await realpath(tmpdir());
const temporary = await mkdtemp(join(tmpdir(), 'tpv-khost-interop-'));
const child = spawn(process.argv[2], [process.argv[3], '--serve-test', temporary], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let stdout = '', stderr = '', timeout;
try {
  await Promise.race([
    new Promise((resolve, reject) => {
      child.stdout.on('data', value => { stdout += value; if (stdout.includes('READY')) resolve(); });
      child.stderr.on('data', value => { stderr = (stderr + value).slice(-4000); });
      child.once('error', reject); child.once('exit', () => reject(Error('Fixture server stopped before ready: ' + stderr)));
    }),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Fixture server startup deadline')), 10_000); }),
  ]);
  clearTimeout(timeout);
  const client = new KHostBridgeClient({ ...await readKHostBridgeProfile(join(temporary, 'connection.json')), timeoutMs: 3000 });
  const status = await client.status(); assert.equal(status.status, 'ready'); assert.equal(status.embeddedPlayback, false);
  const result = await client.search('Artist Song'); assert.equal(result.status, 'ready'); assert.equal(result.songs.length, 1);
  const requestId = randomUUID();
  const accepted = await client.handoff(result.songs[0].resultId, requestId); assert.equal(accepted.status, 'handed-off');
  assert.equal(accepted.playback, 'external-khost');
  const polled = await client.handoffStatus(requestId); assert.equal(polled.status, 'handed-off');
  assert.equal(polled.state, 'complete');
  console.log('PASS: actual Node/C# wire interoperability, native owner-only profile read, search and explicit external handoff; synthetic provider only.');
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; }
  const actual = await realpath(temporary);
  assert.equal(dirname(actual), parent); assert.ok(basename(actual).startsWith('tpv-khost-interop-'));
  await rm(actual, { recursive: true, force: true });
}
