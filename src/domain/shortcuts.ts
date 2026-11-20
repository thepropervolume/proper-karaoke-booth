/** One registry feeds help, the editor, menus and keyboard dispatch. */
export const KARAOKE_PAIR_IMPORT_LABEL = 'Import CD+G / LRC / ZIP';
export const SHORTCUT_ACTIONS = [
  { id: 'search', label: 'Search Song Library', group: 'Application', scope: 'application' },
  { id: 'preferences', label: 'Open Preferences', group: 'Application', scope: 'application' },
  { id: 'keybindings', label: 'Open Keyboard Shortcuts', group: 'Application', scope: 'application' },
  { id: 'backupShow', label: 'Back Up Show', group: 'Application', scope: 'application' },
  { id: 'restoreShow', label: 'Restore Show Backup', group: 'Application', scope: 'application' },
  { id: 'playPause', label: 'Play/Pause', group: 'Playback', scope: 'application' },
  { id: 'previous', label: 'Restart Current Song', group: 'Playback', scope: 'application' },
  { id: 'stop', label: 'Stop', group: 'Playback', scope: 'application' },
  { id: 'skip', label: 'Skip Song', group: 'Playback', scope: 'application' },
  { id: 'seekBackward', label: 'Rewind 10 Seconds', group: 'Playback', scope: 'application' },
  { id: 'seekForward', label: 'Forward 10 Seconds', group: 'Playback', scope: 'application' },
  { id: 'removeRequest', label: 'Remove Selected Queue Request', group: 'Queue', scope: 'queue' },
  { id: 'singerDisplay', label: 'Open Singer Display', group: 'Singer Display', scope: 'application' },
  { id: 'toggleFullscreen', label: 'Toggle Fullscreen', group: 'Singer Display', scope: 'player' },
  { id: 'importVideo', label: 'Import Video File', group: 'Library', scope: 'application' },
  { id: 'importDirectory', label: 'Import Custom Directory', group: 'Library', scope: 'application' },
  { id: 'importCdg', label: KARAOKE_PAIR_IMPORT_LABEL, group: 'Library', scope: 'application' },
  { id: 'appearance', label: 'Open Appearance Preferences', group: 'Appearance', scope: 'application' },
  { id: 'accentColor', label: 'Choose Accent Color', group: 'Appearance', scope: 'application' },
  { id: 'cycleAppearance', label: 'Cycle Appearance', group: 'Appearance', scope: 'application' },
  { id: 'cycleAccent', label: 'Cycle Accent Color', group: 'Appearance', scope: 'application' },
  { id: 'layoutStandard', label: 'Standard Layout', group: 'Layouts', scope: 'application' },
  { id: 'layoutRotation', label: 'Singer Rotation Layout', group: 'Layouts', scope: 'application' },
  { id: 'layoutLibrary', label: 'Song Library Layout', group: 'Layouts', scope: 'application' },
] as const;

export type ShortcutAction = typeof SHORTCUT_ACTIONS[number]['id'];
export type Shortcuts = Record<ShortcutAction, string[]>;
export type ShortcutKeyInput = { code: string; control: boolean; alt: boolean; shift: boolean; meta: boolean };
export const MAX_SHORTCUTS_PER_ACTION = 16;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  search: ['Control+KeyF', 'Meta+KeyF'], playPause: ['Space'],
  preferences: ['Control+Comma', 'Meta+Comma', 'Alt+Comma'],
  keybindings: ['Control+Slash', 'Meta+Slash', 'F1'],
  toggleFullscreen: ['KeyF', 'Shift+KeyF'],
  previous: [], stop: [], skip: [], seekBackward: [], seekForward: [], singerDisplay: [],
  removeRequest: ['Delete'],
  importVideo: [], importDirectory: [], importCdg: [], backupShow: [], restoreShow: [],
  appearance: [], accentColor: [], cycleAppearance: [], cycleAccent: [],
  layoutStandard: [], layoutRotation: [], layoutLibrary: [],
};

