import { applyCommand, isVersionAllowed, type PointsHistoryContext, type ShowState, type Version } from './index';
import type { Settings } from './settings';
import { compileSongBlacklist } from './song-blacklist';

export type CatalogRequestTrack = { youtubeId: string; title: string; artist: string; brandSlug?: string };
export type CatalogRequestInput = { track: CatalogRequestTrack; singerId: string | null; requestId: string };
export type CatalogRequestResult = { ok: boolean; error?: string; versionId?: string; notice?: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, empty = false): value is string => typeof value === 'string' && (empty || !!value.trim()) && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value);

/** Plan the library addition and request together; the authority saves once. */
export function catalogRequest(state: ShowState, value: unknown, settings: Settings, ids: { versionId: string; commandId: string }, now: number, history?: PointsHistoryContext, discoveryOrigin: 'karaokenerds' | 'youtube' = 'karaokenerds'): { state: ShowState; result: CatalogRequestResult } {
  const fail = (error: string) => ({state,result:{ok:false,error}});
  if (!record(value) || Object.keys(value).some(key => !['track','singerId','requestId'].includes(key)) || value.singerId !== null && !text(value.singerId) || !text(value.requestId) || !record(value.track)) return fail('Choose a valid song and optional singer.');
  const track = value.track;
  if (Object.keys(track).some(key => !['youtubeId','title','artist','brandSlug'].includes(key)) || typeof track.youtubeId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(track.youtubeId) || !text(track.title) || !text(track.artist,true) ||
    (track.brandSlug !== undefined && (typeof track.brandSlug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(track.brandSlug)))) return fail('The selected catalog recording is invalid.');
  const blacklist = compileSongBlacklist(settings);
  if (blacklist.isBlocked({ artist: track.artist, title: track.title })) return fail('This song or artist is blacklisted by the host.');
  const matches = state.versions.filter(item => item.source?.provider === 'youtube' && item.source.videoId === track.youtubeId);
  if (matches.length > 1) return fail('This recording has conflicting library entries. Review them before queueing.');
  const existing = matches[0];
  if (existing && !isVersionAllowed(state,existing.id,settings)) return fail('This recording is unavailable under the current host and show policy.');
  const repeated = state.requests.find(item => item.id === value.requestId);
  if (repeated) return existing && repeated.singerId === value.singerId && repeated.versionId === existing.id ? {state,result:{ok:true,versionId:existing.id}} : fail('That request identifier is already in use.');
  const version: Version = existing ?? {id:ids.versionId,title:track.title.trim(),artist:track.artist.trim(),rating:'unrated',
    source:{provider:'youtube',videoId:track.youtubeId,...(track.brandSlug ? {brandSlug:track.brandSlug} : {})}, ...(discoveryOrigin === 'karaokenerds' ? { discoveryOrigin: 'karaokenerds' as const } : {})};
  let next = state;
  const command = (input: Parameters<typeof applyCommand>[1]['command'], suffix: string) => applyCommand(next, {commandId:ids.commandId + suffix,showId:next.showId,hostEpoch:next.hostEpoch,expectedRevision:next.revision,actor:{role:'host',id:'host'},command:input},settings,now,history);
  if (!existing) {
    const added = command({type:'addVersion',version},':catalog');
    if (!added.outcome.ok) return fail(added.outcome.message);
    next = added.state;
  }
  const requested = command({type:'request',requestId:value.requestId,singerId:value.singerId,versionId:version.id},':request');
  if (!requested.outcome.ok) return fail(requested.outcome.message);
  return {state:requested.state,result:{ok:true,versionId:version.id}};
}
