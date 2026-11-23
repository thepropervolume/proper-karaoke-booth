import React from 'react';
import { DEFAULT_LIBRARY_RESULT_FIELDS, LIBRARY_RESULT_FIELDS, type LibraryResultField } from '../domain/library-result-fields';

const availableFields = Object.keys(LIBRARY_RESULT_FIELDS) as LibraryResultField[];

export function LibraryFieldPicker({ value, disabled, onChange }: {
  value: readonly LibraryResultField[]; disabled: boolean; onChange(value: readonly LibraryResultField[]): void;
}) {
  return <details className="library-fields">
    <summary>Columns</summary>
    <div className="library-fields__options" aria-label="Search result columns" role="group">
      {availableFields.map(field => <label key={field}>
        <input type="checkbox" checked={value.includes(field)} disabled={disabled || field === 'title'}
          onChange={event => onChange(availableFields.filter(candidate => candidate === field ? event.target.checked : value.includes(candidate)))} />
        {LIBRARY_RESULT_FIELDS[field]}
      </label>)}
      <button type="button" disabled={disabled} onClick={() => onChange(DEFAULT_LIBRARY_RESULT_FIELDS)}>Restore Defaults</button>
    </div>
  </details>;
}
