import React, { useEffect, useState } from 'react';
import { LIBRARY_RESULT_FIELDS, type LibraryResultField, type LibraryResultMetadata } from '../domain/library-result-fields';
import { RESULT_PROVIDER_COLORS, RESULT_PROVIDER_LABELS, type SongResult } from './unified-song-results';
import { Tooltip } from './Tooltip';

const columnsLayout: Record<LibraryResultField, { min: number; flex?: number }> = {
  title: { min: 137, flex: 2 }, artist: { min: 105, flex: 1.45 }, duration: { min: 52 },
  source: { min: 95, flex: 1 }, code: { min: 67 }, bpm: { min: 36 }, key: { min: 43 }, date: { min: 88 },
  filename: { min: 145, flex: 1.5 },
};
const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const optionalMetadataColumns = new Set<LibraryResultField>(['code', 'bpm', 'key']);

function duration(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function cellText(field: LibraryResultField, row: SongResult, file: string | undefined, metadata: LibraryResultMetadata | undefined): string {
  switch (field) {
    case 'title': return row.title;
    case 'artist': return row.artist;
    case 'source': return row.channelName || RESULT_PROVIDER_LABELS[row.resultProvider];
    case 'duration': return duration(row.durationSeconds ?? metadata?.durationSeconds);
    case 'code': return row.resultProvider === 'youtube' ? '' : [row.djCode, row.trackNumber].filter(Boolean).join('-');
    case 'bpm': return row.resultProvider === 'youtube' ? '' : String(row.bpm ?? metadata?.bpm ?? '');
    case 'key': return row.resultProvider === 'youtube' ? '' : row.musicalKey ?? metadata?.musicalKey ?? '';
    case 'date': {
      const value = row.dateAdded ?? metadata?.dateAdded;
      return value ? dateFormat.format(new Date(value + 'T00:00:00Z')) : '';
    }
    case 'filename': return row.resultProvider === 'youtube' ? '' : file ?? '';
  }
}

export function SongResults({ rows, selected, onSelect, onQueue, onContext, star, listRef, columns,
  filenames, readMetadata, metadataRevision, missingMedia }: {
  rows: readonly SongResult[]; selected: string; onSelect(id: string): void; onQueue(row: SongResult): void;
  onContext(row: SongResult, x: number, y: number): void; star(row: SongResult): React.ReactNode;
  listRef: React.RefObject<HTMLDivElement | null>;
  columns: readonly LibraryResultField[]; filenames: Readonly<Record<string, string>>;
  readMetadata(ids: string[]): Promise<Record<string, LibraryResultMetadata> | null>;
  metadataRevision: number; missingMedia?: ReadonlySet<string>;
}) {
  const [windowStart, setWindowStart] = useState(0);
  const [metadata, setMetadata] = useState<Record<string, LibraryResultMetadata>>({});
  const visibleStart = windowStart < rows.length ? windowStart : 0;
  const metadataIds = JSON.stringify(columns.some(field => field === 'duration' || field === 'bpm' || field === 'key' || field === 'date')
    ? rows.slice(visibleStart, visibleStart + 32).filter(row => row.resultProvider === 'local' && row.persisted && Object.hasOwn(filenames, row.id)).map(row => row.id)
    : []);
  useEffect(() => {
    // A scroll/search can replace the visible results while the probe is running.
    let current = true;
    const ids: string[] = JSON.parse(metadataIds);
    let retryTimer: number | undefined;
    const load = () => {
      void readMetadata(ids).then(result => {
        if (!current) return;
        if (result) setMetadata(result);
        else retryTimer = window.setTimeout(load, 300);
      }).catch(() => {});
    };
    if (ids.length) load();
    return () => { current = false; window.clearTimeout(retryTimer); };
  }, [metadataIds, readMetadata, metadataRevision]);

  // Keep the song and artist readable when a whole optional column is empty.
  const visibleColumns = columns.filter(field => !optionalMetadataColumns.has(field) ||
    rows.some(row => cellText(field, row, filenames[row.id], metadata[row.id])));
  const layout = [...visibleColumns.map(column => columnsLayout[column]), { min: 40 }];
  const grid = layout.map(({ min, flex }) => flex ? `minmax(${min}px, ${flex}fr)` : `${min}px`).join(' ');
  const gridWidth = layout.reduce((width, { min }) => width + min + 8, 16);
  return <div ref={listRef} className="library-results" style={{ '--result-grid': grid, '--result-min-width': `${gridWidth}px` } as React.CSSProperties} onScroll={event => {
    const option = event.currentTarget.querySelector<HTMLElement>('.song-option');
    if (option?.offsetHeight) setWindowStart(Math.floor(event.currentTarget.scrollTop / option.offsetHeight / 16) * 16);
  }}><div className="song-list">
    {rows.length > 0 && <div className="song-list__columns" aria-hidden="true">{visibleColumns.map(field => <span key={field}>{LIBRARY_RESULT_FIELDS[field]}</span>)}</div>}
    <div role="listbox" aria-label="Songs">
    {rows.map((row, index) => {
      const missing = missingMedia?.has(row.id);
      return <div key={row.id} className={`track-row song-option ${row.id === selected ? 'selected' : ''}`} data-provider={row.resultProvider} data-missing={missing || undefined}
      style={{ '--provider-color': RESULT_PROVIDER_COLORS[row.resultProvider] } as React.CSSProperties} role="option" aria-selected={row.id === selected} tabIndex={0}
      onClick={() => onSelect(row.id)} onDoubleClick={() => { onSelect(row.id); if (!missing) onQueue(row); }}
      onContextMenu={event => { event.preventDefault(); onSelect(row.id); onContext(row, event.clientX, event.clientY); }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') { event.preventDefault(); if (!missing) onQueue(row); }
        else if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); onSelect(row.id); const rect = event.currentTarget.getBoundingClientRect(); onContext(row, rect.left, rect.bottom); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus(); onSelect(rows[next]?.id || ''); }
      }}>
      {visibleColumns.map(field => {
        const value = cellText(field, row, filenames[row.id], metadata[row.id]);
        if (field === 'title') return <span className="song-option__title" key={field}><strong title={value}>{value}</strong>
          {missing && <span className="song-option__notice">File missing</span>}</span>;
        if (field === 'source' && row.catalogOnly) return <Tooltip key={field} text="Catalog search only. Playback is not connected for this service."><span className="song-option__cell">{value} · Catalog</span></Tooltip>;
        return <span className="song-option__cell" data-field={field} key={field} title={value || undefined}>{value}</span>;
      })}
      <span className="song-option__actions">{star(row)}</span>
    </div>;
    })}
    </div>
  </div>{!rows.length && <p className="empty">No matching songs.</p>}</div>;
}
