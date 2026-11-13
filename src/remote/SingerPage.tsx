import React, { useEffect, useMemo, useState } from 'react';
import { SingerClient, takeInvitation, type GuestView } from './client';
import { httpsGuestTransport } from './transport';
import './singer-page.css';

/** Embeddable page; a secure server and asset bundle are still required to use it. */
export function SingerPage({ client }: { client: SingerClient }) {
  const [view, setView] = useState<GuestView>(() => client.state());
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [awayMinutes, setAwayMinutes] = useState(5);
  const [missingTitle, setMissingTitle] = useState('');
  const [missingArtist, setMissingArtist] = useState('');
  useEffect(() => {
    if (!view.joined) return;
    const timer = window.setInterval(() => void client.refresh(setView), 15000);
    return () => window.clearInterval(timer);
  }, [client, view.joined]);
  const songs = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return view.songs.filter(song => terms.every(term => `${song.artist} ${song.title}`.toLocaleLowerCase().includes(term)));
  }, [query, view.songs]);
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
        <section><h2>Your availability</h2>
          <p>{(view.snapshot.unavailableUntilMs ?? 0) > (view.snapshot.serverNowMs ?? Date.now()) ? `Unavailable · return in about ${Math.ceil(((view.snapshot.unavailableUntilMs ?? 0) - (view.snapshot.serverNowMs ?? Date.now())) / 60000)} min at last refresh.` : 'Available for your turn.'} You can keep one upcoming request while unavailable; existing requests stay saved. Your turn rejoins automatically when the time expires, and the host starts playback.</p>
          <label>Minutes away<input type="number" min="1" max="60" step="1" value={awayMinutes} onChange={event => setAwayMinutes(Number(event.target.value))} /></label>
          <button disabled={view.busy || view.uncertain || !Number.isInteger(awayMinutes) || awayMinutes < 1 || awayMinutes > 60} onClick={() => void client.setAvailability(awayMinutes, setView)}>Mark me unavailable</button>{' '}
          <button disabled={view.busy || view.uncertain} onClick={() => void client.setAvailability(0, setView)}>I'm back</button>
        </section>
        <section><h2>Your requests</h2>{view.snapshot.requests.length ? <ul>{view.snapshot.requests.map(request => {
          const song = view.songs.find(item => item.id === request.versionId);
          return <li key={request.id}>{song ? `${song.artist} — ${song.title}` : 'Song'} <strong>{request.status}</strong>{['pending', 'accepted'].includes(request.status) && <button disabled={view.busy || view.uncertain} onClick={() => void client.withdraw(request.id, setView)}>Withdraw</button>}</li>;
        })}</ul> : <p>You have no current requests.</p>}{view.snapshot.requestsTruncated && <p>Showing up to 50 requests, prioritizing active requests.</p>}</section>
        <section><h2>Song library</h2><label>Search loaded songs<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          {!songs.length && <p>No loaded songs match your search.</p>}
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
