import React, { useEffect, useState } from 'react';
import type { KaraFunAccountStatus, KaraFunBridge, KaraFunPreparation } from '../domain/karafun';
import type { Version } from '../domain';
export function useKaraFunAccount(bridge: KaraFunBridge) {
  const [status, setStatus] = useState<KaraFunAccountStatus>({ state: 'disconnected', revision: 0, persistence: 'memory-only' });
  useEffect(() => { let alive = true; void bridge.status().then(value => { if (alive) setStatus(value); }); const unsubscribe = bridge.subscribe(setStatus); return () => { alive = false; unsubscribe(); }; }, [bridge]);
  return status;
}
export function KaraFunPanel({ bridge, status, versions }: { bridge: KaraFunBridge; status: KaraFunAccountStatus; versions: readonly Version[] }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [preparations, setPreparations] = useState<KaraFunPreparation[]>([]);
  useEffect(() => { let alive = true; const refresh = () => { void bridge.preparations().then(value => { if (alive) setPreparations(value); }).catch(() => {}); }; refresh(); const timer = window.setInterval(refresh, 1000); return () => { alive = false; clearInterval(timer); }; }, [bridge]);
  const connect = async () => { setBusy(true); setError(''); try { if (status.state === 'connected') await bridge.signOut(); await bridge.signIn(); } catch { setError('Sign-in did not finish. Retry and complete the official KaraFun sign-in window.'); } finally { setBusy(false); } };
  return <section className="provider-catalog" aria-label="KaraFun account"><h2>KaraFun</h2>
    <p>Search and queue with your existing subscription.</p>
    <p role="status"><strong>{status.state === 'connected' ? 'Signed In' : status.state === 'connecting' ? 'Signing In…' : status.state === 'expired' ? 'Sign-In Expired' : 'Not Signed In'}</strong>{status.message ? ` · ${status.message}` : ''}</p>
    {status.state === 'connected' && <p className="muted">{status.persistence === 'os-protected' ? 'Sign-in is remembered securely on this computer.' : 'Secure session storage is unavailable; sign-in lasts until the app closes.'}</p>}
    <button type="button" disabled={busy || status.state === 'connecting'} onClick={() => void connect()}>{status.state === 'connected' ? 'Reconnect KaraFun' : 'Sign In to KaraFun'}</button>{' '}
    {status.state === 'connected' && <button type="button" disabled={busy} onClick={() => void bridge.signOut().catch(() => setError('Could not finish signing out.'))}>Sign Out</button>}
    {error && <p role="alert">{error}</p>}
    {preparations.length > 0 && <div><h3>Song Preparation</h3>{preparations.map(item => <div key={item.versionId}>
      <strong>{versions.find(version => version.id === item.versionId)?.artist} — {versions.find(version => version.id === item.versionId)?.title || 'KaraFun Recording'}</strong>{' · '}
      <span>{item.phase === 'ready' ? 'Ready to Play' : item.phase === 'failed' ? 'Preparation Failed' : item.phase === 'authorizing' ? 'Checking Account' : item.phase === 'checking' ? 'Verifying Song' : 'Downloading Song'}</span>
      {item.phase === 'downloading' && <progress aria-label="KaraFun download" value={item.total ? item.received : undefined} max={item.total || undefined} />}
      {item.message && <p role="alert">{item.message}</p>}
      {item.phase === 'failed' && <button type="button" onClick={() => void bridge.retry(item.versionId).catch(() => setError('Sign in and retry this recording.'))}>Retry</button>}
    </div>)}</div>}
  </section>;
}
