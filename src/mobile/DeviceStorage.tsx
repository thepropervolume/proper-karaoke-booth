import React, { useMemo, useState } from 'react';
import type { MobileRequest, MobileSong } from './show';
import type { LocalVideoCopy } from './storage';

const units = ['B', 'KB', 'MB', 'GB', 'TB'];
const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const formatSize = (bytes: number) => {
  let unit = 0;
  while (bytes >= 1000 && unit < units.length - 1) { bytes /= 1000; unit++; }
  return `${amount.format(bytes)} ${units[unit]}`;
};

export function DeviceStorage({ copies, songs, queue, loadFailed, busy, onRetry, onRemove }: {
  copies: readonly LocalVideoCopy[] | null;
  songs: readonly MobileSong[];
  queue: readonly MobileRequest[];
  loadFailed: boolean;
  busy: boolean;
  onRetry(): void;
  onRemove(id: string): void;
}) {
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const videos = useMemo(() => {
    const byId = new Map(songs.map(song => [song.id, song]));
    return copies?.map(copy => {
      const song = byId.get(copy.id);
      return { ...copy, title: song?.title || copy.fileName || 'Unlinked video', artist: song?.artist, linked: !!song };
    }).sort((a, b) => a.title.localeCompare(b.title));
  }, [copies, songs]);
  const inUse = new Set(queue.filter(request => request.status === 'accepted' || request.status === 'playing').map(request => request.songId));
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = videos?.filter(video => terms.every(term => `${video.title} ${video.artist ?? ''} ${video.fileName ?? ''}`.toLocaleLowerCase().includes(term)));
  return <section className="mobile-device-storage" aria-labelledby="mobile-storage-title">
    <h2 id="mobile-storage-title">Device Storage</h2>
    {!videos ? loadFailed ? <>
      <p role="status">The saved video list is unavailable.</p>
      <button type="button" onClick={onRetry}>Retry</button>
    </> : <p role="status">Checking saved videos…</p> : <>
      <p><strong>{formatSize(videos.reduce((total, video) => total + video.bytes, 0))}</strong> in {videos.length} saved {videos.length === 1 ? 'video' : 'videos'}</p>
      <p className="mobile-quiet">Removing an app copy keeps the original file and show history.</p>
      {videos.length > 0 && <label>Find a Saved Video<input type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></label>}
      {!videos.length && <p>Import local videos under Songs to see them here.</p>}
      {videos.length > 0 && !filtered?.length && <p>No saved videos match your search.</p>}
      <ul className="mobile-device-videos">{filtered?.map(video => {
        const unavailable = inUse.has(video.id);
        const label = `Remove Device Copy of ${video.title}`;
        return <li key={video.id}>
          <div><strong>{video.title}</strong><span>{[formatSize(video.bytes), video.artist, !video.linked && 'Unlinked to this show'].filter(Boolean).join(' · ')}</span></div>
          {unavailable ? <small>In Use or Queued</small> : confirmId === video.id ? <div className="mobile-device-remove-actions">
            <button type="button" onClick={() => setConfirmId(null)}>Keep</button>
            <button type="button" aria-label={`Confirm removal of ${video.title}`} disabled={busy} onClick={() => { setConfirmId(null); onRemove(video.id); }}>Remove</button>
          </div> : <button type="button" aria-label={label} disabled={busy} onClick={() => setConfirmId(video.id)}>Remove Copy</button>}
        </li>;
      })}</ul>
    </>}
  </section>;
}
