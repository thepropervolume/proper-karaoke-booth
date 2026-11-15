import React from 'react';
import { RESULT_PROVIDER_COLORS, RESULT_PROVIDER_LABELS, type SongResult } from './unified-song-results';
import { Tooltip } from './Tooltip';
export function SongResults({ rows, selected, onSelect, onQueue, onContext, rating, listRef, onScroll }: {
  rows: readonly SongResult[]; selected: string; onSelect(id: string): void; onQueue(row: SongResult): void;
  onContext(row: SongResult, x: number, y: number): void; rating(row: SongResult): React.ReactNode;
  listRef: React.RefObject<HTMLDivElement | null>; onScroll(event: React.UIEvent<HTMLDivElement>): void;
}) {
  return <div ref={listRef} className="library-results" onScroll={onScroll}><div role="listbox" aria-label="Songs" className="song-list">
    {rows.map((row, index) => <div key={row.id} className={`track-row song-option ${row.id === selected ? 'selected' : ''}`} data-provider={row.resultProvider}
      style={{ '--provider-color': RESULT_PROVIDER_COLORS[row.resultProvider] } as React.CSSProperties} role="option" aria-selected={row.id === selected} tabIndex={0}
      onClick={() => onSelect(row.id)} onDoubleClick={() => { onSelect(row.id); onQueue(row); }}
      onContextMenu={event => { event.preventDefault(); onSelect(row.id); onContext(row, event.clientX, event.clientY); }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') { event.preventDefault(); onQueue(row); }
        else if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); onSelect(row.id); const rect = event.currentTarget.getBoundingClientRect(); onContext(row, rect.left, rect.bottom); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus(); onSelect(rows[next]?.id || ''); }
      }}>
      <div className="song-option__identity"><strong>{row.title}</strong><small>{row.artist || 'Unknown Artist'}</small></div>
      <div className="song-option__actions"><Tooltip text={row.catalogOnly ? 'Catalog search only. Playback is not connected for this service.' : RESULT_PROVIDER_LABELS[row.resultProvider]}><span className="song-source">{RESULT_PROVIDER_LABELS[row.resultProvider]}{row.catalogOnly ? ' · Catalog' : ''}</span></Tooltip>{!row.catalogOnly && rating(row)}</div>
    </div>)}
  </div>{!rows.length && <p className="empty">No matching songs.</p>}</div>;
}
