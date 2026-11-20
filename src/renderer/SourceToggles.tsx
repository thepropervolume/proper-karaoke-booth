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
    <p className="muted">Account and catalog settings still apply. Existing queue and playback are unchanged.</p>
    <div className="source-toggles__list">
      {SOURCES.map(([id, label]) => <label className="settings-check" key={id}>
        <input type="checkbox" aria-label={`Show ${label} in search`} checked={value[id]} disabled={saving}
          onChange={event => void change(id, event.target.checked)} /> {label}
      </label>)}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
