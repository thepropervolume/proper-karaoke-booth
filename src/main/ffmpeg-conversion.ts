import { spawn } from 'node:child_process';
import { findFfmpegTool } from './media-tool-paths';

/** Keep conversion cancellable, and wait for the worker to close before cleaning up its files. */
export async function runFfmpegConversion(
  args: string[], output: string, signal: AbortSignal, progress: (seconds: number) => void,
  options: { cwd?: string; installMessage: string; decodeMessage: string },
): Promise<void> {
  if (signal.aborted) throw new Error('Import cancelled.');
  const executable = await findFfmpegTool('ffmpeg');
  if (!executable) throw new Error(options.installMessage);
  if (signal.aborted) throw new Error('Import cancelled.');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args, '-progress', 'pipe:1', '-nostats', output], {
      cwd: options.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let spawnError = false, timedOut = false, buffer = '';
    const abort = () => { child.kill('SIGKILL'); };
    const timer = setTimeout(() => { timedOut = true; abort(); }, 30 * 60 * 1000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', chunk => {
      buffer = (buffer + String(chunk)).slice(-4096);
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1e6;
          if (Number.isFinite(seconds) && seconds >= 0) progress(seconds);
        }
      }
    });
    // Worker diagnostics can contain source paths and are never sent to the UI.
    child.stderr.resume();
    child.on('error', () => { spawnError = true; });
    child.on('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(new Error('Import cancelled.'));
      else if (spawnError) reject(new Error(options.installMessage));
      else if (timedOut) reject(new Error('Conversion exceeded 30 minutes.'));
      else if (code !== 0) reject(new Error(options.decodeMessage));
      else resolve();
    });
  });
}
