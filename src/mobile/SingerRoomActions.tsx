import React, { useState } from 'react';
import { SINGER_ON_HOLD } from '../domain/singer-availability';
import type { GuestView, SingerClient, Song } from '../remote/client';
import { prepareGuestPhoto } from '../remote/photo';

type Props = { client: SingerClient; view: GuestView; listen: (view: GuestView) => void };

export function SingerRequests({ client, view, listen, names }: Props & { names: ReadonlyMap<string, Song> }) {
  const locked = view.busy || view.uncertain;
  const requests = view.snapshot?.requests ?? [];
  return <section className="singer-catalog-group">
    <h2>My Requests</h2>
    {view.uncertain && <div className="singer-inline-actions">
      <button type="button" disabled={view.busy} onClick={() => void client.checkOutcome(listen)}>Check Request Outcome</button>
      {view.retryAvailable && <button type="button" disabled={view.busy} onClick={() => void client.retryPending(listen)}>Retry Original Request</button>}
    </div>}
    {requests.length > 0 ? <ul className="mobile-songs">
      {requests.map(request => {
        const song = names.get(request.versionId);
        const status = request.status === 'accepted' || request.status === 'staged' ? 'Queued' : request.status;
        return <li key={request.id} className="mobile-song">
          <div><strong>{request.title ?? song?.title ?? 'Song Request'}</strong>
            {(request.artist || song?.artist) && <span>{request.artist || song?.artist}</span>}
            <span className="singer-request-status">{status}</span></div>
          {['pending', 'accepted', 'staged'].includes(request.status) &&
            <button type="button" disabled={locked} onClick={() => void client.withdraw(request.id, listen)}>Withdraw</button>}
        </li>;
      })}
    </ul> : <p>No requests yet.</p>}
  </section>;
}

export function SingerRoomActions({ client, view, listen }: Props) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [away, setAway] = useState(5);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const snapshot = view.snapshot;
  if (!snapshot) return null;
  const locked = view.busy || view.uncertain;
  const held = snapshot.unavailableUntilMs === SINGER_ON_HOLD;
  const minutes = Math.ceil(((snapshot.unavailableUntilMs ?? 0) - (snapshot.serverNowMs ?? Date.now())) / 60000);
  return <div className="singer-room-actions">
    {snapshot.applauseEnabled && <button type="button" disabled={locked || (snapshot.applauseCredits ?? 3) === 0}
      onClick={() => void client.applaud(listen)}>Applaud ({snapshot.applauseCredits ?? 3})</button>}
    {snapshot.points !== undefined && <p className="mobile-quiet">{snapshot.points} points</p>}
    <details><summary>Availability</summary>
      {held ? <p>Ask the host to return you to the rotation.</p> : <>
        <p>{minutes > 0 ? 'Away for about ' + minutes + ' min as of last refresh.' : 'Available for your turn.'}</p>
        <label>Minutes away<input type="number" min="1" max="60" value={away} onChange={event => setAway(Number(event.currentTarget.value))} /></label>
        <div className="singer-inline-actions">
          <button type="button" disabled={locked || !Number.isInteger(away) || away < 1 || away > 60}
            onClick={() => void client.setAvailability(away, listen)}>Mark Unavailable</button>
          <button type="button" disabled={locked} onClick={() => void client.setAvailability(0, listen)}>I’m Back</button>
        </div>
      </>}
    </details>
    <details><summary>Suggest a Song</summary>
      <form onSubmit={event => { event.preventDefault(); void client.requestMissing(title, artist, listen); }}>
        <label>Song title<input required value={title} maxLength={200} onChange={event => setTitle(event.currentTarget.value)} /></label>
        <label>Artist (optional)<input value={artist} maxLength={200} onChange={event => setArtist(event.currentTarget.value)} /></label>
        <button type="submit" disabled={locked}>Send Suggestion</button>
      </form>
    </details>
    {snapshot.photoEnabled && <details><summary>Share a Photo</summary>
      <form onSubmit={event => {
        event.preventDefault();
        if (!photo || photoBusy) return;
        setPhotoError('');
        setPhotoBusy(true);
        void prepareGuestPhoto(photo).then(data => client.sendPhoto(data, listen))
          .catch(error => setPhotoError(error instanceof Error ? error.message : 'Could not prepare the photo.'))
          .finally(() => setPhotoBusy(false));
      }}>
        <label>JPEG or PNG<input type="file" accept="image/jpeg,image/png" onChange={event => setPhoto(event.currentTarget.files?.[0] ?? null)} /></label>
        <button type="submit" disabled={locked || photoBusy || !photo}>{photoBusy ? 'Preparing…' : 'Send Photo'}</button>
        {photoError && <p role="alert">{photoError}</p>}
      </form>
    </details>}
  </div>;
}
