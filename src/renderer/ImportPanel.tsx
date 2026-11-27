import React, { useEffect, useState } from 'react';
import type { ImportProgress, ImportResult, ImportResultsPage } from '../domain/import-job';

/** Main-process paths are deliberately absent from this host-only bridge. */
export type ImportBridge = {
  status(): Promise<ImportProgress | null>;
  subscribe(callback: (value: ImportProgress) => void): () => void;
  cancel(jobId: string): Promise<boolean>;
  results(jobId: string, offset: number, limit: number): Promise<ImportResultsPage>;
};
const PAGE_SIZE = 25;
export const importActive = (phase: ImportProgress['phase']) => phase === 'scanning' || phase === 'hashing' || phase === 'cancelling';
export function formatImportBytes(value: number): string {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}
function outcomeLabel(item: ImportResult): string {
  const outcome = item.outcome === 'imported' ? 'Imported' : item.outcome === 'duplicate' ? 'Duplicate' : item.outcome === 'cancelled' ? 'Cancelled' : 'Failed';
  return item.needsReview ? `${outcome} · Review metadata` : outcome;
}

/** Self-contained state subscription; a late initial snapshot cannot overwrite an event. */
export function ImportPanel({ bridge, onActiveChange }: { bridge: ImportBridge; onActiveChange?: (active: boolean) => void }) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [loaded, setLoaded] = useState<{ jobId: string; page: ImportResultsPage } | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    let alive = true, received = false;
    const unsubscribe = bridge.subscribe(value => { received = true; if (alive) setProgress(value); });
    void bridge.status().then(value => { if (alive && !received) setProgress(value); })
      .catch(() => { if (alive && !received) setError('Import status is unavailable.'); });
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);
  useEffect(() => { setOffset(0); setLoaded(null); setCancelling(false); setError(''); }, [progress?.jobId]);
  useEffect(() => { onActiveChange?.(!!progress && importActive(progress.phase)); }, [onActiveChange, progress?.phase]);
  useEffect(() => {
    if (!progress) return;
    let alive = true;
    const jobId = progress.jobId;
    void bridge.results(jobId, offset, PAGE_SIZE).then(value => { if (alive) setLoaded({ jobId, page: value }); })
      .catch(() => { if (alive) { setLoaded(null); setError('Import results could not be loaded.'); } });
    return () => { alive = false; };
  }, [bridge, progress?.jobId, progress?.processed, offset]);
  if (!progress) return error ? <p role="alert">{error}</p> : null;
  const page = loaded?.jobId === progress.jobId && loaded.page.offset === offset ? loaded.page : null;
  const cancel = async () => {
    setCancelling(true); setError('');
    try { if (!await bridge.cancel(progress.jobId)) setError('The import has already finished.'); }
    catch { setError('Could not cancel the import.'); }
    finally { setCancelling(false); }
  };
  return <ImportProgressView progress={progress} page={page} error={error} cancelling={cancelling}
    onCancel={() => void cancel()} onPrevious={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}
    onNext={() => { if (page?.nextOffset !== null && page?.nextOffset !== undefined) setOffset(page.nextOffset); }} />;
}

/** Presentational view is also usable with controlled state in accessibility tests. */
export function ImportProgressView({ progress, page, error = '', cancelling = false, onCancel, onPrevious, onNext }: {
  progress: ImportProgress; page: ImportResultsPage | null; error?: string; cancelling?: boolean;
  onCancel: () => void; onPrevious: () => void; onNext: () => void;
}) {
  const active = importActive(progress.phase);
  const title = progress.phase === 'completed' ? 'Import complete' : progress.phase === 'cancelled' ? 'Import cancelled' :
    progress.phase === 'failed' ? 'Import stopped' : progress.phase === 'cancelling' ? 'Cancelling import…' : 'Import in progress';
  return <section className="import-panel" data-phase={progress.phase} aria-label="Import progress">
    <div className="import-panel__heading"><h3>{title}</h3>
      {active && <button type="button" disabled={cancelling || progress.phase === 'cancelling'} onClick={onCancel}>Cancel import</button>}
    </div>
    <p role="status" aria-live="polite">{progress.processed} processed · {progress.imported} imported · {progress.duplicates} duplicates · {progress.failed} failed{progress.cancelled ? ` · ${progress.cancelled} cancelled` : ''}{progress.needsReview ? ` · ${progress.needsReview} need metadata review` : ''}{progress.directoriesScanned ? ` · ${progress.directoriesScanned} folders scanned` : ''}{progress.skippedUnsupported ? ` · ${progress.skippedUnsupported} other files skipped` : ''}</p>
    {active && <p className="import-panel__hint">Folder totals grow as files are discovered. Large or cloud-only files may take time to download and fingerprint. Playback controls remain available.</p>}
    {progress.phase === 'completed' && progress.discovered === 0 && <p className="import-panel__hint">No supported karaoke files were found.</p>}
    {progress.current && <div className="import-panel__current">
      <span className="import-panel__filename">{progress.current.name}</span>
      {!!progress.current.retry && <span>File changed while reading. Retrying {progress.current.retry} of 2 with a full check.</span>}
      {progress.current.bytesTotal > 0 ? <progress aria-label={`Hashing ${progress.current.name}`} value={Math.min(progress.current.bytesRead, progress.current.bytesTotal)} max={progress.current.bytesTotal} /> : <progress aria-label={`${progress.current.converting ? 'Converting' : progress.phase === 'scanning' ? 'Scanning' : 'Preparing'} ${progress.current.name}`} />}
      {progress.current.converting ? <span>Converting paired lyrics and audio</span> : progress.phase !== 'scanning' && <span>{formatImportBytes(progress.current.bytesRead)}{progress.current.bytesTotal > 0 ? ` / ${formatImportBytes(progress.current.bytesTotal)}` : ''}</span>}
    </div>}
    {progress.phase === 'cancelled' && <p className="import-panel__hint">Files not yet discovered were not processed. Songs already imported remain in the library.</p>}
    {progress.phase === 'failed' && <p className="import-panel__hint">The import stopped before all files could be processed. Songs already imported remain in the library.</p>}
    {error && <p role="alert">{error}</p>}
    <details className="import-panel__details"><summary>File results ({progress.processed})</summary>
      <p className="import-panel__hint">Results remain available until the next import or until the app closes.</p>
      {!page ? <p>Loading results…</p> : !page.items.length ? <p>No file results on this page.</p> : <ul>
        {page.items.map((item, index) => <li key={`${page.offset + index}`}><span className="import-panel__filename">{item.name}</span><span>{outcomeLabel(item)}{item.message ? ` — ${item.message}` : ''}</span></li>)}
      </ul>}
      {page && page.total > 0 && <div className="import-panel__pagination">
        <button type="button" disabled={page.offset === 0} onClick={onPrevious}>Previous</button>
        <span>Showing {page.offset + 1}–{page.offset + page.items.length} of {page.total}</span>
        <button type="button" disabled={page.nextOffset === null} onClick={onNext}>Next</button>
      </div>}
    </details>
  </section>;
}
