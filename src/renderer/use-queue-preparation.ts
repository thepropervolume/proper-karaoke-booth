import { useEffect, useState } from 'react';
import type { KaraFunBridge, KaraFunPreparation } from '../domain/karafun';
import type { PartyTymeBridge } from '../domain/partytyme';
import type { Version } from '../domain';
import type { YouTubeDownloadStatus } from './YouTubeDownloadsPanel';

type QueuePreparation = { pending: boolean; label: string; failed: boolean };

export function useQueuePreparations(karaFun: KaraFunBridge, partyTyme?: PartyTymeBridge) {
  const [status, setStatus] = useState<{ karafun: KaraFunPreparation[]; partytyme: KaraFunPreparation[] }>({ karafun: [], partytyme: [] });
  useEffect(() => {
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [karafun, partytyme] = await Promise.all([
          karaFun.preparations().catch(() => []),
          partyTyme?.preparations().catch(() => []) ?? Promise.resolve([]),
        ]);
        if (alive) setStatus({ karafun, partytyme });
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [karaFun, partyTyme]);
  return status;
}

export function queuePreparation(
  version: Version | undefined,
  video: YouTubeDownloadStatus | null,
  providers: { karafun: KaraFunPreparation[]; partytyme: KaraFunPreparation[] },
): QueuePreparation | null {
  const source = version?.source;
  if (!version || !source || !['youtube', 'karafun', 'partytyme'].includes(source.provider)) return null;
  // The authority's ready list covers cached tracks after restart as well as new downloads.
  if (video?.readyVersionIds?.includes(version.id) || (source.provider === 'youtube' && video?.cachedVersionIds.includes(version.id))) return null;
  if (source.provider === 'youtube') {
    const failure = video?.queue?.failures.find(item => item.versionId === version.id);
    if (failure) return { pending: true, failed: true, label: 'Download failed · retry from the queue menu' };
    if (video?.queue?.activeVersionId === version.id) return { pending: true, failed: false, label: 'Downloading song…' };
    return { pending: true, failed: false, label: 'Waiting for download…' };
  }
  if (source.provider !== 'karafun' && source.provider !== 'partytyme') return null;
  const preparation = providers[source.provider].find(item => item.versionId === version.id);
  if (preparation?.phase === 'failed') return { pending: true, failed: true, label: 'Preparation failed · retry from the queue menu' };
  if (!video?.readyVersionIds && preparation?.phase === 'ready') return null;
  const label = preparation?.phase === 'downloading' ? 'Downloading song…' : preparation?.phase === 'authorizing' ? 'Checking account…' : 'Preparing song…';
  return { pending: true, failed: false, label };
}
