import React, { useEffect, useRef, useState } from 'react';
import {
  bindingFromKeyInput, DEFAULT_SHORTCUTS, formatShortcut, MAX_SHORTCUTS_PER_ACTION,
  parseShortcuts, SHORTCUT_ACTIONS, type ShortcutAction, type Shortcuts,
} from '../domain/shortcuts';
import '../styles/keyboard-shortcuts.scss';

type EditingBinding = { action: ShortcutAction; index: number | null };

/** Deliberately has no nested form: Preferences owns the surrounding form. */
export function KeyboardShortcuts({ value, onSave, onEditFile }: {
  value: Shortcuts; onSave: (value: Shortcuts) => Promise<void>; onEditFile: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() => parseShortcuts(value));
  const [editing, setEditing] = useState<EditingBinding | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const capture = useRef<HTMLInputElement>(null);
  const focusTarget = useRef<string | null>(null);
  useEffect(() => { setDraft(parseShortcuts(value)); setEditing(null); }, [value]);
  useEffect(() => {
    if (editing) capture.current?.focus();
    else if (focusTarget.current) { document.getElementById(focusTarget.current)?.focus(); focusTarget.current = null; }
  }, [editing]);
  const changed = JSON.stringify(draft) !== JSON.stringify(value);
  const groups = [...new Set(SHORTCUT_ACTIONS.map(action => action.group))];

  const record = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Capture happens on a focused editor input; do not dispatch app commands.
    if (event.key === 'Tab') return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { setEditing(null); setError(''); return; }
    if (!editing || event.repeat || event.nativeEvent.isComposing) return;
    const binding = bindingFromKeyInput({ code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey });
    if (!binding) return;
    const bindings = [...draft[editing.action]];
    if (editing.index === null) bindings.push(binding); else bindings[editing.index] = binding;
    try {
      setDraft(parseShortcuts({ ...draft, [editing.action]: bindings }));
      setEditing(null); setError(''); setNotice('Shortcut changed. Save Shortcuts to apply it.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const save = async (next: Shortcuts, reset = false) => {
    setSaving(true); setError(''); setNotice('');
    try {
      const validated = parseShortcuts(next);
      await onSave(validated); setDraft(validated); setEditing(null);
      setNotice(reset ? 'Default keyboard shortcuts restored.' : 'Keyboard shortcuts saved.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  const begin = (action: ShortcutAction, index: number | null) => {
    focusTarget.current = index === null ? `shortcut-add-${action}` : `shortcut-binding-${action}-${index}`;
    setEditing({ action, index }); setError(''); setNotice('');
  };

  return <section className="keyboard-shortcuts" aria-label="Keyboard Shortcut Editor">
    <div className="keyboard-shortcuts__toolbar">
      <p>Click a shortcut to change it, or add more than one shortcut to an action. Changes save separately from other preferences and apply immediately after saving.</p>
      <button type="button" disabled={saving} onClick={() => void save(parseShortcuts(DEFAULT_SHORTCUTS), true)}>Reset to Defaults</button>
    </div>
    <div className="keyboard-shortcuts__groups">
      {groups.map(group => <section key={group} className="keyboard-shortcuts__group" aria-label={`${group} Shortcuts`}>
        <h3>{group}</h3>
        <dl>
          {SHORTCUT_ACTIONS.filter(action => action.group === group).map(action => <div className="keyboard-shortcuts__row" key={action.id}>
            <dt>{action.label}{action.scope !== 'application' && <small>{action.scope === 'player' ? 'Player window only' : 'Queue only'}</small>}</dt>
            <dd>
              <div className="keyboard-shortcuts__bindings">
                {draft[action.id].map((binding, index) => <span className="keyboard-shortcuts__binding" key={`${binding}-${index}`}>
                  <button type="button" id={`shortcut-binding-${action.id}-${index}`} className="keyboard-shortcuts__key" disabled={saving} aria-label={`Change ${formatShortcut(binding)} for ${action.label}`} onClick={() => begin(action.id, index)}><kbd>{formatShortcut(binding)}</kbd></button>
                  <button type="button" className="keyboard-shortcuts__remove" disabled={saving} aria-label={`Remove ${formatShortcut(binding)} from ${action.label}`} onClick={() => {
                    setDraft(current => ({ ...current, [action.id]: current[action.id].filter((_, position) => position !== index) }));
                    setEditing(null); setError(''); setNotice('Shortcut removed. Save Shortcuts to apply it.');
                  }}>×</button>
                </span>)}
                {draft[action.id].length === 0 && <span className="muted keyboard-shortcuts__unassigned">Unassigned</span>}
                <button type="button" id={`shortcut-add-${action.id}`} className="keyboard-shortcuts__add" disabled={saving || draft[action.id].length >= MAX_SHORTCUTS_PER_ACTION} aria-label={`Add Shortcut for ${action.label}`} onClick={() => begin(action.id, null)}>+ Add</button>
              </div>
              {editing?.action === action.id && <div className="keyboard-shortcuts__capture">
                <input ref={capture} data-shortcut-capture="true" readOnly value="Press a shortcut…" aria-label={`Record Shortcut for ${action.label}`} aria-describedby="shortcut-record-help" onKeyDown={record} />
                <button type="button" onClick={() => { setEditing(null); setError(''); }}>Cancel Recording</button>
              </div>}
            </dd>
          </div>)}
        </dl>
      </section>)}
    </div>
    {editing && <p id="shortcut-record-help" className="muted">Press the desired key combination. Escape cancels recording; Tab moves to Cancel Recording. Escape and Tab can also be assigned in the JSON file.</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="keyboard-shortcuts__actions">
      <button type="button" disabled={saving || !!editing || !changed} onClick={() => void save(draft)}>Save Shortcuts</button>
      <span className="muted">{changed ? 'Unsaved shortcut changes' : 'All shortcut changes saved'}</span>
    </div>
    <div className="keyboard-shortcuts__custom">
      <h3>Customization</h3>
      <p className="muted">Saving shortcuts writes every action and its bindings to JSON, including unassigned actions. You can edit the file directly for additional control. Close the app before changing the file, then restart to load your changes.</p>
      <button type="button" disabled={saving} onClick={() => {
        setError(''); void Promise.resolve().then(onEditFile).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
      }}>Edit custom shortcuts</button>
    </div>
  </section>;
}
