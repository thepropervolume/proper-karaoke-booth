import { appendFileSync, lstatSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 1024 * 1024;
type EventCode = 'startup' | 'startup-failed' | 'renderer-exited' | 'room-start-failed' | 'room-online' | 'room-ended' | 'media-error' | 'configuration-failed';

/** Store fixed event labels only. Paths, URLs, names and exception text stay out of the log. */
export class DiagnosticLog {
  readonly path: string;
  constructor(directory: string) { this.path = join(directory, 'karabooth.log'); }

  record(event: EventCode): void {
    try {
      const line = `${JSON.stringify({ time: new Date().toISOString(), event })}\n`;
      const info = (() => { try { return lstatSync(this.path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      } })();
      if (info && (!info.isFile() || info.isSymbolicLink())) return;
      if (info && info.size + Buffer.byteLength(line) > LIMIT) renameSync(this.path, this.path + '.1');
      appendFileSync(this.path, line, { mode: 0o600 });
    } catch { /* Diagnostics must never interrupt a show. */ }
  }
}
