import React, { useEffect, useState } from 'react';
import type { KaraFunAccountStatus, KaraFunBridge, KaraFunPreparation, KaraFunSearchReply, KaraFunSong } from '../domain/karafun';
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
export function KaraFunResults({ bridge, account, query, scope, disabled, onChoose }: {
  bridge: KaraFunBridge; account: KaraFunAccountStatus; query: string; scope: string; disabled: boolean;
  onChoose(song: KaraFunSong, searchId: string): void;
}) {
  const [result, setResult] = useState<{ key: string; reply: KaraFunSearchReply } | null>(null), [loading, setLoading] = useState(false);
  const key = JSON.stringify([query.trim(), scope, account.revision]);
  useEffect(() => {
    let alive = true; setResult(null); setLoading(false);
    if (account.state !== 'connected' || query.trim().length < 2) return () => { alive = false; };
    const timer = window.setTimeout(() => { setLoading(true); void bridge.search(query).then(reply => { if (alive) setResult({ key, reply }); }).catch(() => { if (alive) setResult({ key, reply: { status: 'unavailable', songs: [], message: 'KaraFun search is unavailable. Check Sources.' } }); }).finally(() => { if (alive) setLoading(false); }); }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [bridge, key, account.state]);
  if (account.state !== 'connected' || query.trim().length < 2) return null;
  const reply = result?.key === key ? result.reply : null;
  return <section aria-label="KaraFun search results" className="provider-catalog-results"><h3>KaraFun</h3>
    {loading && <p role="status">Searching KaraFun…</p>}
    {reply?.status !== 'ok' && reply?.message && <p role="status">{reply.message}</p>}
    {reply?.songs.map(song => <button type="button" className="track-row" key={`${song.catalog}:${song.songId}`} disabled={disabled || !reply.searchId} onClick={() => onChoose(song, reply.searchId!)}>
      <span><strong>{song.artist} — {song.title}</strong><small>KaraFun · Choose Singer and Queue</small></span>
    </button>)}
    {reply?.status === 'ok' && !reply.songs.length && <p>No KaraFun matches.</p>}
  </section>;
}