const modifiers = ['Control', 'Alt', 'Shift', 'Meta'] as const;
const keyCode = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Comma|Period|Slash|Backslash|Semicolon|Quote|Backquote|BracketLeft|BracketRight|Minus|Equal|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/;

export function canonicalShortcut(binding: unknown): string {
  if (typeof binding !== 'string' || binding.length > 128) throw new Error('Shortcut bindings must be strings of at most 128 characters.');
  const parts = binding.split('+'), code = parts.pop()!;
  if (!keyCode.test(code) || parts.some(part => !modifiers.includes(part as typeof modifiers[number])) || new Set(parts).size !== parts.length)
    throw new Error(`Invalid shortcut: ${binding}`);
  return [...modifiers.filter(modifier => parts.includes(modifier)), code].join('+');
}

/** Old two-action files acquire new defaults; an explicit [] disables an action. */
export function parseShortcuts(value: unknown): Shortcuts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Shortcuts must be an object.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_SHORTCUTS, key))) throw new Error('Unknown shortcut action.');
  const legacyOverrides = new Set(['search', 'playPause'].flatMap(action =>
    Object.hasOwn(input, action) && Array.isArray(input[action]) && input[action].length <= MAX_SHORTCUTS_PER_ACTION
      ? (input[action] as unknown[]).map(canonicalShortcut) : []));
  const result = {} as Shortcuts, used = new Map<string, string>();
  for (const action of SHORTCUT_ACTIONS) {
    const explicit = Object.hasOwn(input, action.id);
    // A valid old override wins over a newly added default during upgrade. The
    // editor submits every action, so editing still detects all conflicts.
    const bindings = explicit ? input[action.id] : DEFAULT_SHORTCUTS[action.id].filter(binding =>
      action.id === 'search' || action.id === 'playPause' || !legacyOverrides.has(binding));
    if (!Array.isArray(bindings) || bindings.length > MAX_SHORTCUTS_PER_ACTION)
      throw new Error(`${action.label} must have between 0 and ${MAX_SHORTCUTS_PER_ACTION} bindings.`);
    result[action.id] = bindings.map(binding => {
      const normalized = canonicalShortcut(binding), previous = used.get(normalized);
      if (previous) throw new Error(`Conflicting shortcut ${formatShortcut(normalized)}: ${previous} and ${action.label}. Remove or change one binding.`);
      used.set(normalized, action.label);
      return normalized;
    });
  }
  return result;
}

/** Modifier-only keys are ignored while recording, not stored as empty bindings. */
export function bindingFromKeyInput(input: ShortcutKeyInput): string | null {
  if (!keyCode.test(input.code)) return null;
  return [input.control && 'Control', input.alt && 'Alt', input.shift && 'Shift', input.meta && 'Meta', input.code].filter(Boolean).join('+');
}

export function matchesShortcut(shortcuts: Shortcuts, action: ShortcutAction, input: ShortcutKeyInput): boolean {
  const binding = bindingFromKeyInput(input);
  // Be tolerant of a still-open older singer display while its host is updating.
  return binding !== null && (shortcuts[action] ?? []).includes(binding);
}

const keyLabels: Record<string, string> = {
  Control: 'Ctrl', Meta: 'Cmd', Space: 'Spacebar', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Semicolon: ';', Quote: "'", Backquote: '`', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
export function formatShortcut(binding: string): string {
  return binding.split('+').map(part => keyLabels[part] ?? part.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Numpad ')).join('+');
}

/** Native editing chords take precedence over custom actions inside text fields. */
export function isTextEditingShortcut(input: ShortcutKeyInput): boolean {
  if ((input.control || input.meta) && !input.alt && /^Key[ACVXYZ]$/.test(input.code)) return true;
  return /^(Arrow(?:Up|Down|Left|Right)|Home|End|Backspace|Delete|Insert)$/.test(input.code);
}
