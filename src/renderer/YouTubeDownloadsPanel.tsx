import React, { useEffect, useState } from 'react';
import type { YouTubeDownloadProgress } from '../main/youtube-download';
export type YouTubeDownloadStatus = { job: YouTubeDownloadProgress | null; preparing: boolean; cachedVersionIds: string[] };
export type YouTubeDownloadBridge = { status(): Promise<YouTubeDownloadStatus>; start(versionId: string): Promise<YouTubeDownloadProgress | null>; cancel(id: string): Promise<boolean> };
export function YouTubeDownloadsPanel({ bridge, onCached }: { bridge: YouTubeDownloadBridge; onCached: (ids: string[]) => void }) {
  const [state, setState] = useState<YouTubeDownloadStatus | null>(null);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState('');
  useEffect(() => {
    let alive = true, pending = false, cached = '';
    const refresh = async () => {
      if (pending) return; pending = true;
      try {
        const value = await bridge.status();
        if (alive) {
          setState(value);
          const key = JSON.stringify(value.cachedVersionIds);
          if (cached !== key) { cached = key; onCached(value.cachedVersionIds); }
        }
      } catch { if (alive) setError('Video download status is unavailable.'); }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 500);
    return () => { alive = false; clearInterval(timer); };
  }, [bridge, onCached]);
  const job = state?.job;
  const active = !!job && ['preparing', 'downloading', 'verifying', 'cancelling'].includes(job.phase);
  if (!error && !state?.preparing && (!job || job.id === dismissed)) return null;
  return <section className="import-panel" aria-label="Video download progress">
    <h3>{active || state?.preparing ? 'Downloading Video to Your Drive' : job?.phase === 'completed' ? 'Video Saved' : 'Video Download'}</h3>
    {state?.preparing && <p role="status">Preparing yt-dlp…</p>}
    {job && <p role={job.phase === 'failed' ? 'alert' : 'status'}>{job.message || job.phase}</p>}
    {active && <>
      {job.percent === null ? <progress aria-label="Video download" /> : <progress aria-label="Video download" value={job.percent} max="100" />}
      <button type="button" disabled={job.phase === 'cancelling'} onClick={() => { void bridge.cancel(job.id).catch(() => setError('Could not cancel the video download.')); }}>Cancel video download</button>
      <p className="muted">Saved videos stay on your drive. Playback starts only when you press Play.</p>
    </>}
    {job?.cleanupNeeded && <p role="alert">Temporary download files need review. They were preserved to avoid unsafe cleanup.</p>}
    {!active && job && <button type="button" onClick={() => setDismissed(job.id)}>Dismiss</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
