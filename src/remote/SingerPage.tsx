import React, { useEffect, useState } from 'react';
import { SingerClient, takeInvitation, type GuestView } from './client';
import { httpsGuestTransport } from './transport';
import './singer-page.css';
import { prepareGuestPhoto } from './photo';
import { SINGER_ON_HOLD } from '../domain/singer-availability';

/** Embeddable page; a secure server and asset bundle are still required to use it. */
export function SingerPage({ client }: { client: SingerClient }) {
  const [view, setView] = useState<GuestView>(() => client.state());
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [awayMinutes, setAwayMinutes] = useState(5);
  const [missingTitle, setMissingTitle] = useState('');
  const [missingArtist, setMissingArtist] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  useEffect(() => {
    if (!view.joined) return;
    const timer = window.setInterval(() => void client.refresh(setView), 15000);
    return () => window.clearInterval(timer);
  }, [client, view.joined]);
  const songs = view.songs;
  const held = view.snapshot?.unavailableUntilMs === SINGER_ON_HOLD;
  const availableIn = Math.ceil(((view.snapshot?.unavailableUntilMs ?? 0) - (view.snapshot?.serverNowMs ?? Date.now())) / 60000);
  return <main className="singer-page">
    <header><h1>The Proper Volume Karaoke</h1><p>Find a song and join the rotation.</p></header>
    {view.message && <p role="status" className="singer-message">{view.message}</p>}
    {!view.joined ? <form onSubmit={event => { event.preventDefault(); void client.join(name, setView); }}>
      <label>Your name<input autoComplete="nickname" maxLength={100} value={name} onChange={event => setName(event.target.value)} required /></label>
      <button disabled={view.busy}>{view.joinUncertain ? 'Retry joining' : 'Join the show'}</button>
      <p>Your access lasts only for this open page. Ask the host for a new link if you close it.</p>
    </form> : <>
      <div className="singer-toolbar"><strong>{view.snapshot ? `Hello, ${view.snapshot.singerName}!` : 'Connecting to the show…'}</strong>
        <button disabled={view.busy} onClick={() => void client.refresh(setView)}>Refresh</button>
        <button disabled={view.busy} onClick={() => void client.reconnect(setView)}>Reconnect</button></div>
      {view.uncertain && <section className="singer-warning"><p>A previous request may have been received. Check its outcome before making another request.</p>
        <button disabled={view.busy} onClick={() => void client.checkOutcome(setView)}>Check request outcome</button>
        {view.retryAvailable && <><p>No outcome was found. You can retry the original action with its existing request ID.</p>
          <button disabled={view.busy} onClick={() => void client.retryPending(setView)}>Retry original action</button></>}</section>}
      {view.snapshot && <>
        {view.snapshot.photoEnabled && <section>
          <h2>Share a photo</h2>
          <form onSubmit={event => {
            event.preventDefault();
            if (!photo || photoBusy) return;
            setPhotoError(''); setPhotoBusy(true);
            void prepareGuestPhoto(photo).then(dataUrl => client.sendPhoto(dataUrl, setView))
              .catch(error => setPhotoError(error instanceof Error ? error.message : 'Could not prepare the photo.'))
              .finally(() => setPhotoBusy(false));
          }}>
            <label>JPEG or PNG<input type="file" accept="image/jpeg,image/png" onChange={event => setPhoto(event.target.files?.[0] ?? null)} /></label>
            <button disabled={!photo || photoBusy || view.busy || view.uncertain}>{photoBusy ? 'Preparing photo…' : 'Send to singer display'}</button>
            {photoError && <p role="alert">{photoError}</p>}
          </form>
        </section>}
        {view.snapshot.applauseEnabled && <section>
          <h2>Applause</h2>
          <p>{view.snapshot.applauseCredits ?? 3} applause credits{view.snapshot.points !== undefined ? ` · ${view.snapshot.points} points` : ''}</p>
          <button disabled={view.busy || view.uncertain || (view.snapshot.applauseCredits ?? 3) === 0}
            onClick={() => void client.applaud(setView)}>👏 Applaud</button>
        </section>}
        <section><h2>Your availability</h2>
          {held ? <p>On hold. Ask the host to return you to the rotation. Your existing requests stay saved.</p> : <>
            <p>{availableIn > 0 ? `Unavailable · return in about ${availableIn} min at last refresh.` : 'Available for your turn.'} You can keep one upcoming request while unavailable. A timed absence ends automatically.</p>
            <label>Minutes away<input type="number" min="1" max="60" step="1" value={awayMinutes} onChange={event => setAwayMinutes(Number(event.target.value))} /></label>
            <button disabled={view.busy || view.uncertain || !Number.isInteger(awayMinutes) || awayMinutes < 1 || awayMinutes > 60} onClick={() => void client.setAvailability(awayMinutes, setView)}>Mark me unavailable</button>{' '}
            <button disabled={view.busy || view.uncertain} onClick={() => void client.setAvailability(0, setView)}>I'm back</button>
          </>}
        </section>
        <section><h2>Your requests</h2>{view.snapshot.requests.length ? <ul>{view.snapshot.requests.map(request => {
          const song = view.songs.find(item => item.id === request.versionId);
          return <li key={request.id}>{song ? `${song.artist} — ${song.title}` : 'Song'} <strong>{request.status === 'staged' || request.status === 'accepted' ? 'Queued' : request.status}</strong>{['pending', 'accepted', 'staged'].includes(request.status) && <button disabled={view.busy || view.uncertain} onClick={() => void client.withdraw(request.id, setView)}>Withdraw</button>}</li>;
        })}</ul> : <p>You have no current requests.</p>}{view.snapshot.requestsTruncated && <p>Showing up to 50 requests, prioritizing active requests.</p>}</section>
        <section><h2>Song library</h2><label>Search host library<input type="search" disabled={!view.snapshot} maxLength={200} value={query} onChange={event => { const value = event.target.value; setQuery(value); void client.search(value, setView); }} /></label>
          {view.searching ? <p>Searching…</p> : !songs.length && <p>No songs match your search.</p>}
          <ul className="singer-songs">{songs.map(song => <li key={song.id}><span><strong>{song.title}</strong><br />{song.artist}</span>
            <button disabled={view.busy || view.uncertain} onClick={() => void client.request(song.id, setView)}>Request</button></li>)}</ul>
          {view.nextOffset !== null && <button disabled={view.busy} onClick={() => void client.more(setView)}>Load more songs</button>}
        </section>
        <section><h2>Can't find your song?</h2><p>Send a request to the host. It will not be added to the singer rotation automatically.</p>
          <form onSubmit={event => { event.preventDefault(); void client.requestMissing(missingTitle, missingArtist, setView); }}>
            <label>Song title<input value={missingTitle} onChange={event => setMissingTitle(event.target.value)} maxLength={200} required /></label>
            <label>Artist (optional)<input value={missingArtist} onChange={event => setMissingArtist(event.target.value)} maxLength={200} /></label>
            <button disabled={view.busy || view.uncertain}>Send to host</button>
          </form>
        </section>
      </>}
    </>}
  </main>;
}

/** Entry helper for a future trusted HTTPS page. The transport does not start a server. */
export function createSingerClient(location: Location, history: History): SingerClient {
  const invitation = takeInvitation(location, history);
  return new SingerClient(httpsGuestTransport(location.origin), invitation);
}
