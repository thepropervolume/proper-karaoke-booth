import React, { useEffect, useState } from 'react';
import type { Policy } from '../domain';
import type { Settings } from '../domain/settings';
import type { YouTubeKaraokeSong, YouTubeSearchResult } from '../domain/youtube-search';

export type YouTubeSearchBridge = {
  search(query: string): Promise<YouTubeSearchResult>; cancel(): Promise<void>;
  request(input: { searchId: string; videoId: string; singerId: string | null; requestId: string }): Promise<{ ok: boolean; error?: string; notice?: string; versionId?: string }>;
  importSubscriptions(): Promise<{ channels: string[]; ignored: number } | null>;
};

export function YouTubeSearchPanel({ bridge, query, settings, policy, disabled, onChoose, onSave }: {
  bridge: YouTubeSearchBridge; query: string; settings: Settings; policy: Policy; disabled: boolean;
  onChoose(song: YouTubeKaraokeSong, searchId: string): void; onSave(patch: Partial<Settings>): Promise<void>;
}) {
  const [reply, setReply] = useState<{ key: string; result: YouTubeSearchResult } | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const scope = JSON.stringify([settings.youtubeSearchEnabled, settings.youtubeSearchMode, settings.youtubeApprovedChannels, settings.youtubeBlockedChannels, settings.artistBlacklist, settings.songBlacklist, settings.ytDlpExecutable, policy]);
  const key = query.trim() + '\0' + scope;
  const result = reply?.key === key ? reply.result : null;
  const policyBlocked = policy.ageRestricted || policy.includeVersionIds !== null;
  useEffect(() => {
    let alive = true; setReply(null); setNotice('');
    if (!settings.youtubeSearchEnabled || policyBlocked || query.trim().length < 2) { setBusy(false); void bridge.cancel(); return () => { alive = false; }; }
    setBusy(true);
    const timer = window.setTimeout(() => { void bridge.search(query).then(value => { if (alive) setReply({ key, result: value }); }).catch(() => { if (alive) setNotice('YouTube search is unavailable. Check yt-dlp in Sources or Preferences.'); }).finally(() => { if (alive) setBusy(false); }); }, 650);
    return () => { alive = false; window.clearTimeout(timer); void bridge.cancel(); };
  }, [bridge, query, scope]);
  if (!settings.youtubeSearchEnabled || policyBlocked || query.trim().length < 2) return null;
  return <section className="youtube-search-results" aria-label="YouTube karaoke search"><h3>YouTube Karaoke</h3>
    {busy && <p role="status">Searching karaoke videos and checking channels…</p>}
    {result && <><p className="muted">{result.message}</p>{result.status === 'ok' && <p className="muted">{result.counts.returned} of {result.counts.examined} videos passed the filters. {result.qualityNote}</p>}
      {result.songs.map(song => <article className="song-row youtube-song" key={song.videoId}>
        <div><strong>{song.artist ? `${song.artist} — ` : ''}{song.title}</strong><small>YouTube · {song.channelName} · {Math.floor(song.durationSeconds / 60)}:{String(Math.round(song.durationSeconds) % 60).padStart(2, '0')} · {song.channelApproval === 'host-approved' ? 'Approved channel' : 'Karaoke channel hint'}</small>
          <small className="muted">{song.metadataSource === 'youtube-metadata' ? 'YouTube metadata' : 'Artist/title suggested from video title'} · Original: {song.videoTitle}</small></div>
        <div className="youtube-song__actions"><button type="button" disabled={disabled || busy || !result.searchId} onClick={() => { if (result.searchId) onChoose(song, result.searchId); }}>Choose Singer</button>
          <button type="button" disabled={disabled || busy} onClick={() => { setBusy(true); void onSave({ youtubeBlockedChannels: [...new Set([...settings.youtubeBlockedChannels, song.channelId])] }).then(() => setNotice('Channel blocked from future YouTube searches.')).catch(() => setNotice('Could not save the blocked channel.')).finally(() => setBusy(false)); }}>Block Channel</button></div>
      </article>)}
    </>}
    {notice && <p role="status">{notice}</p>}
    <p className="muted">Queueing schedules a permanent yt-dlp download. It never starts playback automatically. Channel rules and subscription imports are in Preferences → YouTube Search.</p>
  </section>;
}
