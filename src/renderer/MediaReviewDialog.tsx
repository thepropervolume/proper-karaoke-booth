import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Version } from '../domain';
import type { LibraryMediaRemoval, MediaReviewIssue, MediaReviewResult } from '../domain/media-review';
import '../styles/media-review.scss';

type ReviewBridge = {
  reviewMedia(id: string): Promise<MediaReviewResult>;
  cancelMediaReview(id: string): Promise<void>;
};
type ActionResult = { ok: boolean; cancelled?: boolean; error?: string; notice?: string };
const reasonText: Record<MediaReviewIssue['reason'], string> = {
  missing: 'File not found', unavailable: 'Storage unavailable', invalid: 'Empty or invalid file',
};
const PAGE_SIZE = 40;

export function MediaReviewDialog({ bridge, versions, onRelink, onRemove, onClose }: {
  bridge: ReviewBridge;
  versions: readonly Version[];
  onRelink(id: string): Promise<ActionResult>;
  onRemove(input: LibraryMediaRemoval): Promise<ActionResult>;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const activeScan = useRef<string | null>(null);
  const [report, setReport] = useState<Extract<MediaReviewResult, { status: 'completed' }> | null>(null);
  const [checking, setChecking] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const check = async () => {
    if (activeScan.current) return;
    const id = crypto.randomUUID();
    activeScan.current = id;
    setChecking(true); setReport(null); setMessage(''); setError(''); setPage(0);
    try {
      const result = await bridge.reviewMedia(id);
      if (activeScan.current !== id) return;
      if (result.status === 'completed') setReport(result);
      else setMessage(result.status === 'busy' ? 'The previous check is still waiting for storage. Try again shortly.' : 'File check cancelled.');
    } catch { if (activeScan.current === id) setError('Could not check local files. Try again.'); }
    finally {
      if (activeScan.current === id) { activeScan.current = null; setChecking(false); }
    }
  };

  const cancel = () => {
    const id = activeScan.current;
    if (!id) return;
    activeScan.current = null;
    setChecking(false); setMessage('File check cancelled.');
    void bridge.cancelMediaReview(id).catch(() => {});
  };

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    void check();
    return () => {
      element?.close();
      const id = activeScan.current;
      if (id) void bridge.cancelMediaReview(id).catch(() => {});
      activeScan.current = null;
    };
  }, [bridge]);

  const relink = async (song: Version) => {
    setRelinking(true); setError(''); setMessage('');
    try {
      const result = await onRelink(song.id);
      if (!result.ok) setError(result.error || 'The song could not be relinked.');
      else if (!result.cancelled) {
        setReport(current => current && { ...current, issues: current.issues.filter(issue => issue.versionId !== song.id) });
        setMessage(result.notice || `Relinked ${song.title}.`);
      }
    } catch { setError('The song could not be relinked. Try selecting the original video again.'); }
    finally { setRelinking(false); }
  };
  const remove = async (song: Version, kind: 'file' | 'parent') => {
    setRelinking(true); setError(''); setMessage('');
    try {
      const result = await onRemove({ kind, id: song.id });
      if (!result.ok) setError(result.error || 'Could not remove the selected library entries.');
      else if (!result.cancelled) setMessage(result.notice || 'Library updated.');
    } catch { setError('Could not remove the selected library entries.'); }
    finally { setRelinking(false); }
  };

  const versionMap = useMemo(() => new Map(versions.map(version => [version.id, version])), [versions]);
  const present = useMemo(() => (report?.issues ?? []).flatMap(issue => {
    const song = versionMap.get(issue.versionId);
    return song ? [{ issue, song }] : [];
  }), [report, versionMap]);
  const term = query.trim().toLocaleLowerCase();
  const matching = useMemo(() => term ? present.filter(({ song, issue }) =>
    `${song.title} ${song.artist} ${issue.filename}`.toLocaleLowerCase().includes(term)) : present, [present, term]);
  const lastPage = Math.max(0, Math.ceil(matching.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);

  return <dialog ref={dialog} className="settings-dialog media-review" aria-labelledby="media-review-title"
    onCancel={event => { event.preventDefault(); if (!relinking) onClose(); }}>
    <h2 id="media-review-title">Review Missing Files</h2>
    <p className="muted">Relink a moved file, or remove its library entry while keeping the file on disk.</p>
    <p role="status" aria-live="polite">{checking ? 'Checking local file locations…' : report ? `Checked ${report.checked} local files. ${present.length} need attention.` : ''}</p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {present.length > 0 && <>
      <label>Find by song, artist or filename<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <ul className="media-review__list">
        {matching.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(({ song, issue }) => <li className="track-row" key={song.id}>
          <div><strong>{song.title}</strong><small>{song.artist || 'Unknown Artist'}</small><small>{[reasonText[issue.reason], issue.filename].filter(Boolean).join(' · ')}</small></div>
          <div className="media-review__actions">
            <button type="button" disabled={relinking || checking} aria-label={`Relink file for ${song.title}`} onClick={() => void relink(song)}>Relink File…</button>
            <button type="button" disabled={relinking || checking} aria-label={`Remove ${song.title} from library`} onClick={() => void remove(song, 'file')}>Remove…</button>
            {issue.filename && <button type="button" disabled={relinking || checking} aria-label={`Remove folder for ${song.title} from library`} onClick={() => void remove(song, 'parent')}>Remove Folder…</button>}
          </div>
        </li>)}
      </ul>
      {matching.length === 0 && <p>No files match this search.</p>}
      {lastPage > 0 && <div className="settings-inline-help">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous Page</button>
        <span>Page {currentPage + 1} of {lastPage + 1}</span>
        <button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next Page</button>
      </div>}
    </>}
    <div className="settings-actions">
      {checking ? <button type="button" onClick={cancel}>Cancel Check</button> : <button type="button" disabled={relinking} onClick={() => void check()}>Check Again</button>}
      <button type="button" autoFocus disabled={relinking} onClick={onClose}>Close</button>
    </div>
  </dialog>;
}
