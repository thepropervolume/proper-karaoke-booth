import React, { useCallback, useMemo, useRef, useState } from 'react';
import { LIBRARY_RESULT_FIELDS, activeLibrarySort, compareLibrarySortValues, cycleLibrarySort,
  type LibraryResultField, type LibraryResultMetadata, type LibraryResultSort } from '../domain/library-result-fields';
import { RESULT_PROVIDER_COLORS, RESULT_PROVIDER_LABELS, type SongResult } from './unified-song-results';
import { LibraryFieldPicker } from './LibraryFieldPicker';
import { Tooltip } from './Tooltip';
import { useLibraryResultMetadata, type LibraryMetadataReader } from './use-library-result-metadata';

const columnsLayout: Record<LibraryResultField, { min: number; flex?: number }> = {
  title: { min: 137, flex: 2 }, artist: { min: 105, flex: 1.45 }, duration: { min: 65 },
  source: { min: 90, flex: 1 }, code: { min: 107, flex: 0.6 }, bpm: { min: 43 }, key: { min: 43 }, date: { min: 95 },
  filename: { min: 145, flex: 1.5 },
};
const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const optionalMetadataColumns = new Set<LibraryResultField>(['bpm', 'key']);
const localMetadataColumns = new Set<LibraryResultField>(['code', 'duration', 'bpm', 'key', 'date']);
type CodeResolver = (row: SongResult, metadata?: LibraryResultMetadata) => string;
const defaultCode: CodeResolver = row => [row.djCode, row.trackNumber].filter(Boolean).join('-');

