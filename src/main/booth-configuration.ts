import { randomUUID } from 'node:crypto';
import { closeSync, constants, copyFileSync, fstatSync, linkSync, lstatSync, openSync, readSync, unlinkSync, writeFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { ShowState, Version } from '../domain';
import { parseSettings, type Settings } from '../domain/settings';
import { parseShortcuts, type Shortcuts } from '../domain/shortcuts';
import type { StoredMedia } from './store';

const FORMAT = 'karabooth-configuration-v1';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_RECORDINGS = 50000;
type LocalRecording = { media: StoredMedia; version: Version };
type Configuration = { format: typeof FORMAT; preferences: Settings; shortcuts: Shortcuts; localRecordings: LocalRecording[] };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value);
}
function path(value: unknown): value is string {
  return text(value, 4096) && !value.startsWith('\\\\.\\') && (posix.isAbsolute(value) || win32.isAbsolute(value));
}
function parseRecording(value: unknown): LocalRecording {
  if (!record(value) || !record(value.media) || !record(value.version)) throw new Error('Invalid local recording in configuration.');
  const { version, media } = value;
  if (!text(version.id, 200) || !version.id || media.id !== version.id || !path(media.path) ||
      typeof media.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(media.fingerprint) ||
      media.sourcePath !== undefined && !path(media.sourcePath) ||
      !text(version.title, 500) || !version.title.trim() || !text(version.artist, 500) ||
      typeof version.rating !== 'string' || !['clean', 'explicit', 'unrated', 'uncertain'].includes(version.rating) ||
      version.source !== undefined || version.removedFromLibrary !== undefined || version.discoveryOrigin !== undefined ||
      !['djCode', 'trackNumber', 'metadataTemplate'].every(key => version[key] === undefined || text(version[key], 1000)) ||
      !['metadataAmbiguous', 'isDuet'].every(key => version[key] === undefined || typeof version[key] === 'boolean'))
    throw new Error('Invalid local recording in configuration.');
  const { id, title, artist, rating, djCode, trackNumber, metadataTemplate, metadataAmbiguous, isDuet } = version as Version;
  return { version: { id, title, artist, rating, djCode, trackNumber, metadataTemplate, metadataAmbiguous, isDuet },
    media: { id, path: media.path, fingerprint: media.fingerprint, sourcePath: media.sourcePath as string | undefined } };
}

export function parseConfiguration(value: unknown): Configuration {
  if (!record(value) || value.format !== FORMAT || !Array.isArray(value.localRecordings) || value.localRecordings.length > MAX_RECORDINGS)
    throw new Error('Choose a supported KaraBooth configuration file.');
  const localRecordings = value.localRecordings.map(parseRecording);
  if (new Set(localRecordings.map(item => item.version.id)).size !== localRecordings.length)
    throw new Error('The file contains duplicate recording IDs.');
  return { format: FORMAT, preferences: parseSettings(value.preferences), shortcuts: parseShortcuts(value.shortcuts), localRecordings };
}

export function makeConfiguration(preferences: Settings, shortcuts: Shortcuts, versions: readonly Version[], media: (id: string) => StoredMedia | undefined): Configuration {
  const localRecordings = versions.flatMap(version => {
    const stored = !version.source && !version.removedFromLibrary ? media(version.id) : undefined;
    return stored ? [{ version, media: stored }] : [];
  });
  return parseConfiguration({ format: FORMAT, preferences, shortcuts, localRecordings });
}

export function saveConfiguration(file: string, config: Configuration): void {
  const contents = Buffer.from(JSON.stringify(config, null, 2) + '\n');
  if (contents.length > MAX_BYTES) throw new Error('The configuration is too large to save as one file.');
  const target = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(target, contents, { mode: 0o600, flag: 'wx', flush: true });
    try { linkSync(target, file); }
    catch (error) {
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      copyFileSync(target, file, constants.COPYFILE_EXCL);
    }
  } finally { try { unlinkSync(target); } catch {} }
}

export function readConfiguration(file: string): Configuration {
  const named = lstatSync(file);
  if (!named.isFile() || named.size < 1 || named.size > MAX_BYTES) throw new Error('Choose a regular configuration file under 32 MB.');
  const descriptor = openSync(file, 'r');
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size)
      throw new Error('The selected configuration changed. Choose it again.');
    const bytes = Buffer.alloc(opened.size + 1);
    let length = 0, count: number;
    while (length < bytes.length && (count = readSync(descriptor, bytes, length, bytes.length - length, length))) length += count;
    const after = fstatSync(descriptor);
    if (length !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
      throw new Error('The selected configuration changed. Choose it again.');
    return parseConfiguration(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))));
  } finally { closeSync(descriptor); }
}

/** Merge by media identity. Existing locations and request IDs remain usable after a retry. */
export function mergeConfiguration(state: ShowState, config: Configuration, findMedia: (id: string) => StoredMedia | undefined) {
  const versions = new Map(state.versions.map(version => [version.id, version]));
  const byHash = new Map(state.versions.flatMap(version => {
    const item = !version.source && !version.removedFromLibrary ? findMedia(version.id) : undefined;
    return item ? [[item.fingerprint, version.id] as const] : [];
  }));
  const media: StoredMedia[] = [];
  for (const recording of config.localRecordings) {
    const existingId = byHash.get(recording.media.fingerprint);
    const id = existingId ?? (versions.has(recording.version.id) ? randomUUID() : recording.version.id);
    versions.set(id, { ...recording.version, id });
    if (!existingId) media.push({ ...recording.media, id });
    byHash.set(recording.media.fingerprint, id);
  }
  return { state: { ...state, versions: [...versions.values()] }, media };
}
