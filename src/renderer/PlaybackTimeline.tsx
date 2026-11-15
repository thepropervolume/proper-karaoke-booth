import React, { useEffect, useRef, useState } from 'react';
import { formatPlaybackTime, type PlaybackTimelineState } from '../domain/playback-timeline';
import { Tooltip } from './Tooltip';
import { DEFAULT_SHORTCUTS, formatShortcut, type Shortcuts } from '../domain/shortcuts';
import '../styles/playback-timeline.scss';
const empty: PlaybackTimelineState = { generation: null, position: 0, duration: 0, seekable: false, seeking: false };

export function PlaybackTimeline({ generation, disabled, shortcuts = DEFAULT_SHORTCUTS }: { generation: string | null; disabled: boolean; shortcuts?: Shortcuts }) {
  const hint = (label: string, action: 'seekBackward' | 'seekForward') => `${label}${shortcuts[action].length ? ` (${shortcuts[action].map(formatShortcut).join(', ')})` : ''}`;
  const [timeline, setTimeline] = useState(empty);
  const generationRef = useRef(generation); generationRef.current = generation;
  // Dragging is only a visual draft. Commit one seek on release/key-up so a
  // moving slider does not restart every stem for each pointer pixel.
  const [draft, setDraft] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true, observed = false;
    setDraft(null); setError(''); setTimeline(empty); setPending(false);
    const unsubscribe = window.tpv.onTimeline(value => { observed = true; if (alive) setTimeline(value); });
    void window.tpv.getTimeline().then(value => { if (alive && !observed) setTimeline(value); }).catch(() => { if (alive) setError('Playback position is unavailable.'); });
    return () => { alive = false; unsubscribe(); };
  }, [generation]);
  const current = !!generation && timeline.generation === generation;
  const available = current && timeline.seekable && !timeline.seeking && !disabled && !pending;
  const position = current ? draft ?? timeline.position : 0;
  const duration = current ? timeline.duration : 0;
  const seek = async (target: number) => {
    if (!available || !generation) { setDraft(null); return; }
    setPending(true); setError(''); setDraft(null);
    try {
      const result = await window.tpv.seek({ generation, position: Math.min(duration, Math.max(0, target)) });
      if (generationRef.current === generation && !result.ok) setError(result.error);
    } catch { if (generationRef.current === generation) setError('Could not seek this track. Check the player and try again.'); }
    finally { if (generationRef.current === generation) setPending(false); }
  };
  return <div className="playback-timeline" aria-label="Track position">
    <Tooltip text={hint('Rewind 10 seconds', 'seekBackward')}><button type="button" aria-label="Rewind 10 seconds" disabled={!available} onClick={() => void seek(timeline.position - 10)}>↶ 10s</button></Tooltip>
    <span className="playback-timeline__time" aria-label="Elapsed time">{formatPlaybackTime(position)}</span>
    <input type="range" aria-label="Playback position" aria-valuetext={`${formatPlaybackTime(position)} of ${formatPlaybackTime(duration)}`}
      min="0" max={duration || 1} step="0.1" value={position} disabled={!available}
      onChange={event => setDraft(Number(event.target.value))}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerUp={event => void seek(Number(event.currentTarget.value))} onPointerCancel={() => setDraft(null)}
      onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) void seek(Number(event.currentTarget.value)); }}
      onBlur={event => { if (draft !== null) void seek(Number(event.currentTarget.value)); }} />
    <span className="playback-timeline__time" aria-label="Remaining time">−{formatPlaybackTime(Math.max(0, duration - position))}</span>
    <Tooltip text={hint('Forward 10 seconds', 'seekForward')}><button type="button" aria-label="Forward 10 seconds" disabled={!available} onClick={() => void seek(timeline.position + 10)}>10s ↷</button></Tooltip>
    {error && <span className="playback-timeline__error" role="status">{error}</span>}
  </div>;
}
