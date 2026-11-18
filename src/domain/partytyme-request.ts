import { applyCommand, isVersionAllowed, type Command, type PointsHistoryContext, type ShowState, type Version } from './index';
import type { Settings } from './settings';
import type { PartyTymeSong } from './partytyme';
import { validStreamingSource, type PartyTymeSource } from './streaming-source';
import { compileSongBlacklist } from './song-blacklist';
/** Commit the recording and optional-singer request together or leave both unchanged. */
export function partyTymeRequest(state: ShowState, song: PartyTymeSong, singerId: string | null, requestId: string, settings: Settings, ids: {
    versionId: string;
    commandId: string;
}, now: number, history?: PointsHistoryContext) {
    const refuse = (error: string) => ({ state, result: { ok: false, error, versionId: undefined as string | undefined } });
    const source: PartyTymeSource = { provider: 'partytyme', catalog: 'consumer', videoId: song.videoId };
    if (!validStreamingSource(source) || !song.title?.trim() || typeof song.artist !== 'string' || song.title.length > 500 || song.artist.length > 500 ||
        /[\x00-\x1f\x7f]/.test(song.title + song.artist) || typeof requestId !== 'string' || !requestId || requestId.length > 500 ||
        singerId !== null && typeof singerId !== 'string')
        return refuse('Choose a valid Party Tyme recording and optional singer.');
    if (compileSongBlacklist(settings).isBlocked(song))
        return refuse('This song or artist is blacklisted by the host.');
    const matches = state.versions.filter(v => v.source?.provider === 'partytyme' && v.source.videoId === source.videoId);
    if (matches.length > 1)
        return refuse('This Party Tyme recording has conflicting library entries.');
    const existing = matches[0];
    if (existing && !isVersionAllowed(state, existing.id, settings))
        return refuse('This recording is unavailable under the current show policy.');
    const repeated = state.requests.find(r => r.id === requestId);
    if (repeated)
        return existing && repeated.singerId === singerId && repeated.versionId === existing.id
            ? { state, result: { ok: true, versionId: existing.id, error: undefined as string | undefined } } : refuse('That request identifier is already in use.');
    const version: Version = existing ?? { id: ids.versionId, title: song.title.trim(), artist: song.artist.trim(), rating: 'unrated', source };
    let next = state;
    const send = (command: Command, suffix: string) => applyCommand(next, {
        commandId: ids.commandId + suffix,
        showId: next.showId, hostEpoch: next.hostEpoch, expectedRevision: next.revision, actor: { role: 'host', id: 'host' }, command
    }, settings, now, history);
    if (!existing) {
        const added = send({ type: 'addVersion', version }, ':partytyme');
        if (!added.outcome.ok)
            return refuse(added.outcome.message);
        next = added.state;
    }
    const queued = send({ type: 'request', singerId, requestId, versionId: version.id }, ':request');
    return queued.outcome.ok ? { state: queued.state, result: { ok: true, versionId: version.id, error: undefined as string | undefined } } : refuse(queued.outcome.message);
}
