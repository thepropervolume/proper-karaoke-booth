import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { libraryBpm, libraryMusicalKey, type LibraryResultMetadata } from '../domain/library-result-fields';
import { metadataFromPath, type MetadataFormat } from '../domain/metadata';
import type { StoredMedia } from './store';

const probe = promisify(execFile);
export const MAX_LIBRARY_METADATA_BATCH = 32;
const CACHE_SIZE = 2000;

export function readContainerMetadata(value: unknown): LibraryResultMetadata {
  const format = value && typeof value === 'object' ? (value as { format?: unknown }).format : null;
  if (!format || typeof format !== 'object') return {};
  const { duration, tags } = format as { duration?: unknown; tags?: Record<string, unknown> };
  const normalized = new Map(Object.entries(tags ?? {}).map(([key, v]) => [key.toLowerCase(), v]));
  const seconds = typeof duration === 'string' && /^\d+(?:\.\d+)?$/.test(duration) ? Number(duration) : 0;
  const bpm = libraryBpm(normalized.get('bpm') ?? normalized.get('tbpm') ?? normalized.get('tempo'));
  const musicalKey = libraryMusicalKey(normalized.get('initialkey') ?? normalized.get('tkey') ?? normalized.get('key'));
  const catalogNumber = normalized.get('catalognumber');
  const djCatalogNumber = typeof catalogNumber === 'string' && catalogNumber.length <= 100 &&
    catalogNumber.trim() && !/[\x00-\x1f\x7f]/.test(catalogNumber) ? catalogNumber.trim() : undefined;
  return {
    ...(seconds > 0 && seconds <= 86400 ? { durationSeconds: seconds } : {}),
    ...(bpm === undefined ? {} : { bpm }),
    ...(musicalKey === undefined ? {} : { musicalKey }),
    ...(djCatalogNumber === undefined ? {} : { djCatalogNumber }),
  };
}

/** Probe only visible host-library files. Keep paths private and cap parallel probes, including during fast scrolling. */
export class LibraryMediaMetadata {
  private readonly cache = new Map<string, { identity: string; details: LibraryResultMetadata }>();
  private batches = 0;

  async load(media: readonly StoredMedia[], templates: readonly string[] = [], format: MetadataFormat = 'artist-title'): Promise<Record<string, LibraryResultMetadata> | null> {
    if (media.length > MAX_LIBRARY_METADATA_BATCH) throw new Error('Too many library metadata requests.');
    // The view retries a busy read only while those rows are still visible.
    if (this.batches >= 2) return null;
    this.batches++;
    try {
      const entries: [string, LibraryResultMetadata][] = [];
      let cursor = 0;
      const readRemaining = async () => {
        while (cursor < media.length) {
          const item = media[cursor++];
          const details = await this.read(item);
          // Derive the fallback from current templates, even for media imported before DJ codes were recorded.
          const parsed = details.djCatalogNumber || !templates.length ? null : metadataFromPath(item.path, templates, format);
          const filenameDjCode = parsed?.djCode ? [parsed.djCode, parsed.trackNumber].filter(Boolean).join('-') : undefined;
          entries.push([item.id, filenameDjCode ? { ...details, filenameDjCode } : details]);
        }
      };
      await Promise.all([readRemaining(), readRemaining()]);
      return Object.fromEntries(entries);
    } finally { this.batches--; }
  }

  private async read(item: StoredMedia): Promise<LibraryResultMetadata> {
    if (!isAbsolute(item.path)) return {};
    const file = await lstat(item.path).catch(() => null);
    if (!file?.isFile()) return {};
    const identity = JSON.stringify([item.path, item.fingerprint, file.size, file.mtimeMs, file.birthtimeMs]);
    const cached = this.cache.get(item.id);
    if (cached?.identity === identity) return cached.details;
    const dateAdded = file.birthtimeMs > 0 ? file.birthtime.toISOString().slice(0, 10) : undefined;
    let details: LibraryResultMetadata = dateAdded ? { dateAdded } : {};
    const extension = extname(item.path).toLowerCase();
    if (extension === '.mp4' || extension === '.mp3') {
      try {
        // Force a known demuxer and allow only local files. MOV external references stay disabled.
        const { stdout } = await probe('ffprobe', [
          '-v', 'error', '-protocol_whitelist', 'file,pipe', ...(extension === '.mp4' ? ['-f', 'mov', '-enable_drefs', '0'] : ['-f', 'mp3']), '-i', item.path,
          '-show_entries', 'format=duration:format_tags=bpm,TBPM,initialkey,TKEY,key,tempo,CATALOGNUMBER,catalognumber', '-of', 'json=string_validation=fail',
        ], { timeout: 3500, maxBuffer: 16384, windowsHide: true, killSignal: 'SIGKILL' });
        details = { ...details, ...readContainerMetadata(JSON.parse(stdout)) };
      } catch { /* Unsupported media or missing FFprobe can still show its filesystem date. */ }
    }
    this.cache.delete(item.id);
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(item.id, { identity, details });
    return details;
  }
}
