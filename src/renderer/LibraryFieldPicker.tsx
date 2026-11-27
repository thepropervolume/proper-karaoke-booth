import React from 'react';
import { DEFAULT_LIBRARY_RESULT_FIELDS, LIBRARY_RESULT_FIELDS, type LibraryResultField } from '../domain/library-result-fields';
import { LibraryOptionsPopover } from './LibraryOptionsPopover';

const availableFields = Object.keys(LIBRARY_RESULT_FIELDS) as LibraryResultField[];

export function LibraryFieldPicker({ value, disabled, onChange, triggerRef }: {
  value: readonly LibraryResultField[]; disabled: boolean; onChange(value: readonly LibraryResultField[]): void;
  triggerRef: React.Ref<HTMLButtonElement>;
}) {
  return <LibraryOptionsPopover className="library-columns-trigger" label="Choose result columns"
    tooltip="Choose which columns appear. You can also right-click any column heading."
    trigger={<span aria-hidden="true">▾</span>} triggerRef={triggerRef}>
      {availableFields.map(field => <label key={field}>
        <input type="checkbox" checked={value.includes(field)} disabled={disabled || field === 'title'}
          onChange={event => onChange(availableFields.filter(candidate => candidate === field ? event.target.checked : value.includes(candidate)))} />
        {LIBRARY_RESULT_FIELDS[field]}
      </label>)}
      <button type="button" disabled={disabled} onClick={() => onChange(DEFAULT_LIBRARY_RESULT_FIELDS)}>Restore Defaults</button>
  </LibraryOptionsPopover>;
}
