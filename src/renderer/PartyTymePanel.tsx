import React, { useEffect, useState } from 'react';
import type { PartyTymeBridge, PartyTymeStatus } from '../domain/partytyme';
import type { Version } from '../domain';
import type { KaraFunPreparation } from '../domain/karafun';
import { Tooltip } from './Tooltip';
export function usePartyTymeAccount(bridge?: PartyTymeBridge) {
    const [status, setStatus] = useState<PartyTymeStatus>({ state: 'disconnected', revision: 0, premium: false, persistence: 'memory-only' });
    useEffect(() => {
        if (!bridge)
            return;
        let alive = true;
        void bridge.status().then(v => {
            if (alive)
                setStatus(v);
        }).catch(() => {
        });
        const unsubscribe = bridge.subscribe(setStatus);
        return () => {
            alive = false;
            unsubscribe();
        };
    }, [bridge]);
    return status;
}
export function PartyTymePanel({ bridge, status, versions }: {
    bridge?: PartyTymeBridge;
    status: PartyTymeStatus;
    versions: readonly Version[];
}) {
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preparations, setPreparations] = useState<KaraFunPreparation[]>([]);
    useEffect(() => {
        if (!bridge)
            return;
        let alive = true;
        const refresh = () => {
            void bridge.preparations().then(v => {
                if (alive)
                    setPreparations(v);
            }).catch(() => {
            });
        };
        refresh();
        const timer = window.setInterval(refresh, 1000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [bridge]);
    if (!bridge)
        return null;
    const connect = async () => {
        setBusy(true);
        setError('');
        try {
            await bridge.signIn();
        }
        catch {
            setError('Could not connect. Choose a valid private credentials file and retry.');
        }
        finally {
            setBusy(false);
        }
    };
    return <section className="provider-catalog" aria-label="Party Tyme account"><h2>Party Tyme</h2>
    <p>Connect your consumer Karaoke Premium account to search and queue songs.</p>
    <p role="status"><strong>{status.state === 'connected' ? status.premium ? 'Signed In · Premium' : 'Signed In · Premium Required' : status.state === 'connecting' ? 'Connecting…' : status.state === 'expired' ? 'Sign-In Expired' : 'Not Signed In'}</strong>{status.message ? ` · ${status.message}` : ''}</p>
    <button type="button" disabled={busy || status.state === 'connecting'} onClick={() => void connect()}>{status.state === 'connected' ? 'Reconnect Party Tyme…' : 'Connect Party Tyme…'}</button>{' '}
    {status.state === 'connected' && <button type="button" disabled={busy} onClick={() => void bridge.signOut().catch(() => setError('Could not finish signing out.'))}>Sign Out</button>}
    <p className="muted">Consumer Premium account <Tooltip text="Choose a private credentials file containing username:password, or JSON with username/email and password. Only Party Tyme receives the login; the password is not copied into the saved session. Pro accounts use a separate service."><button type="button" aria-label="Party Tyme connection help">?</button></Tooltip></p>
    {status.state === 'connected' && <p className="muted">{status.persistence === 'os-protected' ? 'Sign-in is remembered securely on this computer.' : 'Sign-in lasts until the app closes; secure storage is unavailable.'}</p>}
    {error && <p role="alert">{error}</p>}
    {preparations.length > 0 && <div><h3>Song Preparation</h3>{preparations.map(item => <div key={item.versionId}><strong>{versions.find(v => v.id === item.versionId)?.title || 'Party Tyme Recording'}</strong>{' · '}{item.phase === 'ready' ? 'Ready to Play' : item.phase === 'failed' ? 'Preparation Failed' : item.phase === 'authorizing' ? 'Checking Account' : 'Preparing Video'}
      {item.phase === 'downloading' && <progress aria-label="Party Tyme preparation" value={item.total ? item.received : undefined} max={item.total || undefined}/>}
      {item.message && <p role="alert">{item.message}</p>}{item.phase === 'failed' && <button type="button" onClick={() => void bridge.retry(item.versionId).catch(() => setError('Connect and retry this recording.'))}>Retry</button>}</div>)}</div>}
  </section>;
}
