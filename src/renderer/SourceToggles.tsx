import React, { useState } from 'react';
import type { SourceVisibility } from '../domain/settings';

const SOURCES: readonly [keyof SourceVisibility, string][] = [
  ['local', 'Imported / Local'],
  ['karaokenerds', 'Karaoke Nerds'],
  ['youtube', 'YouTube'],
  ['karafun', 'KaraFun'],
  ['partytyme', 'Party Tyme'],
  ['sunfly', 'Sunfly'],
  ['stingray', 'Stingray'],
];

export function SearchSourceCheckboxes({ value, disabled, onChange }: {
  value: SourceVisibility; disabled?: boolean; onChange(id: keyof SourceVisibility, checked: boolean): void;
}) {
  return <div className="source-toggles__list">
    {SOURCES.map(([id, label]) => <label className="settings-check" key={id}>
      <input type="checkbox" aria-label={`Show ${label} in search`} checked={value[id]} disabled={disabled}
        onChange={event => onChange(id, event.target.checked)} /> {label}
    </label>)}
  </div>;
}

/** Search visibility is independent from whether a provider is connected. */
export function SourceToggles({ value, onSave }: {
  value: SourceVisibility;
  onSave: (value: SourceVisibility) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const change = async (id: keyof SourceVisibility, checked: boolean) => {
    if (saving) return;
    setSaving(true); setError('');
    try { await onSave({ ...value, [id]: checked }); }
    catch { setError('Could not save source visibility. Please try again.'); }
    finally { setSaving(false); }
  };

  return <section className="source-toggles" aria-label="Search sources" aria-busy={saving}>
    <h3>Show in Search</h3>
    <p className="muted">Choose the sources that appear in library search.</p>
    <SearchSourceCheckboxes value={value} disabled={saving} onChange={(id, checked) => void change(id, checked)} />
    {error && <p role="alert">{error}</p>}
  </section>;
}
