/** Explicitly invoked development-only supervisor. Never installed or started by the application. */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isQuickTunnelOrigin, startQuickTunnelLoopback, type RelayHandler } from './quick-tunnel-loopback';

export type QuickTunnelDevOptions = {
  enabled: boolean;
  executable: string;
  caFile: string;
  cert: Buffer;
  key: Buffer;
  handler: RelayHandler;
  onFailure: () => void;
  signal?: AbortSignal;
  startupTimeoutMs?: number;
};
export type QuickTunnelDevSession = { origin: string; stop(): Promise<void> };
type Spawn = (path: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcess;
type Runtime = { makeTemp: typeof mkdtemp; openGate: typeof startQuickTunnelLoopback };

/** The caller supplies an authenticated, bounded guest handler and handles relay-only credential revocation. */
export async function startQuickTunnelDev(options: QuickTunnelDevOptions, spawnProcess: Spawn = spawn,
  runtime: Runtime = { makeTemp: mkdtemp, openGate: startQuickTunnelLoopback }): Promise<QuickTunnelDevSession> {
  if (options.enabled !== true) throw new Error('Development tunnel is disabled.');
  if (!isAbsolute(options.executable) || !/^(?:cloudflared(?:\.exe)?|cloudflared-windows-amd64\.exe)$/i.test(basename(options.executable)) || !isAbsolute(options.caFile) ||
      typeof options.handler !== 'function' || typeof options.onFailure !== 'function' || options.signal?.aborted) throw new Error('Invalid development tunnel configuration.');
  const timeout = options.startupTimeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new Error('Invalid tunnel startup timeout.');
  const caStat = await stat(options.caFile);
  if (!caStat.isFile() || caStat.size < 1 || caStat.size > 128 * 1024) throw new Error('Invalid loopback CA file.');
  const ca = await readFile(options.caFile);
  let child: ChildProcess | undefined;
  let closed = false, started = false;
  let temporary: string | undefined;
  let unexpected: (() => void) | undefined;
  const abortAfterStart = () => unexpected?.();
  const gate = await runtime.openGate({ cert: options.cert, key: options.key, ca, handler: options.handler, onError: () => unexpected?.() });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    closed = true;
    options.signal?.removeEventListener('abort', abortAfterStart);
    const operation = (async () => {
      // Closing the gate first cuts off traffic even if the connector refuses to exit.
      const gateStop = gate.close();
      let processStop = Promise.resolve();
      if (child && child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        const childProcess = child;
        processStop = new Promise<void>((resolve, reject) => {
          const exited = () => { clearTimeout(timer); resolve(); };
          const timer = setTimeout(() => { childProcess.removeListener('exit', exited); reject(new Error('Tunnel process did not stop.')); }, 5000);
          childProcess.once('exit', exited);
          if (!childProcess.kill()) { clearTimeout(timer); childProcess.removeListener('exit', exited); reject(new Error('Tunnel process could not be stopped.')); }
        });
      }
      const results = await Promise.allSettled([gateStop, processStop]);
      if (temporary) { await rm(temporary, { recursive: true, force: true }); temporary = undefined; }
      if (results.some(result => result.status === 'rejected')) throw new Error('Development tunnel cleanup failed.');
    })();
    stopping = operation;
    void operation.catch(() => { if (stopping === operation) stopping = undefined; });
    return operation;
  };
  unexpected = () => {
    if (closed) return;
    void stop().catch(() => {});
    if (started) { try { options.onFailure(); } catch {} }
  };
  try {
    if (closed || options.signal?.aborted) throw new Error('Development tunnel startup was cancelled.');
    temporary = await runtime.makeTemp(join(tmpdir(), 'tpv-quick-tunnel-'));
    if (closed || options.signal?.aborted) { await rm(temporary, { recursive: true, force: true }); temporary = undefined; throw new Error('Development tunnel startup was cancelled.'); }
    const isolatedConfig = join(temporary, 'config.yml');
    const isolatedCa = join(temporary, 'origin-ca.pem');
    await writeFile(isolatedConfig, '{}\n', { mode: 0o600, flag: 'wx' });
    await writeFile(isolatedCa, ca, { mode: 0o600, flag: 'wx' }); ca.fill(0);
    if (closed || options.signal?.aborted) throw new Error('Development tunnel startup was cancelled.');
    // Inherit no Cloudflare/TUNNEL_* overrides or user config; do not use a shell.
    const env: NodeJS.ProcessEnv = {};
    for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'LANG']) if (process.env[name]) env[name] = process.env[name];
    child = spawnProcess(options.executable, ['tunnel', '--config', isolatedConfig, '--no-autoupdate', '--url', `https://127.0.0.1:${gate.port}`, '--origin-server-name', '127.0.0.1', '--origin-ca-pool', isolatedCa],
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: temporary, env });
    const childProcess = child;
    const origin = await new Promise<string>((resolve, reject) => {
      let resolved = false, buffered = '', announced = false;
      const decoder = new StringDecoder('utf8');
      const finish = (error?: Error, value?: string) => {
        if (resolved) return; resolved = true; clearTimeout(timer); options.signal?.removeEventListener('abort', aborted);
        childProcess.stdout?.removeListener('data', data); childProcess.stderr?.removeListener('data', data);
        childProcess.stdout?.resume(); childProcess.stderr?.resume();
        if (error) reject(error); else resolve(value!);
      };
      const aborted = () => finish(new Error('Development tunnel startup was cancelled.'));
      const timer = setTimeout(() => finish(new Error('Development tunnel did not become ready.')), timeout);
      const data = (chunk: Buffer) => {
        buffered += decoder.write(chunk);
        if (buffered.length > 65536) { finish(new Error('Development tunnel output exceeded its limit.')); return; }
        const lines = buffered.split(/\r?\n/); buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (line.includes('Your quick Tunnel has been created!') || line.includes('Your protected quick Tunnel has been created!')) { announced = true; continue; }
          if (!announced) continue;
          const match = /(?:^|[\s│|])(https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com)(?=$|[\s│|])/g.exec(line);
          if (match && isQuickTunnelOrigin(match[1])) { finish(undefined, match[1]); return; }
        }
      };
      childProcess.stdout?.on('data', data); childProcess.stderr?.on('data', data);
      childProcess.on('error', () => { if (!resolved) finish(new Error('Development tunnel could not start.')); else unexpected?.(); });
      childProcess.once('exit', () => { if (!resolved) finish(new Error('Development tunnel stopped during startup.')); else unexpected?.(); });
      options.signal?.addEventListener('abort', aborted, { once: true });
      if (options.signal?.aborted) aborted();
    });
    if (closed || options.signal?.aborted || childProcess.exitCode !== null || childProcess.signalCode !== null) throw new Error('Development tunnel stopped during startup.');
    gate.bindOrigin(origin); started = true;
    options.signal?.addEventListener('abort', abortAfterStart, { once: true });
    if (options.signal?.aborted) { unexpected(); throw new Error('Development tunnel startup was cancelled.'); }
    return { origin, stop };
  } catch (error) {
    try { await stop(); } finally { if (temporary) { await rm(temporary, { recursive: true, force: true }); temporary = undefined; } }
    throw error;
  }
}