function duration(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function resultValue(field: LibraryResultField, row: SongResult, file: string | undefined, metadata: LibraryResultMetadata | undefined,
  resolveCode: CodeResolver): string | number | null | undefined {
  switch (field) {
    case 'title': return row.title;
    case 'artist': return row.artist;
    case 'source': return row.channelName || RESULT_PROVIDER_LABELS[row.resultProvider];
    case 'duration': return row.durationSeconds ?? metadata?.durationSeconds;
    case 'code': return resolveCode(row, metadata);
    case 'bpm': return row.resultProvider === 'youtube' ? '' : row.bpm ?? metadata?.bpm;
    case 'key': return row.resultProvider === 'youtube' ? '' : row.musicalKey ?? metadata?.musicalKey ?? '';
    case 'date': return row.dateAdded ?? metadata?.dateAdded;
    case 'filename': return row.resultProvider === 'local' ? file ?? '' : '';
  }
}

function cellText(field: LibraryResultField, value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  if (field === 'duration' && typeof value === 'number') return duration(value);
  if (field === 'date') return dateFormat.format(new Date(value + 'T00:00:00Z'));
  return String(value);
}

export function SongResults({ rows, selected, onSelect, onQueue, onContext, star, listRef, columns,
  filenames, readMetadata, metadataRevision, missingMedia, resolveCode = defaultCode,
  sort, onSort, savingColumns, onColumnsChange, emptyMessage }: {
  rows: readonly SongResult[]; selected: string; onSelect(id: string): void; onQueue(row: SongResult): void;
  onContext(row: SongResult, x: number, y: number): void; star(row: SongResult): React.ReactNode;
  listRef: React.RefObject<HTMLDivElement | null>;
  columns: readonly LibraryResultField[]; filenames: Readonly<Record<string, string>>;
  readMetadata: LibraryMetadataReader;
  metadataRevision: string; missingMedia?: ReadonlySet<string>;
  resolveCode?: CodeResolver;
  sort: LibraryResultSort; onSort(value: LibraryResultSort): void;
  savingColumns: boolean; onColumnsChange(value: readonly LibraryResultField[]): void; emptyMessage: string;
}) {
  const [windowStart, setWindowStart] = useState(0);
  const columnsTrigger = useRef<HTMLButtonElement>(null);
  const visibleStart = windowStart < rows.length ? windowStart : 0;
  const sortColumn = useMemo(() => activeLibrarySort(sort), [sort]);
  const metadataSort = Boolean(sortColumn && localMetadataColumns.has(sortColumn.field));
  const ordered = useCallback((values?: ReadonlyMap<string, LibraryResultMetadata>) => {
    if (!sortColumn) return rows;
    const { field, direction } = sortColumn;
    const order = rows.map(row => ({ row, value: resultValue(field, row, filenames[row.id], values?.get(row.id), resolveCode) }));
    return order.sort((a, b) => compareLibrarySortValues(a.value, b.value, direction)).map(item => item.row);
  }, [sortColumn, rows, filenames, resolveCode]);
  const simpleOrder = useMemo(() => metadataSort ? rows : ordered(), [metadataSort, rows, ordered]);
  const metadataIds = (metadataSort ? rows : columns.some(field => localMetadataColumns.has(field))
    ? simpleOrder.slice(visibleStart, visibleStart + 32) : [])
    .filter(row => row.resultProvider === 'local' && row.persisted && Object.hasOwn(filenames, row.id)).map(row => row.id);
  const { values: metadata, loading } = useLibraryResultMetadata(metadataIds, metadataRevision, readMetadata);
  const orderedRows = useMemo(() => metadataSort ? ordered(metadata) : simpleOrder, [metadataSort, metadata, ordered, simpleOrder]);
  const valuesFor = (field: LibraryResultField, row: SongResult) => resultValue(field, row, filenames[row.id], metadata.get(row.id), resolveCode);
  const openColumns = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const trigger = columnsTrigger.current;
    const id = trigger?.getAttribute('popovertarget');
    if (id && !document.getElementById(id)?.matches(':popover-open')) trigger?.click();
  };

  // Keep the song and artist readable when a whole optional column is empty.
  const visibleColumns = columns.filter(field => !optionalMetadataColumns.has(field) ||
    rows.some(row => valuesFor(field, row)));
  const layout = [...visibleColumns.map(column => columnsLayout[column]), { min: 40 }];
  const grid = layout.map(({ min, flex }) => flex ? `minmax(${min}px, ${flex}fr)` : `${min}px`).join(' ');
  const gridWidth = layout.reduce((width, { min }) => width + min + 8, 16);
  return <div ref={listRef} className="library-results" style={{ '--result-grid': grid, '--result-min-width': `${gridWidth}px` } as React.CSSProperties} onScroll={event => {
    const option = event.currentTarget.querySelector<HTMLElement>('.song-option');
    if (option?.offsetHeight) setWindowStart(Math.floor(event.currentTarget.scrollTop / option.offsetHeight / 16) * 16);
  }}><div className="song-list">
    <div className="song-list__columns" role="group" aria-label="Sort or choose result columns"
      onContextMenu={openColumns}
      onKeyDown={event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) openColumns(event); }}>
      {visibleColumns.map(field => {
        const name = LIBRARY_RESULT_FIELDS[field];
        const direction = sortColumn?.field === field ? sortColumn.direction : null;
        const status = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'unsorted';
        const hint = direction === 'desc' ? `Clear ${name} sorting and return to import order.` :
          `Sort by ${name} in ${direction === 'asc' ? 'descending' : 'ascending'} order.`;
        return <Tooltip key={field} text={hint}><button type="button" className="song-column-sort"
          data-sort-field={field} data-direction={direction ?? 'off'} aria-label={`${name}, ${status}`}
          onClick={() => onSort(cycleLibrarySort(sort, field))}>
          <span className="song-column-label">{name}</span><span className="song-column-direction" aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span>
        </button></Tooltip>;
      })}
      <LibraryFieldPicker value={columns} disabled={savingColumns} onChange={onColumnsChange} triggerRef={columnsTrigger} />
    </div>
    {loading && metadataSort && <p className="library-sort-status" role="status">Reading local media details for sorting…</p>}
    <div role="listbox" aria-label="Songs">
    {orderedRows.map((row, index) => {
      const missing = missingMedia?.has(row.id);
      return <div key={row.id} className={`track-row song-option ${row.id === selected ? 'selected' : ''}`} data-provider={row.resultProvider} data-missing={missing || undefined}
      style={{ '--provider-color': RESULT_PROVIDER_COLORS[row.resultProvider] } as React.CSSProperties} role="option" aria-selected={row.id === selected} tabIndex={0}
      onClick={() => onSelect(row.id)} onDoubleClick={() => { onSelect(row.id); if (!missing) onQueue(row); }}
      onContextMenu={event => { event.preventDefault(); onSelect(row.id); onContext(row, event.clientX, event.clientY); }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') { event.preventDefault(); if (!missing) onQueue(row); }
        else if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); onSelect(row.id); const rect = event.currentTarget.getBoundingClientRect(); onContext(row, rect.left, rect.bottom); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.max(0, Math.min(orderedRows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus(); onSelect(orderedRows[next]?.id || ''); }
      }}>
      {visibleColumns.map(field => {
        const value = cellText(field, valuesFor(field, row));
        if (field === 'title') return <span className="song-option__title" key={field}><strong title={value}>{value}</strong>
          {missing && <span className="song-option__notice">File missing</span>}</span>;
        if (field === 'source' && row.catalogOnly) return <Tooltip key={field} text="Catalog search only. Playback is not connected for this service."><span className="song-option__cell">{value} · Catalog</span></Tooltip>;
        return <span className="song-option__cell" data-field={field} key={field} title={value || undefined}>{value}</span>;
      })}
      <span className="song-option__actions">{star(row)}</span>
    </div>;
    })}
    </div>
  </div>
    {!rows.length && <p className="empty">{emptyMessage}</p>}
  </div>;
}
