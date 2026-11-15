import { applyCommand, isVersionAllowed, type Command, type ShowState, type Version } from './index';
import type { Settings } from './settings';
import { validStreamingSource, type KaraFunSource } from './streaming-source';
import { compileSongBlacklist } from './song-blacklist';

export type KaraFunRequestTrack = { songId: string; catalog: 'catalog' | 'community'; title: string; artist: string; explicit?: boolean | null };
type Result = { ok: boolean; versionId?: string; error?: string };
const text = (value: unknown, empty = false): value is string => typeof value === 'string' && (empty || !!value.trim()) &&
  value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value);

/** Only the host's current authenticated-search authority supplies this metadata.
 * Plan the version and request together so a refused request leaves no orphan. */
export function karaFunRequest(state: ShowState, track: KaraFunRequestTrack, singerId: string, requestId: string,
  settings: Settings, ids: { versionId: string; commandId: string }, now: number): { state: ShowState; result: Result } {
  const refuse = (error: string) => ({ state, result: { ok: false, error } });
  if (!track || Object.keys(track).some(key => !['songId', 'catalog', 'title', 'artist', 'explicit'].includes(key)) ||
      track.explicit !== undefined && track.explicit !== null && typeof track.explicit !== 'boolean' ||
      !text(track.title) || !text(track.artist, true) || !text(singerId) || !text(requestId)) return refuse('Choose a valid KaraFun recording and singer.');
  const source: KaraFunSource = { provider: 'karafun', songId: track.songId, catalog: track.catalog };
  if (!validStreamingSource(source)) return refuse('The KaraFun recording identity is invalid.');
  if (compileSongBlacklist(settings).isBlocked(track)) return refuse('This song or artist is blacklisted by the host.');
  const matches = state.versions.filter(version => version.source?.provider === 'karafun' &&
    version.source.catalog === source.catalog && version.source.songId === source.songId);
  if (matches.length > 1) return refuse('This KaraFun recording has conflicting library entries.');
  const existing = matches[0];
  if (existing && !isVersionAllowed(state, existing.id, settings)) return refuse('This recording is unavailable under the current show policy.');
  const repeated = state.requests.find(request => request.id === requestId);
  if (repeated) return existing && repeated.singerId === singerId && repeated.versionId === existing.id
    ? { state, result: { ok: true, versionId: existing.id } } : refuse('That request identifier is already in use.');
  const version: Version = existing ?? { id: ids.versionId, title: track.title.trim(), artist: track.artist.trim(), rating: track.explicit === false ? 'clean' : track.explicit === true ? 'explicit' : 'unrated', source };
  let next = state;
  const send = (command: Command, suffix: string) => applyCommand(next, { commandId: ids.commandId + suffix,
    showId: next.showId, hostEpoch: next.hostEpoch, expectedRevision: next.revision, actor: { role: 'host', id: 'host' }, command }, settings, now);
  if (!existing) {
    const added = send({ type: 'addVersion', version }, ':karafun');
    if (!added.outcome.ok) return refuse(added.outcome.message);
    next = added.state;
  }
  const queued = send({ type: 'request', singerId, requestId, versionId: version.id }, ':request');
  return queued.outcome.ok ? { state: queued.state, result: { ok: true, versionId: version.id } } : refuse(queued.outcome.message);
}
