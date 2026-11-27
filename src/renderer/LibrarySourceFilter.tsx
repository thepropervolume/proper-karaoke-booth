import React from 'react';
import { LibraryOptionsPopover } from './LibraryOptionsPopover';
import { RESULT_PROVIDER_LABELS, type SongResultProvider } from './unified-song-results';

/** Independent of the global source switches in Preferences. */
export function LibrarySourceFilter({ choices, selected, busy, onChange }: {
  choices: readonly SongResultProvider[]; selected: readonly SongResultProvider[]; busy: boolean;
  onChange(value: SongResultProvider[]): void;
}) {
  return <div className="library-source-filter">
    <LibraryOptionsPopover className="library-source-trigger" label="Filter by source"
      tooltip="Choose one or more sources to browse and search. With none selected, typing searches all enabled sources."
      trigger={<>Source{selected.length > 0 && <span className="library-source-count">{selected.length}</span>} <span aria-hidden="true">▾</span></>}>
        {choices.map(source => <label key={source}>
          <input type="checkbox" disabled={busy} checked={selected.includes(source)}
            onChange={event => onChange(event.target.checked ? [...selected, source] : selected.filter(item => item !== source))} />
          {RESULT_PROVIDER_LABELS[source]}
        </label>)}
        {choices.length === 0 && <span className="muted">Enable sources in Preferences.</span>}
        <button type="button" disabled={busy || selected.length === 0} onClick={() => onChange([])}>Clear sources</button>
    </LibraryOptionsPopover>
  </div>;
}
