import React, { useState } from 'react';
import type { GuestPhotoPreview } from './photo-review';

export function PhotoReviewPanel({ preview, displaying, onShow, onDiscard }: {
  preview: GuestPhotoPreview;
  displaying: boolean;
  onShow(): void;
  onDiscard(): void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [decoded, setDecoded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  return <aside className="mobile-photo-review" aria-labelledby="mobile-photo-review-title">
    <h2 id="mobile-photo-review-title">Photo from {preview.singer}</h2>
    {reviewing && <img src={preview.dataUrl} alt={`Photo submitted by ${preview.singer}`} onLoad={() => setDecoded(true)} onError={() => setLoadFailed(true)} />}
    {loadFailed && <p role="status">This photo could not be previewed.</p>}
    <div>
      {reviewing ? <button type="button" className="mobile-primary" disabled={!decoded || loadFailed || displaying} onClick={onShow}>Show Photo</button>
        : <button type="button" className="mobile-primary" onClick={() => setReviewing(true)}>Review Photo</button>}
      <button type="button" onClick={onDiscard}>Discard Photo</button>
    </div>
  </aside>;
}
