import React, { useEffect, useRef, useState } from 'react';
import { MISSING_SONG_STATUSES, type MissingSongReview, type MissingSongStatus } from '../domain/missing-request';

/** These methods are available only to the trusted host window. */
export type MissingSongReviewBridge = {
  getMissingSongReviews(): Promise<MissingSongReview[]>;
  onMissingSongReviews(callback: (items: MissingSongReview[]) => void): () => void;
  setMissingSongStatus(id: string, expected: MissingSongStatus, next: MissingSongStatus): Promise<boolean>;
};
const labels: Record<MissingSongStatus, string> = { pending: 'Pending', reviewing: 'Reviewing', fulfilled: 'Fulfilled', declined: 'Declined' };

export function MissingSongReviewPanel({ bridge }: { bridge: MissingSongReviewBridge }) {
  const [items, setItems] = useState<MissingSongReview[] | null>(null);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    const unsubscribe = bridge.onMissingSongReviews(value => { generation.current++; if (alive) { setItems(value); setError(''); } });
    const start = generation.current;
    void bridge.getMissingSongReviews().then(value => { if (alive && generation.current === start) setItems(value); })
      .catch(() => { if (alive && generation.current === start) setError('Could not load song requests.'); });
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);
  async function update(item: MissingSongReview, next: MissingSongStatus) {
    if (updating || item.status === next) return;
    setUpdating(item.id); setError('');
    try {
      const saved = await bridge.setMissingSongStatus(item.id, item.status, next);
      const start = generation.current, latest = await bridge.getMissingSongReviews();
      if (generation.current === start) setItems(latest);
      if (!saved) setError('This request changed. Review its current status and try again.');
    } catch { setError('Could not update the request. Please try again.'); }
    finally { setUpdating(null); }
  }
  return <MissingSongReviewView items={items} error={error} updating={updating} onUpdate={(item, next) => { void update(item, next); }} />;
}

export function MissingSongReviewView({ items, error, updating, onUpdate }: {
  items: MissingSongReview[] | null; error: string; updating: string | null;
  onUpdate: (item: MissingSongReview, next: MissingSongStatus) => void;
}) {
  return <section aria-label="Unavailable song requests">
    <h3>Unavailable Song Requests</h3>
    {error && <p role="alert">{error}</p>}
    {items === null ? <p>Loading requests…</p> : items.length === 0 ? <p>No unavailable song requests yet.</p> : <ul>
      {items.map(item => <li key={item.id}>
        <strong>{item.title}</strong>{item.artist && <> — {item.artist}</>} <span>requested by {item.singer}</span>
        <label> Status <select aria-label={`Status for ${item.title}, requested by ${item.singer}`} value={item.status} disabled={updating !== null}
          onChange={event => onUpdate(item, event.target.value as MissingSongStatus)}>
          {MISSING_SONG_STATUSES.map(status => <option key={status} value={status}>{labels[status]}</option>)}
        </select></label>
      </li>)}
    </ul>}
  </section>;
}
