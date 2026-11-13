import React, { useEffect, useId, useRef, useState } from 'react';
import { parseSongRating, type RecordingKey, type SongRating } from '../domain/song-rating';
import { Tooltip } from './Tooltip';
import '../styles/song-rating.scss';

const averageText = (rating: SongRating) => rating.average === null ? 'No ratings yet' :
  `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating.average)} / 10`;
const countText = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'rating' : 'ratings'}`;

/** This control sits inside selectable library/queue rows without activating them. */
export function SongRatingButton({ title, rating, loading = false, onClick }: {
  title: string; rating: SongRating | null; loading?: boolean; onClick: () => void;
}) {
  const summary = loading ? 'Loading ratings' : rating ? `${averageText(rating)}; ${countText(rating.count)}` : 'Ratings not loaded';
  const label = `Rate ${title}. ${summary}${rating?.ownVote ? `. Your host rating: ${rating.ownVote} out of 10 hearts` : ''}`;
  return <Tooltip text={label}>
    <button type="button" className="song-rating-button" aria-label={label} aria-busy={loading} draggable={false}
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
      onContextMenu={event => event.stopPropagation()}
      onClick={event => { event.preventDefault(); event.stopPropagation(); onClick(); }}
      onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ' || (!event.ctrlKey && !event.altKey && !event.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'Backspace'].includes(event.key))) event.stopPropagation();
      }}>
      <span className="song-rating-button__heart" aria-hidden="true">{rating?.ownVote ? '♥' : '♡'}</span>
      <span aria-hidden="true">{loading ? '…' : rating?.average !== null && rating?.average !== undefined
        ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(rating.average) : 'Rate'}</span>
      {!!rating?.count && <small aria-hidden="true">({rating.count.toLocaleString()})</small>}
    </button>
  </Tooltip>;
}

export function SongRatingDialog({ title, recordingKey, rating, canVote, onClose, onSave, onOpenPreferences }: {
  title: string; recordingKey: RecordingKey; rating: SongRating | null; canVote: boolean;
  onClose: () => void; onSave: (value: number | null) => Promise<SongRating>; onOpenPreferences?: () => void;
}) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), hearts = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(() => ({ recordingKey, confirmed: rating?.recordingKey === recordingKey ? rating : null, choice: rating?.recordingKey === recordingKey ? rating.ownVote : null, dirty: false }));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const activeKey = useRef(recordingKey);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => {
    const changedRecording = activeKey.current !== recordingKey;
    activeKey.current = recordingKey;
    setState(previous => {
      const confirmed = rating?.recordingKey === recordingKey ? rating : null;
      const same = previous.recordingKey === recordingKey;
      return { recordingKey, confirmed, choice: same && previous.dirty ? previous.choice : confirmed?.ownVote ?? null, dirty: same && previous.dirty };
    });
    if (changedRecording) { setError(''); setNotice(''); }
  }, [rating, recordingKey]);
  const choose = (value: number) => {
    if (!canVote || saving) return;
    setState(previous => ({ ...previous, choice: value, dirty: value !== previous.confirmed?.ownVote }));
    setError(''); setNotice('');
  };
  const save = async (value: number | null) => {
    if (!canVote || saving) return;
    const key = recordingKey;
    setSaving(true); setError(''); setNotice('');
    try {
      const confirmed = parseSongRating(await onSave(value));
      if (!confirmed || confirmed.recordingKey !== key || confirmed.ownVote !== value)
        throw new Error('The service did not confirm this rating. Refresh and check before trying again.');
      if (activeKey.current !== key) return;
      setState({ recordingKey: key, confirmed, choice: confirmed.ownVote, dirty: false });
      setNotice(value === null ? 'Your host rating was cleared.' : 'Your host rating was saved.');
    } catch (reason) {
      if (activeKey.current === key) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setSaving(false); }
  };
  return <dialog ref={dialog} className="settings-dialog song-rating-dialog" aria-labelledby={`${id}-title`}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (state.choice !== null) void save(state.choice); }}>
      <h2 id={`${id}-title`}>Rate This Recording</h2>
      <p className="song-rating-dialog__song"><strong>{title}</strong></p>
      <p className="song-rating-dialog__summary">{state.confirmed
        ? <><span aria-hidden="true">♥ </span>{averageText(state.confirmed)} <span className="muted">· {countText(state.confirmed.count)}</span></>
        : 'The shared rating has not loaded yet.'}</p>
      <p id={`${id}-host-note`} className="muted">Your host rating is saved for the configured private host profile. This does not create an individual singer account. Ratings apply to this exact recording.</p>
      <fieldset disabled={saving || !canVote}>
        <legend>Your Host Rating</legend>
        <div className="song-rating-dialog__hearts" ref={hearts} role="radiogroup" aria-label="Your Host Rating" aria-describedby={`${id}-host-note`}
          onKeyDown={event => {
            const from = Number((event.target as HTMLElement).closest('[data-heart-value]')?.getAttribute('data-heart-value'));
            if (!from || !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 1 : event.key === 'End' ? 10 : Math.max(1, Math.min(10, from + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1)));
            choose(next); hearts.current?.querySelector<HTMLButtonElement>(`[data-heart-value="${next}"]`)?.focus();
          }}>
          {Array.from({ length: 10 }, (_, index) => index + 1).map(value => <button key={value} type="button" role="radio" data-heart-value={value}
            aria-label={`${value} ${value === 1 ? 'heart' : 'hearts'} out of 10`} aria-checked={state.choice === value}
            tabIndex={state.choice === value || state.choice === null && value === 1 ? 0 : -1}
            className={value <= (state.choice ?? 0) ? 'is-filled' : ''} onClick={() => choose(value)}>
            <span aria-hidden="true">{value <= (state.choice ?? 0) ? '♥' : '♡'}</span><small aria-hidden="true">{value}</small>
          </button>)}
        </div>
      </fieldset>
      <p className="song-rating-dialog__choice" aria-live="polite">{state.choice === null ? 'Choose 1–10 hearts.' : `${state.choice} out of 10 hearts${state.dirty ? ' · Unsaved' : ''}`}</p>
      {!canVote && <div className="song-rating-dialog__setup">
        <p>You can view shared ratings. Configure your private host rating profile to save or clear your own rating.</p>
        {onOpenPreferences && <button type="button" onClick={() => { onClose(); onOpenPreferences(); }}>Open Rating Preferences</button>}
      </div>}
      {error && <p role="alert">Could not save rating: {error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="settings-actions song-rating-dialog__actions">
        <button type="button" disabled={saving} onClick={onClose}>Close</button>
        <button type="button" disabled={saving || !canVote || !state.confirmed?.ownVote} onClick={() => void save(null)}>Clear My Host Rating</button>
        <button type="submit" className="primary" disabled={saving || !canVote || state.choice === null || !state.dirty}>{saving ? 'Saving…' : 'Save Host Rating'}</button>
      </div>
    </form>
  </dialog>;
}
