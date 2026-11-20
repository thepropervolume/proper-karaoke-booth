import { useEffect, useState } from 'react';
import type { PlaybackTimelineState } from '../domain/playback-timeline';

/** Ignore an old initial snapshot after a newer playback report arrives. */
export function useQueueTimeline(generation: string | null): PlaybackTimelineState | null {
  const [timeline, setTimeline] = useState<PlaybackTimelineState | null>(null);
  useEffect(() => {
    let alive = true, observed = false;
    setTimeline(null);
    const unsubscribe = window.tpv.onTimeline(value => {
      observed = true;
      if (alive) setTimeline(previous => previous && previous.generation === value.generation &&
        previous.duration === value.duration && previous.seekable === value.seekable && previous.seeking === value.seeking &&
        Math.floor(previous.position / 15) === Math.floor(value.position / 15) ? previous : value);
    });
    void window.tpv.getTimeline().then(value => { if (alive && !observed) setTimeline(value); }).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [generation]);
  return timeline;
}
