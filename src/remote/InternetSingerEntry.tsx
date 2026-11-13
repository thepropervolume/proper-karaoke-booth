import React, { useEffect, useState } from 'react';
import { SingerClient } from './client';
import { SingerPage } from './SingerPage';
import { internetGuestTransport, lookupInternetSingerRoom } from './internet-transport';

/** No credentials are persisted. A changed generation creates a new, explicitly joined page. */
export function InternetSingerEntry({ slug }: { slug: string }) {
  const [client, setClient] = useState<SingerClient | null>(null);
  const [message, setMessage] = useState('Connecting to the show…');
  const [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true); setClient(null); setMessage('Connecting to the show…');
    void lookupInternetSingerRoom(slug).then(room => {
      if (!active) return;
      if (!room.online) { setMessage('The host is offline. Keep this link and try again when the show is connected.'); return; }
      const transport = internetGuestTransport(room, { onEnded: () => {
        if (active) { setClient(null); setMessage('This session ended or changed. Check with the host before joining again.'); }
      } });
      setClient(new SingerClient(transport, ''));
    }).catch(() => { if (active) setMessage('This session is unavailable. Check the link with your host and try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, attempt]);
  if (client) return <SingerPage client={client} />;
  return <main className="singer-page"><header><h1>The Proper Volume Karaoke</h1></header>
    <p role="status">{message}</p><button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>Check Session</button>
  </main>;
}
