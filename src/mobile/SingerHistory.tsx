import { useEffect, useRef, useState } from 'react';
import { IonIcon } from '@ionic/react';
import { timeOutline } from 'ionicons/icons';
import type { GuestSnapshot, Song } from '../remote/client';
import { getPerformances, mergePerformances, putPerformances, type SingerPerformance } from './singer-performance-history';

export function useSingerHistory(snapshot: GuestSnapshot | null | undefined, names: ReadonlyMap<string, Song>, email = '') {
  const scope = email.trim().toLowerCase();
  const [current, setCurrent] = useState(() => ({ scope, entries: getPerformances(scope) }));
  const latest = useRef(current);
  useEffect(() => {
    const saved = latest.current.scope === scope ? latest.current.entries : getPerformances(scope);
    const entries = snapshot ? mergePerformances(saved, snapshot, names, Date.now()) : saved;
    if (latest.current.scope === scope && entries === latest.current.entries) return;
    if (entries !== saved) putPerformances(scope, entries);
    latest.current = { scope, entries };
    setCurrent(latest.current);
  }, [scope, snapshot, names]);
  return current.scope === scope ? current.entries : [];
}

export function SingerHistory({ history, signedIn }: { history: readonly SingerPerformance[]; signedIn: boolean }) {
  return <section className="singer-history" aria-label="Performance history">
    <h2><IonIcon icon={timeOutline} aria-hidden="true" /> Performance History</h2>
    {history.length ? <ul className="singer-result-list">
      {history.map(song => <li key={song.key} className="singer-result-row">
        <div className="singer-copy"><strong>{song.title}</strong>{song.artist && <small>{song.artist}</small>}</div>
      </li>)}
    </ul> : <p className="mobile-quiet">Songs confirmed as completed by your host will appear here.</p>}
    {history.length > 0 && <p className="mobile-quiet">{signedIn ? 'Recorded on this device' : 'Available for this session'}</p>}
  </section>;
}
