export type ShortcutAction = 'search' | 'playPause';
export type Shortcuts = Record<ShortcutAction, string[]>;
export const DEFAULT_SHORTCUTS: Shortcuts = { search: ['Control+KeyF', 'Meta+KeyF'], playPause: ['Space'] };

type KeyInput = { code: string; control: boolean; alt: boolean; shift: boolean; meta: boolean };
const modifiers = ['Control', 'Alt', 'Shift', 'Meta'] as const;
function canonical(binding: unknown): string {
  if (typeof binding !== 'string') throw new Error('Shortcut bindings must be strings.');
  const parts = binding.split('+');
  const code = parts.pop()!;
  if (!/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Enter|Escape|Arrow(?:Up|Down|Left|Right))$/.test(code) ||
      parts.some(part => !modifiers.includes(part as typeof modifiers[number])) || new Set(parts).size !== parts.length)
    throw new Error(`Invalid shortcut: ${binding}`);
  return [...modifiers.filter(modifier => parts.includes(modifier)), code].join('+');
}
export function parseShortcuts(value: unknown): Shortcuts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Shortcuts must be an object.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_SHORTCUTS, key))) throw new Error('Unknown shortcut action.');
  const result = {} as Shortcuts;
  const used = new Set<string>();
  for (const action of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
    const bindings = input[action] ?? DEFAULT_SHORTCUTS[action];
    if (!Array.isArray(bindings) || bindings.length === 0) throw new Error(`${action} must have at least one binding.`);
    result[action] = bindings.map(binding => {
      const normalized = canonical(binding);
      if (used.has(normalized)) throw new Error(`Conflicting shortcut: ${normalized}`);
      used.add(normalized);
      return normalized;
    });
  }
  return result;
}
export function matchesShortcut(shortcuts: Shortcuts, action: ShortcutAction, input: KeyInput): boolean {
  const key = [input.control && 'Control', input.alt && 'Alt', input.shift && 'Shift', input.meta && 'Meta', input.code].filter(Boolean).join('+');
  return shortcuts[action].includes(key);
}
