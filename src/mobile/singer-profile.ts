import { isRecordingKey, type RecordingKey } from '../domain/song-rating';
import { SOURCE_IDS, type SourceId } from '../domain/settings';

export type SingerPlaylistRecording = {
  title: string;
  artist: string;
  source?: SourceId;
  recordingKey?: RecordingKey;
  roomId?: string;
  id?: string;
};

export type SingerPlaylist = { id: string; name: string; recordings: SingerPlaylistRecording[] };
export type SingerProfile = { format: 1; displayName: string; email: string; playlists: SingerPlaylist[] };

const MAX_PLAYLISTS = 50;
const MAX_RECORDINGS = 300;
const BAD_TEXT = /[\x00-\x1f\x7f]/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const DATABASE = 'tpv-mobile-singer';
const STORE = 'profile';
const ACTIVE = 'active';
const emptyProfile = (): SingerProfile => ({ format: 1, displayName: '', email: '', playlists: [] });

function boundedText(value: unknown, limit: number, allowEmpty: boolean): value is string {
  return typeof value === 'string' && value.length <= limit && !BAD_TEXT.test(value) && (allowEmpty || !!value.trim());
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

function validSource(value: unknown): value is SourceId {
  return SOURCE_IDS.some(source => source === value);
}

function validEmail(value: unknown): value is string {
  return boundedText(value, 254, true) && (value === '' || EMAIL.test(value));
}

/** Match exact provider recordings, with a room-scoped fallback for imported files and legacy hosts. */
export function singerRecordingIdentity(recording: SingerPlaylistRecording): string | null {
  if (isRecordingKey(recording.recordingKey)) return recording.recordingKey;
  if (validId(recording.roomId) && validId(recording.id)) return `room:${recording.roomId}:${recording.id}`;
  return null;
}

function parseRecording(value: unknown): SingerPlaylistRecording | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!boundedText(row.title, 500, false) || !boundedText(row.artist, 500, true) ||
      row.source !== undefined && !validSource(row.source) || row.recordingKey !== undefined && !isRecordingKey(row.recordingKey)) return null;

  // Persist selected metadata fields. Search handles, links, and guest session data have no place here.
  const shared = { title: row.title.trim(), artist: row.artist.trim(), ...(validSource(row.source) ? { source: row.source } : {}) };
  if (isRecordingKey(row.recordingKey)) return { ...shared, recordingKey: row.recordingKey };
  return validId(row.roomId) && validId(row.id) ? { ...shared, roomId: row.roomId, id: row.id } : null;
}

export function parseSingerProfile(value: unknown): SingerProfile {
  if (value === undefined) return emptyProfile();
  const invalid = () => new Error('Saved singer data could not be read. It has been preserved.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const row = value as Record<string, unknown>;
  if (row.format !== 1 || !boundedText(row.displayName, 100, true) || !validEmail(row.email) ||
      !Array.isArray(row.playlists) || row.playlists.length > MAX_PLAYLISTS) throw invalid();
  const playlists: SingerPlaylist[] = [];
  const playlistIds = new Set<string>();
  for (const playlist of row.playlists) {
    if (!playlist || !validId(playlist.id) || playlistIds.has(playlist.id) || !boundedText(playlist.name, 100, false) ||
        !Array.isArray(playlist.recordings) || playlist.recordings.length > MAX_RECORDINGS) throw invalid();
    const keys = new Set<string>();
    const recordings: SingerPlaylistRecording[] = [];
    for (const value of playlist.recordings) {
      const recording = parseRecording(value);
      const key = recording && singerRecordingIdentity(recording);
      if (!recording || !key || keys.has(key)) throw invalid();
      keys.add(key);
      recordings.push(recording);
    }
    playlistIds.add(playlist.id);
    playlists.push({ id: playlist.id, name: playlist.name.trim(), recordings });
  }
  return { format: 1, displayName: row.displayName.trim(), email: row.email, playlists };
}

export type SingerProfileAction =
  | { type: 'identity'; displayName: string; email: string }
  | { type: 'create-playlist'; playlistId: string; name: string; recording?: SingerPlaylistRecording }
  | { type: 'rename-playlist'; playlistId: string; name: string }
  | { type: 'remove-playlist'; playlistId: string }
  | { type: 'add-recording'; playlistId: string; recording: SingerPlaylistRecording }
  | { type: 'remove-recording'; playlistId: string; key: string };

function playlistName(name: string): string {
  if (!boundedText(name, 100, false)) throw new Error('Enter a playlist name of up to 100 characters.');
  return name.trim();
}

function requiredRecording(value: unknown): SingerPlaylistRecording {
  const recording = parseRecording(value);
  if (!recording) throw new Error('This recording has no playlist identity.');
  return recording;
}

export function updateSingerProfile(current: SingerProfile, action: SingerProfileAction): SingerProfile {
  const profile = parseSingerProfile(current);
  if (action.type === 'identity') {
    const email = action.email.trim();
    if (!boundedText(action.displayName, 100, true) || !validEmail(email)) throw new Error('Enter a display name of up to 100 characters and a valid optional email.');
    return { ...profile, displayName: action.displayName.trim(), email };
  }

  const index = profile.playlists.findIndex(playlist => playlist.id === action.playlistId);
  if (action.type === 'create-playlist') {
    if (!validId(action.playlistId) || index !== -1) throw new Error('That playlist could not be created. Try again.');
    if (profile.playlists.length >= MAX_PLAYLISTS) throw new Error('You can save up to 50 playlists on this device.');
    profile.playlists.push({ id: action.playlistId, name: playlistName(action.name), recordings: action.recording ? [requiredRecording(action.recording)] : [] });
    return profile;
  }
  if (index < 0) throw new Error('This playlist is no longer available.');
  const playlist = profile.playlists[index];
  switch (action.type) {
    case 'rename-playlist':
      playlist.name = playlistName(action.name);
      break;
    case 'remove-playlist':
      profile.playlists.splice(index, 1);
      break;
    case 'add-recording': {
      const recording = requiredRecording(action.recording);
      const key = singerRecordingIdentity(recording);
      if (playlist.recordings.some(item => singerRecordingIdentity(item) === key)) break;
      if (playlist.recordings.length >= MAX_RECORDINGS) throw new Error('This playlist has reached its 300-song limit.');
      playlist.recordings.push(recording);
      break;
    }
    case 'remove-recording':
      playlist.recordings = playlist.recordings.filter(recording => singerRecordingIdentity(recording) !== action.key);
      break;
  }
  return profile;
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Singer storage is unavailable.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Singer storage is unavailable.'));
  });
}

async function profileTransaction(action?: SingerProfileAction): Promise<SingerProfile> {
  const db = await database();
  try {
    return await new Promise<SingerProfile>((resolve, reject) => {
      // Read and update in one transaction so independent tabs never overwrite each other's changes.
      const transaction = db.transaction(STORE, action ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(STORE);
      const read = store.get(ACTIVE);
      let next: SingerProfile;
      let problem: unknown;
      transaction.oncomplete = () => resolve(next);
      transaction.onerror = transaction.onabort = () => reject(problem ?? new Error('Singer data could not be saved. Check available device storage.'));
      read.onsuccess = () => {
        try {
          const saved = parseSingerProfile(read.result);
          next = action ? updateSingerProfile(saved, action) : saved;
          if (action) store.put(next, ACTIVE);
        } catch (error) {
          problem = error;
          transaction.abort();
        }
      };
    });
  } finally {
    db.close();
  }
}

export const loadSingerProfile = () => profileTransaction();
export const saveSingerProfile = (action: SingerProfileAction) => profileTransaction(action);
