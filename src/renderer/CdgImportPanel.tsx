import React, { useEffect, useState } from 'react';
import type { CdgProgress } from '../main/cdg-import';
import { KARAOKE_PAIR_IMPORT_LABEL } from '../domain/shortcuts';

export type CdgBridge = { status(): Promise<CdgProgress | null>; start(): Promise<CdgProgress | null>; cancel(id: string): Promise<boolean> };
export function CdgImportPanel({ bridge, showStart = true }: { bridge: CdgBridge; showStart?: boolean }) {
  const [state, setState] = useState<CdgProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true, pending = false;
    const refresh = async () => {
      if (pending) return; pending = true;
      try { const value = await bridge.status(); if (alive) setState(value); }
      catch { if (alive) setError('Could not read karaoke pair import status.'); }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 500);
    return () => { alive = false; clearInterval(timer); };
  }, [bridge]);
  const active = !!state && ['preparing', 'converting', 'importing'].includes(state.phase);
  const start = async () => {
    setBusy(true); setError('');
    try { const next = await bridge.start(); if (next) setState(next); }
    catch { setError('Could not start the karaoke pair import. Finish the current import and try again.'); }
    finally { setBusy(false); }
  };
  if (!showStart && !state && !error) return null;
  return <section className="import-panel" aria-label="Karaoke pair import">
    {showStart && <><button type="button" disabled={busy || active} onClick={() => void start()}>{KARAOKE_PAIR_IMPORT_LABEL}…</button><span className="muted"> Choose matching CD+G or LRC and audio files, or a ZIP containing one MP3 + CDG pair. Requires FFmpeg.</span></>}
    {active && <><p role="status">{state.name} · {state.phase}{state.phase === 'converting' ? ` · ${Math.floor(state.seconds)}s converted` : ''}</p><progress aria-label="Converting karaoke pair" /><button type="button" onClick={() => { void bridge.cancel(state.id).catch(() => setError('Could not cancel the karaoke pair import.')); }}>Cancel import</button></>}
    {state && !active && <p role={state.phase === 'failed' ? 'alert' : 'status'}>{state.message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
