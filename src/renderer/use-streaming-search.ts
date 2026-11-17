import { useEffect, useState } from 'react';
import type { KaraFunAccountStatus, KaraFunBridge, KaraFunSearchReply } from '../domain/karafun';
import type { YouTubeSearchBridge } from '../domain/youtube-search';
import type { YouTubeSearchResult } from '../domain/youtube-search';
// A query alone is not enough to identify a result: account and policy changes
// invalidate its request receipt too. The key hides stale replies immediately,
// even before React has run the cleanup for the previous search.
export function useKaraFunSearch(bridge: KaraFunBridge, account: KaraFunAccountStatus, query: string, enabled: boolean, scope: string) {
  const key = JSON.stringify([query.trim(), scope, account.revision, account.state, enabled]);
  const [result, setResult] = useState<{ key: string; reply: KaraFunSearchReply } | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true; setResult(null); setLoading(false);
    if (!enabled || account.state !== 'connected' || query.trim().length < 2) return () => { alive = false; };
    setLoading(true);
    const timer = window.setTimeout(() => { void bridge.search(query).then(reply => { if (alive) setResult({ key, reply }); }).catch(() => { if (alive) setResult({ key, reply: { status: 'unavailable', songs: [], message: 'KaraFun unavailable' } }); }).finally(() => { if (alive) setLoading(false); }); }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [bridge, key, account.state]);
  return { result: result?.key === key ? result.reply : null, loading };
}
export function useYouTubeSearch(bridge: YouTubeSearchBridge, query: string, enabled: boolean, scope: string) {
  const key = JSON.stringify([query.trim(), enabled, scope]);
  const [result, setResult] = useState<{ key: string; reply: YouTubeSearchResult } | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true; setResult(null); setLoading(false);
    if (!enabled || query.trim().length < 2) { void bridge.cancel(); return () => { alive = false; }; }
    setLoading(true);
    const timer = window.setTimeout(() => { void bridge.search(query).then(reply => { if (alive) setResult({ key, reply }); }).catch(() => {}).finally(() => { if (alive) setLoading(false); }); }, 650);
    return () => { alive = false; clearTimeout(timer); void bridge.cancel(); };
  }, [bridge, key]);
  return { result: result?.key === key ? result.reply : null, loading };
}
