import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { fingerprintMedia, mediaIdentityMatches } from './media-verification';
import { findFfmpegTool } from './media-tool-paths';
import type { StoredMedia } from './store';

export type EmbeddedMetadataResult =
  | { status: 'ready'; title: string | null; artist: string | null }
  | { status: 'busy' | 'cancelled' | 'unavailable' | 'changed' | 'unsupported' | 'tool-missing' };

const probe = promisify(execFile);
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** FFprobe provides its effective container values. It may not expose competing MP4 atom groups. */
export function parseEmbeddedMetadata(value: unknown): Pick<Extract<EmbeddedMetadataResult, { status: 'ready' }>, 'title' | 'artist'> {
  if (!record(value) || !record(value.format) || (value.format.tags !== undefined && !record(value.format.tags)))
    throw new Error('Invalid container tag data.');
  const tags = record(value.format.tags) ? value.format.tags : {};
  const valueFor = (key: 'title' | 'artist') => {
    const raw = tags[key];
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    return text && text.length <= 500 && !/[\u0000-\u001f\u007f-\u009f\ufffd]/u.test(text) ? text : null;
  };
  return { title: valueFor('title'), artist: valueFor('artist') };
}

function containedIn(path: string, root: string): boolean {
  const position = relative(root, path);
  return !isAbsolute(position) && position !== '..' && !position.startsWith(`..${sep}`);
}

/** Inspect one existing recording. Neither the FFprobe command nor this function writes media. */
export async function readEmbeddedMp4(media: StoredMedia, managedRoots: readonly string[], signal: AbortSignal): Promise<EmbeddedMetadataResult> {
  if (signal.aborted) return { status: 'cancelled' };
  if (!isAbsolute(media.path) || extname(media.path).toLowerCase() !== '.mp4') return { status: 'unsupported' };
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  try {
    const path = await realpath(media.path);
    if (managedRoots.some(root => containedIn(media.path, root) || containedIn(path, root))) return { status: 'unsupported' };
    for (const root of managedRoots) {
      const actual = await realpath(root).catch(() => root);
      if (containedIn(path, actual)) return { status: 'unsupported' };
    }
    const checked = await fingerprintMedia(media.path, deadline);
    if (checked.fingerprint !== media.fingerprint) return { status: 'changed' };
    const ffprobe = await findFfmpegTool('ffprobe');
    if (!ffprobe) return { status: 'tool-missing' };
    const { stdout } = await probe(ffprobe, [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-enable_drefs', '0', '-i', path,
      '-show_entries', 'format_tags=title,artist', '-of', 'json=string_validation=fail',
    ], { signal: deadline, killSignal: 'SIGKILL', timeout: 5_000, maxBuffer: 8192, windowsHide: true });
    const values = parseEmbeddedMetadata(JSON.parse(stdout));
    if (!await mediaIdentityMatches(path, checked.identity) || !await mediaIdentityMatches(media.path, checked.identity)) return { status: 'changed' };
    if (signal.aborted) return { status: 'cancelled' };
    return deadline.aborted ? { status: 'unavailable' } : { status: 'ready', ...values };
  } catch (error) {
    if (signal.aborted) return { status: 'cancelled' };
    // Only a missing executable is a missing tool. The input file can disappear independently.
    const failure = error as NodeJS.ErrnoException;
    if (failure.syscall?.endsWith('ffprobe' + (process.platform === 'win32' ? '.exe' : '')) && failure.code === 'ENOENT') return { status: 'tool-missing' };
    return { status: 'unavailable' };
  }
}
