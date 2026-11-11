import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import type { BumperSnapshot, BumperTrack } from './bumper-controller';
import { mediaRange } from './media-range';

/** Generation-scoped read-only media; callers retain source paths in the main process. */
export async function serveBumper(request: Request, state: BumperSnapshot, tracks: readonly BumperTrack[]): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.hostname !== 'bumper' || !state.generation ||
      url.pathname !== `/${encodeURIComponent(state.generation)}` || state.status === 'stopped') return new Response(null, { status: 404 });
  const track = tracks.find(value => value.id === state.trackId);
  if (!track) return new Response(null, { status: 404 });
  const types: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
  const type = types[extname(track.path).toLowerCase()];
  if (!type) return new Response(null, { status: 404 });
  try {
    const size = (await stat(track.path)).size;
    if (!Number.isSafeInteger(size) || size <= 0) return new Response(null, { status: 404 });
    const range = mediaRange(request.headers.get('range'), size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const { start, end, partial } = range;
    const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store' };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    const stream = Readable.toWeb(createReadStream(track.path, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(stream, { status: partial ? 206 : 200, headers });
  } catch { return new Response(null, { status: 404 }); }
}
